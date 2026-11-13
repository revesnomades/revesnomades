// Référencement : titre, description, photo et données structurées propres à chaque séjour et à chaque produit,
// écrits dans la page AVANT qu'elle parte vers le visiteur (Google, WhatsApp, Instagram, Facebook ne
// lancent pas tous le JavaScript de la page). Ce fichier ne dépend d'aucun service : il est testable hors ligne.

export const SITE = "https://amesnomades.com";
export const BRAND = "Âmes Nomades";
export const DEFAULT_IMAGE = `${SITE}/assets/img/hero-1.webp`;

// Lecture publique (la même clé que le site dans le navigateur)
export const SUPABASE_URL = "https://qxrxwgrgjvesevjkjmry.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4cnh3Z3JnanZlc2V2amtqbXJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNzE4MTIsImV4cCI6MjA4Mjk0NzgxMn0.WQCWMfqGbhbdnYdkcpBAarVJBBstSFAK3_YYn5uNbKI";

// ─── Texte ─────────────────────────────────────────────────────────────────
export const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Texte brut, sur une ligne, coupé proprement à `max` caractères. */
export function plain(value: unknown, max = 200): string {
  const text = String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.!?–—-]+$/, "")}…`;
}

/** Même règle que la page séjour pour retrouver un séjour à partir de son adresse. */
export function slugify(text: unknown): string {
  return String(text ?? "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

const absolute = (url: unknown): string => {
  const u = String(url ?? "").trim();
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  return u.startsWith("//") ? `https:${u}` : `${SITE}/${u.replace(/^\/+/, "")}`;
};
const isVideo = (url: string) => /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(url);

// ─── Ce qu'une page annonce ────────────────────────────────────────────────
export type PageMeta = {
  title: string;
  description: string;
  url: string;
  image: string;
  type: "website" | "product";
  /** Balises supplémentaires (prix d'un produit) : [propriété, valeur] */
  extra?: [string, string][];
  jsonLd: Record<string, unknown>;
  /** Identifiant du bloc de données structurées, celui que le script de la page remplace ensuite */
  jsonLdId: string;
};

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export const stayUrl = (slug: string) => `${SITE}/sejour.html?slug=${encodeURIComponent(slug)}`;
export const productUrl = (id: string) => `${SITE}/produit.html?id=${encodeURIComponent(id)}`;

/** Même phrase que celle écrite par la page séjour une fois chargée. */
export function stayDescription(stay: Row): string {
  const title = plain(stay.title, 120) || "ce séjour";
  const place = stay.location ? ` à ${plain(stay.location, 80)}` : "";
  const short = stay.short_description
    ? ` ${plain(stay.short_description, 400)}`
    : " Une expérience pour ralentir, se reconnecter à soi et vivre une parenthèse de douceur.";
  return plain(`Découvre le séjour bien-être ${title}${place} avec ${BRAND}.${short}`, 300);
}

/** Première date à venir (ou en cours) parmi les dates du séjour. */
export function nextDate(dates: Row[], today: string): Row | null {
  const upcoming = (dates || [])
    .filter(d => d?.start_date && String(d.end_date || d.start_date).slice(0, 10) >= today)
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
  return upcoming[0] || null;
}

export function stayMeta(stay: Row, dates: Row[] = [], today = new Date().toISOString().slice(0, 10)): PageMeta {
  const name = plain(stay.title, 120) || "Séjour";
  const description = stayDescription(stay);
  const url = stayUrl(String(stay.slug));
  const image = absolute(stay.hero_image) || DEFAULT_IMAGE;
  const organizer = { "@type": "Organization", name: BRAND, url: SITE };
  const date = nextDate(dates, today);
  const place = plain(stay.location, 120);

  // Avec une date à venir : un événement (Google peut afficher la date et le lieu). Sinon : un séjour sans date.
  const jsonLd: Record<string, unknown> = date
    ? {
      "@context": "https://schema.org",
      "@type": "Event",
      name,
      description,
      url,
      image: [image],
      startDate: String(date.start_date).slice(0, 10),
      endDate: String(date.end_date || date.start_date).slice(0, 10),
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      eventStatus: "https://schema.org/EventScheduled",
      location: { "@type": "Place", name: place || "France", address: { "@type": "PostalAddress", addressLocality: place || undefined, addressCountry: plain(stay.country, 60) || "FR" } },
      organizer,
    }
    : { "@context": "https://schema.org", "@type": "TouristTrip", name, description, url, image, provider: organizer };

  return { title: `${name} — ${BRAND}`, description, url, image, type: "website", jsonLd, jsonLdId: "staySchema" };
}

export function productMeta(p: Row): PageMeta {
  const name = plain(p.name, 120) || "Produit";
  const description = plain(p.description, 160) || plain(p.description_longue, 160) || `${name} : à retrouver dans le shop ${BRAND}.`;
  const url = productUrl(String(p.id));
  const images: string[] = (Array.isArray(p.image_urls) && p.image_urls.length ? p.image_urls : (p.image_url ? [p.image_url] : []))
    .map((u: unknown) => String(u || "")).filter((u: string) => u && !isVideo(u)).map(absolute);
  const image = images[0] || DEFAULT_IMAGE;
  const price = Number(p.price);
  const hasPrice = Number.isFinite(price) && price > 0;
  const availability = p.coming_soon === true ? "PreOrder" : (p.stock === 0 ? "OutOfStock" : "InStock");

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    url,
    image: images.length ? images.slice(0, 6) : [image],
    sku: String(p.id),
    brand: { "@type": "Brand", name: BRAND },
  };
  if (hasPrice) {
    jsonLd.offers = {
      "@type": "Offer",
      url,
      price: price.toFixed(2),
      priceCurrency: "EUR",
      availability: `https://schema.org/${availability}`,
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: BRAND },
    };
  }
  return {
    title: `${name} — ${BRAND}`, description, url, image, type: "product",
    extra: hasPrice ? [["product:price:amount", price.toFixed(2)], ["product:price:currency", "EUR"]] : [],
    jsonLd, jsonLdId: "productSchema",
  };
}

