// PDF des devis, factures et avoirs (pdfmake, généré dans le navigateur).
// buildDocDefinition() est une fonction pure : elle décrit le document à partir des données.
import { amountDue, computeTotals, dateFr, depositAmount, euro, KIND_LABEL, NATURE_LABEL, qtyLabel } from "./billing-calc.js?v=1";

const INK = "#1e1f22", MUTED = "#6c7078", LINE = "#e3dcc0", CREAM = "#faf5dc", ACCENT = "#cc6f53";
const PDFMAKE = "https://cdn.jsdelivr.net/npm/pdfmake@0.2.20/build/pdfmake.min.js";
const FONTS = "https://cdn.jsdelivr.net/npm/pdfmake@0.2.20/build/vfs_fonts.js";

const clean = v => String(v ?? "").trim();
const join = (...parts) => parts.map(clean).filter(Boolean);

function sellerLines(s) {
  return [
    ...join(`${clean(s.name)}${s.legal_form ? ` — ${clean(s.legal_form)}` : ""}`),
    ...join(s.address),
    ...join(`${clean(s.postal_code)} ${clean(s.city)}`.trim()),
    ...(clean(s.country) && clean(s.country).toLowerCase() !== "france" ? [clean(s.country)] : []),
    ...(s.siret ? [`SIRET : ${clean(s.siret)}`] : []),
    ...(s.vat_number ? [`N° TVA : ${clean(s.vat_number)}`] : []),
    ...join(s.email, s.phone),
  ];
}

function clientLines(c) {
  return [
    ...(c.contact ? [`À l'attention de ${clean(c.contact)}`] : []),
    ...join(c.address),
    ...join(`${clean(c.postal_code)} ${clean(c.city)}`.trim()),
    ...(clean(c.country) && clean(c.country).toLowerCase() !== "france" ? [clean(c.country)] : []),
    ...(c.siren ? [`SIREN : ${clean(c.siren)}`] : []),
    ...(c.vat_number ? [`N° TVA : ${clean(c.vat_number)}`] : []),
    ...join(c.email, c.phone),
  ];
}

/**
 * Décrit le PDF d'un document.
 * @param doc      ligne de billing_documents (brouillon ou validée)
 * @param settings réglages de l'entreprise (doc.seller les remplace une fois le document validé)
 * @param extra    { source: document d'origine (facture d'un avoir, devis d'une facture) }
 */
