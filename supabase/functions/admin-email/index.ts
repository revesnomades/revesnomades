import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://amesnomades.com";
const SENDER = { name: "Âmes Nomades", email: "contact@amesnomades.com" };
const ADMIN_EMAILS = new Set(["contact@amesnomades.com", "sarnelli.ap@gmail.com", "revesnomades@gmail.com"]);
const BREVO_BATCH_SIZE = 100;
const MAX_TURNS = 40;

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

// ─── Accès admin ───────────────────────────────────────────────────────────
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

// ─── Destinataires ─────────────────────────────────────────────────────────
type Recipient = { email: string; firstname: string };
type Audience = "newsletter" | "priority";

async function loadRecipients(supabase: SupabaseClient, audiences: Audience[]) {
  const byEmail = new Map<string, Recipient>();
  const counts: Record<Audience, number> = { newsletter: 0, priority: 0 };

  const { data: unsubs } = await supabase.from("email_unsubscribes").select("email");
  const unsubscribed = new Set((unsubs || []).map(u => String(u.email).toLowerCase()));

  const add = (aud: Audience, email: unknown, firstname: unknown) => {
    const e = String(email || "").trim().toLowerCase();
    if (!e || !e.includes("@") || unsubscribed.has(e)) return;
    counts[aud]++;
    const first = String(firstname || "").trim().split(/\s+/)[0] || "";
    const existing = byEmail.get(e);
    if (!existing) byEmail.set(e, { email: e, firstname: first });
    else if (!existing.firstname && first) existing.firstname = first;
  };

  if (audiences.includes("newsletter")) {
    const { data, error } = await supabase.from("newsletter").select("*");
    if (error) throw error;
    (data || []).forEach(r => add("newsletter", r.email, r.firstname || r.name));
  }
  if (audiences.includes("priority")) {
    const { data, error } = await supabase.from("priority_waitlist").select("*");
    if (error) throw error;
    (data || []).filter(r => !r.status || r.status === "active").forEach(r => add("priority", r.email, r.firstname));
  }
  return { recipients: [...byEmail.values()], counts };
}

// ─── Désinscription ────────────────────────────────────────────────────────
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function unsubscribeUrl(email: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`unsub:${email}`)));
  const e = b64url(new TextEncoder().encode(email));
  return `${SITE_URL}/desinscription.html?e=${e}&t=${b64url(sig).slice(0, 32)}`;
}

// ─── Gabarit email ─────────────────────────────────────────────────────────
// Neutralise toute syntaxe de template Brevo sauf {{salutation}}
function sanitizeBody(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\{\{\s*salutation\s*\}\}/g, "%%SALUTATION%%")
    .replace(/\{\{/g, "{ {").replace(/\}\}/g, "} }")
    .replace(/\{%/g, "{ %").replace(/%\}/g, "% }");
}

function wrapEmail(bodyHtml: string, preheader: string, salutation: string, unsubUrl: string) {
  const body = sanitizeBody(bodyHtml).replace(/%%SALUTATION%%/g, salutation);
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Âmes Nomades</title></head>
<body style="margin:0; padding:0; background:#faf5dc;">
<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf5dc;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; background:#fffdf3; border:1px solid #e6dfc4;">
      <tr><td align="center" style="padding:28px 24px 18px; border-bottom:1px solid #e6dfc4;">
        <a href="${SITE_URL}" style="text-decoration:none; color:#1e1f22; font-family:Georgia, 'Times New Roman', serif; font-size:24px; letter-spacing:4px;">ÂMES NOMADES</a>
      </td></tr>
      <tr><td style="padding:28px 28px 32px; font-family:Arial, Helvetica, sans-serif; font-size:15px; line-height:1.65; color:#1e1f22;">
${body}
      </td></tr>
      <tr><td align="center" style="padding:20px 24px 26px; border-top:1px solid #e6dfc4; font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:1.6; color:#6c7078;">
        Âmes Nomades — Retraites &amp; séjours bien-être<br>
        <a href="${SITE_URL}" style="color:#6c7078;">amesnomades.com</a> · <a href="https://instagram.com/amesnomades_retreat" style="color:#6c7078;">Instagram</a><br><br>
        Vous recevez cet email car vous êtes inscrit(e) à nos actualités.<br>
        <a href="${unsubUrl}" style="color:#6c7078;">Se désinscrire</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

// ─── Génération IA ─────────────────────────────────────────────────────────
const EMAIL_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "Objet de l'email, 70 caractères maximum" },
    preheader: { type: "string", description: "Texte d'aperçu affiché après l'objet dans la boîte mail, 110 caractères maximum" },
    body_html: { type: "string", description: "Contenu central de l'email en HTML (sans <html>, <head> ni <body>)" },
    notes: { type: "string", description: "Une ou deux phrases expliquant à l'admin ce qui a été rédigé ou modifié" },
  },
  required: ["subject", "preheader", "body_html", "notes"],
  additionalProperties: false,
};