// ─── Écriture dans la page ─────────────────────────────────────────────────
const idPattern = (id: string) => new RegExp(`<(?:meta|link)\\b[^>]*\\bid=["']${id}["'][^>]*>`, "i");

/** Remplace la balise qui porte cet identifiant ; si elle n'existe pas, l'ajoute à la fin de l'en-tête. */
function upsert(html: string, id: string, tag: string): string {
  const re = idPattern(id);
  if (re.test(html)) return html.replace(re, () => tag);
  return html.replace(/<\/head>/i, () => `  ${tag}\n</head>`);
}

/** Écrit titre, description, adresse officielle, aperçu de partage et données structurées dans l'en-tête. */
export function applyMeta(html: string, m: PageMeta): string {
  if (!/<\/head>/i.test(html)) return html; // page inattendue : on n'y touche pas
  let out = html;

  // Titre (en gardant ses attributs : le script de la page le retrouve par son identifiant)
  out = out.replace(/<title\b([^>]*)>[\s\S]*?<\/title>/i, (_all, attrs) => `<title${attrs}>${esc(m.title)}</title>`);

  // Description : la première balise <meta name="description">, quel que soit l'ordre de ses attributs
  let described = false;
  out = out.replace(/<meta\b[^>]*\bname=["']description["'][^>]*>/i, (tag) => {
    described = true;
    const id = tag.match(/\bid=["']([^"']+)["']/i)?.[1];
    return `<meta${id ? ` id="${id}"` : ""} name="description" content="${esc(m.description)}">`;
  });
  if (!described) out = out.replace(/<\/head>/i, () => `  <meta name="description" content="${esc(m.description)}">\n</head>`);

  // Une seule adresse officielle par page
  out = out.replace(/[ \t]*<link\b[^>]*\brel=["']canonical["'][^>]*>\s*\n?/gi, "");
  out = upsert(out, "pageCanonical", `<link rel="canonical" id="pageCanonical" href="${esc(m.url)}">`);

  const tags: [string, string][] = [
    ["ogType", `<meta property="og:type" id="ogType" content="${m.type}">`],
    ["ogSiteName", `<meta property="og:site_name" id="ogSiteName" content="${esc(BRAND)}">`],
    ["ogLocale", `<meta property="og:locale" id="ogLocale" content="fr_FR">`],
    ["ogTitle", `<meta property="og:title" id="ogTitle" content="${esc(m.title)}">`],
    ["ogDescription", `<meta property="og:description" id="ogDescription" content="${esc(m.description)}">`],
    ["ogUrl", `<meta property="og:url" id="ogUrl" content="${esc(m.url)}">`],
    ["ogImage", `<meta property="og:image" id="ogImage" content="${esc(m.image)}">`],
    ["twitterCard", `<meta name="twitter:card" id="twitterCard" content="summary_large_image">`],
    ["twitterTitle", `<meta name="twitter:title" id="twitterTitle" content="${esc(m.title)}">`],
    ["twitterDescription", `<meta name="twitter:description" id="twitterDescription" content="${esc(m.description)}">`],
    ["twitterImage", `<meta name="twitter:image" id="twitterImage" content="${esc(m.image)}">`],
  ];
  for (const [id, tag] of tags) out = upsert(out, id, tag);
  for (const [property, value] of m.extra || []) {
    out = out.replace(/<\/head>/i, () => `  <meta property="${esc(property)}" content="${esc(value)}">\n</head>`);
  }

  // Données structurées : « < » neutralisé pour qu'aucun texte ne puisse fermer la balise
  const json = JSON.stringify(m.jsonLd).replace(/</g, "\\u003c");
  const block = `<script type="application/ld+json" id="${m.jsonLdId}">${json}</script>`;
  const existing = new RegExp(`<script\\b[^>]*\\bid=["']${m.jsonLdId}["'][^>]*>[\\s\\S]*?<\\/script>`, "i");
  out = existing.test(out) ? out.replace(existing, () => block) : out.replace(/<\/head>/i, () => `  ${block}\n</head>`);
  return out;
}

// ─── Plan du site ──────────────────────────────────────────────────────────
export type SitemapEntry = { path: string; changefreq: string; priority: string };

export const STATIC_PAGES: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/boutique.html", changefreq: "weekly", priority: "0.9" },
  { path: "/bon-cadeau.html", changefreq: "monthly", priority: "0.7" },
  { path: "/guides.html", changefreq: "monthly", priority: "0.7" },
  { path: "/guide-retraite-pilates.html", changefreq: "monthly", priority: "0.7" },
  { path: "/guide-partir-seule.html", changefreq: "monthly", priority: "0.7" },
  { path: "/guide-valise-retraite.html", changefreq: "monthly", priority: "0.7" },
  { path: "/guide-offrir-sejour.html", changefreq: "monthly", priority: "0.7" },
  { path: "/faq.html", changefreq: "monthly", priority: "0.6" },
  { path: "/event-sommieres.html", changefreq: "monthly", priority: "0.5" },
  { path: "/guide-cadeau.html", changefreq: "monthly", priority: "0.4" },
  { path: "/cgv.html", changefreq: "yearly", priority: "0.2" },
  { path: "/politique-retours.html", changefreq: "yearly", priority: "0.2" },
  { path: "/mentions-legales.html", changefreq: "yearly", priority: "0.2" },
  { path: "/politique-confidentialite.html", changefreq: "yearly", priority: "0.2" },
];

export function buildSitemap(stays: Row[] = [], products: Row[] = [], pages: SitemapEntry[] = STATIC_PAGES): string {
  const seen = new Set<string>();
  const url = (loc: string, changefreq: string, priority: string) => {
    if (seen.has(loc)) return "";
    seen.add(loc);
    return `  <url>\n    <loc>${esc(loc)}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>\n`;
  };
  let body = "";
  const home = pages.filter(p => p.path === "/"), rest = pages.filter(p => p.path !== "/");
  for (const p of home) body += url(`${SITE}${p.path}`, p.changefreq, p.priority);
  for (const s of stays) if (s?.slug && s.published !== false) body += url(stayUrl(String(s.slug)), "weekly", "0.9");
  for (const p of rest) body += url(`${SITE}${p.path}`, p.changefreq, p.priority);
  for (const p of products) if (p?.id) body += url(productUrl(String(p.id)), "weekly", "0.6");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}</urlset>\n`;
}

// ─── Lecture de la base (avec délai court et mémoire de quelques minutes) ──
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
const memory = new Map<string, { at: number; rows: Row[] }>();
const MEMORY_MS = 5 * 60 * 1000;

export function clearMemory() { memory.clear(); }

/** Lit des lignes par l'accès public de la base. Lève une erreur si la base ne répond pas à temps. */
export async function readRows(query: string, fetcher: Fetcher = fetch, now = Date.now()): Promise<Row[]> {
  const hit = memory.get(query);
  if (hit && now - hit.at < MEMORY_MS) return hit.rows;
  const res = await fetcher(`${SUPABASE_URL}/rest/v1/${query}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Accept: "application/json" },
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) { await res.body?.cancel(); throw new Error(`lecture ${query.split("?")[0]} : ${res.status}`); }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("réponse inattendue");
  if (memory.size > 300) memory.clear();
  memory.set(query, { at: now, rows });
  return rows;
}

