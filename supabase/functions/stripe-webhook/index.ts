import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno&no-check=true";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { recordPaidOrder, type GiftItem, type OrderItem, type PaidOrder } from "../_shared/order.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2022-11-15",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, stripe-signature",
};

function parseJson<T>(raw: string | undefined, fallback: T): T {
  try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400, headers: corsHeaders });
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return new Response("Webhook secret not configured", { status: 500, headers: corsHeaders });
  }

  try {
    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const meta = session.metadata || {};

      const customerEmail = session.customer_details?.email || meta.user_email || "";
      // Le nom saisi dans le formulaire de livraison prime sur le profil Stripe (parfois ancien)
      const customerName = session.shipping_details?.name || session.customer_details?.name || "";
      const amount = session.amount_total ? session.amount_total / 100 : 0;

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceRoleKey) {
        console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants");
        return new Response(JSON.stringify({ received: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }
      const supabase = createClient(supabaseUrl, serviceRoleKey);

      const metaType = meta.type || "product";
      const shipping = session.shipping_details;
      const order: PaidOrder = {
        sessionId: session.id,
        orderRef: meta.order_ref || "",
        customerEmail,
        customerName,
        customerPhone: meta.customer_phone || session.customer_details?.phone || "",
        amount,
        items: metaType === "cart" ? parseJson<OrderItem[]>(meta.cart_items, []) : [],
        giftItems: metaType === "cart" ? parseJson<GiftItem[]>(meta.gift_items, []) : [],
        shipping: shipping ? {
          name: shipping.name || customerName,
          line1: shipping.address?.line1 || "",
          line2: shipping.address?.line2 || "",
          city: shipping.address?.city || "",
          postal_code: shipping.address?.postal_code || "",
          country: shipping.address?.country || "",
        } : null,
        discount: {
          amount: Number(meta.discount_amount) || 0,
          label: meta.discount_label || "",
          promoCode: meta.promo_code || "",
          promoIds: String(meta.promo_ids || "").split(",").map((x: string) => x.trim()).filter(Boolean),
        },
        giftUsed: meta.gift_code && Number(meta.gift_amount) > 0 ? { code: meta.gift_code, amount: Number(meta.gift_amount) } : null,
        userId: meta.user_id || "",
        legacy: metaType === "cart" ? null : {
          type: metaType,
          productName: meta.product_name,
          productId: meta.product_id,
          eventName: meta.event_name,
        },
      };

      await recordPaidOrder(supabase, order);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Erreur inconnue";
    console.error(`Erreur Webhook: ${errorMsg}`);
    return new Response(`Webhook Error: ${errorMsg}`, { status: 400, headers: corsHeaders });
  }
});
