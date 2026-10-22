import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno&no-check=true";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Article du panier tel que relu en base : c'est la seule source de vérité pour les prix
type CheckedItem = { id: string; type: "product" | "sejour"; name: string; price: number; quantity: number; weight_grams: number };

type Promotion = {
  type: string;
  value: number | string;
  value_unit?: string | null;
  min_qty?: number | null;
  code?: string | null;
  name?: string | null;
  apply_to?: string | null;
  eligible_product_ids?: string[] | null;
  eligible_stay_ids?: string[] | null;
};

type ShippingMethod = { id: string; name: string; price: number };

// Même règle que sejour.html : le libellé de l'option est ajouté au titre sauf s'il est générique
const GENERIC_OPTION_LABELS = ["tarif", "option", "default", "standard", "réserver", "reserver", "réservation", "reservation", "payer", "paiement", "checkout"];

function stayItemName(title: string, optionLabel: string) {
  const clean = optionLabel.trim().toLowerCase();
  if (optionLabel && optionLabel !== title && !GENERIC_OPTION_LABELS.includes(clean) && !clean.startsWith("réserver") && !clean.startsWith("reserver")) {
    return `${title} (${optionLabel})`;
  }
  return title;
}

// ── Remises : même logique que getAutoDiscounts / getPromoCodeDiscount (panier.html) ──
function getApplicableItems(cart: CheckedItem[], promo: Promotion) {
  return cart.filter(item => {
    if (promo.apply_to === "all") return true;
    if (promo.apply_to === "products") return item.type === "product";
    if (promo.apply_to === "stays") return item.type === "sejour";
    if (promo.apply_to === "specific") {
      if (item.type === "product") return (promo.eligible_product_ids || []).includes(item.id);
      if (item.type === "sejour") return (promo.eligible_stay_ids || []).includes(item.id);
    }
    return false;
  });
}

type DiscountResult = {
  total: number;          // euros
  label: string;          // libellé affiché sur Stripe, la facture et l'email
  code: string | null;    // code promo retenu, sinon null
  perItem: number[];      // remise répartie par article (même ordre que le panier)
  codeRejected: boolean;  // code valide mais moins avantageux que les promotions en cours
};

// Répartit une remise sur les articles concernés, au prorata de leur montant
function spread(cart: CheckedItem[], applicable: CheckedItem[], amount: number, into: number[]) {
  const base = applicable.reduce((s, i) => s + i.price * i.quantity, 0);
  if (base <= 0) return;
  for (const item of applicable) into[cart.indexOf(item)] += amount * (item.price * item.quantity) / base;
}

function promoAmount(promo: Promotion, applicable: CheckedItem[]) {
  const base = applicable.reduce((s, i) => s + i.price * i.quantity, 0);
  const value = Number(promo.value) || 0;
  return promo.value_unit === "euro" || promo.type === "fixed" ? Math.min(value, base) : base * value / 100;
}

