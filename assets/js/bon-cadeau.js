// Page « Offrir un bon cadeau » : choix du montant et du destinataire, puis ajout au panier.
// Le paiement, la création du code et l'envoi de la carte se font ensuite (panier → Stripe → webhook).
import { addToCart } from "/assets/js/cart.js?v=3";

const GIFT_MIN = 20, GIFT_MAX = 500;

const radios = Array.from(document.querySelectorAll('input[name="amount"]'));
const amountCustom = document.getElementById("amountCustom");
const fromName = document.getElementById("fromName");
const toName = document.getElementById("toName");
const toEmail = document.getElementById("toEmail");
const message = document.getElementById("message");
const rAmount = document.getElementById("rAmount");
const rFrom = document.getElementById("rFrom");
const rTo = document.getElementById("rTo");
const rEmail = document.getElementById("rEmail");
const rMessage = document.getElementById("rMessage");
const btnPay = document.getElementById("btnPayGift");
const gcMsg = document.getElementById("gcMsg");

const euro = n => `${Number(n)} €`;
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

function setText(el, value, fallback = "—") {
  if (!el) return;
  const v = (value ?? "").toString().trim();
  el.textContent = v ? v : fallback;
}
function setError(txt) {
  gcMsg.textContent = txt || "";
  gcMsg.style.color = txt ? "#8b2e2e" : "var(--muted)";
}
function getAmount() {
  const raw = (amountCustom.value || "").trim();
  if (raw !== "") { const n = Math.round(Number(raw)); return Number.isFinite(n) ? n : null; }
  const r = radios.find(x => x.checked);
  return r ? Number(r.value) : null;
}
function updateRecap() {
  const amount = getAmount();
  setText(rAmount, amount && amount >= GIFT_MIN && amount <= GIFT_MAX ? euro(amount) : "", "—");
  setText(rFrom, fromName.value);
  setText(rTo, toName.value);
  setText(rEmail, toEmail.value, "— (envoyé à ton adresse)");
  setText(rMessage, message.value, "—");
}

radios.forEach(r => r.addEventListener("change", () => { if (amountCustom.value) amountCustom.value = ""; updateRecap(); }));
amountCustom.addEventListener("input", () => { if (amountCustom.value) radios.forEach(r => r.checked = false); updateRecap(); });
[fromName, toName, toEmail, message].forEach(el => el.addEventListener("input", updateRecap));
updateRecap();

btnPay.addEventListener("click", () => {
  setError("");
  const amount = getAmount();
  if (!amount) return setError("Choisis un montant, ou saisis un montant personnalisé.");
  if (amount < GIFT_MIN || amount > GIFT_MAX) return setError(`Le montant doit être compris entre ${GIFT_MIN} € et ${GIFT_MAX} €.`);
  const email = toEmail.value.trim();
  if (email && !isEmail(email)) return setError("L'email du destinataire ne semble pas valide.");
  if (message.value.length > 160) return setError("Le message est limité à 160 caractères.");

  addToCart({
    type: "gift_card",
    id: `gift-${Date.now()}`,
    name: `Bon cadeau ${amount} €`,
    price: amount,
    quantity: 1,
    maxStock: 1,
    image: "/assets/img/gift-card.svg",
    gift: { from: fromName.value.trim(), to: toName.value.trim(), email, msg: message.value.trim() },
  });
  if (window.MetaPixel) window.MetaPixel.trackAddToCart("Bon cadeau", "gift_card", amount);
  btnPay.classList.add("btn-loading");
  window.location.href = "/panier.html";
});
