import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.4.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2022-11-15",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { items, userId, userEmail, stayDate, returnUrl } = await req.json();

    if (!items || !items.length) {
      return new Response(JSON.stringify({ error: "Aucun article fourni" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Line items dynamiques pour Stripe Checkout
    const line_items = items.map((item: any) => ({
      price_data: {
        currency: "eur",
        product_data: {
          name: item.title,
          description: item.description || (item.type === "stay" ? `Séjour 1 jour (${stayDate || "date à définir"})` : "Article Boutique"),
          images: item.image ? [item.image] : [],
        },
        unit_amount: Math.round(item.price * 100), // En centimes
      },
      quantity: item.quantity || 1,
    }));

    // Recherche ou création du client Stripe via l'email
    let customerId: string | undefined;
    if (userEmail) {
      const existingCustomers = await stripe.customers.list({ email: userEmail, limit: 1 });
      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
      } else {
        const newCustomer = await stripe.customers.create({
          email: userEmail,
          metadata: { supabase_user_id: userId || "" },
        });
        customerId = newCustomer.id;
      }
    }

    const domain = returnUrl || "https://amesnomades.com";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : userEmail,
      payment_method_types: ["card"],
      line_items: line_items,
      mode: "payment",
      success_url: `${domain}/merci.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domain}/panier.html`,
      metadata: {
        user_id: userId || "",
        stay_date: stayDate || "",
        items_json: JSON.stringify(items.map((i: any) => ({ id: i.id, title: i.title, price: i.price, quantity: i.quantity, type: i.type }))),
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Erreur serveur";
    console.error("Checkout Error:", errorMsg);
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