export function buildDocDefinition(doc, settings = {}, extra = {}) {
  const s = { ...(settings || {}), ...(doc.seller || {}) };
  const c = doc.client || {};
  const kind = doc.kind;
  const draft = doc.status === "brouillon";
  const franchise = doc.vat_mode !== "assujetti";
  const totals = computeTotals(doc.lines, doc.vat_mode);
  const title = { devis: "DEVIS", facture: "FACTURE", avoir: "AVOIR" }[kind];
  const number = doc.number || "Brouillon (non numéroté)";

  // ── En-tête : entreprise à gauche, titre et références à droite ──
  const refs = [
    ["Numéro", number],
    ["Date d'émission", doc.issue_date ? dateFr(doc.issue_date) : "à la validation"],
    ...(kind === "devis" && doc.due_date ? [["Valable jusqu'au", dateFr(doc.due_date)]] : []),
    ...(kind === "facture" && doc.due_date ? [["Échéance", dateFr(doc.due_date)]] : []),
    ...(doc.service_date ? [[kind === "devis" ? "Prestation prévue" : "Date de la prestation", clean(doc.service_date)]] : []),
    ...(kind === "avoir" && extra.source ? [["Sur la facture", `${extra.source.number || ""}${extra.source.issue_date ? ` du ${dateFr(extra.source.issue_date)}` : ""}`]] : []),
    ...(kind === "facture" && extra.source?.kind === "devis" && extra.source.number ? [["Devis", extra.source.number]] : []),
  ];
  const header = {
    columns: [
      {
        width: "*",
        stack: [
          { text: "ÂMES NOMADES", fontSize: 15, characterSpacing: 3.5, bold: false, margin: [0, 0, 0, 6] },
          ...(s.trade_name && s.trade_name !== "Âmes Nomades" ? [{ text: clean(s.trade_name), fontSize: 9.5, bold: true }] : []),
          { text: sellerLines(s).join("\n"), fontSize: 8.5, color: MUTED, lineHeight: 1.25 },
        ],
      },
      {
        width: 210,
        stack: [
          { text: title, fontSize: 22, color: ACCENT, characterSpacing: 2, alignment: "right" },
          {
            margin: [0, 8, 0, 0],
            table: { widths: ["*", "auto"], body: refs.map(([k, v]) => [{ text: k, color: MUTED, fontSize: 8.5 }, { text: v, fontSize: 8.5, bold: k === "Numéro", alignment: "right" }]) },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 1.5, paddingBottom: () => 1.5, paddingLeft: () => 0, paddingRight: () => 0 },
          },
        ],
      },
    ],
  };

  // ── Client ──
  const clientBox = {
    margin: [0, 22, 0, 0],
    columns: [
      { width: "*", text: "" },
      {
        width: 250,
        table: {
          widths: ["*"],
          body: [[{
            stack: [
              { text: { devis: "DEVIS ÉTABLI POUR", facture: "FACTURÉ À", avoir: "AVOIR ÉTABLI POUR" }[kind], fontSize: 7.5, characterSpacing: 1.2, color: MUTED, margin: [0, 0, 0, 3] },
              { text: clean(c.name) || "—", bold: true, fontSize: 10.5 },
              { text: clientLines(c).join("\n"), fontSize: 9, lineHeight: 1.25, color: INK },
            ],
            margin: [8, 7, 8, 7],
          }]],
        },
        layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.8, vLineWidth: () => 0.8, fillColor: () => "#fffdf3" },
      },
    ],
  };

  // ── Lignes ──
  const headCell = text => ({ text, fontSize: 7.5, bold: true, color: MUTED, characterSpacing: 0.6, fillColor: CREAM, margin: [0, 3, 0, 3] });
  const priceHead = franchise ? "PRIX UNITAIRE" : "PRIX UNIT. HT";
  const totalHead = franchise ? "MONTANT" : "TOTAL HT";
  const head = [headCell("DÉSIGNATION"), { ...headCell("QTÉ"), alignment: "right" }, headCell("UNITÉ"), { ...headCell(priceHead), alignment: "right" },
    ...(franchise ? [] : [{ ...headCell("TVA"), alignment: "right" }]), { ...headCell(totalHead), alignment: "right" }];
  const body = (Array.isArray(doc.lines) ? doc.lines : []).map(l => {
    const lineTotal = computeTotals([{ ...l, vat_rate: 0 }], "franchise").ht;
    return [
      { text: clean(l.description) || "—", fontSize: 9, margin: [0, 3, 0, 3] },
      { text: qtyLabel(l.quantity), fontSize: 9, alignment: "right", margin: [0, 3, 0, 3] },
      { text: clean(l.unit), fontSize: 9, color: MUTED, margin: [0, 3, 0, 3] },
      { text: euro(l.unit_price), fontSize: 9, alignment: "right", margin: [0, 3, 0, 3] },
      ...(franchise ? [] : [{ text: `${qtyLabel(l.vat_rate)} %`, fontSize: 9, alignment: "right", margin: [0, 3, 0, 3] }]),
      { text: euro(lineTotal), fontSize: 9, alignment: "right", margin: [0, 3, 0, 3] },
    ];
  });
  const linesTable = {
    margin: [0, 24, 0, 0],
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: franchise ? ["*", 40, 52, 72, 72] : ["*", 34, 46, 66, 36, 66],
      body: [head, ...body],
    },
    layout: {
      hLineWidth: (i, node) => (i === 1 || i === node.table.body.length ? 0.8 : 0.4),
      vLineWidth: () => 0,
      hLineColor: (i) => (i === 1 ? INK : LINE),
      paddingLeft: (i) => (i === 0 ? 4 : 6), paddingRight: () => 4,
    },
  };

  // ── Totaux ──
  const tot = [];
  const bigRows = new Set(); // un filet au-dessus des montants principaux
  const row = (label, value, opts = {}) => {
    if (opts.big) bigRows.add(tot.length);
    tot.push([{ text: label, fontSize: opts.big ? 10.5 : 9, bold: !!opts.big, color: opts.muted ? MUTED : INK }, { text: value, fontSize: opts.big ? 10.5 : 9, bold: !!opts.big, alignment: "right" }]);
  };
  if (franchise) {
    row(kind === "avoir" ? "Montant de l'avoir" : "Total", euro(totals.ttc), { big: true });
  } else {
    row("Total HT", euro(totals.ht));
    for (const r of totals.byRate) row(`TVA ${qtyLabel(r.rate)} % (sur ${euro(r.ht)})`, euro(r.tva), { muted: true });
    row(kind === "avoir" ? "Montant de l'avoir TTC" : "Total TTC", euro(totals.ttc), { big: true });
  }
  if (kind === "devis" && Number(doc.deposit_percent) > 0) {
    row(`Acompte à la commande (${qtyLabel(doc.deposit_percent)} %)`, euro(depositAmount(totals.ttc, doc.deposit_percent)));
  }
  if (kind === "facture" && Number(doc.already_paid) > 0) {
    row("Acompte déjà versé", `− ${euro(doc.already_paid)}`);
    row("Reste à payer", euro(amountDue(totals.ttc, doc.already_paid)), { big: true });
  }
  const totalsBlock = {
    margin: [0, 10, 0, 0],
    columns: [
      { width: "*", stack: franchise ? [{ text: "TVA non applicable, art. 293 B du CGI", fontSize: 8.5, italics: true, color: MUTED, margin: [0, 4, 0, 0] }] : [] },
      {
        width: 230,
        table: { widths: ["*", "auto"], body: tot },
        layout: {
          hLineWidth: (i) => (bigRows.has(i) && i > 0 ? 0.8 : 0),
          vLineWidth: () => 0, hLineColor: () => INK, paddingTop: () => 2.5, paddingBottom: () => 2.5,
        },
      },
    ],
  };

  // ── Paiement, conditions, notes ──
  const blocks = [];
  const para = (label, text) => blocks.push({ text: [{ text: `${label} `, bold: true }, clean(text)], fontSize: 8.5, margin: [0, 0, 0, 4], lineHeight: 1.2 });
  blocks.push({ text: `Nature de l'opération : ${NATURE_LABEL[doc.nature] || NATURE_LABEL.services}`, fontSize: 8.5, color: MUTED, margin: [0, 0, 0, 6] });
  if (kind === "facture") {
    if (doc.status === "payee") para("Réglée le", `${dateFr(doc.paid_at)}${doc.payment_method ? ` (${clean(doc.payment_method)})` : ""}.`);
    else {
      para("Paiement :", `${doc.due_date ? `à régler au plus tard le ${dateFr(doc.due_date)}` : "à réception"}${s.payment_methods ? ` — ${clean(s.payment_methods)}` : ""}.`);
      if (s.iban) para("Coordonnées bancaires :", `IBAN ${clean(s.iban)}${s.bic ? ` — BIC ${clean(s.bic)}` : ""}${s.name ? ` — titulaire ${clean(s.name)}` : ""}`);
    }
  }
  if (kind === "devis") {
    para("Validité :", doc.due_date ? `ce devis est valable jusqu'au ${dateFr(doc.due_date)}.` : "ce devis est valable 30 jours.");
    if (Number(doc.deposit_percent) > 0) para("Acompte :", `${qtyLabel(doc.deposit_percent)} % du montant à la signature, soit ${euro(depositAmount(totals.ttc, doc.deposit_percent))}.`);
  }
  if (clean(doc.terms)) para("Conditions :", doc.terms);
  if (clean(doc.notes)) blocks.push({ text: clean(doc.notes), fontSize: 9, margin: [0, 4, 0, 4], lineHeight: 1.25 });

  const legal = [];
  if (kind === "facture") {
    legal.push("En cas de retard de paiement, des pénalités égales à trois fois le taux d'intérêt légal sont exigibles (art. L441-10 du Code de commerce). Pour les clients professionnels, une indemnité forfaitaire de 40 € pour frais de recouvrement est également due. Pas d'escompte pour paiement anticipé.");
  }
  if (clean(s.extra_mentions)) legal.push(clean(s.extra_mentions));

  const signature = kind === "devis" ? {
    margin: [0, 14, 0, 0],
    columns: [
      { width: "*", text: "" },
      {
        width: 250,
        table: { widths: ["*"], heights: [70], body: [[{ stack: [
          { text: "BON POUR ACCORD", fontSize: 7.5, characterSpacing: 1.2, color: MUTED },
          { text: "Date, nom et signature, précédés de la mention manuscrite « Bon pour accord »", fontSize: 7.5, color: MUTED, margin: [0, 2, 0, 0] },
        ], margin: [6, 5, 6, 5] }]] },
        layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.8, vLineWidth: () => 0.8 },
      },
    ],
    unbreakable: true,
  } : null;

  const footerText = join(`${clean(s.name)}${s.legal_form ? ` — ${clean(s.legal_form)}` : ""}`, s.siret ? `SIRET ${clean(s.siret)}` : "", s.website).join(" · ");

  return {
    pageSize: "A4",
    pageMargins: [42, 40, 42, 52],
    info: { title: `${KIND_LABEL[kind]} ${doc.number || "brouillon"} — Âmes Nomades`, author: clean(s.name) || "Âmes Nomades", subject: `${KIND_LABEL[kind]} ${clean(c.name)}` },
    defaultStyle: { font: "Roboto", fontSize: 9, color: INK },
    ...(draft ? { watermark: { text: "BROUILLON", color: ACCENT, opacity: 0.08, bold: true, angle: -40 } } : {}),
    content: [
      header,
      clientBox,
      linesTable,
      totalsBlock,
      { margin: [0, 18, 0, 0], stack: blocks },
      ...(signature ? [signature] : []),
      ...(legal.length ? [{ margin: [0, 16, 0, 0], text: legal.join("\n"), fontSize: 7.2, color: MUTED, lineHeight: 1.25 }] : []),
    ],
    footer: (page, pages) => ({
      margin: [42, 14, 42, 0],
      columns: [
        { text: footerText, fontSize: 7, color: MUTED },
        { text: `${doc.number || "Brouillon"} · page ${page}/${pages}`, fontSize: 7, color: MUTED, alignment: "right", width: 130 },
      ],
    }),
  };
}

