import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.4.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      const amount = session.amount_total ? session.amount_total / 100 : 0; // en euros
      const eventName = "Pool, Brunch & Yoga"; // On peut le rendre dynamique plus tard si besoin

      if (customerEmail) {
        
        let firstName = "";
        let lastName = "";
        if (customerName) {
          const parts = customerName.split(" ");
          firstName = parts[0];
          lastName = parts.slice(1).join(" ");
        }

        // 1. Sauvegarde dans Supabase
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        
        if (supabaseUrl && serviceRoleKey) {
          const supabase = createClient(supabaseUrl, serviceRoleKey);
          
          if (session.metadata?.type === 'product') {
            // Achat boutique
            const productName = session.metadata?.product_name || "Produit Inconnu";
            const { error } = await supabase
              .from('purchases')
              .insert({
                email: customerEmail,
                firstname: firstName,
                lastname: lastName,
                product_name: productName,
                amount: amount,
                status: 'paid'
              });
            if (error) console.error("Erreur insertion achat Supabase:", error);
            else console.log(`Achat de produit enregistré pour ${customerEmail}`);
          } else {
            // Réservation séjour / événement
            const { error } = await supabase
              .from('event_registrations')
              .insert({
                email: customerEmail,
                firstname: firstName,
                lastname: lastName,
                event_name: eventName,
                amount: amount,
                status: 'paid'
              });
            if (error) console.error("Erreur insertion séjour Supabase:", error);
            else console.log(`Paiement événement enregistré pour ${customerEmail}`);
          }
        } else {
          console.error("Variables Supabase manquantes pour l'insertion.");
        }

        // 2. Ajout du contact sur Brevo (Liste 13)
        const brevoApiKey = Deno.env.get("BREVO_API_KEY");
        if (!brevoApiKey) {
          console.error("BREVO_API_KEY non configurée.");
        } else {
          const payloads = [
            {
              email: customerEmail,
              listIds: [13],
              updateEnabled: true,
              attributes: { PRENOM: firstName, NOM: lastName }
            },
            {
              email: customerEmail,
              listIds: [13],
              updateEnabled: true,
              attributes: { FIRSTNAME: firstName, LASTNAME: lastName }
            },
            {
              email: customerEmail,
              listIds: [13],
              updateEnabled: true
            }
          ];

          let success = false;
          for (const brevoPayloadContact of payloads) {
            const brevoResponseContact = await fetch("https://api.brevo.com/v3/contacts", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "api-key": brevoApiKey
              },
              body: JSON.stringify(brevoPayloadContact)
            });

            if (brevoResponseContact.ok) {
              console.log(`Client ajouté avec succès à la liste Brevo 13 : ${customerEmail}`);
              success = true;
              break;
            } else {
              console.error("Essai échoué Brevo Contact:", await brevoResponseContact.text());
            }
          }

          if (!success) {
            console.error(`Impossible d'ajouter le contact à Brevo pour ${customerEmail}`);
          }

          // 3. Envoi de l'email Admin
          const brevoPayloadAdmin = {
            sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" },
            to: [{ email: "contact@amesnomades.com", name: "Admin Âmes Nomades" }],
            subject: `🎉 Nouveau paiement reçu - ${eventName} (${firstName} ${lastName})`,
            htmlContent: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px;">
                <h2 style="color: #2e7d32;">Nouveau paiement validé !</h2>
                <p>Un client vient de valider son paiement sur Stripe.</p>
                <ul>
                  <li><strong>Nom :</strong> ${customerName}</li>
                  <li><strong>Email :</strong> <a href="mailto:${customerEmail}">${customerEmail}</a></li>
                  <li><strong>Événement :</strong> ${eventName}</li>
                  <li><strong>Montant payé :</strong> ${amount} €</li>
                </ul>
                <p>Le client a été automatiquement ajouté à la liste Brevo #13.</p>
              </div>
            `
          };

          const brevoResponseAdmin = await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "api-key": brevoApiKey
            },
            body: JSON.stringify(brevoPayloadAdmin)
          });

          if (!brevoResponseAdmin.ok) {
            console.error("Erreur Brevo Admin Email:", await brevoResponseAdmin.text());
          } else {
            console.log(`Email Admin envoyé pour ${customerEmail}`);
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
