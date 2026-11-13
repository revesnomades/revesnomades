// Tests du bilan quotidien et du comptage des visites.
// Lancer : deno test supabase/functions/tests/
import {
  buildReport, collect, type DataSource, dayWindow, evolution, type Lock, type Mail, parisDate, parisHour, runDailyReport, summarizeVisits, type VisitRow,
} from "../_shared/report.ts";
import { cleanCampaign, cleanPath, cleanReferrer, deviceOf, isBot, visitorHash } from "../_shared/visits.ts";

function eq<T>(actual: T, expected: T, what = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what ? what + " : " : ""}attendu ${e}, obtenu ${a}`);
}
function ok(cond: unknown, what: string) { if (!cond) throw new Error(what); }
const at = (iso: string) => new Date(iso);
const hours = (w: { start: Date; end: Date }) => (w.end.getTime() - w.start.getTime()) / 3600000;

// ─── Bornes de la journée, heure de Paris ──────────────────────────────────
Deno.test("la veille, en hiver : de 23 h UTC à 23 h UTC", () => {
  const w = dayWindow(at("2026-11-13T05:00:00Z"), 1); // 6 h à Paris
  eq(w.date, "2026-11-12");
  eq(w.start.toISOString(), "2026-11-11T23:00:00.000Z");
  eq(w.end.toISOString(), "2026-11-12T23:00:00.000Z");
  eq(hours(w), 24);
  eq(w.label, "jeudi 12 novembre");
});

Deno.test("la veille, en été : de 22 h UTC à 22 h UTC", () => {
  const w = dayWindow(at("2026-07-10T04:00:00Z"), 1);
  eq(w.date, "2026-07-09");
  eq(w.start.toISOString(), "2026-07-08T22:00:00.000Z");
  eq(w.end.toISOString(), "2026-07-09T22:00:00.000Z");
  eq(hours(w), 24);
});

Deno.test("passage à l'heure d'été (29 mars 2026) : la journée dure 23 h", () => {
  const w = dayWindow(at("2026-03-30T04:00:00Z"), 1);
  eq(w.date, "2026-03-29");
  eq(w.start.toISOString(), "2026-03-28T23:00:00.000Z"); // minuit, encore en heure d'hiver
  eq(w.end.toISOString(), "2026-03-29T22:00:00.000Z");   // minuit suivant, en heure d'été
  eq(hours(w), 23);
});

Deno.test("passage à l'heure d'hiver (25 octobre 2026) : la journée dure 25 h", () => {
  const w = dayWindow(at("2026-10-26T05:00:00Z"), 1);
  eq(w.date, "2026-10-25");
  eq(w.start.toISOString(), "2026-10-24T22:00:00.000Z");
  eq(w.end.toISOString(), "2026-10-25T23:00:00.000Z");
  eq(hours(w), 25);
});

Deno.test("l'avant-veille précède la veille sans trou ni chevauchement, même au changement d'heure", () => {
  for (const now of ["2026-03-30T04:00:00Z", "2026-03-31T04:00:00Z", "2026-10-26T05:00:00Z", "2026-10-27T05:00:00Z", "2027-01-01T05:00:00Z"]) {
    const day = dayWindow(at(now), 1), before = dayWindow(at(now), 2);
    eq(before.end.toISOString(), day.start.toISOString(), now);
  }
});

Deno.test("peu après minuit à Paris, la veille est bien le jour qui vient de finir", () => {
  eq(dayWindow(at("2026-11-12T23:30:00Z"), 1).date, "2026-11-12"); // 0 h 30 le 13 à Paris
  eq(dayWindow(at("2026-12-31T23:30:00Z"), 1).date, "2026-12-31"); // 0 h 30 le 1er janvier
  eq(parisDate(at("2026-12-31T23:30:00Z")), "2027-01-01");
});

Deno.test("il est 6 h à Paris à 4 h UTC en été et à 5 h UTC en hiver", () => {
  eq(parisHour(at("2026-07-10T04:00:00Z")), 6);
  eq(parisHour(at("2026-07-10T05:00:00Z")), 7);
  eq(parisHour(at("2026-11-13T04:00:00Z")), 5);
  eq(parisHour(at("2026-11-13T05:00:00Z")), 6);
});

// ─── Évolution ─────────────────────────────────────────────────────────────
Deno.test("évolution par rapport à la veille", () => {
  eq(evolution(50, 40), "+25 %");
  eq(evolution(36, 40), "−10 %");
  eq(evolution(40, 40), "=");
  eq(evolution(0, 0), "=");
  eq(evolution(5, 0), "nouveau");
  eq(evolution(0, 12), "−100 %");
  eq(evolution(1001, 1000), "="); // moins d'un demi-point : stable
  eq(evolution(3, 1), "+200 %");
});

// ─── Visites ───────────────────────────────────────────────────────────────
const v = (hash: string, path: string, extra: Partial<VisitRow> = {}, t = "2026-11-12T10:00:00Z"): VisitRow =>
  ({ visitor_hash: hash, path, referrer_host: null, campaign: null, device: "telephone", created_at: t, ...extra });

Deno.test("visites : visiteurs uniques, pages, provenances comptées par visiteur, appareils", () => {
  const rows = [
    v("a", "/", { referrer_host: "instagram.com" }, "2026-11-12T09:00:00Z"),
    v("a", "/boutique.html", {}, "2026-11-12T09:01:00Z"),
    v("a", "/boutique.html", {}, "2026-11-12T09:05:00Z"),
    v("b", "/", { campaign: "newsletter", referrer_host: "mail.google.com", device: "ordinateur" }),
    v("c", "/sejour.html?slug=cevennes", { device: "tablette" }),
    v("d", "/", { referrer_host: "instagram.com" }),
  ];
  const s = summarizeVisits(rows, p => p === "/" ? "Accueil" : p);
  eq(s.visitors, 4);
  eq(s.pageviews, 6);
  eq(s.pages[0], { label: "Accueil", count: 3 });
  eq(s.pages[1], { label: "/boutique.html", count: 2 });
  // la campagne prime sur le site d'origine ; sans l'un ni l'autre : accès direct
  eq(s.sources, [{ label: "instagram.com", count: 2 }, { label: "Accès direct", count: 1 }, { label: "Campagne « newsletter »", count: 1 }]);
  eq(s.devices, [{ label: "Téléphone", count: 2 }, { label: "Ordinateur", count: 1 }, { label: "Tablette", count: 1 }]);
});

Deno.test("visites : cinq pages et cinq provenances au plus", () => {
  const rows = Array.from({ length: 8 }, (_, i) => v(`h${i}`, `/page-${i}.html`, { referrer_host: `site${i}.fr` }));
  const s = summarizeVisits(rows);
  eq(s.pages.length, 5); eq(s.sources.length, 5);
});

// ─── Source de données de test ─────────────────────────────────────────────
function fakeSource(over: Partial<DataSource> = {}): DataSource {
  const isYesterday = (w: { date: string }) => w.date === "2026-11-12";
  return {
    visits: async (w) => isYesterday(w)
      ? [...Array.from({ length: 50 }, (_, i) => v(`v${i}`, i % 2 ? "/boutique.html" : "/", { referrer_host: i < 20 ? "instagram.com" : null })), v("v0", "/panier.html")]
      : Array.from({ length: 40 }, (_, i) => v(`p${i}`, "/")),
    pageLabels: async () => ({ "/": "Accueil", "/boutique.html": "Shop" }),
    orders: async (w) => isYesterday(w)
      ? { count: 3, revenue: 210.5, items: [{ ref: "AN-20261112-AB12", label: "Tapis Tadasana ×1", amount: 62.9 }, { ref: "AN-20261112-CD34", label: "Séjour <Cévennes> ×1", amount: 147.6 }] }
      : { count: 2, revenue: 100, items: [] },
    bookings: async (w) => isYesterday(w) ? { count: 2, byStay: [{ label: "Pilates en Cévennes", count: 2 }] } : { count: 0, byStay: [] },
    giftCards: async (w) => isYesterday(w) ? { sold: 1, soldAmount: 50, usedAmount: 20 } : { sold: 0, soldAmount: 0, usedAmount: 0 },
    signups: async (w) => isYesterday(w) ? { accounts: 2, newsletter: 3, priority: 1 } : { accounts: 1, newsletter: 2, priority: 0 },
    messages: async (w) => isYesterday(w) ? { count: 1, items: [{ from: "Marie Dupont", subject: "Question sur le séjour" }] } : { count: 1, items: [] },
    lowStock: async () => [{ name: "Cahier vert", stock: 0 }, { name: "Tapis Balasana", stock: 2 }],
    ...over,
  };
}
const NOW = at("2026-11-13T05:00:00Z"); // 6 h à Paris, bilan du jeudi 12 novembre

// ─── Contenu de l'e-mail ───────────────────────────────────────────────────
Deno.test("e-mail : objet avec la date et les chiffres clés", async () => {
  const mail = buildReport(await collect(fakeSource(), NOW, () => {}));
  eq(mail.subject, "Bilan Âmes Nomades du jeudi 12 novembre : 50 visiteurs, 3 commandes, 210,50 €");
});

Deno.test("e-mail : grands chiffres, évolutions, listes et bouton vers l'administration", async () => {
  const { html, text } = buildReport(await collect(fakeSource(), NOW, () => {}));
  for (const part of [
    "Bilan du jeudi 12 novembre", "Visiteurs", "Pages vues", "Chiffre d&#39;affaires", "210,50 €",
    "+25 %",       // 50 visiteurs contre 40 la veille
    "+50 %",       // 3 commandes contre 2
    "nouveau",     // 2 réservations contre 0
    "=",           // 1 message contre 1
    "Pages les plus vues", "Accueil", "Shop", "instagram.com", "Accès direct", "Téléphone",
    "AN-20261112-AB12", "Tapis Tadasana ×1", "Pilates en Cévennes", "Bons cadeaux", "Newsletter", "Liste prioritaire",
    "Question sur le séjour", "Marie Dupont", "Stock à surveiller", "épuisé", "reste 2",
    'href="https://amesnomades.com/admin-dashboard.html"', "Ouvrir l'administration",
  ]) ok(html.includes(part), `l'e-mail devrait contenir « ${part} »`);
  ok(html.includes("Séjour &lt;Cévennes&gt;") && !html.includes("<Cévennes>"), "les textes venant de la base sont échappés");
  ok(!/<style|<script|class=/.test(html), "styles en ligne uniquement, sans feuille de style ni script");
  ok(html.includes('role="presentation"') && html.includes("max-width:600px"), "mise en page en tableaux, 600 px au plus");
  ok(text.includes("Visiteurs : 50 (+25 %)"), "version texte");
});