const SAFE_ID = /^[A-Za-z0-9_\-.]{1,80}$/;

/** Ce que la page demandée doit annoncer, ou null si elle doit rester telle quelle. */
export async function metaForUrl(url: URL, fetcher: Fetcher = fetch, now = Date.now()): Promise<PageMeta | null> {
  const page = url.pathname.replace(/\.html$/i, "").toLowerCase();
  if (url.searchParams.get("preview") === "1") return null; // aperçu d'un séjour non publié : rien n'est annoncé

  if (page === "/sejour") {
    const raw = (url.searchParams.get("slug") || url.searchParams.get("s") || "").trim();
    if (!raw || raw.length > 200) return null;
    // Même ordre que la page : adresse normalisée, puis adresse telle quelle
    const candidates = [...new Set([slugify(raw), raw.replace(/[*%,()]/g, "")].filter(Boolean))];
    let stay: Row | null = null;
    for (const c of candidates) {
      const rows = await readRows(`stays?select=*&published=eq.true&slug=ilike.${encodeURIComponent(c)}&limit=1`, fetcher, now);
      if (rows[0]) { stay = rows[0]; break; }
    }
    if (!stay?.slug) return null;
    let dates: Row[] = [];
    try {
      dates = await readRows(`stay_dates?select=start_date,end_date&stay_id=eq.${encodeURIComponent(String(stay.id))}&order=start_date.asc&limit=50`, fetcher, now);
    } catch { /* sans date, le séjour est annoncé quand même */ }
    return stayMeta(stay, dates, new Date(now).toISOString().slice(0, 10));
  }

  if (page === "/produit") {
    const id = (url.searchParams.get("id") || "").trim();
    if (!SAFE_ID.test(id)) return null;
    const rows = await readRows(`products?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, fetcher, now);
    return rows[0] ? productMeta(rows[0]) : null;
  }
  return null;
}
