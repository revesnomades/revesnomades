// Bilan quotidien Âmes Nomades : bornes de la journée (heure de Paris), agrégats, mise en forme, envoi unique.
// Ce fichier ne dépend d'aucun service : les lectures et l'envoi sont fournis par l'appelant (testable hors ligne).

export const TZ = "Europe/Paris";
export const SITE_URL = "https://amesnomades.com";
export const ADMIN_URL = `${SITE_URL}/admin-dashboard.html`;

// ─── Heure de Paris ────────────────────────────────────────────────────────
function parisParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Heure qu'il est à Paris (0-23). */
export function parisHour(now: Date): number {
  return parisParts(now).hour;
}

/** Date du jour à Paris, « AAAA-MM-JJ ». */
export function parisDate(now: Date): string {
  const p = parisParts(now);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// Décalage Paris − UTC, en minutes, à un instant donné (60 en hiver, 120 en été)
function parisOffsetMinutes(instant: number): number {
  const p = parisParts(new Date(instant));
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second) - instant) / 60000);
}

/** Instant UTC de minuit, heure de Paris, pour une date civile donnée. */
export function parisMidnight(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let t = guess - parisOffsetMinutes(guess) * 60000;
  // Le décalage peut différer entre l'estimation et le vrai minuit (jours de changement d'heure)
  const off = parisOffsetMinutes(t);
  if (guess - off * 60000 !== t) t = guess - off * 60000;
  return new Date(t);
}

export type DayWindow = { date: string; start: Date; end: Date; label: string };

/** Journée complète à Paris, `daysAgo` jours avant aujourd'hui (1 = la veille), de minuit à minuit. */
export function dayWindow(now: Date, daysAgo: number): DayWindow {
  const p = parisParts(now);
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d - daysAgo)); // calcul sur le calendrier, sans heure
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d - daysAgo + 1));
  const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
  const start = parisMidnight(y, m, d);
  const end = parisMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  const label = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(day);
  return { date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, start, end, label };
}

