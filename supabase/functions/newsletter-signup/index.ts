import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://amesnomades.com",
  "https://www.amesnomades.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
]);

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allowOrigin = allowedOrigins.has(origin) ? origin : "https://amesnomades.com";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

Deno.serve(async (req) => {
  // CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const brevoApiKey = Deno.env.get("BREVO_API_KEY")!;
    const listId = Number(Deno.env.get("BREVO_NEWSLETTER_LIST_ID") || "13");

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { firstname, lastname, email } = await req.json();

    if (!email || !firstname) {
      return new Response(JSON.stringify({ error: "Données manquantes." }), {
        status: 400,
        headers: buildCorsHeaders(req),
      });
    }

    const emailLower = email.toLowerCase().trim();

    // 1. Vérifier si déjà inscrit dans la table "newsletter"
    const { data: existing } = await supabase
      .from("newsletter")
      .select("id")
      .eq("email", emailLower)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ status: "already" }), {
        status: 200,
        headers: buildCorsHeaders(req),
      });
    }

    // 2. Enregistrer dans Supabase
    const { error: dbError } = await supabase
      .from("newsletter")
      .insert({
        name: `${firstname} ${lastname || ""}`.trim(),
        email: emailLower,
      });

    if (dbError) throw dbError;

    // 3. Ajouter à la liste des contacts Brevo
    try {
      await fetch("https://api.brevo.com/v3/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": brevoApiKey,
        },
        body: JSON.stringify({
          email: emailLower,
          listIds: [listId],
          updateEnabled: true,
          attributes: {
            FIRSTNAME: firstname,
            LASTNAME: lastname || "",
            PRENOM: firstname,
            NOM: lastname || "",
          },
        }),
      });
    } catch (brevoErr) {
      console.warn("Erreur ajout contact Brevo (non-bloquant) :", brevoErr);
    }

    // 4. Envoyer l'email personnalisé contenant le guide cadeau au format HTML premium
    const htmlEmail = `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="utf-8">
        <title>Tes quelques pages pour ralentir 🤍</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            line-height: 1.8;
            color: #1e1f22;
            background-color: #f7f4ef;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
          }
          .wrapper {
            width: 100%;
            background-color: #f7f4ef;
            padding: 40px 0;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background: #ffffff;
            border: 1px solid rgba(30, 31, 34, 0.08);
            border-radius: 4px;
            padding: 48px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
          }
          .header {
            text-align: center;
            margin-bottom: 36px;
          }
          .logo {
            font-family: Georgia, serif;
            font-size: 26px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #1e1f22;
            text-decoration: none;
            font-weight: 500;
          }
          .content {
            font-size: 15.5px;
            color: #1e1f22;
          }
          .content p {
            margin: 0 0 20px 0;
          }
          .cta-container {
            text-align: center;
            margin: 36px 0;
          }
          .btn {
            display: inline-block;
            background-color: #1e1f22;
            color: #ffffff !important;
            text-decoration: none;
            padding: 14px 28px;
            font-size: 12px;
            font-family: "Courier New", Courier, monospace;
            font-weight: bold;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            border-radius: 0px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.06);
          }
          .signature {
            margin-top: 36px;
            padding-top: 24px;
            border-top: 1px solid rgba(30, 31, 34, 0.08);
            font-size: 14.5px;
          }
          .footer {
            margin-top: 40px;
            text-align: center;
            font-size: 12px;
            color: #6c7078;
          }
          .footer a {
            color: #6c7078;
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="container">
            <div class="header">
              <a href="https://amesnomades.com" class="logo">ÂMES NOMADES</a>
            </div>
            <div class="content">
              <p>Hello ${firstname},</p>
              
              <p>Voici une parenthèse à glisser dans ton quotidien que j’avais envie de t’offrir.</p>
              
              <p>Je l’ai imaginée avec une intention simple : t’offrir quelques instants pour ralentir, respirer, en ne pensant qu’à toi !</p>
              
              <p>Prends le temps de parcourir ce book à ton rythme. D’y revenir lorsque tu en ressens le besoin. Les plus grands changements naissent souvent de petits rituels répétés avec intention.</p>
              
              <p>J’espère qu’il t’inspirera à créer un peu plus d’espace pour toi.</p>
              
              <p>Et si un jour tu as envie d’aller plus loin, les retraites Âmes Nomades seront là pour t’offrir cette même sensation, mais pendant quelques jours.</p>
              
              <div class="cta-container">
                <a href="https://amesnomades.com/assets/pdf/guide.pdf" target="_blank" class="btn">Télécharger mon guide</a>
              </div>
              
              <p>Je te souhaite une belle lecture.</p>
              
              <p>À très vite,</p>
              
              <div class="signature">
                <strong>Appoline Sarnelli</strong><br>
                <span style="color:#6c7078; font-size:13.5px;">Fondatrice d’Âmes Nomades</span>
              </div>
            </div>
          </div>
          <div class="footer">
            Cet e-mail t'a été envoyé suite à ton inscription sur <a href="https://amesnomades.com">amesnomades.com</a>.<br>
            © 2026 Âmes Nomades
          </div>
        </div>
      </body>
      </html>
    `;

    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "api-key": brevoApiKey,
      },
      body: JSON.stringify({
        sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" },
        to: [{ email: emailLower, name: firstname }],
        subject: "Tes quelques pages pour ralentir 🤍",
        htmlContent: htmlEmail,
      }),
    });

    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: buildCorsHeaders(req),
    });

  } catch (error) {
    console.error("Erreur newsletter-signup :", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: buildCorsHeaders(req),
    });
  }
});
