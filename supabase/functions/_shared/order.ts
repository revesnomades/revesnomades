// Enregistrement d'une commande payée : base, stock, promotions, bons cadeaux, emails.
// Utilisé par stripe-webhook (après paiement Stripe) et par create-checkout-session
// (commande entièrement réglée par un bon cadeau, sans passage par Stripe).
// deno-lint-ignore-file no-explicit-any

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

// Email : carte cadeau envoyée au destinataire (ou à l'acheteur)
export function giftCardEmailHtml(g: { code: string; amount: number; expiresAt: Date; from?: string; to?: string; msg?: string }) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1e1f22">
    <div style="background:#faf5dc;padding:28px 24px;border-radius:6px;text-align:center">
      <div style="font-family:Georgia,serif;font-size:22px;letter-spacing:.08em;text-transform:uppercase">Âmes Nomades</div>
      <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#62666e;margin-top:6px">Bon cadeau</div>
      <div style="background:#fffdf3;border:1px solid rgba(30,31,34,.16);border-radius:6px;padding:26px 20px;margin:22px 0 0">
        ${g.to ? `<p style="margin:0 0 6px;font-size:15px">Pour <strong>${esc(g.to)}</strong></p>` : ""}
        <div style="font-family:Georgia,serif;font-size:44px;line-height:1.1;margin:6px 0">${euro(g.amount)}</div>
        ${g.from ? `<p style="margin:6px 0 0;font-size:14px;color:#62666e">Offert par ${esc(g.from)}</p>` : ""}
        ${g.msg ? `<p style="margin:18px 0 0;font-size:14px;line-height:1.6;font-style:italic;color:#2d2e33">« ${esc(g.msg)} »</p>` : ""}
        <div style="margin:22px auto 0;display:inline-block;background:#1e1f22;color:#fffdf3;font-family:'Courier New',monospace;font-size:20px;letter-spacing:.14em;padding:12px 20px;border-radius:4px">${esc(g.code)}</div>
        <p style="margin:14px 0 0;font-size:12px;color:#62666e">Valable jusqu'au ${dateFr(g.expiresAt)}</p>
      </div>
    </div>
    <h3 style="font-weight:600;font-size:15px;margin:26px 0 8px">Comment l'utiliser</h3>
    <ol style="margin:0;padding-left:18px;font-size:14px;line-height:1.7;color:#2d2e33">
      <li>Choisis un séjour ou des articles sur <a href="https://amesnomades.com" style="color:#1e1f22">amesnomades.com</a>.</li>
      <li>Dans le panier, saisis ce code dans le champ « Bon cadeau » : sa valeur est déduite du total.</li>
      <li>Il est utilisable en plusieurs fois : le reste est conservé sur le bon.</li>
    </ol>
    <p style="font-size:14px;line-height:1.7;color:#2d2e33;margin:14px 0 0">Tu peux aussi l'enregistrer dans ton <a href="https://amesnomades.com/compte.html" style="color:#1e1f22">espace compte</a> pour suivre le montant restant et la date de validité.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="font-size:12px;color:#999">Des questions ? Contacte-nous : <a href="mailto:contact@amesnomades.com" style="color:#666">contact@amesnomades.com</a></p>
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
  const sendEmail = async (to: { email: string; name: string }[], subject: string, htmlContent: string) => {
    if (!brevoApiKey) { console.warn("BREVO_API_KEY manquante — email non envoyé :", subject); return; }
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST", headers: { "Content-Type": "application/json", "api-key": brevoApiKey },
      body: JSON.stringify({ sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" }, to, subject, htmlContent }),
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
    if (sentTo) {
      await sendEmail([{ email: sentTo, name: g.to || firstName || "" }],
        g.from ? `${g.from} t'offre un bon cadeau Âmes Nomades` : "Ton bon cadeau Âmes Nomades",
        giftCardEmailHtml({ code, amount: g.amount, expiresAt, from: g.from, to: g.to, msg: g.msg }));
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
      : `Le bon cadeau de ${euro(c.amount)} a été envoyé à ${esc(c.sentTo)} avec son code.`),
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
