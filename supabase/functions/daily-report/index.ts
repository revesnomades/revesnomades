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
  a = String(a || "").trim(); b = String(b || "").trim(); // un espace ou un retour à la ligne collé avec la valeur ne compte pas
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

// ─── Journal et diagnostic de l'envoi automatique ──────────────────────────
type RunSource = "cron" | "test" | "manuel";
async function logRun(db: SupabaseClient, source: RunSource, outcome: string, detail = "") {
  try {
    const { error } = await db.from("daily_report_runs").insert({ source, outcome, detail: detail.slice(0, 500) });
    if (error) console.warn("daily-report : journal indisponible :", error.message);
  } catch { /* le journal ne doit jamais bloquer le bilan */ }
}

const recipients = () => (Deno.env.get("DAILY_REPORT_EMAIL") || "").split(",").map(s => s.trim()).filter(s => s.includes("@"));
const cronSecret = () => (Deno.env.get("CRON_SECRET") || "").trim();

type Check = { ok: boolean | null; label: string; help?: string };

// deno-lint-ignore no-explicit-any
function diagnose(dbStatus: any, runs: any[] | null, runsError: string): Check[] {
  const checks: Check[] = [];
  const job = dbStatus?.job;
  if (dbStatus?.missing) {
    checks.push({ ok: null, label: "Diagnostic de la base", help: "Lancez le script supabase/sql/daily_report_check.sql dans Supabase (SQL Editor) pour voir l'état de la tâche planifiée." });
  } else if (dbStatus?.cron_error) {
    checks.push({ ok: false, label: "Tâche planifiée", help: `Lecture impossible (${dbStatus.cron_error}). Activez l'extension pg_cron (Database → Extensions), puis lancez supabase/sql/daily_report.sql.` });
  } else if (!job) {
    checks.push({ ok: false, label: "Tâche planifiée", help: "La tâche « bilan-quotidien-ames-nomades » n'existe pas : lancez supabase/sql/daily_report.sql dans Supabase (SQL Editor)." });
  } else {
    checks.push({ ok: !!job.active, label: `Tâche planifiée (${job.schedule}, heure UTC)`, help: job.active ? undefined : "La tâche existe mais elle est désactivée." });
    if (!job.uses_secret || !job.url_ok) checks.push({ ok: false, label: "Commande de la tâche", help: "La tâche n'appelle pas la fonction comme prévu : relancez supabase/sql/daily_report.sql." });
    else if (job.auth_is_key === false || job.secret_from_vault === false) {
      checks.push({ ok: false, label: "Commande de la tâche modifiée à la main", help: job.auth_is_key === false
        ? "L'en-tête Authorization de la tâche ne contient plus la clé publique de Supabase (par exemple si le secret y a été collé) : Supabase refuse alors l'appel avant la fonction. Relancez supabase/sql/daily_report.sql pour recréer la tâche telle quelle ; le secret du coffre et CRON_SECRET ne changent pas."
        : "La tâche n'envoie plus le secret lu dans le coffre (Vault). Relancez supabase/sql/daily_report.sql pour la recréer telle quelle." });
    }
  }
  if (dbStatus && !dbStatus.missing) {
    if (dbStatus.vault_error) checks.push({ ok: false, label: "Secret de la tâche dans le coffre (Vault)", help: `Lecture impossible : ${dbStatus.vault_error}` });
    else checks.push({ ok: !!dbStatus.vault_secret, label: "Secret de la tâche dans le coffre (Vault)", help: dbStatus.vault_secret ? undefined : "Absent : relancez supabase/sql/daily_report.sql, qui le crée et l'affiche." });
  }
  const secret = cronSecret();
  checks.push({ ok: !!secret, label: "Secret CRON_SECRET dans les secrets des fonctions", help: secret ? undefined : "Absent : la tâche de 6 h est refusée. Ajoutez-le dans Supabase → Edge Functions → Secrets, avec la valeur affichée à la fin du script daily_report.sql." });
  const to = recipients();
  checks.push({ ok: to.length > 0, label: to.length ? `Destinataire : ${to.join(", ")}` : "Destinataire (DAILY_REPORT_EMAIL)", help: to.length ? undefined : "Absent : le bilan est préparé mais pas envoyé. Ajoutez DAILY_REPORT_EMAIL dans Supabase → Edge Functions → Secrets." });
  const brevo = !!Deno.env.get("BREVO_API_KEY");
  checks.push({ ok: brevo, label: "Clé d'envoi Brevo (BREVO_API_KEY)", help: brevo ? undefined : "Absente : aucun email ne peut partir." });

  const cronRuns = Array.isArray(dbStatus?.runs) ? dbStatus.runs : [];
  if (job && cronRuns.length === 0) checks.push({ ok: false, label: "Déclenchements de la tâche", help: "La tâche n'a encore jamais tourné. Elle tourne chaque jour à 4 h et 5 h UTC ; si elle a été créée aujourd'hui, attendez demain matin." });
  else if (cronRuns.length) {
    const last = cronRuns[0];
    checks.push({ ok: last.status === "succeeded", label: `Dernier déclenchement : ${new Date(last.start_time).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`, help: last.status === "succeeded" ? undefined : `Échec de la tâche : ${last.message || last.status}` });
  }

  if (runsError) {
    checks.push({ ok: null, label: "Journal des bilans", help: runsError });
  } else if (runs) {
    const fromCron = runs.filter(r => r.source === "cron");
    const sentRecently = fromCron.find(r => r.outcome === "sent" || r.outcome === "already_sent");
    const refused = fromCron.find(r => r.outcome === "refused");
    const lastCron = fromCron[0];
    if (!lastCron) {
      checks.push({ ok: cronRuns.length ? false : null, label: "Réception par la fonction", help: cronRuns.length
        ? "La tâche tourne mais la fonction n'a rien noté : la fonction daily-report en ligne est sans doute une ancienne version. Redéployez-la avec le dernier code."
        : "Aucun appel automatique reçu pour l'instant." });
    } else if (refused && (!sentRecently || new Date(refused.created_at) > new Date(sentRecently.created_at))) {
      checks.push({ ok: false, label: "Réception par la fonction", help: `Appel de 6 h refusé : ${refused.detail}` });
    } else if (lastCron.outcome === "simulated") {
      checks.push({ ok: false, label: "Dernier bilan automatique", help: "Préparé mais pas envoyé : DAILY_REPORT_EMAIL ou BREVO_API_KEY manquait à ce moment-là." });
    } else if (lastCron.outcome === "error") {
      checks.push({ ok: false, label: "Dernier bilan automatique", help: `L'envoi a échoué : ${lastCron.detail}` });
    } else if (sentRecently) {
      checks.push({ ok: true, label: `Dernier bilan automatique envoyé le ${new Date(sentRecently.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}` });
    } else {
      checks.push({ ok: null, label: "Réception par la fonction", help: "Appels reçus, mais pas encore à 6 h (heure de Paris)." });
    }
  }
  return checks;
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
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const headerSecret = (req.headers.get("x-cron-secret") || "").trim();
    // deno-lint-ignore no-explicit-any
    const body: any = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // 1. Tâche planifiée : secret dans « x-cron-secret » (Supabase garde Authorization pour son propre jeton),
    //    ou dans « Authorization: Bearer … »
    const secret = cronSecret();
    const isCron = sameSecret(bearer, secret) || sameSecret(headerSecret, secret);
    if (!isCron && headerSecret) {
      // Appel de la tâche avec un secret faux ou sans CRON_SECRET configuré : noté pour le diagnostic
      const why = secret
        ? "le secret envoyé par la tâche (coffre de la base) est différent de CRON_SECRET. Recopiez dans CRON_SECRET la valeur affichée à la fin du script daily_report.sql."
        : "CRON_SECRET n'est pas enregistré dans les secrets des fonctions.";
      await logRun(db, url.searchParams.get("source") === "test" ? "test" : "cron", "refused", why);
      return json(req, { error: `Accès refusé : ${why}` }, 401);
    }

    let opts: { force?: boolean; manual?: boolean };
    let source: RunSource;
    if (isCron) {
      opts = { force: url.searchParams.get("force") === "1" || body?.force === true };
      source = url.searchParams.get("source") === "test" ? "test" : "cron";
    } else {
      // 2. Administration : compte admin connecté
      const admin = await requireAdmin(bearer, db);
      if (!admin) return json(req, { error: "Accès refusé" }, 401);

      if (body?.action === "status") {
        // deno-lint-ignore no-explicit-any
        let dbStatus: any = null;
        const st = await db.rpc("daily_report_status");
        if (st.error) dbStatus = /does not exist|could not find|PGRST202|42883/i.test(`${st.error.message} ${st.error.code}`) ? { missing: true } : { cron_error: st.error.message };
        else dbStatus = st.data;
        const { data: runs, error: runsErr } = await db.from("daily_report_runs").select("created_at, source, outcome, detail").order("created_at", { ascending: false }).limit(15);
        const runsError = runsErr ? "Journal indisponible : lancez supabase/sql/daily_report_check.sql." : "";
        const { data: sent } = await db.from("daily_reports").select("report_date, status, sent_at").order("report_date", { ascending: false }).limit(7);
        return json(req, { checks: diagnose(dbStatus, runs, runsError), runs: runs || [], cron_runs: dbStatus?.runs || [], sent: sent || [] });
      }

      if (body?.action === "selftest") {
        const start = await db.rpc("daily_report_selftest");
        if (start.error) {
          const missing = /does not exist|could not find|PGRST202|42883/i.test(`${start.error.message} ${start.error.code}`);
          return json(req, { error: missing ? "Lancez d'abord le script supabase/sql/daily_report_check.sql dans Supabase (SQL Editor)." : start.error.message }, 400);
        }
        const requestId = Number(start.data);
        // La base envoie la requête quelques instants plus tard : on attend sa réponse (25 s au plus)
        for (let i = 0; i < 25; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const st = await db.rpc("daily_report_status", { p_request_id: requestId });
          const resp = st.data?.response;
          if (resp) return json(req, { request_id: requestId, response: resp });
        }
        return json(req, { request_id: requestId, response: null });
      }

      opts = { manual: true };
      source = "manuel";
    }

    const result = await runDailyReport({ now: new Date(), source: makeSource(db), lock: makeLock(db), send: sendMail }, opts);
    console.log("daily-report :", source, JSON.stringify(result));
    const detail = result.status === "error" ? result.error
      : result.status === "skipped_hour" ? `il était ${result.parisHour} h à Paris`
      : "date" in result ? `bilan du ${result.date}` : "";
    // Les passages de 4 h ou 5 h qui ne sont pas « 6 h à Paris » sont normaux : notés quand même, pour le suivi
    await logRun(db, source, result.status, detail);
    return json(req, result, result.status === "error" ? 502 : 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("daily-report :", msg);
    return json(req, { status: "error", error: msg }, 500);
  }
});