// ─── Évolution ─────────────────────────────────────────────────────────────
/** « +25 % », « −10 % », « = » ou « nouveau » (rien la veille, quelque chose aujourd'hui). */
export function evolution(current: number, previous: number): string {
  if (!previous) return current ? "nouveau" : "=";
  const pct = Math.round((current - previous) / previous * 100);
  if (pct === 0) return "=";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`;
}

// ─── Visites ───────────────────────────────────────────────────────────────
export type VisitRow = { path: string; referrer_host: string | null; campaign: string | null; device: string | null; visitor_hash: string; created_at?: string };
export type Ranked = { label: string; count: number };
export type VisitSummary = { visitors: number; pageviews: number; pages: Ranked[]; sources: Ranked[]; devices: Ranked[] };

const top = (counts: Map<string, number>, n: number): Ranked[] =>
  [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([label, count]) => ({ label, count }));
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);

const DEVICE_LABEL: Record<string, string> = { ordinateur: "Ordinateur", telephone: "Téléphone", tablette: "Tablette" };

export function summarizeVisits(rows: VisitRow[], pageLabel: (path: string) => string = p => p): VisitSummary {
  const sorted = [...rows].sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const pages = new Map<string, number>();
  // Provenance et appareil comptés une fois par visiteur : campagne, sinon site d'origine, sinon accès direct
  const byVisitor = new Map<string, { campaign: string; referrer: string; device: string }>();
  for (const r of sorted) {
    bump(pages, pageLabel(r.path));
    const v = byVisitor.get(r.visitor_hash) || { campaign: "", referrer: "", device: "" };
    if (!v.campaign && r.campaign) v.campaign = r.campaign;
    if (!v.referrer && r.referrer_host) v.referrer = r.referrer_host;
    if (!v.device && r.device) v.device = r.device;
    byVisitor.set(r.visitor_hash, v);
  }
  const sources = new Map<string, number>(), devices = new Map<string, number>();
  for (const v of byVisitor.values()) {
    bump(sources, v.campaign ? `Campagne « ${v.campaign} »` : v.referrer || "Accès direct");
    bump(devices, DEVICE_LABEL[v.device] || "Autre");
  }
  return { visitors: byVisitor.size, pageviews: rows.length, pages: top(pages, 5), sources: top(sources, 5), devices: top(devices, 3) };
}

// ─── Données du bilan ──────────────────────────────────────────────────────
export type Orders = { count: number; revenue: number; items: { ref: string; label: string; amount: number }[] };
export type Bookings = { count: number; byStay: Ranked[] };
export type GiftCards = { sold: number; soldAmount: number; usedAmount: number };
export type Signups = { accounts: number; newsletter: number; priority: number };
export type Messages = { count: number; items: { from: string; subject: string }[] };
export type LowStock = { name: string; stock: number }[];

/** Lectures fournies par l'appelant. Chaque méthode peut échouer : son bloc est alors absent du bilan. */
export type DataSource = {
  visits(w: DayWindow): Promise<VisitRow[]>;
  pageLabels(): Promise<Record<string, string>>;
  orders(w: DayWindow): Promise<Orders>;
  bookings(w: DayWindow): Promise<Bookings>;
  giftCards(w: DayWindow): Promise<GiftCards>;
  signups(w: DayWindow): Promise<Signups>;
  messages(w: DayWindow): Promise<Messages>;
  lowStock(): Promise<LowStock>;
};

type Pair<T> = { current: T; previous: T };
export type ReportData = {
  day: DayWindow;
  visits: Pair<VisitSummary> | null;
  orders: Pair<Orders> | null;
  bookings: Pair<Bookings> | null;
  giftCards: Pair<GiftCards> | null;
  signups: Pair<Signups> | null;
  messages: Pair<Messages> | null;
  lowStock: LowStock | null;
  missing: string[]; // blocs dont la lecture a échoué
};

/** Lit chaque bloc séparément : une lecture en échec retire son bloc, le reste du bilan part quand même. */
export async function collect(source: DataSource, now: Date, log: (m: string) => void = console.error): Promise<ReportData> {
  const day = dayWindow(now, 1), before = dayWindow(now, 2);
  const missing: string[] = [];
  const block = async <T>(name: string, read: () => Promise<T>): Promise<T | null> => {
    try { return await read(); } catch (e) {
      missing.push(name);
      log(`bilan : lecture « ${name} » en échec : ${e instanceof Error ? e.message : e}`);
      return null;
    }
  };
  const pair = <T>(name: string, read: (w: DayWindow) => Promise<T>) =>
    block(name, async () => { const [current, previous] = await Promise.all([read(day), read(before)]); return { current, previous }; });

  // Libellés lisibles des pages (nom du séjour ou du produit) : facultatifs
  let labels: Record<string, string> = {};
  try { labels = await source.pageLabels(); } catch (e) { log(`bilan : libellés de pages indisponibles : ${e instanceof Error ? e.message : e}`); }
  const pageLabel = (p: string) => labels[p] || p;

  const [visits, orders, bookings, giftCards, signups, messages, lowStock] = await Promise.all([
    pair("visites", async w => summarizeVisits(await source.visits(w), pageLabel)),
    pair("commandes", w => source.orders(w)),
    pair("réservations", w => source.bookings(w)),
    pair("bons cadeaux", w => source.giftCards(w)),
    pair("inscriptions", w => source.signups(w)),
    pair("messages", w => source.messages(w)),
    block("stock", () => source.lowStock()),
  ]);
  return { day, visits, orders, bookings, giftCards, signups, messages, lowStock, missing };
}

// ─── Mise en forme ─────────────────────────────────────────────────────────
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const nb = (n: number) => new Intl.NumberFormat("fr-FR").format(n).replace(/[\u202f\u00a0]/g, " ");
export const euro = (n: number) => `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 }).format(n).replace(/[\u202f\u00a0]/g, " ")} €`;
const plural = (n: number, one: string, many: string) => `${nb(n)} ${n > 1 ? many : one}`;
const totalSignups = (s: Signups) => s.accounts + s.newsletter + s.priority;

export type Mail = { subject: string; html: string; text: string };

export function buildReport(data: ReportData): Mail {
  const { day } = data;
  const C = { bg: "#faf5dc", card: "#fffdf3", line: "#e6dfc4", ink: "#1e1f22", muted: "#6c7078", accent: "#cc6f53", up: "#2e7d4f", down: "#b3542f" };
  const font = "Arial, Helvetica, sans-serif";

  // Objet : les deux ou trois chiffres clés
  const keys: string[] = [];
  if (data.visits) keys.push(plural(data.visits.current.visitors, "visiteur", "visiteurs"));
  if (data.orders) { keys.push(data.orders.current.count ? plural(data.orders.current.count, "commande", "commandes") : "aucune commande"); if (data.orders.current.revenue > 0) keys.push(euro(data.orders.current.revenue)); }
  if (keys.length < 3 && data.bookings?.current.count) keys.push(plural(data.bookings.current.count, "réservation", "réservations"));
  const subject = `Bilan Âmes Nomades du ${day.label}${keys.length ? " : " + keys.join(", ") : ""}`;

  // Grands chiffres, avec l'évolution par rapport à la veille
  type Kpi = { label: string; value: string; evo: string };
  const kpis: Kpi[] = [];
  const add = (label: string, cur: number, prev: number, fmt: (n: number) => string = nb) => kpis.push({ label, value: fmt(cur), evo: evolution(cur, prev) });
  if (data.visits) { add("Visiteurs", data.visits.current.visitors, data.visits.previous.visitors); add("Pages vues", data.visits.current.pageviews, data.visits.previous.pageviews); }
  if (data.orders) { add("Commandes", data.orders.current.count, data.orders.previous.count); add("Chiffre d'affaires", data.orders.current.revenue, data.orders.previous.revenue, euro); }
  if (data.bookings) add("Réservations de séjours", data.bookings.current.count, data.bookings.previous.count);
  if (data.signups) add("Nouveaux inscrits", totalSignups(data.signups.current), totalSignups(data.signups.previous));
  if (data.messages) add("Messages reçus", data.messages.current.count, data.messages.previous.count);

  const evoColor = (e: string) => e.startsWith("+") ? C.up : e.startsWith("−") ? C.down : C.muted;
  const kpiCell = (k: Kpi | undefined) => k ? `<td width="50%" valign="top" style="padding:6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff; border:1px solid ${C.line};"><tr><td style="padding:14px 14px 12px; font-family:${font};">
            <div style="font-size:12px; letter-spacing:1px; text-transform:uppercase; color:${C.muted};">${esc(k.label)}</div>
            <div style="font-size:28px; line-height:1.2; font-weight:bold; color:${C.ink}; margin-top:4px;">${esc(k.value)}</div>
            <div style="font-size:13px; color:${evoColor(k.evo)}; margin-top:2px;">${esc(k.evo)} <span style="color:${C.muted};">vs la veille</span></div>
          </td></tr></table>
        </td>` : `<td width="50%" style="padding:6px;">&nbsp;</td>`;
  let kpiRows = "";
  for (let i = 0; i < kpis.length; i += 2) kpiRows += `<tr>${kpiCell(kpis[i])}${kpiCell(kpis[i + 1])}</tr>`;

  // Listes de détail
  const section = (title: string, inner: string) => `
      <tr><td style="padding:22px 28px 0; font-family:${font};">
        <div style="font-family:Georgia, 'Times New Roman', serif; font-size:18px; color:${C.ink}; padding-bottom:8px; border-bottom:1px solid ${C.line};">${esc(title)}</div>
        ${inner}
      </td></tr>`;
  const rows = (items: { left: string; right: string }[]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map(r =>
    `<tr><td style="padding:8px 0; border-bottom:1px solid #f0ead2; font-family:${font}; font-size:14px; line-height:1.4; color:${C.ink}; word-break:break-word;">${r.left}</td><td align="right" valign="top" style="padding:8px 0 8px 12px; border-bottom:1px solid #f0ead2; font-family:${font}; font-size:14px; color:${C.ink}; white-space:nowrap; font-weight:bold;">${r.right}</td></tr>`).join("")}</table>`;
  const none = (t: string) => `<p style="margin:10px 0 0; font-size:14px; color:${C.muted};">${esc(t)}</p>`;
  const ranked = (list: Ranked[], unit: (n: number) => string) => rows(list.map(x => ({ left: esc(x.label), right: esc(unit(x.count)) })));

  let sections = "";
  if (data.visits) {
    const v = data.visits.current;
    sections += section("Pages les plus vues", v.pages.length ? ranked(v.pages, n => plural(n, "vue", "vues")) : none("Aucune visite hier."));
    if (v.sources.length) sections += section("D'où viennent les visiteurs", ranked(v.sources, n => plural(n, "visiteur", "visiteurs")));
    if (v.devices.length) sections += section("Appareils", ranked(v.devices, n => `${v.visitors ? Math.round(n / v.visitors * 100) : 0} %`));
  }
  if (data.orders) {
    const o = data.orders.current;
    sections += section(`Commandes (${o.count})`, o.items.length
      ? rows(o.items.slice(0, 8).map(i => ({ left: `${i.ref ? `<span style="color:${C.muted};">${esc(i.ref)}</span><br>` : ""}${esc(i.label)}`, right: esc(euro(i.amount)) }))) + (o.items.length > 8 ? none(`… et ${o.items.length - 8} autres.`) : "")
      : none("Aucune commande hier."));
  }
  if (data.bookings) {
    const b = data.bookings.current;
    sections += section(`Réservations de séjours (${b.count})`, b.byStay.length ? ranked(b.byStay, n => plural(n, "place", "places")) : none("Aucune réservation hier."));
  }
  if (data.giftCards && (data.giftCards.current.sold || data.giftCards.current.usedAmount)) {
    const g = data.giftCards.current;
    sections += section("Bons cadeaux", rows([
      { left: `Vendus (${nb(g.sold)})`, right: esc(euro(g.soldAmount)) },
      { left: "Utilisés pour payer", right: esc(euro(g.usedAmount)) },
    ]));
  }
  if (data.signups) {
    const s = data.signups.current;
    sections += section(`Nouveaux inscrits (${totalSignups(s)})`, rows([
      { left: "Comptes créés", right: nb(s.accounts) },
      { left: "Newsletter", right: nb(s.newsletter) },
      { left: "Liste prioritaire", right: nb(s.priority) },
    ]));
  }
  if (data.messages) {
    const m = data.messages.current;
    sections += section(`Messages reçus (${m.count})`, m.items.length
      ? rows(m.items.slice(0, 5).map(i => ({ left: `${esc(i.subject || "Sans objet")}<br><span style="color:${C.muted};">${esc(i.from)}</span>`, right: "" })))
      : none("Aucun message hier."));
  }
  if (data.lowStock?.length) {
    sections += section("Stock à surveiller", rows(data.lowStock.map(p => ({ left: esc(p.name), right: p.stock <= 0 ? `<span style="color:${C.down};">épuisé</span>` : `reste ${nb(p.stock)}` }))));
  }
  const warning = data.missing.length
    ? `<tr><td style="padding:18px 28px 0; font-family:${font}; font-size:13px; line-height:1.5; color:${C.down};">Données indisponibles ce matin : ${esc(data.missing.join(", "))}. Le reste du bilan est complet.</td></tr>` : "";

  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0; padding:0; background:${C.bg};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${esc(keys.join(", ") || "Le bilan de la veille")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; background:${C.card}; border:1px solid ${C.line};">
      <tr><td align="center" style="padding:28px 24px 18px; border-bottom:1px solid ${C.line};">
        <a href="${SITE_URL}" style="text-decoration:none; color:${C.ink}; font-family:Georgia, 'Times New Roman', serif; font-size:24px; letter-spacing:4px;">ÂMES NOMADES</a>
        <div style="font-family:${font}; font-size:14px; color:${C.muted}; margin-top:8px;">Bilan du ${esc(day.label)}</div>
      </td></tr>
      <tr><td style="padding:16px 22px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${kpiRows || `<tr><td style="padding:12px 6px; font-family:${font}; font-size:14px; color:${C.muted};">Aucun chiffre disponible ce matin.</td></tr>`}</table>
      </td></tr>${warning}${sections}
      <tr><td align="center" style="padding:28px 28px 30px;">
        <a href="${ADMIN_URL}" style="display:inline-block; background:${C.ink}; color:${C.card}; padding:13px 28px; text-decoration:none; border-radius:3px; font-family:${font}; font-size:13px; letter-spacing:1px; text-transform:uppercase;">Ouvrir l'administration</a>
      </td></tr>
      <tr><td align="center" style="padding:16px 24px 22px; border-top:1px solid ${C.line}; font-family:${font}; font-size:12px; line-height:1.6; color:${C.muted};">
        Bilan envoyé chaque matin à 6 h. Visites comptées sans cookie, vos propres visites d'administration exclues.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = [subject, "", ...kpis.map(k => `${k.label} : ${k.value} (${k.evo})`), "", `Administration : ${ADMIN_URL}`].join("\n");
  return { subject, html, text };
}

