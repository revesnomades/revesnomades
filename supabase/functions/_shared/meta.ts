// Conversions API de Meta : l'achat est aussi envoyé à Meta depuis le serveur.
// Le pixel du navigateur en perd une partie (bloqueurs de pub, iPhone, page fermée trop tôt) ;
// les deux envois portent le même identifiant (event_id) et Meta ne compte l'achat qu'une fois.
// Ce module ne lève jamais d'erreur : un souci chez Meta ne doit jamais gêner une commande.

const DEFAULT_PIXEL_ID = "27710195578608730";
const DEFAULT_GRAPH_VERSION = "v26.0";
const SITE_URL = "https://amesnomades.com";

export type MetaPurchase = {
  eventId: string;            // identique à l'eventID du pixel sur la page merci (session Stripe, ou n° de commande)
  eventTime: number;          // secondes Unix
  value: number;              // montant payé (euros)
  orderId: string;
  sourceUrl?: string;
  email?: string;
  phone?: string;
  name?: string;              // « Prénom Nom »
  city?: string;
  zip?: string;
  country?: string;           // code ISO à 2 lettres
  externalId?: string;        // identifiant du compte client
  ip?: string;
  userAgent?: string;
  fbp?: string;
  fbc?: string;
  items?: { id: string; qty: number; price?: number }[];
};

export type MetaResult = { sent: boolean; skipped?: string; error?: string; status?: number };

// ─── Préparation des données personnelles (normalisées puis chiffrées en SHA-256, comme Meta l'exige) ───
export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map(b => b.toString(16).padStart(2, "0")).join("");
}

const stripAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const normalize = {
  email: (v?: string) => String(v || "").trim().toLowerCase(),
  /** Chiffres seuls, avec l'indicatif du pays (06 12… → 33612…). */
  phone: (v?: string, country = "FR") => {
    let d = String(v || "").replace(/[^\d+]/g, "");
    if (d.startsWith("+")) return d.slice(1).replace(/\D/g, "");
    d = d.replace(/\D/g, "");
    if (d.startsWith("00")) return d.slice(2);
    if (country.toUpperCase() === "FR" && /^0[1-9]\d{8}$/.test(d)) return `33${d.slice(1)}`;
    return d;
  },
  name: (v?: string) => stripAccents(String(v || "").trim().toLowerCase()).replace(/[^a-z]/g, ""),
  city: (v?: string) => stripAccents(String(v || "").trim().toLowerCase()).replace(/[^a-z]/g, ""),
  zip: (v?: string) => String(v || "").trim().toLowerCase().replace(/\s+/g, ""),
  country: (v?: string) => String(v || "").trim().toLowerCase().slice(0, 2),
};

function splitName(full?: string) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : "" };
}

/** Adresse IP du client d'après les en-têtes posés par l'hébergeur. */
export function clientIpFrom(headers: Headers): string {
  return headers.get("cf-connecting-ip") || (headers.get("x-forwarded-for") || "").split(",")[0].trim() || headers.get("x-real-ip") || "";
}

/** Cookies du pixel : valeurs attendues « fb.1.<horodatage>.<…> ». Toute autre valeur est ignorée. */
export function cleanFbCookie(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_\-.]{1,400}$/.test(s) ? s : "";
}

// ─── Événement ─────────────────────────────────────────────────────────────
export async function buildPurchaseEvent(p: MetaPurchase) {
  const user: Record<string, unknown> = {};
  const hashed = async (key: string, value: string) => { if (value) user[key] = [await sha256Hex(value)]; };
  const country = normalize.country(p.country) || "fr";
  const { first, last } = splitName(p.name);
  await hashed("em", normalize.email(p.email));
  await hashed("ph", normalize.phone(p.phone, country));
  await hashed("fn", normalize.name(first));
  await hashed("ln", normalize.name(last));
  await hashed("ct", normalize.city(p.city));
  await hashed("zp", normalize.zip(p.zip));
  await hashed("country", country);
  await hashed("external_id", String(p.externalId || "").trim());
  // Ces quatre-là ne se chiffrent pas (règle de Meta)
  if (p.ip) user.client_ip_address = p.ip;
  if (p.userAgent) user.client_user_agent = p.userAgent;
  if (p.fbp) user.fbp = p.fbp;
  if (p.fbc) user.fbc = p.fbc;

  const custom: Record<string, unknown> = { currency: "EUR", value: Math.round((Number(p.value) || 0) * 100) / 100, order_id: p.orderId };
  const items = (p.items || []).filter(i => i && i.id);
  if (items.length) {
    custom.contents = items.map(i => ({ id: String(i.id), quantity: Number(i.qty) || 1, item_price: Number(i.price) || 0 }));
    custom.content_ids = items.map(i => String(i.id));
    custom.content_type = "product";
    custom.num_items = items.reduce((n, i) => n + (Number(i.qty) || 1), 0);
  }
  return {
    event_name: "Purchase",
    event_time: Math.floor(p.eventTime),
    event_id: p.eventId,
    action_source: "website",
    event_source_url: p.sourceUrl || `${SITE_URL}/merci`,
    user_data: user,
    custom_data: custom,
  };
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type SendOptions = { token?: string; pixelId?: string; version?: string; testCode?: string; fetcher?: Fetcher; log?: (m: string) => void };

/** Envoie l'achat à Meta. Sans jeton configuré : rien n'est envoyé, rien ne casse. */
export async function sendMetaPurchase(p: MetaPurchase, opts: SendOptions = {}): Promise<MetaResult> {
  const log = opts.log || ((m: string) => console.log(m));
  try {
    const env = (k: string) => { try { return Deno.env.get(k) || ""; } catch { return ""; } };
    const token = opts.token ?? env("META_CAPI_TOKEN");
    if (!token) { log("meta : achat non envoyé (secret META_CAPI_TOKEN absent)"); return { sent: false, skipped: "no_token" }; }
    if (!p.eventId) return { sent: false, skipped: "no_event_id" };
    const pixelId = opts.pixelId ?? (env("META_PIXEL_ID") || DEFAULT_PIXEL_ID);
    const version = opts.version ?? (env("META_GRAPH_VERSION") || DEFAULT_GRAPH_VERSION);
    const testCode = opts.testCode ?? env("META_TEST_EVENT_CODE");

    const body: Record<string, unknown> = { data: [await buildPurchaseEvent(p)] };
    if (testCode) body.test_event_code = testCode;
    const res = await (opts.fetcher || fetch)(`https://graph.facebook.com/${version}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      log(`meta : achat ${p.eventId} refusé (${res.status}) ${text.slice(0, 300)}`);
      return { sent: false, error: text.slice(0, 300), status: res.status };
    }
    log(`meta : achat ${p.eventId} envoyé (${p.value} €)${testCode ? " [événement de test]" : ""}`);
    return { sent: true, status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`meta : achat ${p.eventId} non envoyé (${msg})`);
    return { sent: false, error: msg };
  }
}

/** Laisse l'envoi se terminer après la réponse quand l'hébergeur le permet (Supabase), sinon l'attend. */
export async function inBackground(task: Promise<unknown>): Promise<void> {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") { rt.waitUntil(task); return; }
  await task;
}
