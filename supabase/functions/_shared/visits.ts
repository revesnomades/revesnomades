// Comptage des visites sans cookie : règles appliquées côté serveur avant toute écriture.

/** Robots, aperçus de liens, outils de surveillance, scripts. Un navigateur sans signature est ignoré aussi. */
const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|discord|slack|preview|embedly|pinterest|monitor|uptime|pingdom|lighthouse|pagespeed|gtmetrix|headless|phantom|puppeteer|playwright|selenium|curl|wget|python|httpclient|okhttp|axios|node-fetch|go-http|java\/|libwww|scrapy|feed|scan/i;
export function isBot(userAgent: string): boolean {
  return !userAgent || userAgent.length < 12 || BOT.test(userAgent);
}

/** Pages d'administration et pages techniques : jamais comptées. */
const IGNORED = /^\/(admin-|acces-admin|assets\/|supabase\/|scratch\/|maintenance\.html|reset-password\.html|desinscription\.html|brevo-template|favicon|robots\.txt|sitemap\.xml|llms\.txt)/i;

/** Chemin propre de la page, ou null si elle ne doit pas être comptée. */
export function cleanPath(raw: unknown): string | null {
  let p = String(raw ?? "").trim();
  if (!p.startsWith("/") || p.startsWith("//")) return null;
  p = p.replace(/[^A-Za-z0-9/_.\-?=&%~]/g, "").slice(0, 160);
  const q = p.indexOf("?");
  let path = (q >= 0 ? p.slice(0, q) : p).toLowerCase();
  const query = q >= 0 ? p.slice(q + 1) : "";
  if (path === "/index.html" || path === "") path = "/";
  if (IGNORED.test(path)) return null;
  // Seuls les paramètres qui désignent une page sont gardés (séjour, produit)
  const keep = query.split("&").filter(kv => /^(slug|id)=[A-Za-z0-9_\-%.]{1,80}$/.test(kv)).slice(0, 1);
  return keep.length ? `${path}?${keep[0]}` : path;
}

const OWN_HOSTS = /(^|\.)amesnomades\.com$|(^|\.)netlify\.app$|^localhost$|^127\.0\.0\.1$/i;

/** Domaine d'origine de la visite (sans « www. »), ou null si c'est le site lui-même ou une valeur invalide. */
export function cleanReferrer(raw: unknown): string | null {
  let h = String(raw ?? "").trim().toLowerCase();
  if (!h) return null;
  try { if (h.includes("/")) h = new URL(h.startsWith("http") ? h : `https://${h}`).hostname; } catch { return null; }
  h = h.replace(/^www\./, "").slice(0, 100);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) || OWN_HOSTS.test(h)) return null;
  return h;
}

/** Campagne (utm_source) : lettres, chiffres, tirets, points. */
export function cleanCampaign(raw: unknown): string | null {
  const c = String(raw ?? "").trim().toLowerCase().replace(/[^a-z0-9_.\-]/g, "").slice(0, 60);
  return c || null;
}

export type Device = "ordinateur" | "telephone" | "tablette";
export function deviceOf(userAgent: string): Device {
  if (/ipad|tablet|playbook|silk|kindle|(android(?!.*mobile))/i.test(userAgent)) return "tablette";
  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(userAgent)) return "telephone";
  return "ordinateur";
}

/**
 * Empreinte du visiteur : SHA-256 de l'adresse IP + navigateur + date du jour (+ un sel connu du seul serveur).
 * Elle change chaque jour ; l'adresse IP elle-même n'est jamais enregistrée.
 */
export async function visitorHash(ip: string, userAgent: string, day: string, salt = ""): Promise<string> {
  const bytes = new TextEncoder().encode(`${ip}|${userAgent}|${day}|${salt}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Adresse IP du visiteur d'après les en-têtes posés par l'hébergeur. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || headers.get("cf-connecting-ip") || headers.get("x-real-ip") || "";
}
