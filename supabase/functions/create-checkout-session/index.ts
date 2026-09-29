import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno&no-check=true";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

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
      return new Response(JSON.stringify({ error: "items ou product_id requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!items.length || !return_url) {
      return new Response(JSON.stringify({ error: "Panier vide ou return_url manquant" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
    const cartMeta: Array<{ id: string; type: string; name: string; qty: number }> = [];

    for (const item of items) {
      const qty = Math.max(1, Number(item.quantity) || 1);

      if (item.type === "product") {
        const { data: product, error } = await supabase
          .from("products")
          .select("id, name, price, stock, image_urls, image_url")
          .eq("id", item.id)
          .single();

        if (error || !product) {
          return new Response(JSON.stringify({ error: `Produit introuvable : ${item.id}` }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        if (product.stock !== null && product.stock < qty) {
          return new Response(JSON.stringify({ error: `Stock insuffisant pour "${product.name}"` }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const imgUrl = (product.image_urls && product.image_urls[0]) || product.image_url;
        lineItems.push({
          price_data: {
            currency: "eur",
            product_data: {
              name: product.name,
              ...(imgUrl ? { images: [imgUrl] } : {}),
            },
            unit_amount: Math.round((Number(product.price) || 0) * 100),
          },
          quantity: qty,
        });
        cartMeta.push({ id: product.id, type: "product", name: product.name, qty, price: Number(product.price) || 0 });

      } else {
        // Séjour ou article sans DB lookup — utilise les infos fournies
        const price = Number(item.price) || 0;
        const name = item.name || "Article";
        lineItems.push({
          price_data: {
            currency: "eur",
            product_data: {
              name,
              ...(item.image ? { images: [item.image] } : {}),
            },
            unit_amount: Math.round(price * 100),
          },
          quantity: qty,
        });
        cartMeta.push({ id: item.id, type: item.type || "sejour", name, qty, price });
      }
    }

    // Frais de livraison transmis en centimes
    const shippingCents = Math.round(Number(body.shippingAmount) || 0);
    const shippingLabel: string = body.shippingLabel || "Livraison";
    if (shippingCents > 0) {
      lineItems.push({
        price_data: {
          currency: "eur",
          product_data: { name: shippingLabel },
          unit_amount: shippingCents,
        },
        quantity: 1,
      });
    }

    // ui_mode "redirect" → checkout Stripe hébergé (retourne url)
    // ui_mode "embedded" (défaut) → checkout embarqué (retourne client_secret)
    const isRedirect = body.ui_mode === "redirect";

    // Remise promotionnelle transmise en centimes
    const discountCents = Math.round(Number(body.discountAmount) || 0);
    let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;

    if (discountCents > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: discountCents,
        currency: "eur",
        duration: "once",
        name: "Promotion",
        max_redemptions: 1,
      });
      discounts = [{ coupon: coupon.id }];
    }

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
      metadata: {
        type: "cart",
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
      ? { url: session.url }
      : { client_secret: session.client_secret };

    return new Response(
      JSON.stringify(responseBody),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("create-checkout-session error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