// Un code promo n'est jamais cumulable : on garde soit le code, soit les promotions automatiques,
// selon ce qui est le plus avantageux pour le client.
function computeDiscounts(cart: CheckedItem[], promos: Promotion[], promoCode: string | null): DiscountResult {
  const autoPerItem = cart.map(() => 0);
  const autoNames: string[] = [];
  let autoTotal = 0;
  for (const promo of promos) {
    if (promo.type === "promo_code") continue;
    const applicable = getApplicableItems(cart, promo);
    if (!applicable.length) continue;
    if (promo.type === "percent" || promo.type === "early_bird" || promo.type === "fixed") {
      const amount = promoAmount(promo, applicable);
      if (amount > 0) { autoTotal += amount; spread(cart, applicable, amount, autoPerItem); autoNames.push(promo.name || "Promotion"); }
    } else if (promo.type === "duo") {
      for (const item of applicable) {
        if (item.quantity >= (promo.min_qty || 2)) {
          const amount = promoAmount(promo, [item]);
          if (amount > 0) { autoTotal += amount; autoPerItem[cart.indexOf(item)] += amount; autoNames.push(promo.name || "Promotion"); }
        }
      }
    }
  }

  let codeResult: DiscountResult | null = null;
  if (promoCode) {
    const promo = promos.find(p => p.type === "promo_code" && p.code === promoCode);
    const applicable = promo ? getApplicableItems(cart, promo) : [];
    if (promo && applicable.length) {
      const amount = promoAmount(promo, applicable);
      if (amount > 0) {
        const perItem = cart.map(() => 0);
        spread(cart, applicable, amount, perItem);
        const value = Number(promo.value) || 0;
        const valueLabel = promo.value_unit === "euro" ? `-${value.toFixed(2).replace(".", ",").replace(",00", "")} €` : `-${value} %`;
        codeResult = { total: amount, label: `Code ${promoCode} (${valueLabel})`, code: promoCode, perItem, codeRejected: false };
      }
    }
  }

  const autoResult: DiscountResult = {
    total: autoTotal,
    label: [...new Set(autoNames)].join(" + ") || "Promotion",
    code: null,
    perItem: autoPerItem,
    codeRejected: !!codeResult,
  };
  const chosen = codeResult && codeResult.total >= autoTotal ? codeResult : autoResult;
  // Une remise ne dépasse jamais le montant de l'article
  chosen.perItem = chosen.perItem.map((d, i) => Math.min(d, cart[i].price * cart[i].quantity));
  chosen.total = chosen.perItem.reduce((s, d) => s + d, 0);
  return chosen;
}

