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
    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const customerEmail = session.customer_details?.email;
      const customerName = session.customer_details?.name || "";
      const amount = session.amount_total ? session.amount_total / 100 : 0;

      let firstName = "";
      let lastName = "";
      if (customerName) {
        const parts = customerName.split(" ");
        firstName = parts[0];
        lastName = parts.slice(1).join(" ");
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const supabase = supabaseUrl && serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey)
        : null;

      if (customerEmail && supabase) {
        if (session.metadata?.type === "product") {
          const productName = session.metadata?.product_name || "Produit Inconnu";
          const productId = session.metadata?.product_id;

          // 1. Enregistrer l'achat
          const { error: purchaseError } = await supabase.from("purchases").insert({
            email: customerEmail,
            firstname: firstName,
            lastname: lastName,
            product_name: productName,
            amount,
            status: "paid",
          });
          if (purchaseError) console.error("Erreur insertion achat:", purchaseError);

          // 2. Décrémenter le stock
          if (productId) {
            const { data: prod } = await supabase
              .from("products")
              .select("stock")
              .eq("id", productId)
              .single();

            if (prod && prod.stock !== null && prod.stock > 0) {
              const newStock = prod.stock - 1;
              await supabase
                .from("products")
                .update({ stock: newStock })
                .eq("id", productId);
              console.log(`Stock produit ${productId} : ${prod.stock} → ${newStock}`);
            }
          }
        } else {
          // Réservation séjour
          const eventName = session.metadata?.event_name || "Séjour Âmes Nomades";
          const { error } = await supabase.from("event_registrations").insert({
            email: customerEmail,
            firstname: firstName,
            lastname: lastName,
            event_name: eventName,
            amount,
            status: "paid",
          });
          if (error) console.error("Erreur insertion séjour:", error);
        }

        // 3. Ajouter le contact sur Brevo (liste 13)
        const brevoApiKey = Deno.env.get("BREVO_API_KEY");
        if (brevoApiKey) {
          const payloads = [
            { email: customerEmail, listIds: [13], updateEnabled: true, attributes: { PRENOM: firstName, NOM: lastName } },
            { email: customerEmail, listIds: [13], updateEnabled: true, attributes: { FIRSTNAME: firstName, LASTNAME: lastName } },
            { email: customerEmail, listIds: [13], updateEnabled: true },
          ];

          for (const payload of payloads) {
            const res = await fetch("https://api.brevo.com/v3/contacts", {
              method: "POST",
              headers: { "Content-Type": "application/json", "api-key": brevoApiKey },
              body: JSON.stringify(payload),
            });
            if (res.ok) { console.log(`Contact Brevo ajouté : ${customerEmail}`); break; }
          }

          // 4. Email d'alerte admin
          const subject = session.metadata?.type === "product"
            ? `🛍️ Nouvel achat boutique — ${firstName} ${lastName} (${amount} €)`
            : `🎉 Nouveau paiement séjour — ${firstName} ${lastName} (${amount} €)`;

          await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: { "Content-Type": "application/json", "api-key": brevoApiKey },
            body: JSON.stringify({
              sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" },
              to: [{ email: "contact@amesnomades.com", name: "Admin Âmes Nomades" }],
              subject,
              htmlContent: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px;">
                  <h2 style="color: #2e7d32;">Nouveau paiement validé !</h2>
                  <ul>
                    <li><strong>Nom :</strong> ${customerName}</li>
                    <li><strong>Email :</strong> <a href="mailto:${customerEmail}">${customerEmail}</a></li>
                    <li><strong>Produit :</strong> ${session.metadata?.product_name || session.metadata?.event_name || "—"}</li>
                    <li><strong>Montant :</strong> ${amount} €</li>
                  </ul>
                </div>
              `,
            }),
          });
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
