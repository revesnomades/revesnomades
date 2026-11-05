// Enregistrement d'une commande payée : base, stock, promotions, bons cadeaux, emails.
// Utilisé par stripe-webhook (après paiement Stripe) et par create-checkout-session
// (commande entièrement réglée par un bon cadeau, sans passage par Stripe).
// deno-lint-ignore-file no-explicit-any
import { Image, decode } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

export type OrderItem = {
  id: string;
  type: "product" | "sejour" | "gift_card";
  name: string;
  qty: number;
  price?: number;
  d?: number; // remise affectée à cet article (euros)
};

export type GiftItem = { amount: number; to?: string; email?: string; from?: string; msg?: string };

export type PaidOrder = {
  sessionId: string;
  orderRef: string;
  customerEmail: string;
  customerName: string;
  amount: number; // total réellement payé (euros)
  items: OrderItem[];
  giftItems: GiftItem[];
  shipping: { name: string; line1: string; line2: string; city: string; postal_code: string; country: string } | null;
  discount: { amount: number; label: string; promoCode: string; promoIds: string[] };
  giftUsed: { code: string; amount: number } | null; // bon cadeau utilisé pour payer
  userId: string;
  // Anciens formats (produit unique, séjour seul)
  legacy: { type: string; productName?: string; productId?: string; eventName?: string } | null;
};

export const GIFT_CARD_VALIDITY_MONTHS = 12;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const euro = (n: number) => `${(Number(n) || 0).toFixed(2).replace(".", ",")} €`;
const dateFr = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

// Code lisible : CADEAU-XXXX-XXXX, sans 0/O/1/I
export function makeGiftCode() {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const part = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), b => chars[b % chars.length]).join("");
  return `CADEAU-${part()}-${part()}`;
}

