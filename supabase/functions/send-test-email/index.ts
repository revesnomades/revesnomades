import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

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
    const { targetEmail, subject, content } = await req.json();

    if (!targetEmail) {
      return new Response(JSON.stringify({ error: "Email destinataire requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    if (!brevoApiKey) {
      return new Response(JSON.stringify({ error: "BREVO_API_KEY non configurée dans Supabase" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let emailSubject = subject || "Test - Confirmation de séjour Âmes Nomades";
    let emailBody = content || "<p>Ceci est un email de test.</p>";

    // Remplacer les variables de test dynamiques
    emailSubject = emailSubject
      .replaceAll("{{params.PRENOM}}", "Sophie")
      .replaceAll("{{params.NOM}}", "Martin")
      .replaceAll("{{params.TITRE_SEJOUR}}", "Journée Retraite & Yoga (Test)")
      .replaceAll("{{params.DATE_SEJOUR}}", "15 Octobre 2026")
      .replaceAll("{{params.PRIX}}", "150 €");

    emailBody = emailBody
      .replaceAll("{{params.PRENOM}}", "Sophie")
      .replaceAll("{{params.NOM}}", "Martin")
      .replaceAll("{{params.TITRE_SEJOUR}}", "Journée Retraite & Yoga (Test)")
      .replaceAll("{{params.DATE_SEJOUR}}", "15 Octobre 2026")
      .replaceAll("{{params.PRIX}}", "150 €");

    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": brevoApiKey,
      },
      body: JSON.stringify({
        sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" },
        to: [{ email: targetEmail, name: "Admin Test" }],
        subject: `[TEST] ${emailSubject}`,
        htmlContent: `<div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; line-height: 1.6;">${emailBody}</div>`,
      }),
    });

    if (!brevoRes.ok) {
      const errText = await brevoRes.text();
      console.error("Erreur Brevo Test Email:", errText);
      return new Response(JSON.stringify({ error: `Brevo error: ${errText}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, message: `Email de test envoyé à ${targetEmail}` }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Erreur serveur";
    console.error("Test Email Error:", errorMsg);
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