Deno.test("e-mail : une lecture en échec retire son bloc, le reste part quand même", async () => {
  const logs: string[] = [];
  const data = await collect(fakeSource({ orders: async () => { throw new Error("table purchases indisponible"); } }), NOW, m => logs.push(m));
  eq(data.orders, null); eq(data.missing, ["commandes"]);
  const mail = buildReport(data);
  ok(!mail.html.includes("Chiffre d&#39;affaires") && !mail.html.includes("Commandes ("), "le bloc commandes est absent");
  ok(mail.html.includes("Données indisponibles ce matin : commandes"), "l'absence est signalée");
  ok(mail.html.includes("Pages les plus vues") && mail.html.includes("Pilates en Cévennes"), "les autres blocs sont là");
  eq(mail.subject, "Bilan Âmes Nomades du jeudi 12 novembre : 50 visiteurs, 2 réservations");
  ok(logs.some(l => l.includes("purchases indisponible")), "l'erreur est notée dans les journaux");
});

Deno.test("e-mail : journée sans aucune activité", async () => {
  const empty = fakeSource({
    visits: async () => [], orders: async () => ({ count: 0, revenue: 0, items: [] }), bookings: async () => ({ count: 0, byStay: [] }),
    giftCards: async () => ({ sold: 0, soldAmount: 0, usedAmount: 0 }), signups: async () => ({ accounts: 0, newsletter: 0, priority: 0 }),
    messages: async () => ({ count: 0, items: [] }), lowStock: async () => [],
  });
  const mail = buildReport(await collect(empty, NOW, () => {}));
  eq(mail.subject, "Bilan Âmes Nomades du jeudi 12 novembre : 0 visiteur, aucune commande");
  ok(mail.html.includes("Aucune visite hier.") && mail.html.includes("Aucune commande hier."), "messages « aucun »");
  ok(!mail.html.includes("Stock à surveiller") && !mail.html.includes("Bons cadeaux"), "blocs vides masqués");
});

