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

async function sendAdminNotificationEmail(
  email: string,
  firstname: string,
  lastname: string,
  intention: string,
  brevoApiKey: string,
): Promise<void> {
  const intentionHtml = intention
    ? `<p><strong>Ce qu'elle vient chercher :</strong><br>${intention.replace(/\n/g, "<br>")}</p>`
    : `<p><em>Champ "intention" non rempli.</em></p>`;

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": brevoApiKey,
    },
    body: JSON.stringify({
      sender: { name: "Âmes Nomades", email: "contact@amesnomades.com" },
      to: [{ email: "contact@amesnomades.com", name: "Âmes Nomades Admin" }],
      subject: `🌿 Nouvelle inscription prioritaire — ${firstname} ${lastname}`,
      htmlContent: `
        <h2>Nouvelle inscription sur la liste prioritaire</h2>
        <p><strong>Prénom :</strong> ${firstname}</p>
        <p><strong>Nom :</strong> ${lastname}</p>
        <p><strong>Email :</strong> ${email}</p>
        ${intentionHtml}
        <hr>
        <p style="color:#999; font-size:12px;">Inscription via la page maintenance — Âmes Nomades</p>
      `,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error(`Brevo admin notification failed: ${response.status} ${text}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(req),
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(req, { error: "Missing Supabase environment variables" }, 500);
    }

    const brevoApiKey = Deno.env.get("BREVO_API_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const firstname = String(body.firstname ?? "").trim();
    const lastname = String(body.lastname ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const intention = String(body.intention ?? "").trim();
    const newsletterOptin = body.newsletter_optin === true;

    if (!firstname || !email) {
      return jsonResponse(req, { error: "firstname and email are required" }, 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return jsonResponse(req, { error: "invalid email" }, 400);
    }

    const { data: existingRows, error: existingError } = await supabase
      .from("priority_waitlist")
      .select("id")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existingError) {
      throw existingError;
    }

    const existing = existingRows?.[0];

    if (existing) {
      const { error: updateError } = await supabase
        .from("priority_waitlist")
        .update({
          firstname,
          ...(lastname ? { lastname } : {}),
          source: "maintenance",
          status: "active",
          ...(intention ? { intention } : {}),
        })
        .eq("id", existing.id);

      if (updateError) throw updateError;

      return jsonResponse(req, { status: "already" }, 200);
    }

    const { error: insertError } = await supabase
      .from("priority_waitlist")
      .insert({
        firstname,
        lastname: lastname || null,
        email,
        source: "maintenance",
        status: "active",
        intention: intention || null,
        newsletter_optin: newsletterOptin,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        return jsonResponse(req, { status: "already" }, 200);
      }
      throw insertError;
    }

    if (newsletterOptin) {
      await supabase
        .from("newsletter")
        .upsert({
          email,
          name: `${firstname} ${lastname}`.trim(),
        }, { onConflict: "email", ignoreDuplicates: true })
        .catch((err: unknown) => {
          console.error("Erreur ajout newsletter depuis priority-signup:", err);
        });
    }

    if (brevoApiKey) {
      await sendAdminNotificationEmail(
        email,
        firstname,
        lastname,
        intention,
        brevoApiKey,
      ).catch((err: unknown) => {
        console.error("Erreur notification admin:", err);
      });
    }

    return jsonResponse(req, { status: "ok" }, 200);
  } catch (error) {
    console.error("priority-signup error:", error);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
