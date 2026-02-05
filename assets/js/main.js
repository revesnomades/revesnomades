// main.js — version clean (nav + smooth scroll + reveal + hamburger + about toggle)
(() => {
  // ✅ Indique que JS est actif (sert au CSS pour animer sans cacher si JS plante)
  document.documentElement.classList.add("js");

  // ✅ Cascade: data-delay -> variable CSS --d
  document.querySelectorAll(".reveal[data-delay]").forEach((el) => {
    el.style.setProperty("--d", el.getAttribute("data-delay"));
  });

  /* ===============================
     1) NAV: background au scroll
  ================================ */
  const nav = document.querySelector(".nav");
  const onScroll = () => {
    if (!nav) return;
    nav.classList.toggle("is-scrolled", window.scrollY > 20);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ===============================
     2) Smooth scroll ancres (offset nav)
  ================================ */
  document.querySelectorAll('a[href^="#"][data-scroll]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href");
      if (!href || href === "#") return;

      const target = document.querySelector(href);
      if (!target) return;

      e.preventDefault();

      const navH =
        parseInt(
          getComputedStyle(document.documentElement).getPropertyValue("--navH")
        ) || 66;

      const y = target.getBoundingClientRect().top + window.scrollY - (navH + 14);
      window.scrollTo({ top: y, behavior: "smooth" });
    });
  });

  /* ===============================
     3) Reveal animation au scroll
  ================================ */
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
      { threshold: 0.15 }
    );

    revealEls.forEach((el) => io.observe(el));
  }

  /* ===============================
     4) Hamburger menu (mobile)
  ================================ */
  const btn = document.querySelector(".hamburger");
  const drawer = document.querySelector(".mobile-drawer");

  if (nav && btn && drawer) {
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
      if (e.target === drawer) closeMenu();
    });

    // clic sur un lien -> ferme
    drawer.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", closeMenu);
    });

    // ESC -> ferme
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
  }

  /* ===============================
     5) À PROPOS — Voir la suite / Voir moins
     HTML attendu :
     - <div id="aboutText" class="about-text is-collapsed">...</div>
     - <button id="aboutToggleBtn">Voir la suite</button>
  ================================ */
  const aboutText = document.getElementById("aboutText");
  const aboutBtn = document.getElementById("aboutToggleBtn");

  if (aboutText && aboutBtn) {
    const sync = () => {
      const collapsed = aboutText.classList.contains("is-collapsed");
      aboutBtn.textContent = collapsed ? "Voir la suite" : "Voir moins";
      aboutBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    };

    aboutBtn.addEventListener("click", () => {
      aboutText.classList.toggle("is-collapsed");
      sync();

      // option: quand on replie, remonter légèrement
      if (aboutText.classList.contains("is-collapsed")) {
        const y = aboutText.getBoundingClientRect().top + window.scrollY - 90;
        window.scrollTo({ top: y, behavior: "smooth" });
      }
    });

    sync();
  }

  /* ===============================
     6) iOS: simuler les backgrounds fixed
  ================================ */
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (isIOS) {
    const fixedBands = Array.from(document.querySelectorAll(".fixed-bg"));
    if (fixedBands.length) {
      const updateFixedBg = () => {
        for (const band of fixedBands) {
          const top = band.getBoundingClientRect().top + window.scrollY;
          const offset = window.scrollY - top;
          band.style.backgroundPosition = `center ${offset}px`;
        }
      };

      window.addEventListener("scroll", updateFixedBg, { passive: true });
      window.addEventListener("resize", updateFixedBg);
      updateFixedBg();
    }
  }
})();
