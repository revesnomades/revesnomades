(() => {
  // ✅ Mets ici TES 5 Payment Links Stripe
  const STRIPE_LINKS = {
  "50":  "https://buy.stripe.com/test_00wdR3ddf6801tjgjG0ZW05",
  "100": "https://buy.stripe.com/test_cNi00d3CFaog5Jz8Re0ZW04",
  "150": "https://buy.stripe.com/test_9B67sF8WZ9kcb3T2sQ0ZW03",
  "200": "https://buy.stripe.com/test_8x26oB5KNcwo1tj3wU0ZW02",
  "custom": "https://buy.stripe.com/test_5kQeV7flneEw7RH6J60ZW07"
};


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

  const euro = (n) => `${Number(n).toFixed(0)} €`;

  function setText(el, value, fallback = "—") {
    if (!el) return;
    const v = (value ?? "").toString().trim();
    el.textContent = v ? v : fallback;
  }

  function setError(txt) {
    gcMsg.textContent = txt || "";
    gcMsg.style.color = txt ? "#8b2e2e" : "var(--muted)";
  }

  function selectedRadioAmount() {
    const r = radios.find(x => x.checked);
    return r ? Number(r.value) : null;
  }

  function getAmount() {
    const raw = (amountCustom.value || "").trim();
    const custom = Number(raw);
    if (raw !== "" && !Number.isNaN(custom) && custom > 0) return custom;
    return selectedRadioAmount();
  }

  function isCustomMode() {
    const raw = (amountCustom.value || "").trim();
    return raw !== "";
  }

  function updateRecap() {
    const amount = getAmount();
    if (amount && amount >= 10) setText(rAmount, euro(amount));
    else setText(rAmount, "—");

    setText(rFrom, fromName.value);
    setText(rTo, toName.value);
    setText(rEmail, toEmail.value);
    setText(rMessage, message.value, "—");
  }

  // radios -> si radio coché on efface custom
  radios.forEach(r => {
    r.addEventListener("change", () => {
      if (amountCustom.value) amountCustom.value = "";
      updateRecap();
    });
  });

  // custom -> décoche les radios
  amountCustom.addEventListener("input", () => {
    if (amountCustom.value) radios.forEach(r => r.checked = false);
    updateRecap();
  });

  [fromName, toName, toEmail, message].forEach(el => {
    el.addEventListener("input", updateRecap);
  });

  function pickStripeLink(amount) {
    // Si montant personnalisé saisi -> lien custom
    if (isCustomMode()) return STRIPE_LINKS.custom;

    // Sinon -> lien fixe correspondant
    const key = String(Math.round(amount));
    return STRIPE_LINKS[key] || null;
  }

  btnPay.addEventListener("click", () => {
    setError("");

    const amount = getAmount();
    if (!amount || Number.isNaN(amount)) {
      setError("Veuillez choisir un montant (ou saisir un montant personnalisé).");
      return;
    }
    if (amount < 10) {
      setError("Le montant personnalisé minimum est de 10€.");
      return;
    }

    const link = pickStripeLink(amount);
    if (!link) {
      setError("Lien Stripe introuvable pour ce montant. Vérifiez vos liens Stripe.");
      return;
    }

    const from = (fromName.value || "").trim();
    const to = (toName.value || "").trim();
    const email = (toEmail.value || "").trim();
    const msg = (message.value || "").trim();

    const u = new URL(link);

    // ✅ Payment Links: email pré-rempli
    if (email) u.searchParams.set("prefilled_email", email);

    // ✅ Meta utile (optionnel)
    u.searchParams.set("rn_type", "gift");
    u.searchParams.set("rn_amount", String(Math.round(amount)));
    if (from) u.searchParams.set("rn_from", from.slice(0, 60));
    if (to) u.searchParams.set("rn_to", to.slice(0, 60));
    if (msg) u.searchParams.set("rn_msg", msg.slice(0, 120));

    // ⚠️ IMPORTANT :
    // Si ton lien "custom" permet au client de CHOISIR le montant dans Stripe,
    // alors Stripe gère le montant. On ne peut pas forcer le montant via l’URL.
    // => tu peux juste afficher le montant côté récap ici.

    window.location.href = u.toString();
  });

  // init
  updateRecap();
})();
