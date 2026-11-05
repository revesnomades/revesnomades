// Aperçu de la carte cadeau : la vraie carte (image) avec les valeurs posées dans les cadres.
// Utilisé sur la page bon cadeau (aperçu en direct) et dans le panier (vignette + agrandissement).
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Date de validité : 12 mois après aujourd'hui (la date définitive est fixée au paiement)
export function giftValidityLabel(from = new Date()) {
  const d = new Date(from); d.setMonth(d.getMonth() + 12);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export function giftCardPreviewHtml(v = {}, extraClass = "") {
  const amount = Number(v.amount) || 0;
  return `<div class="gift-visual ${extraClass}" role="img" aria-label="Bon cadeau Âmes Nomades${amount ? ` de ${amount} €` : ""}${v.from ? `, de la part de ${esc(v.from)}` : ""}">
    <img src="/assets/img/bon-cadeau-vierge.jpg" alt="" draggable="false">
    <span class="gift-visual-v gift-visual-from">${esc(v.from || "Âmes Nomades")}</span>
    <span class="gift-visual-v gift-visual-amount">${amount ? `${amount} €` : "—"}</span>
    <span class="gift-visual-v gift-visual-until">${esc(v.until || giftValidityLabel())}</span>
    <span class="gift-visual-box"></span>
    <span class="gift-visual-label">Code :</span>
    <span class="gift-visual-v gift-visual-code">${esc(v.code || "CADEAU-••••-••••")}</span>
  </div>`;
}

// Agrandissement plein écran, fermé par clic, bouton ou Échap
export function openGiftCardLightbox(v = {}) {
  document.getElementById("giftLightbox")?.remove();
  const box = document.createElement("div");
  box.id = "giftLightbox";
  box.className = "gift-lightbox";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Aperçu de la carte cadeau");
  box.innerHTML = `
    <button type="button" class="gift-lightbox-close" aria-label="Fermer l'aperçu">×</button>
    <div class="gift-lightbox-inner">
      ${giftCardPreviewHtml(v, "gift-visual--large")}
      <p class="gift-lightbox-note">Le code définitif est inscrit sur la carte envoyée par email après le paiement.</p>
    </div>`;
  const previous = document.activeElement;
  const close = () => { box.remove(); document.removeEventListener("keydown", onKey); previous?.focus?.(); };
  const onKey = e => { if (e.key === "Escape") close(); };
  box.addEventListener("click", e => { if (e.target === box || e.target.closest(".gift-lightbox-close")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(box);
  box.querySelector(".gift-lightbox-close").focus();
}
