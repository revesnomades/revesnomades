// Tests du référencement des pages séjour et produit, et du plan du site.
// Lancer : deno test --allow-read netlify/tests/
import { applyMeta, buildSitemap, clearMemory, metaForUrl, nextDate, plain, productMeta, slugify, stayMeta, STATIC_PAGES } from "../lib/seo.ts";
import seoHandler from "../edge-functions/seo.ts";
import sitemapHandler from "../edge-functions/sitemap.ts";
import checkHandler from "../edge-functions/seo-check.ts";
import { onRequest as pagesMiddleware } from "../../functions/_middleware.ts";
import { handlePage } from "../lib/seo.ts";

function assert(cond: unknown, msg = "condition fausse"): asserts cond { if (!cond) throw new Error(msg); }
function assertEquals(a: unknown, b: unknown, msg = "") { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  obtenu  : ${JSON.stringify(a)}\n  attendu : ${JSON.stringify(b)}`); }
const count = (s: string, re: RegExp) => (s.match(re) || []).length;
const root = new URL("../../", import.meta.url);
const page = (name: string) => Deno.readTextFileSync(new URL(name, root));
const head = (html: string) => html.slice(0, html.search(/<\/head>/i));
const attr = (html: string, id: string, name = "content") => {
  const tag = html.match(new RegExp(`<(?:meta|link)\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] || "";
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
};
const jsonLd = (html: string, id: string) => JSON.parse(html.match(new RegExp(`<script type="application/ld\\+json" id="${id}">([\\s\\S]*?)</script>`))![1]);

const STAY = { id: "11111111-1111-1111-1111-111111111111", slug: "pilates-rando-cevennes", title: "Pilates & randonnée en Cévennes", location: "Saint-Jean-du-Gard", short_description: "Quatre jours pour souffler.", hero_image: "https://qxrxwgrgjvesevjkjmry.supabase.co/storage/v1/object/public/stays/cevennes.webp", published: true };
const PRODUCT = { id: "p1", name: "Tapis de yoga Tadasana", description: "Un tapis <b>antidérapant</b> en liège naturel.", price: 62.9, stock: 3, image_urls: ["https://x.supabase.co/clip.mp4", "https://x.supabase.co/tapis.webp"] };

// Fausse base : répond selon la table demandée
function fakeDb(tables: Record<string, unknown[] | number>) {
  const calls: string[] = [];
  const fetcher = (url: string) => {
    calls.push(decodeURIComponent(url.split("/rest/v1/")[1]));
    const table = url.split("/rest/v1/")[1].split("?")[0];
    const v = tables[table];
    if (typeof v === "number") return Promise.resolve(new Response("erreur", { status: v }));
    if (v === undefined) return Promise.reject(new Error("base injoignable"));
    return Promise.resolve(new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } }));
  };
  return { fetcher, calls };
}

Deno.test("texte : nettoyé, sur une ligne, coupé sans casser un mot", () => {
  assertEquals(plain("  Un <b>tapis</b>\n en&nbsp;liège  "), "Un tapis en liège");
  const cut = plain("Une parenthèse de douceur au cœur des Cévennes pour ralentir vraiment", 40);
  assert(cut.length <= 40 && cut.endsWith("…") && !cut.includes("  "), cut);
  assertEquals(plain(null), "");
});

Deno.test("adresse d'un séjour : même normalisation que la page", () => {
  assertEquals(slugify("Yoga & Brunch : Flow and Care — Octobre Rose"), "yoga-brunch-flow-and-care-octobre-rose");
  assertEquals(slugify("  Séjour d'Été  "), "sejour-dete");
});

