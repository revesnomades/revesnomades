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
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: buildCorsHeaders(req),
  });
}

async function callBrevoApi(path: string, init: RequestInit, brevoApiKey: string) {
  const response = await fetch(`https://api.brevo.com/v3${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": brevoApiKey,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Brevo ${path} failed: ${response.status} ${text}`);
  }

  return response;
}

async function sendBrevoUnsubscribeEmail(email: string, brevoApiKey: string) {
  const templateIdRaw = Deno.env.get("BREVO_UNSUBSCRIBE_TEMPLATE_ID");
  const templateId = templateIdRaw ? Number(templateIdRaw) : NaN;

  if (!Number.isFinite(templateId) || templateId <= 0) {
    // TODO Processus Brevo #6 : renseigner BREVO_UNSUBSCRIBE_TEMPLATE_ID pour envoyer
    // le template transactionnel exact de désinscription demandé.
    return;
  }

  await callBrevoApi(
    "/smtp/email",
    {
      method: "POST",
      body: JSON.stringify({
        to: [{ email }],
        templateId,
      }),
    },
    brevoApiKey,
  );
}

async function removeContactFromBrevoNewsletter(email: string, brevoApiKey: string) {
  await callBrevoApi(
    `/contacts/${encodeURIComponent(email)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        emailBlacklisted: true,
      }),
    },
    brevoApiKey,
  );

  const listIdRaw = Deno.env.get("BREVO_NEWSLETTER_LIST_ID");
  const listId = listIdRaw ? Number(listIdRaw) : NaN;

  if (!Number.isFinite(listId) || listId <= 0) return;

  await callBrevoApi(
    `/contacts/lists/${listId}/contacts/remove`,
    {
      method: "POST",
      body: JSON.stringify({
        emails: [email],
      }),
    },
    brevoApiKey,
  );
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
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");

    if (!supabaseUrl || !serviceRoleKey || !brevoApiKey) {
      return jsonResponse(req, { error: "Missing environment variables" }, 500);
    }

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user?.email) {
      return jsonResponse(req, { error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const requestedEmail = String(body.email ?? "").trim().toLowerCase();
    const email = String(user.email).trim().toLowerCase();

    if (requestedEmail && requestedEmail !== email) {
      return jsonResponse(req, { error: "Forbidden email mismatch" }, 403);
    }

    const { error: dbDeleteError } = await supabase
      .from("newsletter")
      .delete()
      .eq("email", email);

    if (dbDeleteError) {
      throw dbDeleteError;
    }

    await removeContactFromBrevoNewsletter(email, brevoApiKey);
    await sendBrevoUnsubscribeEmail(email, brevoApiKey);

    return jsonResponse(req, { status: "ok" }, 200);
  } catch (error) {
    console.error("newsletter-unsubscribe error:", error);
    return jsonResponse(req, { error: "Internal error" }, 500);
  }
});
