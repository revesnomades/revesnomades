import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.4.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
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
        cartMeta.push({ id: product.id, type: "product", name: product.name, qty });

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
        cartMeta.push({ id: item.id, type: item.type || "sejour", name, qty });
      }
    }

    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      return_url,
      shipping_address_collection: {
        allowed_countries: ["FR", "BE", "CH", "LU", "MC"],
      },
      metadata: {
        type: "cart",
        cart_items: JSON.stringify(cartMeta),
        user_id: body.userId || "",
        user_email: body.userEmail || "",
      },
    });

    return new Response(
      JSON.stringify({ client_secret: session.client_secret }),
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