Deno.test("page séjour : titre, description, adresse officielle et aperçu de partage du séjour", () => {
  const before = page("sejour.html");
  const html = applyMeta(before, stayMeta(STAY, [{ start_date: "2027-05-13", end_date: "2027-05-16" }], "2026-11-13"));
  const h = head(html);
  assert(/<title id="pageTitle">Pilates &amp; randonnée en Cévennes — Âmes Nomades<\/title>/.test(h), "titre");
  assertEquals(count(h, /<title\b/g), 1);
  assert(attr(h, "stayMetaDescription")!.startsWith("Découvre le séjour bien-être Pilates &amp; randonnée en Cévennes à Saint-Jean-du-Gard avec Âmes Nomades. Quatre jours"), "description");
  assertEquals(count(h, /name="description"/g), 1);
  assertEquals(count(h, /rel="canonical"/g), 1, "une seule adresse officielle");
  assertEquals(attr(h, "pageCanonical", "href"), "https://amesnomades.com/sejour.html?slug=pilates-rando-cevennes");
  assertEquals(attr(h, "ogTitle"), "Pilates &amp; randonnée en Cévennes — Âmes Nomades");
  assertEquals(attr(h, "ogImage"), STAY.hero_image);
  assertEquals(attr(h, "twitterImage"), STAY.hero_image);
  assertEquals(attr(h, "ogUrl"), "https://amesnomades.com/sejour.html?slug=pilates-rando-cevennes");
  for (const id of ["ogType", "ogSiteName", "ogLocale", "ogTitle", "ogDescription", "ogUrl", "ogImage", "twitterCard", "twitterTitle", "twitterDescription", "twitterImage"]) {
    assertEquals(count(h, new RegExp(`id="${id}"`, "g")), 1, `balise ${id} en un seul exemplaire`);
  }
  // Le reste de la page n'a pas bougé
  assertEquals(html.slice(html.search(/<\/head>/i)), before.slice(before.search(/<\/head>/i)), "corps de page inchangé");
});

Deno.test("page séjour : événement daté s'il reste une date à venir, séjour sans date sinon", () => {
  const dates = [{ start_date: "2026-03-01", end_date: "2026-03-04" }, { start_date: "2027-09-10", end_date: "2027-09-13" }, { start_date: "2027-05-13", end_date: "2027-05-16" }];
  assertEquals(nextDate(dates, "2026-11-13")?.start_date, "2027-05-13");
  assertEquals(nextDate(dates, "2027-05-15")?.start_date, "2027-05-13", "séjour en cours : encore annoncé");
  assertEquals(nextDate(dates, "2028-01-01"), null);

  const event = jsonLd(applyMeta(page("sejour.html"), stayMeta(STAY, dates, "2026-11-13")), "staySchema");
  assertEquals([event["@type"], event.startDate, event.endDate], ["Event", "2027-05-13", "2027-05-16"]);
  assertEquals(event.location.address, { "@type": "PostalAddress", addressLocality: "Saint-Jean-du-Gard", addressCountry: "FR" });
  assertEquals(event.url, "https://amesnomades.com/sejour.html?slug=pilates-rando-cevennes");
  assert(!("offers" in event), "aucun prix annoncé pour un séjour (le tarif dépend des options)");

  const trip = jsonLd(applyMeta(page("sejour.html"), stayMeta(STAY, dates, "2028-01-01")), "staySchema");
  assertEquals(trip["@type"], "TouristTrip");
  assert(!("startDate" in trip));
});

Deno.test("texte piégé : rien ne sort de sa balise", () => {
  const nasty = { ...STAY, title: `Week-end "zen" <script>alert(1)</script> $& $1`, short_description: `</script><script>alert(2)</script> & "fin"`, hero_image: `/photos/a"b.webp` };
  const html = applyMeta(page("sejour.html"), stayMeta(nasty, [], "2026-11-13"));
  const h = head(html);
  assert(!/<script>alert/.test(h), "aucun script injecté");
  assert(h.includes("Week-end &quot;zen&quot; alert(1) $&amp; $1 — Âmes Nomades"), "titre échappé, symboles $ conservés");
  assertEquals(attr(h, "ogImage"), "https://amesnomades.com/photos/a&quot;b.webp", "image relative rendue absolue et échappée");
  const data = jsonLd(html, "staySchema"); // lisible malgré le texte piégé
  assert(data.description.includes("alert(2)") && data.name.includes("zen"));
  assertEquals(count(h, /id="staySchema"/g), 1);
});

