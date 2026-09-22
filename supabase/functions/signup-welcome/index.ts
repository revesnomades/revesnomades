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
    const { firstname, email } = await req.json();

    if (!email) {
      return new Response(JSON.stringify({ error: "Email requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    if (!brevoApiKey) {
      return new Response(JSON.stringify({ error: "BREVO_API_KEY non configurée" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const safeName = (firstname || "").trim();
    const greeting = safeName ? `Hello ${safeName},` : "Hello,";

    const htmlContent = `
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Bienvenue chez Âmes Nomades 🤍</title>
</head>
<body style="margin:0; padding:0; background-color:#f7f4ef; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#1e1f22; line-height:1.7;">
  <div style="width:100%; background-color:#f7f4ef; padding:40px 0;">
    <div style="max-width:600px; margin:0 auto; background:#ffffff; border:1px solid rgba(30, 31, 34, 0.08); border-radius:8px; padding:48px; box-shadow:0 4px 12px rgba(0, 0, 0, 0.03);">
      
      <div style="text-align:center; margin-bottom:32px;">
        <h1 style="margin:0; font-family:Georgia, serif; font-size:28px; font-weight:300; letter-spacing:0.04em; color:#1e1f22;">ÂmesNomades</h1>
        <p style="margin:6px 0 0 0; font-size:12px; text-transform:uppercase; letter-spacing:0.12em; color:#888;">Retraites & Expériences Holistiques</p>
      </div>

      <div style="font-size:16px; color:#1e1f22; margin-bottom:24px;">
        <p style="font-size:18px; margin-top:0;">${greeting}</p>
        <p>Bienvenue dans la communauté <strong>Âmes Nomades</strong> ✨</p>
        <p>Votre compte a été créé avec succès ! Vous pouvez dès à présent vous connecter à votre espace personnel pour suivre vos réservations de séjours, télécharger vos factures et recevoir nos actualités exclusives.</p>
      </div>

      <div style="text-align:center; margin:36px 0;">
        <a href="https://www.amesnomades.com/compte.html" target="_blank" style="display:inline-block; background:#1e1f22; color:#ffffff; font-weight:600; font-size:14px; padding:14px 28px; border-radius:6px; text-decoration:none; letter-spacing:0.04em;">
          Accéder à mon espace compte →
        </a>
      </div>

      <div style="border-top:1px solid #eee; padding-top:24px; margin-top:36px; font-size:13px; color:#666;">
        <p style="margin:0 0 4px 0;">Si vous avez la moindre question, n'hésitez pas à nous écrire directement à <a href="mailto:contact@amesnomades.com" style="color:#1e1f22; text-decoration:underline;">contact@amesnomades.com</a>.</p>
        <p style="margin:16px 0 0 0; font-style:italic; color:#888;">Douceur & Sérénité,<br><strong style="font-style:normal; color:#1e1f22;">L'équipe Âmes Nomades</strong></p>
      </div>

    </div>
  </div>
</body>
</html>
    `;

    // 1. Envoyer l'email transactionnel de bienvenue via Brevo API
    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": brevoApiKey,
      },
      body: JSON.stringify({
        sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" },
        to: [{ email: cleanEmail, name: safeName || cleanEmail }],
        subject: "Bienvenue chez Âmes Nomades ✨ — Confirmation de votre compte",
        htmlContent: htmlContent,
      }),
    });

    if (!brevoRes.ok) {
      const errText = await brevoRes.text();
      console.error("Erreur Brevo Signup Email:", errText);
    }

    // 2. Synchroniser le contact dans Brevo (Liste 13)
    try {
      await fetch("https://api.brevo.com/v3/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": brevoApiKey },
        body: JSON.stringify({
          email: cleanEmail,
          listIds: [13],
          updateEnabled: true,
          attributes: { PRENOM: safeName }
        }),
      });
    } catch (e) {
      console.warn("Brevo contact sync warning:", e);
    }

    return new Response(JSON.stringify({ success: true, message: `Email de confirmation envoyé à ${cleanEmail}` }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Erreur serveur";
    console.error("Signup Welcome Error:", errorMsg);
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
