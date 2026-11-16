// Envoi d'un devis, d'une facture ou d'un avoir par email (Brevo), avec le PDF en pièce jointe.
// Réservé aux administrateurs ; seuls les documents validés (numérotés) peuvent partir.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://amesnomades.com";
const SENDER = { name: "Âmes Nomades", email: "contact@amesnomades.com" };
const ADMIN_EMAILS = new Set(["contact@amesnomades.com", "sarnelli.ap@gmail.com", "revesnomades@gmail.com"]);
const MAX_PDF_BYTES = 4 * 1024 * 1024;

const allowedOrigins = new Set(["https://amesnomades.com", "https://www.amesnomades.com", "http://localhost:3000", "http://localhost:8000"]);
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
const json = (req: Request, body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const isEmail = (v: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v);

async function requireAdmin(req: Request, supabase: SupabaseClient) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  if (ADMIN_EMAILS.has((user.email || "").toLowerCase())) return user;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin" ? user : null;
}

/** Email simple aux couleurs d'Âmes Nomades ; le message de l'admin est repris tel quel, en texte. */
export function emailHtml(message: string, docLabel: string) {
  const paragraphs = String(message || "").trim().split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#faf5dc">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf5dc"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fffdf3;border:1px solid #e6dfc4">
    <tr><td align="center" style="padding:26px 24px 16px;border-bottom:1px solid #e6dfc4">
      <a href="${SITE_URL}" style="text-decoration:none;color:#1e1f22;font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:4px">ÂMES NOMADES</a>
    </td></tr>
    <tr><td style="padding:26px 28px 10px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1e1f22">${paragraphs}</td></tr>
    <tr><td style="padding:0 28px 26px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6c7078">📎 ${esc(docLabel)} en pièce jointe (PDF).</td></tr>
    <tr><td align="center" style="padding:16px 24px 22px;border-top:1px solid #e6dfc4;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#6c7078">
      Âmes Nomades — Retraites &amp; séjours bien-être<br><a href="${SITE_URL}" style="color:#6c7078">amesnomades.com</a> · contact@amesnomades.com
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(req, { error: "Configuration Supabase manquante" }, 500);
    const supabase = createClient(supabaseUrl, serviceKey);
    const admin = await requireAdmin(req, supabase);
    if (!admin) return json(req, { error: "Accès réservé aux administrateurs" }, 403);

    const brevoKey = Deno.env.get("BREVO_API_KEY");
    if (!brevoKey) return json(req, { error: "Secret BREVO_API_KEY manquant dans Supabase" }, 500);

    const body = await req.json().catch(() => ({}));
    const id = String(body.id || "");
    const to = String(body.to || "").trim().toLowerCase();
    const subject = String(body.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 180);
    const message = String(body.message || "").slice(0, 5000);
    const pdf = String(body.pdf_base64 || "").replace(/^data:application\/pdf;base64,/, "");
    const fileName = String(body.file_name || "document.pdf").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(req, { error: "Document invalide" }, 400);
    if (!isEmail(to)) return json(req, { error: "Adresse email du destinataire invalide" }, 400);
    if (!subject) return json(req, { error: "Objet manquant" }, 400);
    if (!pdf || pdf.length * 0.75 > MAX_PDF_BYTES || !/^[A-Za-z0-9+/=]+$/.test(pdf)) return json(req, { error: "PDF manquant ou trop lourd" }, 400);
    // Un vrai PDF commence par « %PDF »
    if (!atob(pdf.slice(0, 8)).startsWith("%PDF")) return json(req, { error: "Le fichier joint n'est pas un PDF" }, 400);

    const { data: doc, error } = await supabase.from("billing_documents").select("id, kind, status, number").eq("id", id).maybeSingle();
    if (error) return json(req, { error: `Lecture du document impossible : ${error.message}` }, 500);
    if (!doc) return json(req, { error: "Document introuvable" }, 404);
    if (doc.status === "brouillon" || !doc.number) return json(req, { error: "Validez le document avant de l'envoyer." }, 400);

    const label = `${{ devis: "Devis", facture: "Facture", avoir: "Avoir" }[doc.kind as string] || "Document"} ${doc.number}`;
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "api-key": brevoKey },
      body: JSON.stringify({
        sender: SENDER,
        replyTo: SENDER,
        to: [{ email: to }],
        ...(body.copy_me ? { bcc: [{ email: SENDER.email }] } : {}),
        subject,
        htmlContent: emailHtml(message, label),
        textContent: `${message}\n\n${label} en pièce jointe (PDF).`,
        attachment: [{ content: pdf, name: fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf` }],
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("billing-send : Brevo", res.status, txt.slice(0, 300));
      return json(req, { error: `L'email n'est pas parti (Brevo ${res.status}).` }, 502);
    }
    const sentAt = new Date().toISOString();
    const { error: upErr } = await supabase.from("billing_documents").update({ sent_at: sentAt, sent_to: to }).eq("id", id);
    if (upErr) console.warn("billing-send : date d'envoi non enregistrée :", upErr.message);
    console.log(`billing-send : ${label} envoyé à ${to}`);
    return json(req, { sent: true, sent_at: sentAt, to });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("billing-send :", msg);
    return json(req, { error: msg }, 500);
  }
});