Deno.test("page produit : nom, photo (pas la vidéo), prix et disponibilité", () => {
  const html = applyMeta(page("produit.html"), productMeta(PRODUCT));
  const h = head(html);
  assert(/<title id="pageTitle">Tapis de yoga Tadasana — Âmes Nomades<\/title>/.test(h));
  assertEquals(attr(h, "pageDesc"), "Un tapis antidérapant en liège naturel.");
  assertEquals(count(h, /rel="canonical"/g), 1);
  assertEquals(attr(h, "pageCanonical", "href"), "https://amesnomades.com/produit.html?id=p1");
  assertEquals(attr(h, "ogImage"), "https://x.supabase.co/tapis.webp");
  assertEquals(attr(h, "ogType"), "product");
  assert(h.includes('<meta property="product:price:amount" content="62.90">'));
  const data = jsonLd(html, "productSchema");
  assertEquals([data["@type"], data.offers.price, data.offers.priceCurrency, data.offers.availability], ["Product", "62.90", "EUR", "https://schema.org/InStock"]);
  assertEquals(data.image, ["https://x.supabase.co/tapis.webp"]);

  assertEquals((productMeta({ ...PRODUCT, stock: 0 }).jsonLd.offers as Record<string, string>).availability, "https://schema.org/OutOfStock");
  assertEquals((productMeta({ ...PRODUCT, stock: 0, coming_soon: true }).jsonLd.offers as Record<string, string>).availability, "https://schema.org/PreOrder");
  const free = productMeta({ id: "p2", name: "Carnet", price: null });
  assert(!("offers" in free.jsonLd), "sans prix : pas d'offre annoncée");
  assertEquals(free.description, "Carnet : à retrouver dans le shop Âmes Nomades.");
  assertEquals(free.image, "https://amesnomades.com/assets/img/hero-1.webp");
});

Deno.test("appliquer deux fois ne duplique rien ; une page sans en-tête n'est pas touchée", () => {
  const once = applyMeta(page("produit.html"), productMeta(PRODUCT));
  const twice = applyMeta(once, productMeta({ ...PRODUCT, name: "Autre" }));
  const h = head(twice);
  assertEquals([count(h, /rel="canonical"/g), count(h, /id="ogTitle"/g), count(h, /id="productSchema"/g), count(h, /<title\b/g)], [1, 1, 1, 1]);
  assert(h.includes("Autre — Âmes Nomades"));
  assertEquals(applyMeta("pas une page", productMeta(PRODUCT)), "pas une page");
});

Deno.test("quelle page annoncer : séjour publié, produit, aperçu, adresse inconnue", async () => {
  clearMemory();
  const db = fakeDb({ stays: [STAY], stay_dates: [{ start_date: "2027-05-13", end_date: "2027-05-16" }], products: [PRODUCT] });
  const now = Date.parse("2026-11-13T10:00:00Z");
  const m = await metaForUrl(new URL("https://amesnomades.com/sejour.html?slug=Pilates%20Rando%20C%C3%A9vennes&utm_source=insta"), db.fetcher, now);
  assertEquals(m?.url, "https://amesnomades.com/sejour.html?slug=pilates-rando-cevennes", "adresse officielle = celle enregistrée, sans paramètre de suivi");
  assertEquals(m?.jsonLd["@type"], "Event");
  assert(db.calls[0].includes("published=eq.true") && db.calls[0].includes("slug=ilike.pilates-rando-cevennes"), db.calls[0]);

  const p = await metaForUrl(new URL("https://amesnomades.com/produit.html?id=p1"), db.fetcher, now);
  assertEquals(p?.title, "Tapis de yoga Tadasana — Âmes Nomades");

  const n = db.calls.length;
  assertEquals(await metaForUrl(new URL("https://amesnomades.com/sejour.html?slug=x&preview=1"), db.fetcher, now), null, "aperçu d'un brouillon");
  assertEquals(await metaForUrl(new URL("https://amesnomades.com/sejour.html"), db.fetcher, now), null, "sans séjour demandé");
  assertEquals(await metaForUrl(new URL("https://amesnomades.com/produit.html?id=1%20or%201=1"), db.fetcher, now), null, "identifiant invalide");
  assertEquals(await metaForUrl(new URL("https://amesnomades.com/boutique.html"), db.fetcher, now), null, "autre page");
  assertEquals(db.calls.length, n, "aucune lecture pour ces cas");

  clearMemory();
  const empty = fakeDb({ stays: [], products: [] });
  assertEquals(await metaForUrl(new URL("https://amesnomades.com/sejour.html?slug=inconnu"), empty.fetcher, now), null);
  assertEquals(await metaForUrl(new URL("https://amesnomades.com/produit.html?id=inconnu"), empty.fetcher, now), null);
});