async function siteContext(supabase: SupabaseClient) {
  const [{ data: stays }, { data: products }] = await Promise.all([
    supabase.from("stays").select("*").eq("published", true).order("created_at", { ascending: false }).limit(12),
    supabase.from("products").select("*").order("created_at", { ascending: false }).limit(30),
  ]);
  const isVideo = (u: string) => /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(u || "");
  const stayLines = (stays || []).map(s =>
    `- ${s.title}${s.location ? ` (${s.location})` : ""} — ${SITE_URL}/sejour.html?slug=${encodeURIComponent(s.slug || "")}` +
    `${s.short_description ? `\n  ${String(s.short_description).slice(0, 240)}` : ""}` +
    `${s.hero_image || s.index_image ? `\n  Image : ${s.hero_image || s.index_image}` : ""}`);
  const productLines = (products || []).map(p => {
    const media = (p.image_urls?.length ? p.image_urls : (p.image_url ? [p.image_url] : [])) as string[];
    const img = media.find(u => !isVideo(u));
    const status = p.coming_soon === true || p.stock === 0 ? "bientôt disponible" : "disponible";
    return `- ${p.name} — ${Number(p.price || 0).toFixed(2)} € (${status}) — ${SITE_URL}/produit.html?id=${p.id}` +
      `${p.description ? `\n  ${String(p.description).slice(0, 200)}` : ""}${img ? `\n  Image : ${img}` : ""}`;
  });
  return `Séjours publiés :\n${stayLines.join("\n") || "(aucun)"}\n\nProduits du shop :\n${productLines.join("\n") || "(aucun)"}`;
}

const SYSTEM_PROMPT = `Tu rédiges les emails marketing d'Âmes Nomades (amesnomades.com) : retraites et séjours bien-être en France — Pilates, yoga, randonnées, massages, alimentation saine — et un shop d'objets bien-être éco-responsables.

Ton de la marque : chaleureux, apaisant, inspirant, sincère, jamais agressif ni « vendeur ». Phrases simples, quelques images sensorielles (nature, lenteur, se retrouver). Vouvoiement par défaut, sauf si l'admin demande le tutoiement. Français impeccable.

Tu travailles avec l'admin du site : il décrit l'email voulu, puis demande des modifications. À chaque tour, renvoie l'email COMPLET mis à jour (pas seulement la partie modifiée), en conservant tout ce que l'admin n'a pas demandé de changer.

Règles pour body_html (il est inséré dans un gabarit qui contient déjà l'en-tête « ÂMES NOMADES » et le pied de page avec le lien de désinscription — ne les répète pas) :
- HTML d'email compatible Gmail/Outlook : styles en ligne uniquement (attribut style), pas de <style>, pas de JavaScript, pas de <html>/<head>/<body>.
- Commence par un paragraphe contenant exactement {{salutation}} (remplacé par « Bonjour Marie, » ou « Bonjour, »). N'utilise aucune autre accolade double.
- Police Arial/Helvetica, texte #1e1f22, couleur d'accent #cc6f53. Titres en <h2>/<h3> sobres (font-family:Georgia, serif ; font-weight:normal).
- Boutons : <a> avec style display:inline-block; background:#1e1f22; color:#fffdf3; padding:12px 26px; text-decoration:none; border-radius:3px; font-size:13px; letter-spacing:1px; text-transform:uppercase.
- Images : uniquement les URLs fournies dans le contexte ci-dessous, en <img> avec width="100%" style="display:block; max-width:100%; height:auto; border:0;" et un alt descriptif. N'invente jamais d'URL d'image.
- Liens : uniquement vers ${SITE_URL} et ses pages listées dans le contexte. N'invente pas de dates, de prix, de codes promo ni d'offres qui ne sont pas dans le contexte ou la demande de l'admin.
- Termine par une courte signature (par ex. « Belle journée, L'équipe Âmes Nomades »).
- Longueur adaptée : un email se lit en moins d'une minute.

Objet : accrocheur, 70 caractères maximum, un emoji au plus. Preheader : complète l'objet sans le répéter.`;

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

type Turn = { role: "user" | "assistant"; content: string };

async function generateEmail(supabase: SupabaseClient, turns: Turn[]) {
  const context = await siteContext(supabase);
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map(t => ({ role: t.role, content: t.content }));

  const stream = anthropic.beta.messages.stream({
    model: "claude-opus-5-5",
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: EMAIL_SCHEMA },
    },
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      { type: "text", text: `Contexte actuel du site (à utiliser pour les liens, images, noms et prix) :\n\n${context}` },
    ],
    messages,
    // deno-lint-ignore no-explicit-any
  } as any);
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") throw new Error("L'IA a refusé cette demande. Reformulez-la.");
  if (message.stop_reason === "max_tokens") throw new Error("L'email généré est trop long. Demandez une version plus courte.");
  const text = message.content.find(b => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Réponse de l'IA vide.");
  const email = JSON.parse(text.text) as { subject: string; preheader: string; body_html: string; notes: string };
  return { ...email, raw: text.text };
}

