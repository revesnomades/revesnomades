import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://amesnomades.com";
const SENDER = { name: "Âmes Nomades", email: "contact@amesnomades.com" };
const ADMIN_EMAILS = new Set(["contact@amesnomades.com", "sarnelli.ap@gmail.com", "revesnomades@gmail.com"]);
const BREVO_BATCH_SIZE = 100;
const MAX_TURNS = 40;
// Photos importées par l'admin pour un email (bucket public « stays », dossier « emails/ »)
const STORAGE_PUBLIC = `${Deno.env.get("SUPABASE_URL") ?? ""}/storage/v1/object/public/`;
const UPLOADS_PREFIX = `${STORAGE_PUBLIC}stays/emails/`;
const MAX_PHOTOS = 10;
// Visuels du site montrés à l'IA quand l'admin le demande (les autres restent listés en texte)
const SITE_VISION_MAX = 12;
const SITE_CATALOG_MAX = 80;

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
        Tu reçois cet email car tu es inscrit(e) à nos actualités.<br>
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

type SiteImage = { id: string; url: string; label: string };
type Photo = { n: number; url: string; note: string };

const isVideo = (u: string) => /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(u || "");
// Formats que l'IA peut regarder et que les messageries affichent
const isImage = (u: string) => /\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(u || "");
const absUrl = (u: unknown) => {
  const v = String(u ?? "").trim();
  if (!v || v.startsWith("data:")) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("//")) return `https:${v}`;
  return `${SITE_URL}/${v.replace(/^\.?\//, "")}`;
};

// Toutes les photos du site, de la plus représentative à la plus secondaire
// deno-lint-ignore no-explicit-any
function siteLibrary(stays: any[], products: any[], gallery: any[]): SiteImage[] {
  const found: Array<{ url: string; label: string; prio: number }> = [];
  const seen = new Set<string>();
  const add = (u: unknown, label: string, prio: number) => {
    const url = absUrl(u);
    if (!url || !isImage(url) || seen.has(url)) return;
    seen.add(url);
    found.push({ url, label: label.replace(/\s+/g, " ").trim().slice(0, 140), prio });
  };
  for (const s of stays) {
    const t = `Séjour « ${s.title} »`;
    add(s.hero_image, `${t} — image principale`, 0);
    add(s.index_image, `${t} — vignette`, 1);
    let blocks = s.content_blocks;
    if (typeof blocks === "string") { try { blocks = JSON.parse(blocks); } catch { blocks = []; } }
    for (const b of Array.isArray(blocks) ? blocks : []) {
      if (!b || typeof b !== "object") continue;
      add(b.image, `${t} — ${b.image_alt || b.title || "photo de la page"}`, 3);
      for (const g of Array.isArray(b.images) ? b.images : []) {
        add(typeof g === "string" ? g : (g?.url || g?.src), `${t} — ${(typeof g === "object" && (g?.alt || g?.caption)) || "galerie du séjour"}`, 4);
      }
    }
  }
  for (const g of gallery) add(g?.url, `Galerie de la page d'accueil — ${g?.alt || "souvenir d'un séjour"}`, 2);
  for (const p of products) {
    const media = (p.image_urls?.length ? p.image_urls : (p.image_url ? [p.image_url] : [])) as string[];
    media.filter(u => !isVideo(u)).forEach((u, i) => add(u, `Produit « ${p.name} » — photo ${i + 1}`, i === 0 ? 5 : 6));
  }
  return found
    .sort((a, b) => a.prio - b.prio)
    .slice(0, SITE_CATALOG_MAX)
    .map((f, i) => ({ id: `V${i + 1}`, url: f.url, label: f.label }));
}

async function siteContext(supabase: SupabaseClient) {
  const [{ data: stays }, { data: products }, { data: gallerySetting }] = await Promise.all([
    supabase.from("stays").select("*").eq("published", true).order("created_at", { ascending: false }).limit(12),
    supabase.from("products").select("*").order("created_at", { ascending: false }).limit(30),
    supabase.from("site_settings").select("value").eq("key", "homepage_gallery").maybeSingle(),
  ]);
  const stayLines = (stays || []).map(s =>
    `- ${s.title}${s.location ? ` (${s.location})` : ""} — ${SITE_URL}/sejour.html?slug=${encodeURIComponent(s.slug || "")}` +
    `${s.short_description ? `\n  ${String(s.short_description).slice(0, 240)}` : ""}`);
  const productLines = (products || []).map(p => {
    const status = p.coming_soon === true || p.stock === 0 ? "bientôt disponible" : "disponible";
    return `- ${p.name} — ${Number(p.price || 0).toFixed(2)} € (${status}) — ${SITE_URL}/produit.html?id=${p.id}` +
      `${p.description ? `\n  ${String(p.description).slice(0, 200)}` : ""}`;
  });
  const library = siteLibrary(stays || [], products || [], Array.isArray(gallerySetting?.value) ? gallerySetting.value : []);
  const libraryLines = library.map(v => `- ${v.id} — ${v.label} — ${v.url}`);
  const text = `Séjours publiés :\n${stayLines.join("\n") || "(aucun)"}\n\nProduits du shop :\n${productLines.join("\n") || "(aucun)"}` +
    `\n\nVisuels du site (seules adresses d'images autorisées, avec les photos importées par l'admin) :\n${libraryLines.join("\n") || "(aucun)"}`;
  return { text, library };
}