// ── Livraison : on redemande les tarifs à get-shipping-rates (même source que le panier) ──
async function fetchShippingMethods(postalCode: string, country: string, weightGrams: number, productsTotal: number) {
  const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/get-shipping-rates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ to_postal_code: postalCode, to_country: country, weight_grams: weightGrams, products_total: productsTotal }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || !Array.isArray(data.methods)) {
    throw new Error(data.error || `get-shipping-rates HTTP ${res.status}`);
  }
  return {
    free: data.free_shipping === true,
    methods: (data.methods as Array<Record<string, unknown>>).map(m => ({
      id: String(m.id ?? m.name),
      name: String(m.name || "Livraison"),
      price: Number(m.price) || 0,
    })) as ShippingMethod[],
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Support both legacy single-product and new cart format
    let items: Array<{ id: string; type: string; name?: string; price?: number; quantity?: number; image?: string | null }>;
    let return_url: string;

    if (body.items && Array.isArray(body.items)) {
      items = body.items;
      return_url = body.return_url || `${req.headers.get("origin") || ""}/merci.html`;
    } else if (body.product_id) {
      items = [{ id: body.product_id, type: "product", quantity: 1 }];
      return_url = body.return_url;
    } else {
      return json({ error: "items ou product_id requis" }, 400);
    }

    if (!items.length || !return_url) {
      return json({ error: "Panier vide ou return_url manquant" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2022-11-15",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    const cartMeta: Array<{ id: string; type: string; name: string; qty: number; price?: number; d?: number }> = [];
    const checked: CheckedItem[] = [];

    for (const item of items) {
      const qty = Math.max(1, Math.floor(Number(item.quantity) || 1));

      if (item.type === "product") {
        const { data: product, error } = await supabase
          .from("products")
          .select("id, name, price, stock, image_urls, image_url, weight_grams")
          .eq("id", item.id)
          .single();

        if (error || !product) {
          return json({ error: `Produit introuvable : ${item.id}` }, 404);
        }

        if (product.stock !== null && product.stock < qty) {
          return json({
            error: `Stock insuffisant pour "${product.name}"`,
            code: "stock",
            product_id: product.id,
            product_name: product.name,
            available: Math.max(0, Number(product.stock) || 0),
          }, 400);
        }

        const price = Number(product.price) || 0;
        const imgUrl = (product.image_urls && product.image_urls[0]) || product.image_url;
        lineItems.push({
          price_data: {
            currency: "eur",
            product_data: {
              name: product.name,
              ...(imgUrl ? { images: [imgUrl] } : {}),
            },
            unit_amount: Math.round(price * 100),
          },
          quantity: qty,
        });
        cartMeta.push({ id: product.id, type: "product", name: product.name, qty, price });
        checked.push({ id: product.id, type: "product", name: product.name, price, quantity: qty, weight_grams: Number(product.weight_grams) || 500 });

      } else {
        // Séjour : le prix doit correspondre à l'une des options tarifaires (stays.extra_options)
        const { data: stay, error } = await supabase
          .from("stays")
          .select("id, title, extra_options, hero_image, index_image")
          .eq("id", item.id)
          .maybeSingle();

        if (error || !stay) {
          return json({ error: `Séjour introuvable : ${item.id}`, code: "price" }, 404);
        }

        const title = String(stay.title || "Séjour");
        const options = (Array.isArray(stay.extra_options) ? stay.extra_options : [])
          .filter((o: unknown): o is Record<string, unknown> => !!o && typeof o === "object")
          .map((o: Record<string, unknown>) => ({ label: String(o.label || ""), price: Number(o.price) || 0 }))
          .filter((o: { price: number }) => o.price > 0);

        const clientPriceCents = Math.round((Number(item.price) || 0) * 100);
        const matching = options.filter((o: { price: number }) => Math.round(o.price * 100) === clientPriceCents);
        // Plusieurs options au même prix : on garde celle dont le libellé correspond au nom affiché
        const option = matching.find((o: { label: string }) => stayItemName(title, o.label) === item.name) || matching[0];

        if (!option) {
          console.warn(`create-checkout-session: prix séjour refusé (${item.id}) : ${item.price} €`);
          return json({
            error: `Le tarif de « ${title} » a changé. Retirez le séjour du panier puis ajoutez-le à nouveau depuis sa page.`,
            code: "price",
            stay_id: stay.id,
          }, 400);
        }

        const name = stayItemName(title, option.label);
        const image = stay.index_image || stay.hero_image || null;
        lineItems.push({
          price_data: {
            currency: "eur",
            product_data: {
              name,
              ...(image ? { images: [image] } : {}),
            },
            unit_amount: Math.round(option.price * 100),
          },
          quantity: qty,
        });
        cartMeta.push({ id: stay.id, type: "sejour", name, qty, price: option.price });
        checked.push({ id: stay.id, type: "sejour", name, price: option.price, quantity: qty, weight_grams: 0 });
      }
    }

    // Frais de livraison recalculés côté serveur (seuls les articles shop sont expédiés)
    const products = checked.filter(i => i.type === "product");
    if (products.length) {
      const addr = body.shippingAddress || {};
      const productsTotal = products.reduce((s, i) => s + i.price * i.quantity, 0);
      const weight = products.reduce((s, i) => s + i.weight_grams * i.quantity, 0) || 500;

      let rates: { free: boolean; methods: ShippingMethod[] };
      try {
        rates = await fetchShippingMethods(String(addr.postal_code || ""), String(addr.country || "FR").toUpperCase(), weight, productsTotal);
      } catch (e) {
        console.error("create-checkout-session: tarifs de livraison indisponibles:", e);
        return json({ error: "Impossible de vérifier les frais de livraison pour le moment. Réessayez dans un instant.", code: "shipping" }, 503);
      }

      const wantedId = body.shippingMethodId != null ? String(body.shippingMethodId) : null;
      const method = rates.free
        ? rates.methods[0]
        : rates.methods.find(m => wantedId ? m.id === wantedId : m.name === body.shippingLabel);

      if (!method) {
        console.warn(`create-checkout-session: mode de livraison refusé (${wantedId ?? body.shippingLabel})`);
        return json({
          error: "Ce mode de livraison n'est pas disponible pour cette adresse. Recalculez la livraison puis relancez le paiement.",
          code: "shipping",
        }, 400);
      }

      const shippingCents = Math.round(method.price * 100);
      if (shippingCents !== Math.round(Number(body.shippingAmount) || 0)) {
        console.warn(`create-checkout-session: livraison corrigée ${body.shippingAmount} → ${shippingCents} centimes`);
      }
      if (shippingCents > 0) {
        lineItems.push({
          price_data: {
            currency: "eur",
            product_data: { name: method.name },
            unit_amount: shippingCents,
          },
          quantity: 1,
        });
      }
    }

    // ui_mode "redirect" → checkout Stripe hébergé (retourne url)
    // ui_mode "embedded" (défaut) → checkout embarqué (retourne client_secret)
    const isRedirect = body.ui_mode === "redirect";

    // Remises recalculées à partir de la table promotions (discountAmount du navigateur ignoré)
    const now = new Date().toISOString();
    const { data: promos, error: promosError } = await supabase
      .from("promotions")
      .select("*")
      .eq("active", true)
      .or(`starts_at.is.null,starts_at.lte.${now}`)
      .or(`ends_at.is.null,ends_at.gte.${now}`);
    if (promosError) throw new Error(`promotions: ${promosError.message}`);

    const promoCode = body.promoCode ? String(body.promoCode).trim().toUpperCase() : null;
    const itemsCents = checked.reduce((s, i) => s + Math.round(i.price * 100) * i.quantity, 0);
    // La remise ne porte jamais sur la livraison ; code promo non cumulable
    const discount = computeDiscounts(checked, (promos || []) as Promotion[], promoCode);
    const discountCents = Math.min(itemsCents, Math.round(discount.total * 100));
    if (discount.codeRejected) console.log(`create-checkout-session: code ${promoCode} écarté, promotions en cours plus avantageuses`);
    // Remise par article, gardée pour les factures (bookings / purchases)
    checked.forEach((item, i) => {
      const d = Math.round(discount.perItem[i] * 100) / 100;
      if (d > 0) cartMeta[i].d = d;
    });
    if (discountCents !== Math.round(Number(body.discountAmount) || 0)) {
      console.warn(`create-checkout-session: remise corrigée ${body.discountAmount} → ${discountCents} centimes`);
    }
    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;

    if (discountCents > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: discountCents,
        currency: "eur",
        duration: "once",
        // Ce nom apparaît sur le paiement Stripe, le reçu et la facture Stripe (40 caractères max)
        name: discount.label.slice(0, 40),
        max_redemptions: 1,
      });
      discounts = [{ coupon: coupon.id }];
    }

    // Numéro de commande lisible : AN-AAAAMMJJ-XXXX (sans 0/O/1/I pour éviter les confusions)
    const REF_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const refRand = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => REF_CHARS[b % REF_CHARS.length]).join("");
    const orderRef = `AN-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${refRand}`;

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      // Pre-fill shipping address from saved profile if provided
      ...(body.shippingAddress && body.shippingAddress.line1 ? {
        payment_intent_data: {
          shipping: {
            name: body.shippingAddress.name || body.userEmail || "",
            address: {
              line1: body.shippingAddress.line1,
              line2: body.shippingAddress.line2 || "",
              city: body.shippingAddress.city || "",
              postal_code: body.shippingAddress.postal_code || "",
              country: body.shippingAddress.country || "FR",
            },
          },
        },
      } : {}),
      ...(discounts ? { discounts } : {}),
      // Client connecté : email prérempli ; invité : Stripe le demande
      ...(body.userEmail ? { customer_email: String(body.userEmail) } : {}),
      metadata: {
        type: "cart",
        order_ref: orderRef,
        ...(discountCents > 0 ? {
          discount_amount: (discountCents / 100).toFixed(2),
          discount_label: discount.label.slice(0, 200),
          promo_code: discount.code || "",
        } : {}),
        cart_items: JSON.stringify(cartMeta),
        user_id: body.userId || "",
        user_email: body.userEmail || "",
      },
    };

    if (isRedirect) {
      sessionParams.success_url = return_url.includes("{CHECKOUT_SESSION_ID}")
        ? return_url
        : `${return_url}${return_url.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;
      sessionParams.cancel_url = body.cancel_url || return_url;
    } else {
      sessionParams.ui_mode = "embedded";
      sessionParams.return_url = return_url;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    const responseBody = isRedirect
      ? { url: session.url, order_ref: orderRef }
      : { client_secret: session.client_secret, order_ref: orderRef };

    return json(responseBody);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("create-checkout-session error:", msg);
    return json({ error: msg }, 500);
  }
});