Deno.test("mémoire : la même page n'interroge pas la base à chaque visite, mais se rafraîchit après 5 minutes", async () => {
  clearMemory();
  const db = fakeDb({ products: [PRODUCT] });
  const url = new URL("https://amesnomades.com/produit.html?id=p1");
  const t0 = Date.parse("2026-11-13T10:00:00Z");
  await metaForUrl(url, db.fetcher, t0);
  await metaForUrl(url, db.fetcher, t0 + 60_000);
  assertEquals(db.calls.length, 1);
  await metaForUrl(url, db.fetcher, t0 + 6 * 60_000);
  assertEquals(db.calls.length, 2);
});

// ─── Les fonctions telles que Netlify les appelle ──────────────────────────
function withFetch<T>(impl: (url: string) => Promise<Response>, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  globalThis.fetch = ((input: any) => impl(String(input?.url || input))) as typeof fetch;
  clearMemory();
  return run().finally(() => { globalThis.fetch = real; });
}
const staticPage = (name: string, extra: Record<string, string> = {}) => () =>
  Promise.resolve(new Response(page(name), { status: 200, headers: { "content-type": "text/html; charset=UTF-8", etag: '"abc"', "last-modified": "Mon, 01 Jan 2026 00:00:00 GMT", "x-frame-options": "DENY", ...extra } }));

Deno.test("fonction : la page séjour part avec les informations du séjour", async () => {
  const db = fakeDb({ stays: [STAY], stay_dates: [] });
  await withFetch(db.fetcher, async () => {
    const res = await seoHandler(new Request("https://amesnomades.com/sejour.html?slug=pilates-rando-cevennes"), { next: staticPage("sejour.html") });
    const html = await res.text();
    assertEquals(res.status, 200);
    assert(html.includes("<title id=\"pageTitle\">Pilates &amp; randonnée en Cévennes — Âmes Nomades</title>"));
    assertEquals([res.headers.get("etag"), res.headers.get("last-modified"), res.headers.get("content-length")], [null, null, null], "repères de cache du fichier retirés");
    assertEquals(res.headers.get("x-frame-options"), "DENY", "en-têtes de sécurité conservés");
    assert((res.headers.get("content-type") || "").includes("text/html"));
  });
});

Deno.test("fonction : base en panne, lente ou séjour inconnu → la page part telle quelle", async () => {
  const original = page("sejour.html");
  for (const [label, tables] of [["panne", {}], ["erreur 500", { stays: 500 }], ["inconnu", { stays: [] }]] as const) {
    await withFetch(fakeDb(tables as Record<string, unknown[] | number>).fetcher, async () => {
      const res = await seoHandler(new Request("https://amesnomades.com/sejour.html?slug=pilates-rando-cevennes"), { next: staticPage("sejour.html") });
      assertEquals(await res.text(), original, label);
      assertEquals(res.headers.get("etag"), '"abc"', label);
    });
  }
});

Deno.test("fonction : ne touche ni aux autres méthodes, ni aux réponses « inchangée », ni à ce qui n'est pas une page", async () => {
  const db = fakeDb({ stays: [STAY], stay_dates: [], products: [PRODUCT] });
  await withFetch(db.fetcher, async () => {
    const post = await seoHandler(new Request("https://amesnomades.com/produit.html?id=p1", { method: "POST" }), { next: () => Promise.resolve(new Response("x", { status: 405 })) });
    assertEquals(post.status, 405);
    const notModified = await seoHandler(new Request("https://amesnomades.com/produit.html?id=p1"), { next: () => Promise.resolve(new Response(null, { status: 304, headers: { etag: '"abc"' } })) });
    assertEquals([notModified.status, notModified.headers.get("etag")], [304, '"abc"']);
    const notFound = await seoHandler(new Request("https://amesnomades.com/produit.html?id=p1"), { next: () => Promise.resolve(new Response("<html><head></head>introuvable</html>", { status: 404, headers: { "content-type": "text/html" } })) });
    assertEquals([notFound.status, await notFound.text()], [404, "<html><head></head>introuvable</html>"]);
    const json = await seoHandler(new Request("https://amesnomades.com/produit.html?id=p1"), { next: () => Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) });
    assertEquals(await json.text(), "{}");
  });
});