// ─── Envoi unique ──────────────────────────────────────────────────────────
function harness(opts: { sendFails?: number; simulated?: boolean } = {}) {
  const reserved = new Map<string, string>(), sent: Mail[] = [];
  let failures = opts.sendFails || 0;
  const lock: Lock = {
    reserve: async (d) => { if (reserved.has(d)) return false; reserved.set(d, "pending"); return true; },
    release: async (d) => { if (reserved.get(d) === "pending") reserved.delete(d); },
    markSent: async (d) => { reserved.set(d, "sent"); },
  };
  const send = async (mail: Mail) => {
    if (opts.simulated) return { simulated: true };
    if (failures-- > 0) throw new Error("Brevo 500");
    sent.push(mail); return { simulated: false };
  };
  const run = (now: Date, o = {}) => runDailyReport({ now, source: fakeSource(), lock, send, log: () => {} }, o);
  return { run, sent, reserved };
}

Deno.test("un deuxième appel le même jour n'envoie rien", async () => {
  const h = harness();
  eq((await h.run(NOW)).status, "sent");
  eq((await h.run(NOW)).status, "already_sent");
  eq((await h.run(at("2026-11-13T05:20:00Z"))).status, "already_sent");
  eq(h.sent.length, 1);
  eq(h.reserved.get("2026-11-12"), "sent");
});