// ── Carte cadeau en image : la carte « Bon cadeau » d'Âmes Nomades, remplie ──
// Base : assets/img/bon-cadeau-vierge.jpg (1200 × 851) ; polices : Outfit et JetBrains Mono (assets/fonts).
// Les valeurs sont dessinées dans les cadres blancs, et un 4e cadre reçoit le code.
const GIFT_ASSETS_BASE = Deno.env.get("GIFT_ASSETS_BASE") || "https://amesnomades.com";
const GIFT_BUCKET = "gift-cards";
const giftAssetCache = new Map<string, Promise<Uint8Array>>();
function giftAsset(path: string) {
  if (!giftAssetCache.has(path)) {
    giftAssetCache.set(path, fetch(`${GIFT_ASSETS_BASE}${path}`).then(async r => {
      if (!r.ok) throw new Error(`asset ${path} : HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    }).catch(e => { giftAssetCache.delete(path); throw e; }));
  }
  return giftAssetCache.get(path)!;
}

export async function renderGiftCardImage(g: { code: string; amount: number; expiresAt: Date; from?: string }) {
  const [baseBytes, label, value, mono] = await Promise.all([
    giftAsset("/assets/img/bon-cadeau-vierge.jpg"),
    giftAsset("/assets/fonts/Outfit-Medium.ttf"),
    giftAsset("/assets/fonts/Outfit-SemiBold.ttf"),
    giftAsset("/assets/fonts/JetBrainsMono-Medium.ttf"),
  ]);
  const base = await decode(baseBytes) as Image;
  const INK = 0x1e1f22ff, WHITE = 0xfffdf3ff;
  // Cadres blancs mesurés sur l'image de base : x 85→703, hauteur 37, en y 357 / 422 / 481, pas 59,5
  const BOX = { x0: 85, x1: 703, h: 37, ys: [357, 422, 481], step: 59.5 };
  const put = async (text: string, font: Uint8Array, size: number, x: number, boxY: number) => {
    const img = await Image.renderText(font, size, text, INK);
    base.composite(img, x, Math.round(boxY + (BOX.h - img.height) / 2) + 1);
  };
  await put(g.from || "Âmes Nomades", value, 21, 300, BOX.ys[0]);
  await put(`${g.amount} €`, value, 21, 300, BOX.ys[1]);
  await put(dateFr(g.expiresAt), value, 21, 300, BOX.ys[2]);
  const y4 = Math.round(BOX.ys[2] + BOX.step);
  base.drawBox(BOX.x0, y4, BOX.x1 - BOX.x0, BOX.h, WHITE);
  await put("Code :", label, 21, 100, y4);
  await put(g.code, mono, 21, 300, y4);
  return await base.encodeJPEG(88);
}

// Génère la carte, la dépose dans le bucket public « gift-cards » et renvoie son URL (null en cas d'échec)
export async function publishGiftCardImage(db: any, g: { code: string; amount: number; expiresAt: Date; from?: string }) {
  try {
    const bytes = await renderGiftCardImage(g);
    const path = `${g.code}.jpg`;
    const { error } = await db.storage.from(GIFT_BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (error) throw new Error(error.message);
    const { data } = db.storage.from(GIFT_BUCKET).getPublicUrl(path);
    return data?.publicUrl as string || null;
  } catch (e) {
    console.error("Carte cadeau en image non générée, carte HTML envoyée à la place :", e instanceof Error ? e.message : e);
    return null;
  }
}

// Email avec la carte en image (identique à la carte imprimée), message et mode d'emploi
export function giftCardImageEmailHtml(g: { code: string; amount: number; to?: string; from?: string; msg?: string; imageUrl: string }) {
  const sans = "Helvetica, Arial, sans-serif";
  return `<div style="margin:0;padding:20px 12px;background:#faf5dc">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;border-collapse:collapse">
    <tr><td style="padding:0 0 14px;font-family:${sans};font-size:16px;line-height:1.5;color:#1e1f22">
      ${g.to ? `${esc(g.to)}, ` : ""}${g.from ? `${esc(g.from)} t'offre` : "voici"} un bon cadeau Âmes Nomades de <strong>${euro(g.amount)}</strong>.
    </td></tr>
    <tr><td style="padding:0">
      <a href="${g.imageUrl}" style="display:block"><img src="${g.imageUrl}" width="640" alt="Bon cadeau Âmes Nomades de ${euro(g.amount)}, code ${esc(g.code)}" style="display:block;width:100%;max-width:640px;height:auto;border:0"></a>
    </td></tr>
    <tr><td style="padding:14px 0 0;font-family:${sans};font-size:13px;color:#62666e"><a href="${g.imageUrl}" style="color:#1e1f22">Télécharger la carte</a> pour l'imprimer ou l'offrir en main propre.</td></tr>
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:18px auto 0;background:#fffdf3;border-collapse:collapse">
    <tr><td style="padding:24px 30px;font-family:${sans};color:#1e1f22">
      ${g.msg ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;font-style:italic;color:#2d2e33">« ${esc(g.msg)} »</p>` : ""}
      <h3 style="font-weight:600;font-size:15px;margin:0 0 8px">Comment l'utiliser</h3>
      <ol style="margin:0;padding-left:18px;font-size:14px;line-height:1.7;color:#2d2e33">
        <li>Choisis un séjour ou des articles sur <a href="https://amesnomades.com" style="color:#1e1f22">amesnomades.com</a>.</li>
        <li>Dans le panier, saisis le code <strong style="font-family:'Courier New',monospace">${esc(g.code)}</strong> dans le champ « Bon cadeau » : sa valeur est déduite du total.</li>
        <li>Il est utilisable en plusieurs fois : le reste est conservé sur le bon.</li>
      </ol>
      <p style="font-size:14px;line-height:1.7;color:#2d2e33;margin:14px 0 0">Tu peux aussi l'enregistrer dans ton <a href="https://amesnomades.com/compte.html" style="color:#1e1f22">espace compte</a> pour suivre le montant restant et la date de validité.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="font-size:12px;color:#999;margin:0">Des questions ? Contacte-nous : <a href="mailto:contact@amesnomades.com" style="color:#666">contact@amesnomades.com</a></p>
    </td></tr>
  </table>
</div>`;
}

// Email : carte cadeau envoyée au destinataire (ou à l'acheteur).
// Reprend la carte « Bon cadeau » d'Âmes Nomades (fond jaune paille, soleils dessinés à droite),
// remplie avec les informations de la commande. Tableaux et polices web-safe pour les clients email.
const GIFT_CARD_BG = "#f1e6b6";
const GIFT_CARD_SUNS = "https://amesnomades.com/assets/img/bon-cadeau-soleils.jpg";

export function giftCardEmailHtml(g: { code: string; amount: number; expiresAt: Date; from?: string; to?: string; msg?: string }) {
  const mono = "'Courier New', Courier, monospace";
  const sans = "Helvetica, Arial, sans-serif";
  const row = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:0 0 12px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#fffdf3"><tr>
      <td style="padding:9px 14px;font-family:${sans};font-size:15px;color:#1e1f22;white-space:nowrap">${label}</td>
      <td class="gc-value" style="padding:9px 14px 9px 0;font-family:${strong ? mono : sans};font-size:${strong ? "17px" : "15px"};font-weight:700;letter-spacing:${strong ? ".12em" : "0"};color:#1e1f22;text-align:right;white-space:nowrap">${value}</td>
    </tr></table></td></tr>`;
  const rows = [
    g.to ? row("Pour :", esc(g.to)) : "",
    g.from ? row("De la part de :", esc(g.from)) : "",
    row("D'une valeur de :", euro(g.amount)),
    row("Valable jusqu'au :", dateFr(g.expiresAt)),
    row("Code :", esc(g.code), true),
  ].join("");
  return `<div style="margin:0;padding:20px 12px;background:#faf5dc">
  <style>
    @media only screen and (max-width: 520px) {
      .gc-left, .gc-suns { display: block !important; width: 100% !important; box-sizing: border-box; }
      .gc-suns { height: 150px !important; background-position: center 30% !important; }
      .gc-suns img { display: none !important; }
      .gc-value { font-size: 14px !important; }
    }
  </style>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;background:${GIFT_CARD_BG};border-collapse:collapse">
    <tr>
      <td class="gc-left" valign="top" style="padding:34px 20px 30px 30px;width:62%">
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:21px;letter-spacing:.3em;text-transform:uppercase;color:#1e1f22;margin:0 0 44px">Âmes Nomades</div>
        <div style="font-family:${mono};font-size:30px;letter-spacing:.28em;text-transform:uppercase;color:#1e1f22;line-height:1.1">Bon cadeau</div>
        <div style="font-family:${mono};font-size:14px;letter-spacing:.14em;color:#1e1f22;margin:12px 0 24px">Valable sur tout le site</div>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table>
        <div style="font-family:${mono};font-size:13px;letter-spacing:.1em;line-height:1.7;color:#1e1f22;margin-top:40px">Âmes Nomades Retreat,<br>Retraites et séjours bien-être<br>www.amesnomades.com</div>
      </td>
      <td class="gc-suns" valign="top" style="width:38%;padding:0;background:${GIFT_CARD_BG} url('${GIFT_CARD_SUNS}') no-repeat right top;background-size:cover">
        <img src="${GIFT_CARD_SUNS}" width="240" alt="" style="display:block;width:100%;height:auto;border:0">
      </td>
    </tr>
  </table>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;background:#fffdf3;border-collapse:collapse">
    <tr><td style="padding:24px 30px;font-family:${sans};color:#1e1f22">
      ${g.msg ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;font-style:italic;color:#2d2e33">« ${esc(g.msg)} »</p>` : ""}
      <h3 style="font-weight:600;font-size:15px;margin:0 0 8px">Comment l'utiliser</h3>
      <ol style="margin:0;padding-left:18px;font-size:14px;line-height:1.7;color:#2d2e33">
        <li>Choisis un séjour ou des articles sur <a href="https://amesnomades.com" style="color:#1e1f22">amesnomades.com</a>.</li>
        <li>Dans le panier, saisis le code ci-dessus dans le champ « Bon cadeau » : sa valeur est déduite du total.</li>
        <li>Il est utilisable en plusieurs fois : le reste est conservé sur le bon.</li>
      </ol>
      <p style="font-size:14px;line-height:1.7;color:#2d2e33;margin:14px 0 0">Tu peux aussi l'enregistrer dans ton <a href="https://amesnomades.com/compte.html" style="color:#1e1f22">espace compte</a> pour suivre le montant restant et la date de validité.</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="font-size:12px;color:#999;margin:0">Des questions ? Contacte-nous : <a href="mailto:contact@amesnomades.com" style="color:#666">contact@amesnomades.com</a></p>
    </td></tr>
  </table>
</div>`;
}

// Insère avec des colonnes optionnelles ; si elles n'existent pas encore, réessaie sans
async function insertWithExtra(db: any, table: string, row: Record<string, unknown>, extra: Record<string, unknown>) {
  const { error } = await db.from(table).insert({ ...row, ...extra });
  if (!error || !Object.keys(extra).length) return error;
  console.warn(`${table} : colonnes optionnelles absentes, insertion sans (${error.message})`);
  const { error: retryErr } = await db.from(table).insert(row);
  return retryErr;
}

export async function recordPaidOrder(db: any, order: PaidOrder) {
  const { customerEmail, customerName, amount, items, sessionId, orderRef } = order;
  const parts = customerName.split(" ");
  const firstName = parts[0] || "";
  const lastName = parts.slice(1).join(" ");
  const shippingCols = order.shipping ? {
    shipping_name: order.shipping.name || customerName,
    shipping_line1: order.shipping.line1, shipping_line2: order.shipping.line2,
    shipping_city: order.shipping.city, shipping_postal_code: order.shipping.postal_code, shipping_country: order.shipping.country,
  } : {};
  const discountCols = order.discount.amount > 0
    ? { discount_amount: order.discount.amount, discount_label: order.discount.label, promo_code: order.discount.promoCode || null }
    : {};

  // 1. Promotions : une utilisation par paiement, désactivation à la limite
  for (const promotionId of order.discount.promoIds) {
    const { error: rpcErr } = await db.rpc("record_promo_use", { p_session_id: sessionId, p_promotion_id: promotionId });
    if (!rpcErr) continue;
    console.warn("record_promo_use indisponible, comptage direct :", rpcErr.message);
    const { data: promo } = await db.from("promotions").select("uses_count, max_uses, active").eq("id", promotionId).maybeSingle();
    if (!promo) continue;
    const uses = (Number(promo.uses_count) || 0) + 1;
    await db.from("promotions").update({ uses_count: uses, active: promo.max_uses != null && uses >= Number(promo.max_uses) ? false : promo.active }).eq("id", promotionId);
  }

  // 2. Bon cadeau utilisé pour payer : débité une seule fois par paiement
  let giftBalanceLeft: number | null = null;
  if (order.giftUsed && order.giftUsed.amount > 0) {
    const { data, error } = await db.rpc("gift_card_redeem", { p_session_id: sessionId, p_code: order.giftUsed.code, p_amount: order.giftUsed.amount });
    if (error) console.error("Débit du bon cadeau impossible :", error.message);
    else giftBalanceLeft = Number(data);
  }

  if (!customerEmail) { console.warn("Commande sans email client, enregistrement partiel"); }

  const products = items.filter(i => i.type === "product");
  const stays = items.filter(i => i.type === "sejour");
  const articlesLabel = [
    ...items.map(i => `${i.name} ×${i.qty}`),
    ...order.giftItems.map(g => `Bon cadeau ${euro(g.amount)}${g.to ? ` pour ${g.to}` : ""}`),
  ].join(", ") || order.legacy?.productName || order.legacy?.eventName || "—";

  if (order.legacy?.type === "product") {
    // Ancien format produit unique
    await insertWithExtra(db, "purchases", { email: customerEmail, firstname: firstName, lastname: lastName, product_name: order.legacy.productName || "Produit", amount, status: "paid", ...shippingCols }, {});
    if (order.legacy.productId) {
      const { data: prod } = await db.from("products").select("stock").eq("id", order.legacy.productId).single();
      if (prod && prod.stock !== null && prod.stock > 0) await db.from("products").update({ stock: prod.stock - 1 }).eq("id", order.legacy.productId);
    }
  } else if (order.legacy?.type === "sejour") {
    await db.from("event_registrations").insert({ email: customerEmail, firstname: firstName, lastname: lastName, event_name: order.legacy.eventName || "Séjour Âmes Nomades", amount, status: "paid" });
  } else {
    // 3. Achat global
    const purchaseError = await insertWithExtra(db, "purchases", {
      email: customerEmail, firstname: firstName, lastname: lastName,
      product_name: articlesLabel || "Commande", amount, status: "paid", ...shippingCols,
    }, { ...discountCols, order_ref: orderRef });
    if (purchaseError) console.error("Erreur insertion achat:", purchaseError);

    // 4. Une réservation par séjour
    for (const item of stays) {
      const itemAmount = item.price ? item.price * item.qty : amount;
      const itemDiscount = Number(item.d) || 0;
      const row: Record<string, unknown> = { stay_id: item.id || null, stay_title: item.name || "Séjour", customer_name: customerName, customer_email: customerEmail, price_label: item.name || "Standard", amount: itemAmount, status: "paid" };
      const err = await insertWithExtra(db, "bookings", { ...row, amount_paid: Math.round((itemAmount - itemDiscount) * 100) / 100, stripe_session_id: sessionId, booking_date: new Date().toISOString().split("T")[0] },
        itemDiscount > 0 ? { discount_amount: itemDiscount, discount_label: order.discount.label, promo_code: order.discount.promoCode || null } : {});
      if (err) {
        console.warn("Insert complet échoué, retry sans colonnes optionnelles:", err.message);
        const { error: retryErr } = await db.from("bookings").insert(row);
        if (retryErr) console.error("Erreur insertion booking séjour:", retryErr);
      }
    }

    // 5. Stock des produits
    for (const item of products) {
      if (!item.id) continue;
      const { data: prod } = await db.from("products").select("stock").eq("id", item.id).single();
      if (prod && prod.stock !== null && prod.stock > 0) {
        const newStock = Math.max(0, prod.stock - item.qty);
        await db.from("products").update({ stock: newStock }).eq("id", item.id);
        console.log(`Stock produit ${item.id} : ${prod.stock} → ${newStock}`);
      }
    }
  }

  // 6. Bons cadeaux achetés : création + envoi de la carte
  const brevoApiKey = Deno.env.get("BREVO_API_KEY");
  const sendEmail = async (to: { email: string; name: string }[], subject: string, htmlContent: string, attachment?: Array<{ url: string; name: string }>) => {
    if (!brevoApiKey) { console.warn("BREVO_API_KEY manquante — email non envoyé :", subject); return; }
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "Content-Type": "application/json", "api-key": brevoApiKey },
      body: JSON.stringify({ sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" }, to, subject, htmlContent, ...(attachment?.length ? { attachment } : {}) }),
    });
    const txt = await res.text();
    if (!res.ok) console.error(`Brevo email erreur (${res.status}):`, txt);
    else console.log(`Email envoyé à ${to.map(t => t.email).join(", ")}`);
  };

  const createdCards: Array<{ code: string; amount: number; sentTo: string }> = [];
  for (const g of order.giftItems) {
    const expiresAt = new Date(); expiresAt.setMonth(expiresAt.getMonth() + GIFT_CARD_VALIDITY_MONTHS);
    let code = makeGiftCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { error } = await db.from("gift_cards").insert({
        code, initial_amount: g.amount, balance: g.amount, status: "active", expires_at: expiresAt.toISOString(),
        buyer_email: customerEmail, buyer_name: customerName, recipient_name: g.to || null, recipient_email: g.email || null,
        message: g.msg || null, order_ref: orderRef, stripe_session_id: sessionId,
        // Bon acheté pour soi par un client connecté : déjà rattaché à son compte
        claimed_by: !g.email && order.userId ? order.userId : null, claimed_at: !g.email && order.userId ? new Date().toISOString() : null,
      });
      if (!error) break;
      if (attempt === 4) { console.error("Création du bon cadeau impossible :", error.message); code = ""; }
      else code = makeGiftCode();
    }
    if (!code) continue;
    const sentTo = g.email || customerEmail;
    createdCards.push({ code, amount: g.amount, sentTo });
    // Carte en image (identique à la carte imprimée) ; carte HTML si la génération échoue
    const imageUrl = await publishGiftCardImage(db, { code, amount: g.amount, expiresAt, from: g.from });
    const cardHtml = imageUrl
      ? giftCardImageEmailHtml({ code, amount: g.amount, to: g.to, from: g.from, msg: g.msg, imageUrl })
      : giftCardEmailHtml({ code, amount: g.amount, expiresAt, from: g.from, to: g.to, msg: g.msg });
    const attachment = imageUrl ? [{ url: imageUrl, name: `bon-cadeau-ames-nomades-${code}.jpg` }] : undefined;
    if (sentTo) {
      await sendEmail([{ email: sentTo, name: g.to || firstName || "" }],
        g.from ? `${g.from} t'offre un bon cadeau Âmes Nomades` : "Ton bon cadeau Âmes Nomades",
        cardHtml, attachment);
    }
    // L'acheteur garde une copie de la carte envoyée au destinataire (adresse erronée, bon à réimprimer…)
    if (g.email && customerEmail && g.email !== customerEmail) {
      await sendEmail([{ email: customerEmail, name: firstName || customerName }],
        `Copie du bon cadeau offert${g.to ? ` à ${g.to}` : ""}`,
        `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px 20px 0;color:#1e1f22">
          <p style="font-size:14px;line-height:1.6;margin:0">Voici une copie du bon cadeau que nous venons d'envoyer à <strong>${esc(g.email)}</strong>. Garde-la : elle te permet de transmettre le code toi-même si besoin.</p>
        </div>` + cardHtml, attachment);
    }
  }

  if (!customerEmail) return;

  // 7. Contact Brevo (liste 13)
  if (brevoApiKey) {
    for (const payload of [
      { email: customerEmail, listIds: [13], updateEnabled: true, attributes: { PRENOM: firstName, NOM: lastName } },
      { email: customerEmail, listIds: [13], updateEnabled: true },
    ]) {
      const res = await fetch("https://api.brevo.com/v3/contacts", { method: "POST", headers: { "Content-Type": "application/json", "api-key": brevoApiKey }, body: JSON.stringify(payload) });
      const resText = await res.text();
      if (res.ok) { console.log(`Contact Brevo ajouté : ${customerEmail}`); break; }
      else console.warn(`Brevo contact erreur (${res.status}):`, resText);
    }
  }

  // 8. Emails de confirmation
  const hasProducts = order.legacy ? order.legacy.type === "product" : products.length > 0;
  const hasStays = order.legacy ? order.legacy.type === "sejour" : stays.length > 0;
  const hasGifts = order.giftItems.length > 0;
  const deliveryLine = hasProducts && order.shipping
    ? [order.shipping.line1, order.shipping.line2, `${order.shipping.postal_code} ${order.shipping.city}`].filter(s => s && s.trim()).map(s => esc(s)).join("<br>")
    : "";
  const giftPaidLine = order.giftUsed && order.giftUsed.amount > 0
    ? `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Bon cadeau ${esc(order.giftUsed.code)}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;color:#b34400">-${euro(order.giftUsed.amount)}${giftBalanceLeft != null ? `<br><span style="font-size:12px;color:#666">reste ${euro(giftBalanceLeft)}</span>` : ""}</td></tr>`
    : "";

  const adminSubject = hasStays && !hasProducts && !hasGifts
    ? `🎉 Nouveau paiement séjour${orderRef ? " " + orderRef : ""} — ${firstName} ${lastName} (${amount} €)`
    : hasGifts && !hasProducts && !hasStays
      ? `🎁 Bon cadeau vendu${orderRef ? " " + orderRef : ""} — ${firstName} ${lastName} (${amount} €)`
      : `🛍️ Nouvel achat${hasStays ? " + séjour" : ""}${hasGifts ? " + bon cadeau" : ""}${orderRef ? " " + orderRef : ""} — ${firstName} ${lastName} (${amount} €)`;
  await sendEmail([{ email: "contact@amesnomades.com", name: "Admin Âmes Nomades" }], adminSubject,
    `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px">
      <h2 style="color:#2e7d32">Nouveau paiement validé !</h2>
      <ul>
        ${orderRef ? `<li><strong>Commande :</strong> ${orderRef}</li>` : ""}
        <li><strong>Nom :</strong> ${esc(customerName)}</li>
        <li><strong>Email :</strong> <a href="mailto:${esc(customerEmail)}">${esc(customerEmail)}</a></li>
        <li><strong>Articles :</strong> ${esc(articlesLabel)}</li>
        ${order.discount.amount > 0 ? `<li><strong>Remise :</strong> ${esc(order.discount.label || "Promotion")} : -${euro(order.discount.amount)}</li>` : ""}
        ${order.giftUsed && order.giftUsed.amount > 0 ? `<li><strong>Bon cadeau utilisé :</strong> ${esc(order.giftUsed.code)} : -${euro(order.giftUsed.amount)}</li>` : ""}
        <li><strong>Montant payé :</strong> ${amount} €</li>
        ${createdCards.map(c => `<li><strong>Bon cadeau créé :</strong> ${c.code} (${euro(c.amount)}) envoyé à ${esc(c.sentTo)}</li>`).join("")}
        ${order.shipping ? `<li><strong>Adresse de livraison :</strong> ${esc(order.shipping.line1)}, ${esc(order.shipping.postal_code)} ${esc(order.shipping.city)}, ${esc(order.shipping.country)}</li>` : ""}
      </ul>
    </div>`);

  const what = [hasProducts ? "ta commande" : "", hasStays ? "ta réservation" : "", hasGifts ? "ton bon cadeau" : ""].filter(Boolean);
  const subjectWhat = what.length === 1 ? what[0] : what.slice(0, -1).join(", ") + " et " + what[what.length - 1];
  const plural = what.length > 1;
  const clientNext = [
    hasProducts ? "Nous préparons ton colis avec soin. Tu recevras un email avec le numéro de suivi dès son expédition." : "",
    hasStays ? "Tu recevras prochainement par email toutes les informations pratiques pour ton séjour." : "",
    ...createdCards.map(c => c.sentTo === customerEmail
      ? `Ton bon cadeau de ${euro(c.amount)} (code ${c.code}) arrive dans un email séparé, prêt à être offert ou utilisé.`
      : `Le bon cadeau de ${euro(c.amount)} a été envoyé à ${esc(c.sentTo)} avec son code. Tu en reçois une copie dans un email séparé.`),
  ].filter(Boolean).map(p => `<p style="color:#666;font-size:14px">${p}</p>`).join("");

  await sendEmail([{ email: customerEmail, name: firstName || customerName }],
    `${subjectWhat.charAt(0).toUpperCase() + subjectWhat.slice(1)} Âmes Nomades ${plural ? "sont confirmés" : (hasStays && !hasProducts && !hasGifts ? "est confirmée" : "est confirmé" + (hasProducts ? "e" : ""))}`,
    `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px;color:#222">
      <h2 style="font-family:Georgia,serif;font-weight:400;color:#222">Merci ${hasStays && !hasProducts && !hasGifts ? "pour ta réservation" : "pour ta commande"}, ${esc(firstName)} !</h2>
      <p>Nous avons bien reçu ton paiement${amount > 0 ? "" : " par bon cadeau"} : ${subjectWhat} ${plural ? "sont confirmés" : "est confirmé" + (hasProducts || hasStays ? "e" : "")}.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0">
        ${orderRef ? `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Commande n°</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${orderRef}</td></tr>` : ""}
        <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Articles</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${esc(articlesLabel)}</td></tr>
        ${deliveryLine ? `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666;vertical-align:top">Livraison</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${deliveryLine}</td></tr>` : ""}
        ${order.discount.amount > 0 ? `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Remise · ${esc(order.discount.label || "Promotion")}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;color:#b34400">-${euro(order.discount.amount)}</td></tr>` : ""}
        ${giftPaidLine}
        <tr><td style="padding:8px 0;font-weight:600">Total payé</td><td style="padding:8px 0;text-align:right;font-weight:600">${amount} €</td></tr>
      </table>
      ${clientNext}
      <p style="margin-top:24px">À très bientôt,<br><strong>L'équipe Âmes Nomades</strong></p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="font-size:12px;color:#999">Des questions ? Contacte-nous : <a href="mailto:contact@amesnomades.com" style="color:#666">contact@amesnomades.com</a></p>
    </div>`);
}
