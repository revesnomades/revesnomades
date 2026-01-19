// main.js — version clean (nav + smooth scroll + reveal animations)
(() => {
  // 1) Indique que JS est actif (sert au CSS pour animer sans cacher si JS plante)
  document.documentElement.classList.add("js");
// Cascade: data-delay -> variable CSS --d
document.querySelectorAll(".reveal[data-delay]").forEach(el=>{
  el.style.setProperty("--d", el.getAttribute("data-delay"));
});

  // 2) NAV: background au scroll
  const nav = document.querySelector(".nav");
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle("is-scrolled", window.scrollY > 20);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // 3) Smooth scroll ancres (avec offset nav)
  document.querySelectorAll('a[href^="#"][data-scroll]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href");
      const el = document.querySelector(href);
      if (!el) return;

      e.preventDefault();
      const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--navH")) || 66;
      const y = el.getBoundingClientRect().top + window.scrollY - (navH + 14);

      window.scrollTo({ top: y, behavior: "smooth" });
    });
  });

  // 4) Reveal animation: au chargement + au scroll (toutes pages)
  // Utilisation: ajoute class="reveal" sur les blocs à animer
  const revealEls = Array.from(document.querySelectorAll(".reveal"));
  if (revealEls.length) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const ent of entries) {
          if (ent.isIntersecting) {
            ent.target.classList.add("is-visible");
            io.unobserve(ent.target);
          }
        }
      },
      { threshold: 0.18 }
    );

    revealEls.forEach((el) => io.observe(el));
  }

  // 5) HERO: si tu veux que le texte s'anime toujours dès l'ouverture
  // Assure-toi que ton bloc texte hero a class="hero-content reveal"
  window.addEventListener("load", () => {
    const heroContent = document.querySelector(".hero.hero-left .hero-content.reveal");
    if (heroContent) heroContent.classList.add("is-visible");
  });
})();
// Active le mode JS (pour éviter de cacher si JS ne tourne pas)
document.documentElement.classList.add("js");

/* ===============================
   REVEAL ON SCROLL (micro-animations)
================================ */
(() => {
  const items = document.querySelectorAll(".reveal");
  if (!items.length) return;

  // applique la variable de cascade depuis data-delay
  items.forEach((el) => {
    const d = el.getAttribute("data-delay");
    if (d !== null) el.style.setProperty("--d", d);
  });

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((ent) => {
        if (ent.isIntersecting) {
          ent.target.classList.add("is-visible");
          io.unobserve(ent.target); // animation une seule fois
        }
      });
    },
    { threshold: 0.15 }
  );

  items.forEach((el) => io.observe(el));
})();
/* ===============================
   HAMBURGER MENU (mobile)
================================ */
(() => {
  const nav = document.querySelector(".nav");
  const btn = document.querySelector(".hamburger");
  const drawer = document.querySelector(".mobile-drawer");
  if(!nav || !btn || !drawer) return;

  const closeMenu = () => {
    nav.classList.remove("is-menu-open");
    btn.setAttribute("aria-expanded", "false");
    drawer.setAttribute("aria-hidden", "true");
  };

  const openMenu = () => {
    nav.classList.add("is-menu-open");
    btn.setAttribute("aria-expanded", "true");
    drawer.setAttribute("aria-hidden", "false");
  };

  btn.addEventListener("click", () => {
    const isOpen = nav.classList.contains("is-menu-open");
    isOpen ? closeMenu() : openMenu();
  });

  // clic sur overlay -> ferme
  drawer.addEventListener("click", (e) => {
    if(e.target === drawer) closeMenu();
  });

  // clic sur un lien -> ferme
  drawer.querySelectorAll("a").forEach(a => {
    a.addEventListener("click", () => closeMenu());
  });

  // ESC -> ferme
  window.addEventListener("keydown", (e) => {
    if(e.key === "Escape") closeMenu();
  });
})();

