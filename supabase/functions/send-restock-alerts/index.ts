import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
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
    const { product_id } = await req.json();
    if (!product_id) {
      return new Response(JSON.stringify({ error: "product_id requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const [{ data: product }, { data: subs }] = await Promise.all([
      supabase.from("products").select("name").eq("id", product_id).single(),
      supabase.from("restock_subscriptions").select("email").eq("product_id", product_id),
    ]);

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const productName = product?.name || "un produit";
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    let sent = 0;

    for (const sub of subs) {
      try {
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": brevoApiKey!,
          },
          body: JSON.stringify({
            sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" },
            to: [{ email: sub.email }],
            subject: `✨ ${productName} est de retour en stock !`,
            htmlContent: `
              <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 20px; color: #2d2d2d;">
                <h2 style="font-size: 22px; margin-bottom: 12px;">Bonne nouvelle !</h2>
                <p style="font-size: 15px; line-height: 1.6; color: #555;">
                  Le produit <strong>${productName}</strong> que vous aviez mis en favoris est à nouveau disponible sur notre boutique.
                </p>
                <a href="https://www.amesnomades.com/boutique.html"
                   style="display:inline-block; margin-top:20px; padding:12px 28px; background:#2d2d2d; color:#fff; text-decoration:none; border-radius:6px; font-size:14px; font-weight:600;">
                  Voir le produit
                </a>
                <p style="margin-top: 28px; font-size: 12px; color: #aaa;">
                  Vous recevez cet email car vous avez demandé à être alerté du retour en stock.
                </p>
              </div>
            `,
          }),
        });
        if (res.ok) sent++;
      } catch (e) {
        console.error("Erreur envoi alerte restock à", sub.email, e);
      }
    }

    // Supprimer les abonnements envoyés
    await supabase
      .from("restock_subscriptions")
      .delete()
      .eq("product_id", product_id);

    console.log(`Alertes restock envoyées : ${sent}/${subs.length} pour produit ${product_id}`);

    return new Response(JSON.stringify({ sent, total: subs.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