Deno.test("deux déclenchements (4 h et 5 h UTC) : un seul envoie, celui où il est 6 h à Paris", async () => {
  const winter = harness();
  eq(await winter.run(at("2026-11-13T04:00:00Z")), { status: "skipped_hour", parisHour: 5 });
  eq((await winter.run(at("2026-11-13T05:00:00Z"))).status, "sent");
  eq(winter.sent.length, 1);
  const summer = harness();
  eq((await summer.run(at("2026-07-10T04:00:00Z"))).status, "sent");
  eq(await summer.run(at("2026-07-10T05:00:00Z")), { status: "skipped_hour", parisHour: 7 });
  eq(summer.sent.length, 1);
});

Deno.test("le lendemain, un nouveau bilan part", async () => {
  const h = harness();
  await h.run(NOW);
  const next = await h.run(at("2026-11-14T05:00:00Z"));
  eq(next.status, "sent"); eq(h.sent.length, 2);
  ok(h.sent[1].subject.includes("vendredi 13 novembre"), "bilan du 13");
});

Deno.test("envoi en échec : la date est libérée et l'appel suivant envoie", async () => {
  const h = harness({ sendFails: 1 });
  const first = await h.run(NOW);
  eq(first.status, "error"); eq(h.reserved.has("2026-11-12"), false);
  eq((await h.run(NOW)).status, "sent");
  eq(h.sent.length, 1);
});

Deno.test("forçage : envoie à n'importe quelle heure, mais toujours une seule fois", async () => {
  const h = harness();
  const afternoon = at("2026-11-13T14:00:00Z");
  eq((await h.run(afternoon)).status, "skipped_hour");
  eq((await h.run(afternoon, { force: true })).status, "sent");
  eq((await h.run(afternoon, { force: true })).status, "already_sent");
  eq(h.sent.length, 1);
});

Deno.test("bouton de l'administration : envoi immédiat, sans bloquer ni consommer le bilan de 6 h", async () => {
  const h = harness();
  eq((await h.run(at("2026-11-13T15:00:00Z"), { manual: true })).status, "sent");
  eq((await h.run(at("2026-11-13T15:01:00Z"), { manual: true })).status, "sent");
  eq(h.reserved.size, 0);
  const late = harness();
  await late.run(NOW);
  eq((await late.run(at("2026-11-13T09:00:00Z"), { manual: true })).status, "sent"); // même après l'envoi du matin
  eq(late.sent.length, 2);
});

