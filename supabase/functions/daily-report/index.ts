// Bilan quotidien : rassemble les chiffres de la veille et les envoie par e-mail (Brevo).
// Appelé par la tâche planifiée (secret CRON_SECRET) à 4 h et 5 h UTC : n'envoie que s'il est 6 h à Paris.
// Appelé par le bouton de l'administration (compte admin) : envoi immédiat.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type DataSource, type DayWindow, type Lock, type Mail, runDailyReport, SITE_URL, type VisitRow } from "../_shared/report.ts";

const SENDER = { name: "Âmes Nomades", email: "contact@amesnomades.com" };
const ADMIN_EMAILS = new Set(["contact@amesnomades.com", "sarnelli.ap@gmail.com", "revesnomades@gmail.com"]);

const allowedOrigins = new Set(["https://amesnomades.com", "https://www.amesnomades.com", "http://localhost:3000", "http://localhost:8000"]);
function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : SITE_URL,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}
const json = (req: Request, body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });

// Comparaison à durée constante : ne révèle rien du secret par le temps de réponse
function sameSecret(a: string, b: string) {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function requireAdmin(token: string, supabase: SupabaseClient) {
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  if (ADMIN_EMAILS.has((user.email || "").toLowerCase())) return user;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin" ? user : null;
}

// ─── Lectures dans la base ─────────────────────────────────────────────────
const STATIC_PAGES: Record<string, string> = {
  "/": "Accueil", "/boutique.html": "Shop", "/panier.html": "Panier", "/merci.html": "Confirmation de commande",
  "/compte.html": "Compte", "/signup.html": "Création de compte", "/favoris.html": "Favoris", "/bon-cadeau.html": "Bon cadeau",
  "/faq.html": "FAQ", "/cgv.html": "CGV", "/liens.html": "Page de liens", "/guide-cadeau.html": "Guide cadeau",
  "/sejour.html": "Séjour", "/produit.html": "Produit", "/event-sommieres.html": "Événement Sommières",
  "/mentions-legales.html": "Mentions légales", "/politique-confidentialite.html": "Confidentialité", "/politique-retours.html": "Retours",
};

function makeSource(db: SupabaseClient): DataSource {
  const iso = (w: DayWindow) => [w.start.toISOString(), w.end.toISOString()] as const;
  // Toutes les lignes d'une journée, par pages de 1000 (limite d'une lecture)
  // deno-lint-ignore no-explicit-any
  async function all(table: string, columns: string, w: DayWindow): Promise<any[]> {
    const [from, to] = iso(w), out = [];
    for (let page = 0; page < 60; page++) {
      const { data, error } = await db.from(table).select(columns).gte("created_at", from).lt("created_at", to)
        .order("created_at", { ascending: true }).range(page * 1000, page * 1000 + 999);
      if (error) throw new Error(`${table} : ${error.message}`);
      out.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  async function count(table: string, w: DayWindow): Promise<number> {
    const [from, to] = iso(w);
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).gte("created_at", from).lt("created_at", to);
    if (error) throw new Error(`${table} : ${error.message}`);
    return count || 0;
  }
  // Comptes créés : une seule lecture de la liste des comptes pour les deux journées comparées
  let usersPromise: Promise<string[]> | null = null;
  const userDates = () => usersPromise ??= (async () => {
    const dates: string[] = [];
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(`comptes : ${error.message}`);
      dates.push(...data.users.map((u: { created_at: string }) => u.created_at));
      if (data.users.length < 1000) break;
    }
    return dates;
  })();
  const sum = (rows: Record<string, unknown>[], key: string) => Math.round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100;

  return {
    visits: (w) => all("site_visits", "path, referrer_host, campaign, device, visitor_hash, created_at", w) as Promise<VisitRow[]>,

    async pageLabels() {
      const labels: Record<string, string> = { ...STATIC_PAGES };
      const [{ data: stays }, { data: products }] = await Promise.all([
        db.from("stays").select("slug, title"),
        db.from("products").select("id, name"),
      ]);
      for (const s of stays || []) if (s.slug) labels[`/sejour.html?slug=${s.slug}`] = `Séjour : ${s.title}`;
      for (const p of products || []) labels[`/produit.html?id=${p.id}`] = `Produit : ${p.name}`;
      return labels;
    },

    async orders(w) {
      const rows = await all("purchases", "*", w);
      return {
        count: rows.length,
        revenue: sum(rows, "amount"),
        items: rows.map(r => ({ ref: String(r.order_ref || ""), label: String(r.product_name || "Commande"), amount: Number(r.amount) || 0 })).reverse(),
      };
    },

    async bookings(w) {
      const rows = await all("bookings", "*", w);
      const by = new Map<string, number>();
      for (const r of rows) { const k = String(r.stay_title || "Séjour"); by.set(k, (by.get(k) || 0) + 1); }
      return { count: rows.length, byStay: [...by.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })) };
    },

    async giftCards(w) {
      const [sold, used] = await Promise.all([all("gift_cards", "initial_amount, created_at", w), all("gift_card_redemptions", "amount, created_at", w)]);
      return { sold: sold.length, soldAmount: sum(sold, "initial_amount"), usedAmount: sum(used, "amount") };
    },

    async signups(w) {
      const [newsletter, priority, dates] = await Promise.all([count("newsletter", w), count("priority_waitlist", w), userDates()]);
      const a = w.start.getTime(), b = w.end.getTime();
      return { newsletter, priority, accounts: dates.filter(d => { const t = Date.parse(d); return t >= a && t < b; }).length };
    },

    async messages(w) {
      const rows = await all("contact_messages", "*", w);
      return {
        count: rows.length,
        items: rows.reverse().map(r => ({ from: [r.firstname, r.lastname].filter(Boolean).join(" ") || String(r.email || ""), subject: String(r.subject || "") })),
      };
    },

    async lowStock() {
      const { data, error } = await db.from("products").select("*").lte("stock", 2).order("stock", { ascending: true }).limit(8);
      if (error) throw new Error(`products : ${error.message}`);
      return (data || []).filter((p: Record<string, unknown>) => p.coming_soon !== true && p.stock !== null).map((p: Record<string, unknown>) => ({ name: String(p.name), stock: Number(p.stock) }));
    },
  };
}