// Retire les <img> dont l'adresse n'existe pas (inventée ou déformée) : une image cassée partirait à toute la liste
function dropUnknownImages(html: string, allowed: Set<string>) {
  let removed = 0;
  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const m = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const src = (m?.[1] ?? m?.[2] ?? "").replace(/&amp;/g, "&").trim();
    const ok = !!src && (allowed.has(src) || src.startsWith(`${SITE_URL}/`) || (STORAGE_PUBLIC.startsWith("http") && src.startsWith(STORAGE_PUBLIC)));
    if (ok) return tag;
    removed++;
    return "";
  });
  return { html: out, removed };
}

// L'admin demande-t-il des visuels tirés du site ? (case cochée dans la page, ou formulé dans sa demande)
const ASKS_SITE_VISUALS = /(visuels?|photos?|images?|illustr\w*)[^.\n]{0,60}\b(site|s[ée]jours?|shop|boutique|produits?|galerie)\b|\b(site|galerie)\b[^.\n]{0,40}(visuels?|photos?|images?)/i;

const SYSTEM_PROMPT = `Tu rédiges les emails marketing d'Âmes Nomades (amesnomades.com) : retraites et séjours bien-être en France — Pilates, yoga, randonnées, massages, alimentation saine — et un shop d'objets bien-être éco-responsables.

Ton de la marque : chaleureux, apaisant, inspirant, sincère, jamais agressif ni « vendeur ». Phrases simples, quelques images sensorielles (nature, lenteur, se retrouver). Tutoiement par défaut, sauf si l'admin demande le vouvoiement. Français impeccable.

Tu travailles avec l'admin du site : il décrit l'email voulu, puis demande des modifications. À chaque tour, renvoie l'email COMPLET mis à jour (pas seulement la partie modifiée), en conservant tout ce que l'admin n'a pas demandé de changer.

Règles pour body_html (il est inséré dans un gabarit qui contient déjà l'en-tête « ÂMES NOMADES » et le pied de page avec le lien de désinscription — ne les répète pas) :
- HTML d'email compatible Gmail/Outlook : styles en ligne uniquement (attribut style), pas de <style>, pas de JavaScript, pas de <html>/<head>/<body>.
- Commence par un paragraphe contenant exactement {{salutation}} (remplacé par « Bonjour Marie, » ou « Bonjour, »). N'utilise aucune autre accolade double.
- Police Arial/Helvetica, texte #1e1f22, couleur d'accent #cc6f53. Titres en <h2>/<h3> sobres (font-family:Georgia, serif ; font-weight:normal).
- Boutons : <a> avec style display:inline-block; background:#1e1f22; color:#fffdf3; padding:12px 26px; text-decoration:none; border-radius:3px; font-size:13px; letter-spacing:1px; text-transform:uppercase.
- Images : uniquement les adresses de la liste « Visuels du site » du contexte et celles des photos importées par l'admin, recopiées à l'identique, en <img> avec width="100%" style="display:block; max-width:100%; height:auto; border:0;" et un alt qui décrit ce que montre la photo. N'invente jamais d'adresse d'image : une image inconnue est retirée de l'email.
- Photos importées par l'admin (« Photo importée n°… ») : il les a ajoutées pour qu'elles figurent dans l'email. Place-les toutes, chacune une seule fois, à l'endroit où elle sert le texte, sauf s'il en décide autrement. Il les désigne par leur numéro (« la photo 2 »). Tiens compte de la précision qu'il a écrite pour chacune.
- Visuels du site : quand l'admin demande des photos ou visuels de son site, choisis-les dans la liste du contexte, en privilégiant ceux que tu peux voir, cohérents avec le sujet de l'email (le bon séjour, le bon produit). Trois ou quatre visuels suffisent en général ; n'utilise pas deux fois la même image. Sans demande de sa part, reste sobre : une image du séjour ou du produit mis en avant au plus.
- Deux images côte à côte : <table role="presentation" width="100%" cellpadding="0" cellspacing="0"> avec deux <td width="50%"> et un padding de 4px ; sinon une image par ligne.
- Liens : uniquement vers ${SITE_URL} et ses pages listées dans le contexte. N'invente pas de dates, de prix, de codes promo ni d'offres qui ne sont pas dans le contexte ou la demande de l'admin.
- Termine par une courte signature (par ex. « Belle journée, L'équipe Âmes Nomades »).
- Longueur adaptée : un email se lit en moins d'une minute.

Objet : accrocheur, 70 caractères maximum, un emoji au plus. Preheader : complète l'objet sans le répéter.`;

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

