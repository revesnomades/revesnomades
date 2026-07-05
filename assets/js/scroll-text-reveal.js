/**
 * scroll-text-reveal.js
 * ============================================================================
 * Module d'animation de révélation de texte au scroll (Scrubbed Text Reveal),
 * reproduisant l'effet visuel haute performance du Commandant Charcot de PONANT.
 * 
 * CHOIX TECHNIQUES & ARCHITECTURE :
 * ----------------------------------------------------------------------------
 * 1. Moteur d'animation : GSAP + ScrollTrigger
 *    - Offre une précision absolue de synchronisation avec le scroll (scrub).
 *    - Le paramètre `scrub: 0.5` lisse les acoups de molette/trackpad sur 0.5s,
 *      garantissant une sensation de fluidité veloutée à 60 FPS sans décalage.
 * 
 * 2. Découpage du DOM : SplitType (types: 'words,chars')
 *    - Découper d'abord en mots ('words') puis en caractères ('chars') permet
 *      de conserver les mots dans des conteneurs inline-block. Cela empêche les
 *      mots de se briser en milieu de ligne lors du wrapping naturel.
 * 
 * 3. Élimination totale du CLS (Cumulative Layout Shift) :
 *    - L'initialisation attend la résolution de `document.fonts.ready` afin que
 *      les largeurs de polices soient calculées définitivement avant le découpage.
 *    - Un gestionnaire de redimensionnement (debounce) exécute `split.revert()`,
 *      laissant le navigateur recalculer le layout responsive avant de redécouper.
 * 
 * 4. Accessibilité 100% préservée (Lecteurs d'écran & Sélection de texte) :
 *    - Si aucun `aria-label` n'est présent, on affecte le texte brut au conteneur.
 *    - Les spans générés par SplitType reçoivent `aria-hidden="true"`, forçant
 *      les lecteurs d'écran à lire la phrase fluide au lieu de l'épeler lettre à lettre.
 *    - Les nœuds de texte DOM étant intacts dans les spans, le copier-coller
 *      et la sélection de texte standard restent 100% fonctionnels.
 * 
 * 5. Respect des préférences d'accessibilité (prefers-reduced-motion) :
 *    - Détection via `matchMedia`. Si l'utilisateur demande une réduction des
 *      mouvements, l'animation JS ne s'exécute pas et le texte reste à 100% d'opacité.
 * 
 * 6. Support du contenu dynamique (Supabase / Ajax) :
 *    - Un `MutationObserver` surveille le DOM pour détecter et animer automatiquement
 *      les descriptions de séjour injectées de manière asynchrone.
 * ============================================================================
 */

