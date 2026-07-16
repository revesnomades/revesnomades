// supabase/functions/newsletter-signup/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") || "";
const BREVO_LIST_ID = Number(Deno.env.get("BREVO_LIST_ID") || "9");

const SITE_URL = "https://www.amesnomades.com";
const LOGO_URL = "https://www.amesnomades.com/assets/img/logo-ames-nomades.png";
const GUIDE_URL = "https://www.amesnomades.com/assets/pdf/5%20fa%C3%A7ons%20de%20reprendre%20du%20temps%20pour%20toi.pdf";
const INSTAGRAM_URL = "https://instagram.com/amesnomades_retreat";
const FACEBOOK_URL = "https://www.facebook.com/share/1bLsFzNTCz/?mibextid=wwXIfr";
const SENDER_NAME = "Âmes Nomades";
const SENDER_EMAIL = "contact@amesnomades.com";

// Autoriser les origines
const ALLOWED_ORIGINS = new Set([
  "https://amesnomades.com",
  "https://www.amesnomades.com",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
]);

function corsHeaders(origin: string | null) {
  const allowedOrigin =
    origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://www.amesnomades.com";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "content-type, authorization, x-client-info, apikey",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeEmail(s: string) {
  return String(s || "").trim().toLowerCase();
}

function normalizeName(s: string) {
  return String(s || "").trim();
}

function buildGuideEmailHTML(params: {
  firstname: string;
  siteUrl: string;
  logoUrl: string;
  guideUrl: string;
  instagramUrl: string;
  facebookUrl: string;
}) {
  const safeName = params.firstname?.trim() ? params.firstname.trim() : "";
  const greeting = safeName ? `Hello ${safeName},` : "Hello,";

  return `
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Tes quelques pages pour ralentir 🤍</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f7f4ef;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1e1f22;
      -webkit-font-smoothing: antialiased;
      line-height: 1.8;
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
    .header img {
      height: 48px;
      width: auto;
      border: 0;
      outline: none;
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
      color: #1e1f22;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .social-links {
      margin-top: 16px;
    }
    .social-links a {
      display: inline-block;
      margin: 0 8px;
      color: #1e1f22;
      text-decoration: underline;
      text-underline-offset: 3px;
      font-size: 13.5px;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <a href="${params.siteUrl}" target="_blank" style="text-decoration:none;display:inline-block;">
          <img src="${params.logoUrl}" alt="Âmes Nomades">
        </a>
      </div>
      
      <div class="content">
        <p>${greeting}</p>
        
        <p>Voici une parenthèse à glisser dans ton quotidien que j’avais envie de t’offrir.</p>
        
        <p>Je l’ai imaginée avec une intention simple : t’offrir quelques instants pour ralentir, respirer, en ne pensant qu’à toi !</p>
        
        <p>Prends le temps de parcourir ce book à ton rythme. D’y revenir lorsque tu en ressens le besoin. Les plus grands changements naissent souvent de petits rituels répétés avec intention.</p>
        
        <p>J’espère qu’il t’inspirera à créer un peu plus d’espace pour toi.</p>
        
        <p>Et si un jour tu as envie d’aller plus loin, les retraites Âmes Nomades seront là pour t’offrir cette même sensation, mais pendant quelques jours.</p>
        
        <div class="cta-container">
          <a href="${params.guideUrl}" target="_blank" class="btn">Télécharger mon guide</a>
        </div>
        
        <p>Je te souhaite une lecture inspirante.</p>
        
        <p>À très vite,</p>
        
        <div class="signature">
          <strong>Appoline Sarnelli</strong><br>
          <span style="color:#6c7078; font-size:13px;">Fondatrice d’Âmes Nomades</span>
        </div>
      </div>
    </div>
    
    <div class="footer">
      <div class="social-links">
        <a href="${params.instagramUrl}" target="_blank">Instagram</a>
        <a href="${params.facebookUrl}" target="_blank">Facebook</a>
      </div>
      <p style="margin: 16px 0 0 0;">
        Cet e-mail t'a été envoyé suite à ton inscription sur <a href="${params.siteUrl}" target="_blank">amesnomades.com</a>.<br>
        © ${new Date().getFullYear()} Âmes Nomades — Partir pour mieux se retrouver.
      </p>
    </div>
  </div>
</body>
</html>`.trim();
}

async function addToBrevo(email: string, firstname: string) {
  if (!BREVO_API_KEY) return { ok: false, details: "BREVO_API_KEY missing" };

  const attributes = firstname ? { PRENOM: firstname, FIRSTNAME: firstname } : {};

  const res = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": BREVO_API_KEY,
    },
    body: JSON.stringify({
      email,
      attributes,
      listIds: [BREVO_LIST_ID],
      updateEnabled: true,
    }),
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, details: text || `HTTP ${res.status}` };
  return { ok: true, details: text || "OK" };
}

async function sendGuideEmailBrevo(email: string, firstname: string) {
  if (!BREVO_API_KEY) return { ok: false, details: "BREVO_API_KEY missing" };

  const htmlContent = buildGuideEmailHTML({
    firstname,
    siteUrl: SITE_URL,
    logoUrl: LOGO_URL,
    guideUrl: GUIDE_URL,
    instagramUrl: INSTAGRAM_URL,
    facebookUrl: FACEBOOK_URL,
  });

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: SENDER_NAME, email: SENDER_EMAIL },
      to: [{ email, name: firstname || "" }],
      subject: "Tes quelques pages pour ralentir 🤍",
      htmlContent,
    }),
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, details: text || `HTTP ${res.status}` };
  return { ok: true, details: text || "OK" };
}

serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders(origin),
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, origin);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail(body.email);
    const firstname = normalizeName(body.firstname ?? body.name);

    if (!email) return json({ error: "Missing email" }, 400, origin);
    if (!firstname) return json({ error: "Missing firstname" }, 400, origin);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { error: dbError } = await supabase
      .from("newsletter")
      .insert([{ email, name: firstname }]);

    let status: "created" | "already" = "created";

    if (dbError) {
      if (dbError.code === "23505") {
        status = "already";
      } else {
        return json(
          { error: "DB error", details: dbError.message, code: dbError.code },
          400,
          origin
        );
      }
    }

    const brevoContact = await addToBrevo(email, firstname);
    const brevoMail = await sendGuideEmailBrevo(email, firstname);

    return json(
      {
        ok: true,
        status,
        brevoContactOk: brevoContact.ok,
        brevoMailOk: brevoMail.ok,
      },
      200,
      origin
    );
  } catch (e) {
    return json({ error: String(e) }, 500, origin);
  }
});
