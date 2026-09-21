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
      const customerEmail = session.customer_details?.email || session.customer_email;
      const customerName = session.customer_details?.name || "";
      const amountTotal = session.amount_total ? session.amount_total / 100 : 0;
      const userId = session.metadata?.user_id || null;
      const stayDate = session.metadata?.stay_date || null;
      
      let items: any[] = [];
      try {
        if (session.metadata?.items_json) {
          items = JSON.parse(session.metadata.items_json);
        }
      } catch (e) {
        console.error("Erreur parsing items_json:", e);
      }

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (supabaseUrl && serviceRoleKey) {
        const supabase = createClient(supabaseUrl, serviceRoleKey);

        // 1. Inscrire la commande principale dans 'orders'
        const { data: orderData, error: orderErr } = await supabase
          .from("orders")
          .insert({
            user_id: userId || null,
            customer_email: customerEmail,
            customer_name: customerName,
            stripe_session_id: session.id,
            stripe_customer_id: typeof session.customer === "string" ? session.customer : null,
            total_amount: amountTotal,
            status: "paid",
          })
          .select()
          .single();

        if (orderErr) {
          console.error("Erreur insertion order:", orderErr);
        }

        const orderId = orderData?.id || null;

        // 2. Traiter chaque article (Séjour vs Produit Boutique)
        let isStayOrder = false;
        let stayItem: any = null;

        for (const item of items) {
          if (item.type === "stay") {
            isStayOrder = true;
            stayItem = item;

            // Insérer dans 'bookings'
            const { error: bookingErr } = await supabase
              .from("bookings")
              .insert({
                user_id: userId || null,
                stay_id: item.id && item.id.length === 36 ? item.id : null,
                stay_title: item.title,
                customer_email: customerEmail,
                customer_name: customerName,
                booking_date: stayDate || new Date().toISOString().split("T")[0],
                amount_paid: item.price * (item.quantity || 1),
                status: "confirmed",
                stripe_session_id: session.id,
              });

            if (bookingErr) console.error("Erreur insertion booking:", bookingErr);
          } else {
            // Produit boutique -> 'order_items'
            if (orderId) {
              const { error: itemErr } = await supabase
                .from("order_items")
                .insert({
                  order_id: orderId,
                  product_id: item.id && item.id.length === 36 ? item.id : null,
                  product_name: item.title,
                  unit_price: item.price,
                  quantity: item.quantity || 1,
                });
              if (itemErr) console.error("Erreur insertion order_item:", itemErr);
            }
          }
        }

        // 3. Ajouter / Mettre à jour le contact dans Brevo
        const brevoApiKey = Deno.env.get("BREVO_API_KEY");
        if (brevoApiKey && customerEmail) {
          let firstName = customerName.split(" ")[0] || "";
          let lastName = customerName.split(" ").slice(1).join(" ") || "";

          // Ajout Contact Liste 13 (Acheteurs)
          await fetch("https://api.brevo.com/v3/contacts", {
            method: "POST",
            headers: { "Content-Type": "application/json", "api-key": brevoApiKey },
            body: JSON.stringify({
              email: customerEmail,
              listIds: [13],
              updateEnabled: true,
              attributes: { PRENOM: firstName, NOM: lastName }
            }),
          });

          // 4. Envoi de l'Email de Confirmation Transactionnel via Brevo API
          if (isStayOrder && stayItem) {
            // Email Séjour 1 jour (Personnalisé depuis template Supabase)
            let emailSubject = `Confirmation de votre séjour : ${stayItem.title}`;
            let emailBody = `
              <p>Bonjour ${firstName || customerEmail},</p>
              <p>Nous avons bien confirmé votre réservation pour le séjour <strong>${stayItem.title}</strong>.</p>
              <p><strong>Date retenue :</strong> ${stayDate || "À déterminer ensemble"}</p>
              <p><strong>Montant réglé :</strong> ${stayItem.price} €</p>
              <p>Nous avons hâte de vous accueillir !</p>
              <p>L'équipe Âmes Nomades</p>
            `;

            // Recherche d'un template sur mesure dans 'email_templates'
            const { data: templateData } = await supabase
              .from("email_templates")
              .select("*")
              .eq("template_key", "stay_confirmation_single_day")
              .single();

            if (templateData && templateData.content) {
              emailSubject = templateData.subject || emailSubject;
              emailBody = templateData.content
                .replaceAll("{{params.PRENOM}}", firstName || customerEmail)
                .replaceAll("{{params.NOM}}", lastName)
                .replaceAll("{{params.TITRE_SEJOUR}}", stayItem.title)
                .replaceAll("{{params.DATE_SEJOUR}}", stayDate || "À convenir")
                .replaceAll("{{params.PRIX}}", `${stayItem.price} €`);
            }

            await fetch("https://api.brevo.com/v3/smtp/email", {
              method: "POST",
              headers: { "Content-Type": "application/json", "api-key": brevoApiKey },
              body: JSON.stringify({
                sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" },
                replyTo: { email: "contact@amesnomades.com", name: "Âmes Nomades" },
                to: [{ email: customerEmail, name: customerName }],
                subject: emailSubject,
                htmlContent: `<div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; line-height: 1.6;">${emailBody}<hr style="border:none; border-top:1px solid #eee; margin:24px 0 16px 0;"><p style="font-size:12px; color:#666;">Une question ? Contactez-nous à <a href="mailto:contact@amesnomades.com" style="color:#1e1f22; text-decoration:underline;">contact@amesnomades.com</a></p></div>`,
              }),
            });
          } else {
            // Email Produits Boutique
            const itemsListHtml = items
              .map((i: any) => `<li><strong>${i.title}</strong> (x${i.quantity || 1}) - ${i.price} €</li>`)
              .join("");

            await fetch("https://api.brevo.com/v3/smtp/email", {
              method: "POST",
              headers: { "Content-Type": "application/json", "api-key": brevoApiKey },
              body: JSON.stringify({
                sender: { name: "Boutique Âmes Nomades", email: "contact@amesnomades.com" },
                replyTo: { email: "contact@amesnomades.com", name: "Âmes Nomades" },
                to: [{ email: customerEmail, name: customerName }],
                subject: "Confirmation de votre commande Âmes Nomades",
                htmlContent: `
                  <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; line-height: 1.6;">
                    <h2>Merci pour votre commande !</h2>
                    <p>Bonjour ${firstName || customerEmail},</p>
                    <p>Nous avons bien reçu votre commande et préparons vos articles avec soin.</p>
                    <h3>Récapitulatif :</h3>
                    <ul>${itemsListHtml}</ul>
                    <p><strong>Total payé :</strong> ${amountTotal} €</p>
                    <p>À très bientôt,<br>L'équipe Âmes Nomades</p>
                    <hr style="border:none; border-top:1px solid #eee; margin:24px 0 16px 0;">
                    <p style="font-size:12px; color:#666;">Une question concernant votre commande ? Contactez-nous à <a href="mailto:contact@amesnomades.com" style="color:#1e1f22; text-decoration:underline;">contact@amesnomades.com</a></p>
                  </div>
                `,
              }),
            });
          }

          // 5. Notification Admin
          await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: { "Content-Type": "application/json", "api-key": brevoApiKey },
            body: JSON.stringify({
              sender: { name: "Système Âmes Nomades", email: "contact@amesnomades.com" },
              to: [{ email: "contact@amesnomades.com", name: "Admin Âmes Nomades" }],
              subject: `🎉 Nouvelle vente (${amountTotal} €) par ${customerName || customerEmail}`,
              htmlContent: `<p>Une nouvelle commande de ${amountTotal} € a été payée avec succès par ${customerEmail}.</p>`,
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