(function () {
  "use strict";

  // Configuration globale de l'effet
  const CONFIG = {
    selector: ".text-reveal",
    initialOpacity: 0.15, // Opacité de base discrète (15%), identique aux standards du luxe
    start: "top 85%",     // Début de l'animation lorsque le haut de l'élément arrive à 85% du viewport
    end: "bottom 35%",    // Révélation complète lorsque le bas de l'élément atteint 35% du viewport
    scrub: 0.5,           // Lissage de 0.5s pour une fluidité 60 FPS irréprochable
    stagger: 0.05,        // Délai de cascade pour un effet de vague naturelle (gauche à droite)
  };

  // Registre des instances animées pour gestion propre du cycle de vie (resize)
  const instances = new Set();

  /**
   * Vérifie si l'utilisateur a activé la réduction des animations dans son système.
   * @returns {boolean}
   */
  function isReducedMotion() {
    return (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /**
   * Initialise la révélation au scroll sur une sélection d'éléments.
   * @param {string|Element|NodeList|Array} targets - Cibles à animer.
   */
  function initScrollTextReveal(targets = CONFIG.selector) {
    // Vérification de sécurité des dépendances
    if (
      typeof gsap === "undefined" ||
      typeof ScrollTrigger === "undefined" ||
      typeof SplitType === "undefined"
    ) {
      console.warn(
        "[ScrollTextReveal] GSAP, ScrollTrigger ou SplitType manquant. Le texte restera visible par défaut."
      );
      return;
    }

    // Enregistrement de ScrollTrigger dans GSAP
    gsap.registerPlugin(ScrollTrigger);

    // Arrêt immédiat si l'utilisateur demande moins de mouvement
    if (isReducedMotion()) {
      return;
    }

    // Normalisation des cibles en tableau
    let elements = [];
    if (typeof targets === "string") {
      elements = Array.from(document.querySelectorAll(targets));
    } else if (targets instanceof Element) {
      elements = [targets];
    } else if (
      targets &&
      (targets instanceof NodeList ||
        Array.isArray(targets) ||
        targets instanceof HTMLCollection)
    ) {
      elements = Array.from(targets);
    }

    elements.forEach((el) => {
      // 1. Déclenchement individuel et protection contre la double initialisation
      if (!el || el.dataset.textRevealInitialized === "true") return;

      // Ignorer si l'élément ne contient pas de texte lisible
      const rawText = el.textContent.trim();
      if (!rawText) return;

      el.dataset.textRevealInitialized = "true";

      // 2. Accessibilité : garantir une lecture fluide pour les lecteurs d'écran
      if (!el.getAttribute("aria-label") && !el.closest("[aria-label]")) {
        el.setAttribute("aria-label", rawText);
      }

      // 3. Découpage du texte sans induire de Layout Shift
      // L'option 'words,chars' préserve l'intégrité des mots lors des retours à la ligne
      const split = new SplitType(el, { types: "words,chars" });

      if (!split.chars || split.chars.length === 0) {
        return;
      }

      // Masquer les spans découpés aux lecteurs d'écran (qui liront l'aria-label du conteneur)
      if (split.words && split.words.length) {
        split.words.forEach((word) => word.setAttribute("aria-hidden", "true"));
      }
      if (split.chars && split.chars.length) {
        split.chars.forEach((char) => char.setAttribute("aria-hidden", "true"));
      }

      // 4. Construction de l'animation GSAP
      // On affecte l'opacité initiale et une couleur gris clair aux caractères individuels
      gsap.set(split.chars, { opacity: CONFIG.initialOpacity, color: "#888888" });

      // Création d'une timeline scrubbée (strictement pilotée par le défilement)
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: el,
          start: CONFIG.start,
          end: CONFIG.end,
          scrub: CONFIG.scrub,
          invalidateOnRefresh: true, // Recalcule les coordonnées en cas de rafraîchissement
        },
      });

      // Révélation progressive (de gauche à droite en suivant l'ordre du DOM) : devient noir et 100% opaque
      tl.to(split.chars, {
        opacity: 1,
        color: "#000000",
        stagger: CONFIG.stagger,
        ease: "none", // Indispensable avec scrub pour une relation 1:1 et fluide
      });

      // Enregistrement de l'instance pour gestion au redimensionnement
      instances.add({ el, split, tl });
    });
  }

  /**
   * Gestionnaire de redimensionnement responsive (avec Debounce 250ms).
   * Restaure le DOM initial pour recalculer le wrapping des lignes (desktop/tablette/mobile),
   * puis réinitialise l'animation sans aucun décalage visuel (0 CLS).
   */
  let resizeTimeout = null;
  function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (isReducedMotion() || instances.size === 0) return;

      instances.forEach((instance) => {
        if (instance.tl && instance.tl.scrollTrigger) {
          instance.tl.scrollTrigger.kill();
        }
        if (instance.tl) instance.tl.kill();
        if (instance.split) instance.split.revert();
        delete instance.el.dataset.textRevealInitialized;
      });
      instances.clear();

      // Réinitialisation après recalcul du layout par le navigateur
      initScrollTextReveal();
      if (typeof ScrollTrigger !== "undefined") {
        ScrollTrigger.refresh();
      }
    }, 250);
  }

  /**
   * Surveillance des mutations DOM (MutationObserver).
   * Détecte l'insertion de descriptions dynamiques (ex : requêtes Supabase)
   * et déclenche leur révélation au scroll de manière autonome.
   */
  function setupDOMObserver() {
    if (typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver((mutations) => {
      let shouldRefresh = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (
                node.classList?.contains("text-reveal") ||
                node.querySelector?.(".text-reveal")
              ) {
                shouldRefresh = true;
                break;
              }
            }
          }
        }
        if (shouldRefresh) break;
      }

      if (shouldRefresh) {
        // Exécution dans le prochain cycle d'animation pour garantir le rendu DOM
        window.requestAnimationFrame(() => {
          initScrollTextReveal();
          if (typeof ScrollTrigger !== "undefined") {
            ScrollTrigger.refresh();
          }
        });
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * Démarrage sécurisé au chargement complet de la page et des polices.
   */
  function boot() {
    const startApp = () => {
      initScrollTextReveal();
      setupDOMObserver();
      window.addEventListener("resize", handleResize, { passive: true });
    };

    // Attendre le chargement des polices web pour éviter tout CLS au découpage
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(startApp);
    } else {
      if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", startApp);
      } else {
        startApp();
      }
    }
  }

  // Initialisation automatique du module
  boot();

  // Exposition globale pour usage avancé ou appel manuel
  window.ScrollTextReveal = {
    init: initScrollTextReveal,
    config: CONFIG,
    refresh: () => {
      if (typeof ScrollTrigger !== "undefined") ScrollTrigger.refresh();
    },
  };
})();
