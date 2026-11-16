// Calculs des devis et factures : mêmes règles que la base (fonction billing_totals),
// en nombres entiers pour éviter les erreurs d'arrondi des nombres à virgule.
//   • montant HT d'une ligne = quantité × prix unitaire, arrondi au centime ;
//   • TVA calculée par taux, sur le total HT de ce taux, arrondie au centime ;
//   • arrondi « au plus proche, la moitié en s'éloignant de zéro » (comme Postgres).

/** Division entière arrondie au plus proche, la moitié en s'éloignant de zéro. */
function divRound(n, d) {
  const sign = (n < 0) !== (d < 0) ? -1 : 1;
  const a = Math.abs(n), b = Math.abs(d);
  const q = Math.floor(a / b), r = a - q * b;
  return sign * (r * 2 >= b ? q + 1 : q);
}

/** Arrondit un nombre à `decimals` décimales en entier (ex. 19.99 → 1999 pour 2 décimales). */
export function toUnits(value, decimals) {
  const n = Number(String(value ?? "").replace(",", ".").replace(/\s/g, ""));
  if (!Number.isFinite(n)) return 0;
  // Passage par la chaîne : 1.005 reste 1.005 et ne devient pas 1.00499999…
  const [int, frac = ""] = Math.abs(n).toFixed(decimals + 2).split(".");
  const scaled = Number(int) * 10 ** decimals + Number(frac.slice(0, decimals) || 0);
  const rest = Number(frac.slice(decimals) || 0);
  const rounded = scaled + (rest >= 50 ? 1 : 0);
  return n < 0 ? -rounded : rounded;
}

/** Montant HT d'une ligne, en centimes. */
export function lineCents(line) {
  const qtyMilli = toUnits(line?.quantity, 3);
  const priceCents = toUnits(line?.unit_price, 2);
  return divRound(qtyMilli * priceCents, 1000);
}

/**
 * Totaux d'un document, en euros.
 * @returns {{ ht: number, tva: number, ttc: number, byRate: { rate: number, ht: number, tva: number }[] }}
 */
export function computeTotals(lines, vatMode) {
  const groups = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    const rate = vatMode === "assujetti" ? toUnits(line?.vat_rate, 2) : 0; // en centièmes de %
    groups.set(rate, (groups.get(rate) || 0) + lineCents(line));
  }
  let ht = 0, tva = 0;
  const byRate = [];
  for (const [rate, base] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
    const vat = divRound(base * rate, 10000);
    ht += base; tva += vat;
    byRate.push({ rate: rate / 100, ht: base / 100, tva: vat / 100 });
  }
  return { ht: ht / 100, tva: tva / 100, ttc: (ht + tva) / 100, byRate };
}

/** Montant de l'acompte demandé sur un devis (arrondi au centime). */
export function depositAmount(totalTtc, percent) {
  return divRound(toUnits(totalTtc, 2) * toUnits(percent, 2), 10000) / 100;
}

/** Reste à payer sur une facture. */
export function amountDue(totalTtc, alreadyPaid) {
  return (toUnits(totalTtc, 2) - toUnits(alreadyPaid, 2)) / 100;
}

/** « 1 234,50 € » avec des espaces ordinaires (lisibles partout, PDF compris). */
export function euro(value) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number(value) || 0).replace(/[  ]/g, " ");
}

/** Quantité lisible : 2, 1,5, 0,25. */
export function qtyLabel(value) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(Number(String(value ?? "").replace(",", ".")) || 0).replace(/[  ]/g, " ");
}

/** Date « AAAA-MM-JJ » → « 13/11/2026 ». */
export function dateFr(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : "";
}

/** Date du jour à Paris, « AAAA-MM-JJ ». */
export function todayParis(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Ajoute des jours à une date « AAAA-MM-JJ ». */
export function addDays(iso, days) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
  return t.toISOString().slice(0, 10);
}

export const KIND_LABEL = { devis: "Devis", facture: "Facture", avoir: "Avoir" };
export const NATURE_LABEL = { services: "Prestation de services", biens: "Vente de biens", mixte: "Prestation de services et vente de biens" };

/** Libellé du statut, selon le type de document. */
export function statusLabel(kind, status) {
  if (status === "brouillon") return "Brouillon";
  if (kind === "devis") return { emis: "Validé", accepte: "Accepté", refuse: "Refusé" }[status] || status;
  if (kind === "facture") return { emis: "À payer", payee: "Payée", annulee: "Annulée (avoir)" }[status] || status;
  return { emis: "Émis" }[status] || status;
}
