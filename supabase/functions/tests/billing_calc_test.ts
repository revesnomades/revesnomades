// Tests des calculs des devis et factures (mêmes règles que la base : billing_totals).
// Lancer : deno test supabase/functions/tests/
import { addDays, amountDue, computeTotals, depositAmount, euro, lineCents, statusLabel, toUnits } from "../../../assets/js/billing-calc.js";

function assertEquals(a: unknown, b: unknown, msg = "") { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  obtenu  : ${JSON.stringify(a)}\n  attendu : ${JSON.stringify(b)}`); }

Deno.test("arrondis exacts, la moitié s'éloignant de zéro (comme la base)", () => {
  assertEquals(toUnits(1.005, 2), 101, "1,005 → 1,01 (et non 1,00 à cause des nombres à virgule)");
  assertEquals(toUnits(2.675, 2), 268);
  assertEquals(toUnits(-0.005, 2), -1);
  assertEquals(toUnits("19,99", 2), 1999, "virgule acceptée");
  assertEquals(toUnits("abc", 2), 0);
  assertEquals(lineCents({ quantity: 3, unit_price: 19.99 }), 5997);
  assertEquals(lineCents({ quantity: 0.333, unit_price: 0.335 }), 11, "0,333 × 0,34 = 0,11322 → 0,11");
  assertEquals(lineCents({ quantity: 1.5, unit_price: -15 }), -2250);
});

Deno.test("franchise de TVA : aucun montant de TVA, total = total HT", () => {
  const t = computeTotals([{ quantity: 12, unit_price: 395, vat_rate: 20 }, { quantity: 1, unit_price: -240, vat_rate: 20 }], "franchise");
  assertEquals([t.ht, t.tva, t.ttc], [4500, 0, 4500]);
});

Deno.test("TVA calculée par taux sur le total HT du taux", () => {
  const t = computeTotals([
    { quantity: 3, unit_price: 83.33, vat_rate: 20 },
    { quantity: 1, unit_price: 12.5, vat_rate: 5.5 },
    { quantity: 2, unit_price: 0.05, vat_rate: 20 },
  ], "assujetti");
  assertEquals(t, { ht: 262.59, tva: 50.71, ttc: 313.3, byRate: [{ rate: 20, ht: 250.09, tva: 50.02 }, { rate: 5.5, ht: 12.5, tva: 0.69 }] });
});

Deno.test("acompte, reste à payer, dates, libellés", () => {
  assertEquals(depositAmount(5180, 30), 1554);
  assertEquals(depositAmount(99.99, 33.33), 33.33);
  assertEquals(amountDue(5180, 1500), 3680);
  assertEquals(addDays("2026-12-31", 30), "2027-01-30");
  assertEquals(addDays("2028-02-28", 1), "2028-02-29", "année bissextile");
  assertEquals(euro(1234.5), "1 234,50 €");
  assertEquals([statusLabel("facture", "emis"), statusLabel("devis", "emis"), statusLabel("facture", "annulee")], ["À payer", "Validé", "Annulée (avoir)"]);
});