Deno.test("plan du site : pages fixes, séjours publiés et produits, sans doublon", () => {
  const xml = buildSitemap(
    [{ slug: "pilates-rando-cevennes", published: true }, { slug: "brouillon", published: false }, { slug: "pilates-rando-cevennes", published: true }, { slug: null }],
    [{ id: "p1" }, { id: "a&b" }, {}],
  );
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1]);
  assertEquals(locs[0], "https://amesnomades.com/");
  assertEquals(locs[1], "https://amesnomades.com/sejour.html?slug=pilates-rando-cevennes", "les séjours juste après l'accueil");
  assert(locs.includes("https://amesnomades.com/boutique.html") && locs.includes("https://amesnomades.com/produit.html?id=p1"));
  assert(locs.includes("https://amesnomades.com/produit.html?id=a%26b"), "caractères spéciaux encodés");
  assert(!locs.some(l => l.includes("brouillon")), "séjour non publié absent");
  assertEquals(new Set(locs).size, locs.length, "aucun doublon");
  assertEquals(locs.length, STATIC_PAGES.length + 1 + 2);
  assert(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && xml.trimEnd().endsWith("</urlset>"));
  assert(!/&(?!amp;|lt;|gt;|quot;|#39;)/.test(xml), "aucun « & » nu dans le fichier");
  assert(!locs.some(l => /admin|panier|compte|merci|favoris|signup/.test(l)), "pages privées absentes");
});

Deno.test("plan du site : toutes les pages fixes annoncées existent vraiment", () => {
  for (const p of STATIC_PAGES) {
    const file = p.path === "/" ? "index.html" : p.path.slice(1);
    try { Deno.statSync(new URL(file, root)); } catch { throw new Error(`page annoncée mais absente : ${file}`); }
  }
});

Deno.test("fonction plan du site : à jour depuis la base, partiel si une lecture échoue, fichier de secours si tout échoue", async () => {
  const fallback = () => Promise.resolve(new Response("<urlset>secours</urlset>", { status: 200, headers: { "content-type": "application/xml" } }));
  await withFetch(fakeDb({ stays: [{ slug: "cevennes", published: true }], products: [{ id: "p1" }] }).fetcher, async () => {
    const res = await sitemapHandler(new Request("https://amesnomades.com/sitemap.xml"), { next: fallback });
    const xml = await res.text();
    assert(xml.includes("/sejour?slug=cevennes") && xml.includes("/produit?id=p1") && xml.includes("/guides</loc>") && !xml.includes(".html"), "adresses sans « .html »");
    assertEquals(res.headers.get("content-type"), "application/xml; charset=utf-8");
    assert(xml.includes("<!-- Plan généré automatiquement : 1 séjour(s) publié(s), 1 produit(s) -->"), "repère de génération");
    assert(xml.indexOf("<!--") > xml.indexOf("?>") && xml.indexOf("<!--") < xml.indexOf("<urlset"), "repère placé avant la liste");
  });
  await withFetch(fakeDb({ stays: [{ slug: "cevennes", published: true }] }).fetcher, async () => {
    const xml = await (await sitemapHandler(new Request("https://amesnomades.com/sitemap.xml"), { next: fallback })).text();
    assert(xml.includes("/sejour?slug=cevennes") && !xml.includes("/produit?id="), "séjours présents malgré l'échec des produits");
  });
  await withFetch(fakeDb({}).fetcher, async () => {
    const xml = await (await sitemapHandler(new Request("https://amesnomades.com/sitemap.xml"), { next: fallback })).text();
    assertEquals(xml, "<urlset>secours</urlset>");
  });
});

Deno.test("page de contrôle : dit si les fonctions tournent et si la base répond", async () => {
  await withFetch(fakeDb({ stays: [{ slug: "cevennes" }, { slug: "luberon" }], products: [{ id: "p1" }] }).fetcher, async () => {
    const res = await checkHandler(new Request("https://amesnomades.com/seo-check"));
    const text = await res.text();
    assert(text.includes("Fonctions Netlify : actives") && text.includes("Séjours publiés lus dans la base : 2") && text.includes("Produits lus dans la base : 1"), text);
    assertEquals([res.status, res.headers.get("x-robots-tag")], [200, "noindex"]);
  });
  await withFetch(fakeDb({ stays: 401 }).fetcher, async () => {
    const text = await (await checkHandler(new Request("https://amesnomades.com/seo-check"))).text();
    assert(text.includes("Fonctions Netlify : actives") && text.includes("Séjours publiés : lecture impossible (lecture stays : 401)") && text.includes("Produits : lecture impossible"), text);
  });
});

