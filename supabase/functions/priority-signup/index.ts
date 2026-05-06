import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://amesnomades.com",
  "https://www.amesnomades.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
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

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: buildCorsHeaders(req),
  });
}

async function sendBrevoEmail(
  brevoApiKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": brevoApiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Brevo API error: ${response.status} ${text}`);
  }
}

async function sendConfirmationToUser(
  brevoApiKey: string,
  email: string,
  firstname: string,
): Promise<void> {
  const templateIdRaw = Deno.env.get("BREVO_PRIORITY_CONFIRMATION_TEMPLATE_ID");
  const templateId = templateIdRaw ? Number(templateIdRaw) : NaN;

  if (!Number.isFinite(templateId) || templateId <= 0) {
    console.warn(
      "BREVO_PRIORITY_CONFIRMATION_TEMPLATE_ID non configuré ou invalide, email confirmation non envoyé."
    );
    return;
  }

  await sendBrevoEmail(brevoApiKey, {
    to: [{ email, name: firstname }],
    templateId,
    params: {
      FIRSTNAME: firstname,
      firstname: firstname,
    },
  });

  console.log(`Email confirmation envoyé à ${email} (template ${templateId})`);
}

async function sendAdminNotification(
  brevoApiKey: string,
  email: string,
  firstname: string,
  lastname: string,
  intention: string,
): Promise<void> {
  const intentionHtml = intention
    ? `<p><strong>Ce qu'elle vient chercher :</strong><br>${
        intention
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>")
      }</p>`
    : `<p style="color:#999;"><em>Champ intention non rempli.</em></p>`;

  await sendBrevoEmail(brevoApiKey, {
    sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" },
    to: [{ email: "contact@amesnomades.com", name: "Admin Âmes Nomades" }],
    subject: `🌿 Nouvelle inscription prioritaire — ${firstname} ${lastname}`.trim(),
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <body style="font-family:Arial,sans-serif; color:#1e1f22; max-width:600px; margin:0 auto;">
        <h2 style="color:#1e1f22;">Nouvelle inscription liste prioritaire</h2>
        <table style="border-collapse:collapse; width:100%;">
          <tr>
            <td style="padding:8px; border:1px solid #eee; background:#f7f4ef; font-weight:bold; width:140px;">Prénom</td>
            <td style="padding:8px; border:1px solid #eee;">${firstname}</td>
          </tr>
          <tr>
            <td style="padding:8px; border:1px solid #eee; background:#f7f4ef; font-weight:bold;">Nom</td>
            <td style="padding:8px; border:1px solid #eee;">${lastname || "—"}</td>
          </tr>
          <tr>
            <td style="padding:8px; border:1px solid #eee; background:#f7f4ef; font-weight:bold;">Email</td>
            <td style="padding:8px; border:1px solid #eee;">
              <a href="mailto:${email}">${email}</a>
            </td>
          </tr>
        </table>
        <div style="margin-top:20px; padding:14px; background:#f7f4ef; border-left:3px solid #1e1f22;">
          <strong>Ce qu'elle vient chercher :</strong>
          <div style="margin-top:8px;">${intentionHtml}</div>
        </div>
        <p style="margin-top:24px; font-size:12px; color:#999;">
          Inscription via la page maintenance — amesnomades.com
        </p>
      </body>
      </html>
    `,
  });

  console.log(`Email notification admin envoyé pour ${email}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: buildCorsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl    = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const brevoApiKey    = Deno.env.get("BREVO_API_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Variables Supabase manquantes");
      return jsonResponse(req, { error: "Configuration serveur manquante" }, 500);
    }

    if (!brevoApiKey) {
      console.warn("BREVO_API_KEY non configurée — emails désactivés");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body      = await req.json().catch(() => ({}));
    const firstname = String(body.firstname ?? "").trim();
    const lastname  = String(body.lastname  ?? "").trim();
    const email     = String(body.email     ?? "").trim().toLowerCase();
    const intention = String(body.intention ?? "").trim();

    console.log("priority-signup reçu:", { firstname, lastname, email, hasIntention: !!intention });

    if (!firstname || !email) {
      return jsonResponse(req, { error: "firstname et email sont obligatoires" }, 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return jsonResponse(req, { error: "Email invalide" }, 400);
    }

    // Vérifier si déjà inscrit
    const { data: existingRows, error: existingError } = await supabase
      .from("priority_waitlist")
      .select("id")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existingError) {
      console.error("Erreur vérification existant:", existingError);
      throw existingError;
    }

    const existing = existingRows?.[0];

    if (existing) {
      // Mise à jour sans renvoyer d'email
      const { error: updateError } = await supabase
        .from("priority_waitlist")
        .update({
          firstname,
          lastname,
          source: "maintenance",
          status: "active",
          ...(intention ? { intention } : {}),
        })
        .eq("id", existing.id);

      if (updateError) {
        console.error("Erreur mise à jour:", updateError);
        throw updateError;
      }

      console.log(`Inscrit existant mis à jour: ${email}`);
      return jsonResponse(req, { status: "already" }, 200);
    }

    // Nouvelle inscription
    const { error: insertError } = await supabase
      .from("priority_waitlist")
      .insert({
        firstname,
        lastname,
        email,
        source: "maintenance",
        status: "active",
        intention: intention || null,
        newsletter_optin: false,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        console.warn("Double insertion détectée (race condition):", email);
        return jsonResponse(req, { status: "already" }, 200);
      }
      console.error("Erreur insertion:", insertError);
      throw insertError;
    }

    console.log(`Nouvelle inscription enregistrée: ${email}`);

    // Envoi emails en parallèle (non bloquants)
    if (brevoApiKey) {
      await Promise.allSettled([
        sendConfirmationToUser(brevoApiKey, email, firstname).catch(err =>
          console.error("Erreur email confirmation:", err)
        ),
        sendAdminNotification(brevoApiKey, email, firstname, lastname, intention).catch(err =>
          console.error("Erreur email admin:", err)
        ),
      ]);
    } else {
      console.warn("Emails non envoyés : BREVO_API_KEY manquante");
    }

    return jsonResponse(req, { status: "ok" }, 200);

  } catch (error) {
    console.error("priority-signup erreur générale:", error);
    return jsonResponse(req, { error: "Erreur serveur interne" }, 500);
  }
});