/** Nom du fichier PDF : « facture-F-2026-0001-studio-zen.pdf ». */
export function pdfFileName(doc) {
  const who = (clean(doc.client?.name) || "client").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${doc.kind}-${doc.number || "brouillon"}-${who}.pdf`;
}

// ── Chargement de pdfmake, seulement au premier PDF ──
let loading = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src; el.async = true; el.crossOrigin = "anonymous";
    el.onload = resolve; el.onerror = () => reject(new Error("Le module PDF n'a pas pu être chargé. Vérifiez la connexion puis réessayez."));
    document.head.appendChild(el);
  });
}
export function loadPdfMake() {
  if (window.pdfMake?.vfs) return Promise.resolve(window.pdfMake);
  loading ??= loadScript(PDFMAKE).then(() => loadScript(FONTS)).then(() => window.pdfMake).catch(e => { loading = null; throw e; });
  return loading;
}

/** Télécharge le PDF. */
export async function downloadPdf(doc, settings, extra) {
  const pdfMake = await loadPdfMake();
  pdfMake.createPdf(buildDocDefinition(doc, settings, extra)).download(pdfFileName(doc));
}

/** Ouvre le PDF dans un nouvel onglet (aperçu). */
export async function openPdf(doc, settings, extra) {
  const pdfMake = await loadPdfMake();
  pdfMake.createPdf(buildDocDefinition(doc, settings, extra)).open();
}

/** PDF en base64, pour l'envoi par email. */
export async function pdfBase64(doc, settings, extra) {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve, reject) => {
    try { pdfMake.createPdf(buildDocDefinition(doc, settings, extra)).getBase64(resolve); } catch (e) { reject(e); }
  });
}
