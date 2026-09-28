// main.js — version clean (nav + smooth scroll + reveal + hamburger + about toggle)
(() => {
  function initUniformHeader() {
    const navInner = document.querySelector(".nav-inner");
    if (!navInner || navInner.querySelector(".nav-left")) return;
    
    const navLeft = document.createElement("nav");
    navLeft.className = "nav-left nav-links-desktop";
    navLeft.setAttribute("aria-label", "Navigation gauche");
    navLeft.innerHTML = `<a href="/boutique.html">Shop</a><a href="/index.html#sejours">Séjours</a>`;
    navInner.insertBefore(navLeft, navInner.firstElementChild);

    navInner.querySelectorAll(".nav-links a").forEach(a => {
      const href = (a.getAttribute("href") || "").toLowerCase();
      if (href.includes("boutique.html") && a.textContent.trim().toLowerCase() === "shop") {
        a.remove();
      }
    });

    const mobileMenu = document.querySelector(".mobile-menu");
    if (mobileMenu && !mobileMenu.querySelector("a[href*='sejours']")) {
      const sejourLink = document.createElement("a");
      sejourLink.href = "/index.html#sejours";
      sejourLink.textContent = "Séjours";
      mobileMenu.insertBefore(sejourLink, mobileMenu.firstElementChild);
    }
  }
  initUniformHeader();

  // ── Icône panier + menu mobile sur toutes les pages ───────────────────
  function initMobileNav() {
    const navInner = document.querySelector(".nav-inner");
    if (!navInner) return;

    // 1. Injecter icône panier visible sur mobile (avant le hamburger)
    if (!navInner.querySelector(".mobile-cart-btn")) {
      const cartBtn = document.createElement("a");
      cartBtn.className = "icon-btn mobile-cart-btn cart-nav-link";
      cartBtn.href = "/panier.html";
      cartBtn.setAttribute("aria-label", "Panier");
      cartBtn.style.cssText = "display:none; position:relative;";
      cartBtn.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="cart-badge"></span>`;
      const hamburger = navInner.querySelector(".hamburger");
      if (hamburger) {
        navInner.insertBefore(cartBtn, hamburger);
      } else {
        navInner.appendChild(cartBtn);
      }
      // Visible seulement sur mobile
      const showCartMobile = () => {
        cartBtn.style.display = window.innerWidth <= 900 ? "inline-flex" : "none";
      };
      showCartMobile();
      window.addEventListener("resize", showCartMobile);
    }

    // 2. Injecter hamburger + drawer si absent (ex: compte.html)
    if (!navInner.querySelector(".hamburger")) {
      const hamburger = document.createElement("button");
      hamburger.className = "hamburger";
      hamburger.type = "button";
      hamburger.setAttribute("aria-label", "Ouvrir le menu");
      hamburger.setAttribute("aria-expanded", "false");
      hamburger.innerHTML = "<span></span><span></span><span></span>";
      navInner.appendChild(hamburger);

      const drawer = document.createElement("div");
      drawer.className = "mobile-drawer";
      drawer.setAttribute("aria-hidden", "true");
      const currentPath = window.location.pathname;
      drawer.innerHTML = `<nav class="mobile-menu" aria-label="Navigation mobile">
        <a href="/index.html#sejours">Séjours</a>
        <a href="/boutique.html">Shop</a>
        <a href="/index.html#apropos">À propos</a>
        <a href="/faq.html">FAQ</a>
        <a href="/index.html#contact">Contact</a>
        <a href="/panier.html">Panier <span class="cart-badge" style="position:static;display:inline-flex;margin-left:4px;"></span></a>
        <a href="/compte.html">Compte</a>
      </nav>`;
      navInner.appendChild(drawer);
    }

    // 3. S'assurer que le lien Panier est dans TOUS les menus mobiles existants
    const mobileMenu = navInner.querySelector(".mobile-menu");
    if (mobileMenu && !mobileMenu.querySelector("a[href*='panier']")) {
      const panierLink = document.createElement("a");
      panierLink.href = "/panier.html";
      panierLink.innerHTML = `Panier <span class="cart-badge" style="position:static;display:inline-flex;margin-left:4px;"></span>`;
      const compteLink = mobileMenu.querySelector("a[href*='compte']");
      if (compteLink) mobileMenu.insertBefore(panierLink, compteLink);
      else mobileMenu.appendChild(panierLink);
    }
  }
  initMobileNav();

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
     2b) Hash au chargement (offset nav)
  ================================ */
  if (window.location.hash) {
    const target = document.querySelector(window.location.hash);
    if (target) {
      const navH =
        parseInt(
          getComputedStyle(document.documentElement).getPropertyValue("--navH")
        ) || 66;
      const y = target.getBoundingClientRect().top + window.scrollY - (navH + 14);
      window.scrollTo({ top: y });
    }
  }

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
    const aboutRevealEls = Array.from(aboutText.querySelectorAll(".reveal"));

    const sync = () => {
      const collapsed = aboutText.classList.contains("is-collapsed");
      aboutBtn.textContent = collapsed ? "Voir la suite" : "Voir moins";
      aboutBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");

      if (!collapsed) {
        aboutRevealEls.forEach((el) => el.classList.add("is-visible"));
      }
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
    const layers = [];

    for (const band of fixedBands) {
      const computed = getComputedStyle(band);
      const bgImage = computed.backgroundImage;
      if (!bgImage || bgImage === "none") continue;

      const layer = document.createElement("div");
      layer.className = "fixed-bg-layer";
      layer.style.backgroundImage = bgImage;
      band.style.backgroundImage = "none";
      band.prepend(layer);
      layers.push({ band, layer });
    }

    if (layers.length) {
      let ticking = false;

      const updateFixedBg = () => {
        ticking = false;
        for (const { band, layer } of layers) {
          const top = band.getBoundingClientRect().top + window.scrollY;
          const offset = Math.round(window.scrollY - top);
          layer.style.transform = `translate3d(0, ${offset}px, 0)`;
        }
      };

      const onScroll = () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(updateFixedBg);
        }
      };

      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
      onScroll();
    }
  }

  // ✅ Sécurité des images : empêcher clic droit et glisser-déposer sur les images
  document.addEventListener("contextmenu", (e) => {
    if (e.target.tagName === "IMG") {
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener("dragstart", (e) => {
    if (e.target.tagName === "IMG") {
      e.preventDefault();
    }
  }, { passive: false });

  /* ===============================
     7) Reset des boutons de chargement (Retour navigateur / BFCache)
  ================================ */
  const resetLoadingButtons = () => {
    document.querySelectorAll(".btn-loading").forEach((btn) => {
      btn.classList.remove("btn-loading");
    });
  };
  window.addEventListener("pageshow", resetLoadingButtons);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      resetLoadingButtons();
    }
  });
})();