type Turn = { role: "user" | "assistant"; content: string };
type GenerateOptions = { photos: Photo[]; siteVisuals: boolean };

async function generateEmail(supabase: SupabaseClient, turns: Turn[], opts: GenerateOptions) {
  const { text: context, library } = await siteContext(supabase);
  const wantsSite = opts.siteVisuals || turns.some(t => t.role === "user" && ASKS_SITE_VISUALS.test(t.content));
  const shown = wantsSite ? library.slice(0, SITE_VISION_MAX) : [];

  // Dernier message de l'admin : les photos (vues par l'IA quand withImages est vrai), puis sa demande
  const buildMessages = (withImages: boolean): Anthropic.Beta.BetaMessageParam[] => {
    const history = turns.slice(0, -1).map(t => ({ role: t.role, content: t.content }));
    const last = turns[turns.length - 1];
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const p of opts.photos) {
      blocks.push({ type: "text", text: `Photo importée n°${p.n}${p.note ? ` — précision de l'admin : ${p.note}` : ""}\nAdresse à utiliser dans <img> : ${p.url}` });
      if (withImages) blocks.push({ type: "image", source: { type: "url", url: p.url } });
    }
    for (const v of shown) {
      blocks.push({ type: "text", text: `Visuel du site ${v.id} — ${v.label}\nAdresse à utiliser dans <img> : ${v.url}` });
      if (withImages) blocks.push({ type: "image", source: { type: "url", url: v.url } });
    }
    if (wantsSite) blocks.push({ type: "text", text: "L'admin souhaite des visuels tirés de son site dans cet email." });
    blocks.push({ type: "text", text: last.content });
    return [...history, { role: "user", content: blocks.length > 1 ? blocks : last.content }];
  };

  const run = async (withImages: boolean) => {
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
      messages: buildMessages(withImages),
      // deno-lint-ignore no-explicit-any
    } as any);
    return await stream.finalMessage();
  };

  const hasImages = opts.photos.length > 0 || shown.length > 0;
  let unseen = false;
  let message;
  try {
    message = await run(hasImages);
  } catch (e) {
    // Une photo illisible (trop lourde, adresse cassée) ferait échouer toute la demande :
    // on réessaie sans les montrer, l'IA les place alors d'après leurs descriptions.
    if (!(hasImages && e instanceof Anthropic.BadRequestError)) throw e;
    console.warn("admin-email : images refusées par l'IA, nouvel essai sans vision :", e.message);
    unseen = true;
    message = await run(false);
  }

  if (message.stop_reason === "refusal") throw new Error("L'IA a refusé cette demande. Reformulez-la.");
  if (message.stop_reason === "max_tokens") throw new Error("L'email généré est trop long. Demandez une version plus courte.");
  const text = message.content.find(b => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Réponse de l'IA vide.");
  const email = JSON.parse(text.text) as { subject: string; preheader: string; body_html: string; notes: string };

  const allowed = new Set<string>([...library.map(v => v.url), ...opts.photos.map(p => p.url)]);
  const checked = dropUnknownImages(email.body_html, allowed);
  email.body_html = checked.html;
  if (checked.removed) email.notes += ` (${checked.removed} image${checked.removed > 1 ? "s ont été retirées" : " a été retirée"} : adresse inconnue.)`;
  if (unseen) email.notes += " (L'IA n'a pas pu voir les photos cette fois : elle les a placées d'après leurs descriptions. Vérifiez l'aperçu.)";
  // « raw » repart dans l'historique : il doit refléter l'email réellement affiché
  return { ...email, raw: JSON.stringify(email), site_visuals_shown: shown.length };
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
      // Photos importées : uniquement celles déposées dans notre dossier de stockage
      const photos: Photo[] = (Array.isArray(body.photos) ? body.photos : [])
        .map((p: Record<string, unknown>) => ({
          n: Math.max(1, Math.floor(Number(p?.n) || 0)),
          url: String(p?.url || "").trim(),
          note: String(p?.note || "").replace(/\s+/g, " ").trim().slice(0, 200),
        }))
        .filter((p: Photo) => UPLOADS_PREFIX.startsWith("http") && p.url.startsWith(UPLOADS_PREFIX) && isImage(p.url) && !/[\s"'<>]/.test(p.url))
        .slice(0, MAX_PHOTOS);
      const email = await generateEmail(supabase, turns, { photos, siteVisuals: body.site_visuals === true });
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
