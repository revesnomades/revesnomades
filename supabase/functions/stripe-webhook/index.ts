import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.4.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2022-11-15",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, stripe-signature",
};

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
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      
      const customerEmail = session.customer_details?.email;
      const customerName = session.customer_details?.name || "";

      if (customerEmail) {
        // Envoi de l'email via Brevo
        const brevoApiKey = Deno.env.get("BREVO_API_KEY");
        if (!brevoApiKey) {
          console.error("BREVO_API_KEY non configurée.");
        } else {
          // On ajoute le client à la liste Brevo #13 (Pool, Brunch & Yoga)
          // L'automatisation Brevo prendra ensuite le relais pour envoyer l'email
          
          let firstName = "";
          let lastName = "";
          if (customerName) {
            const parts = customerName.split(" ");
            firstName = parts[0];
            lastName = parts.slice(1).join(" ");
          }

          const brevoPayload = {
            email: customerEmail,
            listIds: [13],
            updateEnabled: true,
            attributes: {
              PRENOM: firstName,
              NOM: lastName,
              FIRSTNAME: firstName,
              LASTNAME: lastName
            }
          };

          const brevoResponse = await fetch("https://api.brevo.com/v3/contacts", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "api-key": brevoApiKey
            },
            body: JSON.stringify(brevoPayload)
          });

          if (!brevoResponse.ok) {
            console.error("Erreur Brevo:", await brevoResponse.text());
          } else {
            console.log(`Client ajouté avec succès à la liste Brevo 13 : ${customerEmail}`);
          }
        }
      }
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
