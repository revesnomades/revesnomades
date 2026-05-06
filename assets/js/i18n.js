(function () {
  const TRANSLATIONS = {
    fr: {
      "nav.about":    "À propos",
      "nav.faq":      "FAQ",
      "nav.contact":  "Contact",
      "nav.account":  "Compte",

      "hero.tagline": "Partir pour mieux se retrouver.",
      "hero.cta":     "Voir les séjours",

      "index.next_stay":        "Prochain séjour…",
      "index.reserve":          "Réserver",
      "index.upcoming":         "Prochains séjours",
      "index.upcoming_sub":     "Survolez un séjour pour découvrir les prochaines dates.",
      "index.about_title":      "À propos de Âmes Nomades",
      "index.see_more":         "Voir la suite",
      "index.newsletter_title": "Recevez votre guide en cadeau !",
      "index.newsletter_btn":   "Recevoir mon guide",
      "index.gift_title":       "Et si vous offriez un moment Âmes Nomades ?",
      "index.gift_sub":         "Un bon cadeau pour une parenthèse de mouvement, de douceur et de présence.",
      "index.gift_btn":         "Commander votre bon cadeau",

      "stay.book":          "Réserver",
      "stay.contact":       "Nous contacter",
      "stay.missing":       "réservations nécessaires pour valider ce séjour.",
      "stay.confirm_email": "Un email de confirmation vous sera envoyé dès que le séjour sera validé.",
      "stay.highlights":    "Ce que tu vas vivre",
      "stay.program":       "Programme",
      "stay.included":      "Ce qui est inclus",
      "stay.not_included":  "Ce qui n'est pas inclus",
      "stay.options":       "Options (en supplément)",
      "stay.faq":           "FAQ",
      "stay.other":         "Découvrir d'autres séjours",
      "stay.trust1":        "Réservation simple",
      "stay.trust2":        "Petit groupe",
      "stay.trust3":        "Accompagnement personnalisé",
      "stay.trust4":        "Confirmation par email",
      "stay.not_found":     "Ce séjour n'est plus disponible",
      "stay.not_found_sub": "Le séjour que vous cherchez n'existe pas ou n'est plus disponible.",
      "stay.see_all":       "Voir les séjours du moment",
      "stay.back_home":     "Retour à l'accueil",

      "faq.title":    "Questions fréquentes",
      "faq.subtitle": "Les réponses aux questions les plus fréquentes avant de réserver un séjour Âmes Nomades.",

      "footer.legal":     "Mentions légales",
      "footer.privacy":   "Politique de confidentialité",
      "footer.copyright": "Copyright © 2026 Âmes Nomades",

      "lang.switch": "EN",
    },

    en: {
      "nav.about":   "About",
      "nav.faq":     "FAQ",
      "nav.contact": "Contact",
      "nav.account": "Account",

      "hero.tagline": "Leave to find yourself.",
      "hero.cta":     "See retreats",

      "index.next_stay":        "Next retreat…",
      "index.reserve":          "Book",
      "index.upcoming":         "Upcoming retreats",
      "index.upcoming_sub":     "Hover over a retreat to discover the next dates.",
      "index.about_title":      "About Âmes Nomades",
      "index.see_more":         "Read more",
      "index.newsletter_title": "Receive your free guide!",
      "index.newsletter_btn":   "Get my guide",
      "index.gift_title":       "Give an Âmes Nomades experience?",
      "index.gift_sub":         "A gift voucher for a moment of movement, softness and presence.",
      "index.gift_btn":         "Order a gift voucher",

      "stay.book":          "Book",
      "stay.contact":       "Contact us",
      "stay.missing":       "bookings needed to confirm this retreat.",
      "stay.confirm_email": "A confirmation email will be sent once the retreat is confirmed.",
      "stay.highlights":    "What you will experience",
      "stay.program":       "Program",
      "stay.included":      "What's included",
      "stay.not_included":  "What's not included",
      "stay.options":       "Optional add-ons",
      "stay.faq":           "FAQ",
      "stay.other":         "Discover other retreats",
      "stay.trust1":        "Simple booking",
      "stay.trust2":        "Small group",
      "stay.trust3":        "Personal support",
      "stay.trust4":        "Email confirmation",
      "stay.not_found":     "This retreat is no longer available",
      "stay.not_found_sub": "The retreat you are looking for does not exist or is no longer available.",
      "stay.see_all":       "See current retreats",
      "stay.back_home":     "Back to home",

      "faq.title":    "Frequently asked questions",
      "faq.subtitle": "Answers to the most common questions before booking an Âmes Nomades retreat.",

      "footer.legal":     "Legal notice",
      "footer.privacy":   "Privacy policy",
      "footer.copyright": "Copyright © 2026 Âmes Nomades",

      "lang.switch": "FR",
    }
  };

  const STORAGE_KEY = "an_lang";

  function getLang() {
    return localStorage.getItem(STORAGE_KEY) || "fr";
  }

  function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }

  function t(key) {
    const lang = getLang();
    return TRANSLATIONS[lang]?.[key] || TRANSLATIONS["fr"]?.[key] || key;
  }

  function applyTranslations() {
    const lang = getLang();
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      const key = el.getAttribute("data-i18n");
      const translation = TRANSLATIONS[lang]?.[key] || TRANSLATIONS["fr"]?.[key];
      if (translation) el.textContent = translation;
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      const key = el.getAttribute("data-i18n-placeholder");
      const translation = TRANSLATIONS[lang]?.[key] || TRANSLATIONS["fr"]?.[key];
      if (translation) el.setAttribute("placeholder", translation);
    });
    document.querySelectorAll(".lang-toggle-btn").forEach(function (btn) {
      btn.textContent = TRANSLATIONS[lang]?.["lang.switch"] || "EN";
      btn.setAttribute("aria-label", lang === "fr" ? "Switch to English" : "Passer en français");
    });
  }

  function toggleLang() {
    const current = getLang();
    const next = current === "fr" ? "en" : "fr";
    setLang(next);
    applyTranslations();
    if (typeof window.reloadDynamicContent === "function") {
      window.reloadDynamicContent();
    }
  }

  function initLangToggle() {
    applyTranslations();
    document.querySelectorAll(".lang-toggle-btn").forEach(function (btn) {
      const fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
    });
    document.querySelectorAll(".lang-toggle-btn").forEach(function (btn) {
      btn.addEventListener("click", function () { toggleLang(); });
    });
  }

  window.AnI18n = { getLang: getLang, setLang: setLang, t: t, applyTranslations: applyTranslations, toggleLang: toggleLang, initLangToggle: initLangToggle };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLangToggle);
  } else {
    initLangToggle();
  }
})();
