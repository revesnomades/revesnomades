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

        // Ajouter le contact sur Brevo (liste 13)
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

          // Email d'alerte admin
          const subject = metaType === "sejour"
            ? `🎉 Nouveau paiement séjour — ${firstName} ${lastName} (${amount} €)`
            : `🛍️ Nouvel achat boutique — ${firstName} ${lastName} (${amount} €)`;

          const shippingHtml = shipping
            ? `<li><strong>Adresse de livraison :</strong> ${shippingAddress.shipping_line1}, ${shippingAddress.shipping_postal_code} ${shippingAddress.shipping_city}, ${shippingAddress.shipping_country}</li>`
            : "";

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
                    <li><strong>Articles :</strong> ${session.metadata?.cart_items ? JSON.parse(session.metadata.cart_items).map((i: { name: string; qty: number }) => `${i.name} ×${i.qty}`).join(", ") : (session.metadata?.product_name || session.metadata?.event_name || "—")}</li>
                    <li><strong>Montant :</strong> ${amount} €</li>
                    ${shippingHtml}
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
