// Tests de l'envoi des achats à Meta depuis le serveur (Conversions API).
// Lancer : deno test supabase/functions/tests/
import { buildPurchaseEvent, cleanFbCookie, clientIpFrom, normalize, sendMetaPurchase, sha256Hex } from "../_shared/meta.ts";

function assert(cond: unknown, msg = "condition fausse"): asserts cond { if (!cond) throw new Error(msg); }
function assertEquals(a: unknown, b: unknown, msg = "") { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  obtenu  : ${JSON.stringify(a)}\n  attendu : ${JSON.stringify(b)}`); }

const PURCHASE = {
  eventId: "cs_test_a1B2", orderId: "cs_test_a1B2", eventTime: 1763300000, value: 86.9,
  email: "  Marie.Dupont@Exemple.FR ", phone: "06 12 34 56 78", name: "Marie-Hélène Dupont",
  city: "Saint-Jean-du-Gard", zip: "30 270", country: "FR", externalId: "user-42",
  ip: "203.0.113.7", userAgent: "Mozilla/5.0 (iPhone)", fbp: "fb.1.1763299000000.123456789", fbc: "fb.1.1763299000000.IwAR0abc",
  items: [{ id: "p1", qty: 1, price: 55 }, { id: "p2", qty: 2, price: 12 }],
};

Deno.test("normalisation des données avant chiffrement (règles de Meta)", () => {
  assertEquals(normalize.email("  Marie.Dupont@Exemple.FR "), "marie.dupont@exemple.fr");
  assertEquals(normalize.phone("06 12 34 56 78"), "33612345678", "numéro français");
  assertEquals(normalize.phone("+33 6 12 34 56 78"), "33612345678", "avec +33");
  assertEquals(normalize.phone("0033612345678"), "33612345678", "avec 0033");
  assertEquals(normalize.phone("+32 470 12 34 56", "BE"), "32470123456", "numéro belge");
  assertEquals(normalize.name("Hélène"), "helene");
  assertEquals(normalize.city("Saint-Jean-du-Gard"), "saintjeandugard");
  assertEquals(normalize.zip("30 270"), "30270");
  assertEquals(normalize.country("FR"), "fr");
});

Deno.test("chiffrement SHA-256 identique à la référence", async () => {
  // SHA-256 de « marie.dupont@exemple.fr », calculé indépendamment
  const expected = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("marie.dupont@exemple.fr")))).map(b => b.toString(16).padStart(2, "0")).join("");
  assertEquals(await sha256Hex("marie.dupont@exemple.fr"), expected);
  assertEquals((await sha256Hex("")).length, 64);
});

Deno.test("événement Achat : identifiant commun avec le pixel, montant, articles, données chiffrées", async () => {
  const ev = await buildPurchaseEvent(PURCHASE);
  assertEquals([ev.event_name, ev.event_id, ev.event_time, ev.action_source], ["Purchase", "cs_test_a1B2", 1763300000, "website"]);
  assertEquals(ev.custom_data, {
    currency: "EUR", value: 86.9, order_id: "cs_test_a1B2",
    contents: [{ id: "p1", quantity: 1, item_price: 55 }, { id: "p2", quantity: 2, item_price: 12 }],
    content_ids: ["p1", "p2"], content_type: "product", num_items: 3,
  });
  const u = ev.user_data as Record<string, unknown>;
  assertEquals(u.em, [await sha256Hex("marie.dupont@exemple.fr")]);
  assertEquals(u.ph, [await sha256Hex("33612345678")]);
  assertEquals(u.fn, [await sha256Hex("mariehelene")], "prénom composé, sans accent ni tiret");
  assertEquals(u.ln, [await sha256Hex("dupont")]);
  assertEquals(u.ct, [await sha256Hex("saintjeandugard")]);
  assertEquals(u.zp, [await sha256Hex("30270")]);
  assertEquals(u.country, [await sha256Hex("fr")]);
  assertEquals(u.external_id, [await sha256Hex("user-42")]);
  // Non chiffrés, comme l'exige Meta
  assertEquals([u.client_ip_address, u.client_user_agent, u.fbp, u.fbc], [PURCHASE.ip, PURCHASE.userAgent, PURCHASE.fbp, PURCHASE.fbc]);
  // Aucune donnée personnelle en clair
  const raw = JSON.stringify(ev);
  for (const clear of ["marie", "dupont", "0612", "33612345678", "30270", "Saint-Jean"]) assert(!raw.toLowerCase().includes(clear.toLowerCase()), `« ${clear} » ne doit pas apparaître en clair`);
});

Deno.test("champs absents : rien n'est inventé", async () => {
  const ev = await buildPurchaseEvent({ eventId: "AN-1", orderId: "AN-1", eventTime: 1763300000.7, value: 0 });
  const u = ev.user_data as Record<string, unknown>;
  assertEquals(Object.keys(u), ["country"], "seul le pays par défaut (France)");
  assertEquals(ev.event_time, 1763300000);
  assert(!("contents" in ev.custom_data));
  assertEquals(ev.custom_data.value, 0);
});

Deno.test("cookies du pixel et adresse IP : valeurs propres seulement", () => {
  assertEquals(cleanFbCookie("fb.1.1763299000000.123456789"), "fb.1.1763299000000.123456789");
  assertEquals(cleanFbCookie("fb.1.1763299000000.IwAR0abc-_x"), "fb.1.1763299000000.IwAR0abc-_x");
  assertEquals(cleanFbCookie("<script>"), "");
  assertEquals(cleanFbCookie(undefined), "");
  assertEquals(clientIpFrom(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assertEquals(clientIpFrom(new Headers({ "cf-connecting-ip": "198.51.100.2", "x-forwarded-for": "10.0.0.1" })), "198.51.100.2");
});

Deno.test("envoi : adresse, jeton, code de test, et jamais d'erreur levée", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const ok = (url: string, init?: RequestInit) => { calls.push({ url, body: JSON.parse(String(init?.body)) }); return Promise.resolve(new Response('{"events_received":1}', { status: 200 })); };
  const logs: string[] = [];
  let r = await sendMetaPurchase(PURCHASE, { token: "JETON", pixelId: "123", version: "v26.0", testCode: "TEST4242", fetcher: ok, log: m => logs.push(m) });
  assertEquals(r, { sent: true, status: 200 });
  assertEquals(calls[0].url, "https://graph.facebook.com/v26.0/123/events?access_token=JETON");
  assertEquals(calls[0].body.test_event_code, "TEST4242");
  assertEquals((calls[0].body.data as unknown[]).length, 1);
  assert(!logs.join(" ").includes("JETON"), "le jeton n'apparaît jamais dans les journaux");

  r = await sendMetaPurchase(PURCHASE, { token: "", fetcher: ok, log: m => logs.push(m) });
  assertEquals(r, { sent: false, skipped: "no_token" });
  assertEquals(calls.length, 1, "sans jeton : aucun appel");

  const refused = () => Promise.resolve(new Response('{"error":{"message":"Invalid OAuth access token"}}', { status: 400 }));
  r = await sendMetaPurchase(PURCHASE, { token: "MAUVAIS", fetcher: refused, log: m => logs.push(m) });
  assertEquals([r.sent, r.status], [false, 400]);
  assert(!logs.join(" ").includes("MAUVAIS"));

  const down = () => Promise.reject(new Error("réseau coupé"));
  r = await sendMetaPurchase(PURCHASE, { token: "JETON", fetcher: down, log: m => logs.push(m) });
  assertEquals([r.sent, r.error], [false, "réseau coupé"]);
});
