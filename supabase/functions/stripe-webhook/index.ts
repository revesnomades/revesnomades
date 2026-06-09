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
          // On utilise un template s'il est configuré, sinon un contenu par défaut
          const brevoTemplateId = Deno.env.get("BREVO_TEMPLATE_ID_SOMMIERES");
          
          let brevoPayload;
          
          if (brevoTemplateId) {
            brevoPayload = {
              to: [{ email: customerEmail, name: customerName }],
              templateId: parseInt(brevoTemplateId, 10),
              params: {
                name: customerName,
                event: "Pool, Brunch & Yoga"
              }
            };
          } else {
            brevoPayload = {
              sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" },
              to: [{ email: customerEmail, name: customerName }],
              subject: "Confirmation de réservation - Pool, Brunch & Yoga",
              htmlContent: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="text-align: center;">Votre réservation est confirmée !</h2>
                  <p>Bonjour ${customerName},</p>
                  <p>Nous avons le plaisir de vous confirmer votre réservation pour notre journée exclusive <strong>Pool, Brunch & Yoga</strong> à Sommières.</p>
                  <p>Préparez-vous pour une véritable parenthèse ensoleillée, un moment hors du temps pour ralentir, respirer et prendre soin de vous.</p>
                  <ul>
                    <li><strong>Événement :</strong> Pool, Brunch & Yoga</li>
                    <li><strong>Lieu :</strong> Hôtel particulier à Sommières</li>
                    <li><strong>À prévoir :</strong> Pensez à prendre votre tapis de yoga !</li>
                  </ul>
                  <p>Nous avons hâte de partager ce moment avec vous.</p>
                  <p>À très bientôt,<br><strong>L'équipe Âmes Nomades</strong></p>
                </div>
              `
            };
          }

          const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
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
            console.log(`Email envoyé avec succès à ${customerEmail}`);
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