Deno.test("adresses sans « .html » quand l'hébergeur redirige /page.html vers /page", async () => {
  assertEquals(stayMeta(STAY, [], "2026-11-13", true).url, "https://amesnomades.com/sejour?slug=pilates-rando-cevennes");
  assertEquals(productMeta(PRODUCT, true).url, "https://amesnomades.com/produit?id=p1");
  assertEquals((productMeta(PRODUCT, true).jsonLd.offers as Record<string, string>).url, "https://amesnomades.com/produit?id=p1");
  const locs = [...buildSitemap([{ slug: "cevennes", published: true }], [{ id: "p1" }], STATIC_PAGES, true).matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1]);
  assert(!locs.some(l => l.includes(".html")), "aucune adresse en .html");
  assert(locs.includes("https://amesnomades.com/") && locs.includes("https://amesnomades.com/boutique") && locs.includes("https://amesnomades.com/sejour?slug=cevennes"));

  // La forme est déduite de l'adresse réellement servie
  const db = fakeDb({ stays: [STAY], stay_dates: [] });
  await withFetch(db.fetcher, async () => {
    const clean = await (await handlePage(new Request("https://amesnomades.com/sejour?slug=pilates-rando-cevennes"), staticPage("sejour.html"))).text();
    assertEquals(attr(head(clean), "pageCanonical", "href"), "https://amesnomades.com/sejour?slug=pilates-rando-cevennes");
    const html = await (await handlePage(new Request("https://amesnomades.com/sejour.html?slug=pilates-rando-cevennes"), staticPage("sejour.html"))).text();
    assertEquals(attr(head(html), "pageCanonical", "href"), "https://amesnomades.com/sejour.html?slug=pilates-rando-cevennes");
  });
});

Deno.test("Cloudflare Pages : séjour, redirection laissée intacte, plan du site, contrôle, panne", async () => {
  const db = fakeDb({ stays: [STAY], stay_dates: [], products: [PRODUCT] });
  await withFetch(db.fetcher, async () => {
    const env = {};
    const page1 = await pagesMiddleware({ request: new Request("https://amesnomades.com/sejour?slug=pilates-rando-cevennes"), env, next: staticPage("sejour.html") });
    assert((await page1.text()).includes('<title id="pageTitle">Pilates &amp; randonnée en Cévennes — Âmes Nomades</title>'));
    // /sejour.html est redirigé par l'hébergeur : la redirection passe telle quelle
    const redirect = await pagesMiddleware({ request: new Request("https://amesnomades.com/sejour.html?slug=pilates-rando-cevennes"), env, next: () => Promise.resolve(new Response(null, { status: 308, headers: { location: "/sejour?slug=pilates-rando-cevennes" } })) });
    assertEquals([redirect.status, redirect.headers.get("location")], [308, "/sejour?slug=pilates-rando-cevennes"]);
    const map = await (await pagesMiddleware({ request: new Request("https://amesnomades.com/sitemap.xml"), env, next: () => Promise.resolve(new Response("secours")) })).text();
    assert(map.includes("/sejour?slug=pilates-rando-cevennes") && map.includes("/produit?id=p1") && !map.includes(".html"));
    const check = await (await pagesMiddleware({ request: new Request("https://amesnomades.com/seo-check"), env, next: () => Promise.resolve(new Response("accueil")) })).text();
    assert(check.startsWith("Fonctions Cloudflare Pages : actives"), check);
    // Une autre adresse (si jamais elle arrivait jusqu'ici) n'est pas touchée
    assertEquals(await (await pagesMiddleware({ request: new Request("https://amesnomades.com/boutique"), env, next: () => Promise.resolve(new Response("boutique")) })).text(), "boutique");
  });
  // Base en panne : la page d'origine, et la suite de la chaîne n'est appelée qu'une fois
  await withFetch(fakeDb({}).fetcher, async () => {
    let calls = 0;
    const next = () => { calls++; return Promise.resolve(new Response(page("sejour.html"), { status: 200, headers: { "content-type": "text/html" } })); };
    const res = await pagesMiddleware({ request: new Request("https://amesnomades.com/sejour?slug=pilates-rando-cevennes"), env: {}, next });
    assertEquals([await res.text() === page("sejour.html"), calls], [true, 1]);
    const map = await pagesMiddleware({ request: new Request("https://amesnomades.com/sitemap.xml"), env: {}, next: () => Promise.resolve(new Response("secours")) });
    assertEquals(await map.text(), "secours");
  });
});