// ─── Envoi Brevo ───────────────────────────────────────────────────────────
async function sendBatch(
  brevoApiKey: string,
  subject: string,
  htmlContent: string,
  versions: { to: { email: string; name?: string }[]; params: Record<string, string> }[],
) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "accept": "application/json", "content-type": "application/json", "api-key": brevoApiKey },
    body: JSON.stringify({ sender: SENDER, replyTo: SENDER, subject, htmlContent, messageVersions: versions }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status} ${await res.text().catch(() => "")}`);
}

function brevoHtml(bodyHtml: string, preheader: string) {
  return wrapEmail(bodyHtml, preheader, "{{ params.salutation }}", "{{ params.unsubscribe_url }}");
}

const salutationFor = (firstname: string) => firstname ? `Bonjour ${escapeHtml(firstname)},` : "Bonjour,";

// ─── Routeur ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const admin = await requireAdmin(req, supabase);
    if (!admin) return json(req, { error: "Accès réservé aux administrateurs" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const audiences = (Array.isArray(body.audiences) ? body.audiences : [])
      .filter((a: string): a is Audience => a === "newsletter" || a === "priority");

    if (action === "counts") {
      const all = await loadRecipients(supabase, ["newsletter", "priority"]);
      return json(req, { counts: all.counts, total_unique: all.recipients.length });
    }

    if (action === "audience") {
      const { recipients, counts } = await loadRecipients(supabase, audiences);
      return json(req, { counts, total_unique: recipients.length });
    }

    if (action === "generate") {
      if (!Deno.env.get("ANTHROPIC_API_KEY")) return json(req, { error: "Secret ANTHROPIC_API_KEY manquant dans Supabase" }, 500);
      const turns: Turn[] = (Array.isArray(body.turns) ? body.turns : [])
        .filter((t: Turn) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string" && t.content.trim())
        .slice(-MAX_TURNS);
      if (!turns.length || turns[0].role !== "user" || turns[turns.length - 1].role !== "user") {
        return json(req, { error: "Conversation invalide" }, 400);
      }
      const email = await generateEmail(supabase, turns);
      const preview = wrapEmail(email.body_html, email.preheader, "Bonjour Marie,", "#");
      return json(req, { ...email, preview_html: preview });
    }

    if (action === "preview") {
      const preview = wrapEmail(String(body.body_html || ""), String(body.preheader || ""), "Bonjour Marie,", "#");
      return json(req, { preview_html: preview });
    }

    if (action === "test" || action === "send") {
      const brevoApiKey = Deno.env.get("BREVO_API_KEY");
      if (!brevoApiKey) return json(req, { error: "Secret BREVO_API_KEY manquant dans Supabase" }, 500);
      const subject = String(body.subject || "").trim();
      const preheader = String(body.preheader || "").trim();
      const bodyHtml = String(body.body_html || "");
      if (!subject || !bodyHtml.trim()) return json(req, { error: "Objet ou contenu manquant" }, 400);
      const html = brevoHtml(bodyHtml, preheader);

      if (action === "test") {
        const to = String(body.test_email || admin.email || "").trim().toLowerCase();
        if (!to.includes("@")) return json(req, { error: "Adresse de test invalide" }, 400);
        await sendBatch(brevoApiKey, `[TEST] ${subject}`, html, [{
          to: [{ email: to }],
          params: { salutation: salutationFor("Marie"), unsubscribe_url: await unsubscribeUrl(to) },
        }]);
        return json(req, { sent: 1, to });
      }

      if (!audiences.length) return json(req, { error: "Choisissez au moins une liste" }, 400);
      const { recipients } = await loadRecipients(supabase, audiences);
      if (!recipients.length) return json(req, { error: "Aucun destinataire dans ces listes" }, 400);

      let sent = 0;
      const failures: string[] = [];
      for (let i = 0; i < recipients.length; i += BREVO_BATCH_SIZE) {
        const chunk = recipients.slice(i, i + BREVO_BATCH_SIZE);
        const versions = await Promise.all(chunk.map(async r => ({
          to: [{ email: r.email, ...(r.firstname ? { name: r.firstname } : {}) }],
          params: { salutation: salutationFor(r.firstname), unsubscribe_url: await unsubscribeUrl(r.email) },
        })));
        try {
          await sendBatch(brevoApiKey, subject, html, versions);
          sent += chunk.length;
        } catch (e) {
          console.error("Lot Brevo en échec:", e);
          failures.push(`${chunk.length} destinataires (lot ${i / BREVO_BATCH_SIZE + 1})`);
        }
      }

      await supabase.from("email_campaigns").insert({
        subject, preheader, body_html: bodyHtml, audiences, recipients_count: sent, sent_by: admin.id,
      });

      return json(req, { sent, total: recipients.length, failures });
    }

    return json(req, { error: "Action inconnue" }, 400);
  } catch (err) {
    console.error("admin-email:", err);
    if (err instanceof Anthropic.APIError) {
      return json(req, { error: `Erreur de l'IA (${err.status ?? "réseau"}) : réessayez dans un instant.` }, 502);
    }
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    return json(req, { error: msg }, 500);
  }
});
