import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTIFY_TO = "contact@amesnomades.com";
const SITE_URL = "https://amesnomades.com";

const allowedOrigins = new Set([
  "https://amesnomades.com",
  "https://www.amesnomades.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : SITE_URL,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);

  try {
    const { product_id, email: rawEmail } = await req.json();
    const email = String(rawEmail || "").trim().toLowerCase();

    if (!UUID_RE.test(String(product_id || ""))) return json(req, { error: "Produit invalide" }, 400);
    if (!EMAIL_RE.test(email) || email.length > 254) return json(req, { error: "Adresse email invalide" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: product } = await supabase
      .from("products")
      .select("id, name")
      .eq("id", product_id)
      .maybeSingle();
    if (!product) return json(req, { error: "Produit introuvable" }, 404);

    const { error: insertError } = await supabase
      .from("restock_subscriptions")
      .insert([{ product_id, email }]);

    if (insertError) {
      if (insertError.code === "23505") return json(req, { already: true });
      console.error("Insertion restock_subscriptions:", insertError);
      return json(req, { error: "Inscription impossible pour le moment" }, 500);
    }

    // Notification interne : n'empêche pas l'inscription si l'email échoue
    try {
      const brevoApiKey = Deno.env.get("BREVO_API_KEY");
      if (!brevoApiKey) throw new Error("BREVO_API_KEY manquante");

      const { count } = await supabase
        .from("restock_subscriptions")
        .select("*", { count: "exact", head: true })
        .eq("product_id", product_id);

      const productUrl = `${SITE_URL}/produit.html?id=${product_id}`;
      const name = escapeHtml(product.name);
      const total = count ?? 1;

      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "accept": "application/json", "content-type": "application/json", "api-key": brevoApiKey },
        body: JSON.stringify({
          sender: { name: "Âmes Nomades", email: NOTIFY_TO },
          to: [{ email: NOTIFY_TO }],
          replyTo: { email },
          subject: `🔔 Nouvelle demande « Me prévenir » : ${product.name}`,
          htmlContent: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px 20px; color: #2d2d2d;">
              <h2 style="font-size: 20px; margin: 0 0 16px;">Nouvelle demande de retour en stock</h2>
              <p style="font-size: 15px; line-height: 1.6; margin: 0 0 8px;"><strong>Produit :</strong> <a href="${productUrl}" style="color:#2d2d2d;">${name}</a></p>
              <p style="font-size: 15px; line-height: 1.6; margin: 0 0 8px;"><strong>Email du client :</strong> ${escapeHtml(email)}</p>
              <p style="font-size: 15px; line-height: 1.6; margin: 0 0 20px;"><strong>Total en attente pour ce produit :</strong> ${total} personne${total > 1 ? "s" : ""}</p>
              <p style="font-size: 13px; color: #777; line-height: 1.6; margin: 0;">
                Le client recevra automatiquement un email dès que le stock repassera au-dessus de 0 dans l'admin du shop.
              </p>
            </div>`,
        }),
      });
      if (!res.ok) throw new Error(`Brevo ${res.status} ${await res.text().catch(() => "")}`);
    } catch (e) {
      console.error("Notification contact@ non envoyée:", e);
    }

    return json(req, { ok: true });
  } catch (err) {
    console.error("restock-signup:", err);
    return json(req, { error: "Requête invalide" }, 400);
  }
});
