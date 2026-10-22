import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno&no-check=true";
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
      // Prioritize shipping name (typed in form) over Stripe profile name (may be outdated)
      const customerName = session.shipping_details?.name || session.customer_details?.name || "";
      const amount = session.amount_total ? session.amount_total / 100 : 0;

      let firstName = "";
      let lastName = "";
      if (customerName) {
        const parts = customerName.split(" ");
        firstName = parts[0];
        lastName = parts.slice(1).join(" ");
      }

      // Shipping address
      const shipping = session.shipping_details;
      const shippingAddress = shipping ? {
        shipping_name: shipping.name || customerName,
        shipping_line1: shipping.address?.line1 || "",
        shipping_line2: shipping.address?.line2 || "",
        shipping_city: shipping.address?.city || "",
        shipping_postal_code: shipping.address?.postal_code || "",
        shipping_country: shipping.address?.country || "",
      } : {};

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const supabase = supabaseUrl && serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey)
        : null;

      if (customerEmail && supabase) {
        const metaType = session.metadata?.type || "product";

        if (metaType === "cart") {
          // Nouveau format panier multi-articles
          let cartItems: Array<{ id: string; type: string; name: string; qty: number; price?: number }> = [];
          try {
            cartItems = JSON.parse(session.metadata?.cart_items || "[]");
          } catch { cartItems = []; }

          const productNames = cartItems.map(i => `${i.name} ×${i.qty}`).join(", ");

          // Enregistrer l'achat global
          const { error: purchaseError } = await supabase.from("purchases").insert({
            email: customerEmail,
            firstname: firstName,
            lastname: lastName,
            product_name: productNames || "Commande",
            amount,
            status: "paid",
            ...shippingAddress,
          });
          if (purchaseError) console.error("Erreur insertion achat:", purchaseError);

          // Insérer une réservation dans bookings pour chaque séjour du panier
          const stayItems = cartItems.filter(i => i.type === "sejour");
          for (const item of stayItems) {
            const itemAmount = item.price ? item.price * item.qty : amount;
            const bookingRow: Record<string, unknown> = {
              stay_id: item.id || null,
              stay_title: item.name || "Séjour",
              customer_name: customerName,
              customer_email: customerEmail,
              price_label: item.name || "Standard",
              amount: itemAmount,
              status: "paid",
            };
            // Colonnes optionnelles — insérées seulement si elles existent dans la table
            try {
              const { error: bookingErr } = await supabase.from("bookings").insert({
                ...bookingRow,
                amount_paid: itemAmount,
                stripe_session_id: session.id,
                booking_date: new Date().toISOString().split("T")[0],
              });
              if (bookingErr) {
                console.warn("Insert complet échoué, retry sans colonnes optionnelles:", bookingErr.message);
                const { error: retryErr } = await supabase.from("bookings").insert(bookingRow);
                if (retryErr) console.error("Erreur insertion booking séjour:", retryErr);
              }
            } catch (e) {
              console.error("Exception insertion booking:", e);
            }
          }

          // Décrémenter le stock pour chaque produit
          for (const item of cartItems) {
            if (item.type === "product" && item.id) {
              const { data: prod } = await supabase
                .from("products")
                .select("stock")
                .eq("id", item.id)
                .single();

              if (prod && prod.stock !== null && prod.stock > 0) {
                const newStock = Math.max(0, prod.stock - item.qty);
                await supabase
                  .from("products")
                  .update({ stock: newStock })
                  .eq("id", item.id);
                console.log(`Stock produit ${item.id} : ${prod.stock} → ${newStock}`);
              }
            }
          }

        } else if (metaType === "product") {
          // Ancien format produit unique (rétrocompatibilité)
          const productName = session.metadata?.product_name || "Produit";
          const productId = session.metadata?.product_id;

          const { error: purchaseError } = await supabase.from("purchases").insert({
            email: customerEmail,
            firstname: firstName,
            lastname: lastName,
            product_name: productName,
            amount,
            status: "paid",
            ...shippingAddress,
          });
          if (purchaseError) console.error("Erreur insertion achat:", purchaseError);

          if (productId) {
            const { data: prod } = await supabase
              .from("products")
              .select("stock")
              .eq("id", productId)
              .single();
            if (prod && prod.stock !== null && prod.stock > 0) {
              const newStock = prod.stock - 1;
              await supabase.from("products").update({ stock: newStock }).eq("id", productId);
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

        // Résumé des articles pour les emails
        const articlesLabel = session.metadata?.cart_items
          ? JSON.parse(session.metadata.cart_items).map((i: { name: string; qty: number }) => `${i.name} ×${i.qty}`).join(", ")
          : (session.metadata?.product_name || session.metadata?.event_name || "—");
        const orderRef = session.metadata?.order_ref || "";

        // Contenu de la commande : articles de la boutique, séjours, ou les deux
        let metaItems: Array<{ type: string }> = [];
        try { metaItems = JSON.parse(session.metadata?.cart_items || "[]"); } catch { metaItems = []; }
        const hasProducts = metaType === "cart" ? metaItems.some(i => i.type === "product") : metaType === "product";
        const hasStays = metaType === "cart" ? metaItems.some(i => i.type === "sejour") : metaType !== "product";

        const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
        const deliveryLine = hasProducts && shipping
          ? [shippingAddress.shipping_line1, shippingAddress.shipping_line2, `${shippingAddress.shipping_postal_code} ${shippingAddress.shipping_city}`]
              .filter(s => s && s.trim()).map(s => esc(String(s))).join("<br>")
          : "";

        const clientSubject = hasProducts && hasStays
          ? "Ta commande et ta réservation Âmes Nomades sont confirmées"
          : hasStays ? "Ta réservation Âmes Nomades est confirmée" : "Ta commande Âmes Nomades est confirmée";
        const clientIntro = hasProducts && hasStays
          ? "Nous avons bien reçu ton paiement : ta commande et ta réservation sont confirmées."
          : hasStays ? "Nous avons bien reçu ton paiement et ta réservation est confirmée."
          : "Nous avons bien reçu ton paiement et ta commande est confirmée.";
        const clientNext = [
          hasProducts ? "Nous préparons ton colis avec soin. Tu recevras un email avec le numéro de suivi dès son expédition." : "",
          hasStays ? "Tu recevras prochainement par email toutes les informations pratiques pour ton séjour." : "",
        ].filter(Boolean).map(p => `<p style="color:#666;font-size:14px">${p}</p>`).join("");

        const shippingHtml = shipping
          ? `<li><strong>Adresse de livraison :</strong> ${shippingAddress.shipping_line1}, ${shippingAddress.shipping_postal_code} ${shippingAddress.shipping_city}, ${shippingAddress.shipping_country}</li>`
          : "";

        // Ajouter le contact sur Brevo (liste 13)
        const brevoApiKey = Deno.env.get("BREVO_API_KEY");
        if (brevoApiKey) {
          // Ajout contact liste
          for (const payload of [
            { email: customerEmail, listIds: [13], updateEnabled: true, attributes: { PRENOM: firstName, NOM: lastName } },
            { email: customerEmail, listIds: [13], updateEnabled: true },
          ]) {
            const res = await fetch("https://api.brevo.com/v3/contacts", {
              method: "POST",
              headers: { "Content-Type": "application/json", "api-key": brevoApiKey },
              body: JSON.stringify(payload),
            });
            const resText = await res.text();
            if (res.ok) { console.log(`Contact Brevo ajouté : ${customerEmail}`); break; }
            else console.warn(`Brevo contact erreur (${res.status}):`, resText);
          }

          const sendEmail = async (to: { email: string; name: string }[], subject: string, htmlContent: string) => {
            const res = await fetch("https://api.brevo.com/v3/smtp/email", {
              method: "POST",
              headers: { "Content-Type": "application/json", "api-key": brevoApiKey },
              body: JSON.stringify({
                sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" },
                to,
                subject,
                htmlContent,
              }),
            });
            const txt = await res.text();
            if (!res.ok) console.error(`Brevo email erreur (${res.status}):`, txt);
            else console.log(`Email envoyé à ${to.map(t => t.email).join(", ")}`);
          };

          // Email alerte admin
          await sendEmail(
            [{ email: "contact@amesnomades.com", name: "Admin Âmes Nomades" }],
            hasStays && !hasProducts
              ? `🎉 Nouveau paiement séjour${orderRef ? " " + orderRef : ""} — ${firstName} ${lastName} (${amount} €)`
              : `🛍️ Nouvel achat${hasStays ? " + séjour" : ""}${orderRef ? " " + orderRef : ""} — ${firstName} ${lastName} (${amount} €)`,
            `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px">
              <h2 style="color:#2e7d32">Nouveau paiement validé !</h2>
              <ul>
                ${orderRef ? `<li><strong>Commande :</strong> ${orderRef}</li>` : ""}
                <li><strong>Nom :</strong> ${customerName}</li>
                <li><strong>Email :</strong> <a href="mailto:${customerEmail}">${customerEmail}</a></li>
                <li><strong>Articles :</strong> ${articlesLabel}</li>
                <li><strong>Montant :</strong> ${amount} €</li>
                ${shippingHtml}
              </ul>
            </div>`
          );

          // Email confirmation client
          await sendEmail(
            [{ email: customerEmail, name: firstName || customerName }],
            clientSubject,
            `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px;color:#222">
              <h2 style="font-family:Georgia,serif;font-weight:400;color:#222">Merci ${hasStays && !hasProducts ? "pour ta réservation" : "pour ta commande"}, ${firstName} !</h2>
              <p>${clientIntro}</p>
              <table style="width:100%;border-collapse:collapse;margin:20px 0">
                ${orderRef ? `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Commande n°</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${orderRef}</td></tr>` : ""}
                <tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">Articles</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${articlesLabel}</td></tr>
                ${deliveryLine ? `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666;vertical-align:top">Livraison</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${deliveryLine}</td></tr>` : ""}
                <tr><td style="padding:8px 0;font-weight:600">Total payé</td><td style="padding:8px 0;text-align:right;font-weight:600">${amount} €</td></tr>
              </table>
              ${clientNext}
              <p style="margin-top:24px">À très bientôt,<br><strong>L'équipe Âmes Nomades</strong></p>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
              <p style="font-size:12px;color:#999">Des questions ? Contacte-nous : <a href="mailto:contact@amesnomades.com" style="color:#666">contact@amesnomades.com</a></p>
            </div>`
          );
        } else {
          console.warn("BREVO_API_KEY manquante — aucun email envoyé");
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