// ─── Un seul envoi par date de bilan ───────────────────────────────────────
function makeLock(db: SupabaseClient): Lock {
  return {
    async reserve(date) {
      const { error } = await db.from("daily_reports").insert({ report_date: date, status: "pending" });
      if (!error) return true;
      if (error.code !== "23505") throw new Error(`daily_reports : ${error.message}`); // autre chose qu'un doublon
      // Réservation restée en attente (fonction interrompue) depuis plus de 30 minutes : on la reprend
      const { data } = await db.from("daily_reports").update({ created_at: new Date().toISOString() })
        .eq("report_date", date).eq("status", "pending").lt("created_at", new Date(Date.now() - 30 * 60000).toISOString()).select("report_date");
      return !!data?.length;
    },
    async release(date) { await db.from("daily_reports").delete().eq("report_date", date).eq("status", "pending"); },
    async markSent(date) { await db.from("daily_reports").update({ status: "sent", sent_at: new Date().toISOString() }).eq("report_date", date); },
  };
}

// ─── Envoi par Brevo ───────────────────────────────────────────────────────
async function sendMail(mail: Mail) {
  const apiKey = Deno.env.get("BREVO_API_KEY");
  const to = (Deno.env.get("DAILY_REPORT_EMAIL") || "").split(",").map(s => s.trim()).filter(s => s.includes("@"));
  if (!apiKey || !to.length) return { simulated: true }; // rien n'est configuré : le bilan est seulement noté dans les journaux
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "accept": "application/json", "content-type": "application/json", "api-key": apiKey },
    body: JSON.stringify({ sender: SENDER, to: to.map(email => ({ email })), subject: mail.subject, htmlContent: mail.html, textContent: mail.text }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return { simulated: false };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST" && req.method !== "GET") return json(req, { error: "Méthode non autorisée" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(req, { error: "Configuration Supabase manquante" }, 500);
    const db = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const auth = req.headers.get("authorization") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // 1. Tâche planifiée : secret dans « Authorization: Bearer … » (ou « x-cron-secret », quand Supabase
    //    exige déjà son propre jeton dans Authorization)
    const secret = Deno.env.get("CRON_SECRET") || "";
    const isCron = sameSecret(bearer, secret) || sameSecret(req.headers.get("x-cron-secret") || "", secret);
    let opts: { force?: boolean; manual?: boolean };
    if (isCron) {
      opts = { force: url.searchParams.get("force") === "1" || body?.force === true };
    } else {
      // 2. Bouton de l'administration : compte admin connecté, envoi immédiat
      const admin = await requireAdmin(bearer, db);
      if (!admin) return json(req, { error: "Accès refusé" }, 401);
      opts = { manual: true };
    }

    const result = await runDailyReport({ now: new Date(), source: makeSource(db), lock: makeLock(db), send: sendMail }, opts);
    console.log("daily-report :", JSON.stringify(result));
    return json(req, result, result.status === "error" ? 502 : 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("daily-report :", msg);
    return json(req, { status: "error", error: msg }, 500);
  }
});