// ─── Envoi unique ──────────────────────────────────────────────────────────
export type Lock = {
  /** Réserve la date du bilan. Renvoie false si elle l'est déjà (bilan déjà parti ou en cours). */
  reserve(date: string): Promise<boolean>;
  release(date: string): Promise<void>;
  markSent(date: string): Promise<void>;
};
export type SendResult = { simulated: boolean };
export type RunDeps = {
  now: Date;
  source: DataSource;
  lock: Lock;
  /** Envoie l'e-mail. `simulated: true` quand aucune clé d'envoi ou aucun destinataire n'est configuré. */
  send(mail: Mail): Promise<SendResult>;
  log?: (m: string) => void;
};
export type RunOptions = { force?: boolean; manual?: boolean };
export type RunResult =
  | { status: "skipped_hour"; parisHour: number }
  | { status: "already_sent"; date: string }
  | { status: "sent" | "simulated"; date: string; subject: string; missing: string[] }
  | { status: "error"; date: string; error: string };

/**
 * Envoi planifié : seulement s'il est 6 h à Paris (sauf `force`), et une seule fois par date de bilan.
 * Envoi manuel (`manual`, bouton de l'administration) : immédiat, sans toucher à la réservation du jour.
 */
export async function runDailyReport(deps: RunDeps, opts: RunOptions = {}): Promise<RunResult> {
  const log = deps.log || console.log;
  if (!opts.manual && !opts.force) {
    const h = parisHour(deps.now);
    if (h !== 6) return { status: "skipped_hour", parisHour: h };
  }
  const date = dayWindow(deps.now, 1).date;
  if (!opts.manual && !(await deps.lock.reserve(date))) return { status: "already_sent", date };
  try {
    const data = await collect(deps.source, deps.now, log);
    const mail = buildReport(data);
    const res = await deps.send(mail);
    if (res.simulated) {
      log(`bilan simulé (aucun envoi configuré) : ${mail.subject}`);
      if (!opts.manual) await deps.lock.release(date); // un vrai envoi reste possible une fois la configuration faite
      return { status: "simulated", date, subject: mail.subject, missing: data.missing };
    }
    if (!opts.manual) await deps.lock.markSent(date);
    return { status: "sent", date, subject: mail.subject, missing: data.missing };
  } catch (e) {
    if (!opts.manual) await deps.lock.release(date).catch(() => {}); // libérée : le prochain déclenchement réessaiera
    const error = e instanceof Error ? e.message : String(e);
    log(`bilan : envoi en échec : ${error}`);
    return { status: "error", date, error };
  }
}