Deno.test("sans clé d'envoi : bilan simulé, rien ne plante, la date reste disponible", async () => {
  const h = harness({ simulated: true });
  const r = await h.run(NOW);
  eq(r.status, "simulated"); eq(h.sent.length, 0); eq(h.reserved.size, 0);
});

// ─── Comptage des visites ──────────────────────────────────────────────────
Deno.test("robots ignorés, vrais navigateurs gardés", () => {
  for (const ua of ["", "curl/8.4.0", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "facebookexternalhit/1.1", "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0", "python-requests/2.31"]) ok(isBot(ua), `robot attendu : ${ua}`);
  for (const ua of ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"]) ok(!isBot(ua), `navigateur attendu : ${ua}`);
});

Deno.test("pages d'administration et techniques jamais comptées, chemins nettoyés", () => {
  for (const p of ["/admin-dashboard.html", "/admin-bookings.html?x=1", "/acces-admin-7k29x.html", "/assets/js/main.js", "/maintenance.html", "/reset-password.html", "/desinscription.html", "https://autre.site/", "//autre.site", "", null]) eq(cleanPath(p), null, String(p));
  eq(cleanPath("/"), "/");
  eq(cleanPath("/index.html"), "/");
  eq(cleanPath("/Boutique.html"), "/boutique.html");
  eq(cleanPath("/sejour.html?slug=cevennes-mai&utm_source=insta"), "/sejour.html?slug=cevennes-mai");
  eq(cleanPath("/produit.html?id=8f1c2d3e-aaaa-bbbb-cccc-1234567890ab"), "/produit.html?id=8f1c2d3e-aaaa-bbbb-cccc-1234567890ab");
  eq(cleanPath("/boutique.html?email=marie@ex.fr&token=secret"), "/boutique.html"); // aucune donnée personnelle gardée
  eq(cleanPath('/panier.html"><script>'), "/panier.htmlscript");
});

Deno.test("provenance, campagne et appareil", () => {
  eq(cleanReferrer("www.instagram.com"), "instagram.com");
  eq(cleanReferrer("https://l.facebook.com/l.php?u=x"), "l.facebook.com");
  eq(cleanReferrer("amesnomades.com"), null);
  eq(cleanReferrer("www.amesnomades.com"), null);
  eq(cleanReferrer(""), null);
  eq(cleanReferrer("pas un domaine"), null);
  eq(cleanCampaign("Newsletter_Noël 2026!"), "newsletter_nol2026");
  eq(cleanCampaign(""), null);
  eq(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Mobile/15E148 Safari/604.1"), "telephone");
  eq(deviceOf("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36"), "telephone");
  eq(deviceOf("Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) Safari/604.1"), "tablette");
  eq(deviceOf("Mozilla/5.0 (Linux; Android 13; SM-X700) Chrome/130.0 Safari/537.36"), "tablette");
  eq(deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"), "ordinateur");
});

Deno.test("empreinte : change chaque jour, ne contient pas l'adresse IP", async () => {
  const ua = "Mozilla/5.0 (iPhone)", ip = "203.0.113.42";
  const today = await visitorHash(ip, ua, "2026-11-12", "sel");
  eq(today, await visitorHash(ip, ua, "2026-11-12", "sel"), "stable dans la journée");
  ok(today !== await visitorHash(ip, ua, "2026-11-13", "sel"), "différente le lendemain");
  ok(today !== await visitorHash("203.0.113.43", ua, "2026-11-12", "sel"), "différente pour une autre adresse");
  ok(/^[0-9a-f]{64}$/.test(today), "SHA-256 en hexadécimal : 64 caractères, l'adresse n'y figure pas en clair");
  ok(today !== await visitorHash(ip, ua, "2026-11-12", "autre sel"), "dépend du sel connu du seul serveur");
});
