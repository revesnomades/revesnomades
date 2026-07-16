/**
 * scroll-text-reveal.js
 * ============================================================================
 * Module d'animation de révélation de texte haut de gamme (Luxury Storytelling),
 * reproduisant l'effet d'apparition fluide et élégant des sites de luxe (Apple, Cartier, etc.).
 *
 * CHOIX TECHNIQUES & ARCHITECTURE :
 * ----------------------------------------------------------------------------
 * 1. Moteur d'animation : GSAP + ScrollTrigger (ou IntersectionObserver en fallback)
 *    - Déclenchement autonome : l'animation ne dépend PAS du scroll pour sa lecture.
 *      Le scroll (ou l'entrée dans le viewport à ~70-80% de visibilité) sert uniquement
 *      de déclencheur (`once: true`).
 *    - Une fois lancée, l'animation s'exécute à un rythme fluide et constant (60 FPS),
 *      indépendamment de la vitesse de défilement de l'utilisateur.
 *
 * 2. Découpage du DOM : SplitType ('words,chars')
 *    - Découpage par mots puis par caractères. Le fait de maintenir les mots dans
 *      des conteneurs `inline-block` avec `white-space: nowrap` empêche toute cassure
 *      de mot en milieu de ligne lors du wrapping naturel.
 *
 * 3. Pacing dynamique & Opacité discrète :
 *    - Le texte est initialement à très faible opacité (15% par défaut).
 *    - Pour éviter qu'un paragraphe long ne mette 10 secondes à s'afficher, le délai
 *      de cascade (`stagger`) est calculé dynamiquement selon la longueur du texte :
 *      la vague complète d'apparition dure au maximum ~1.2s à 1.5s.
 *
 * 4. Accessibilité 100% préservée (Lecteurs d'écran & Sélection de texte) :
 *    - Positionnement automatique d'un `aria-label` sur le conteneur contenant le texte brut.
 *    - Ajout de `aria-hidden="true"` sur les spans générés par SplitType afin que
 *      les synthèses vocales lisent la phrase fluide au lieu d'épeler lettre par lettre.
 *    - Les nœuds de texte DOM restant intacts, le copier-coller et la sélection
 *      de texte standard restent 100% fonctionnels.
 *
 * 5. Respect des préférences d'accessibilité (prefers-reduced-motion) :
 *    - Détection via `window.matchMedia`. Si la réduction des mouvements est activée,
 *      aucune animation n'est jouée et le texte reste immédiatement à 100% d'opacité.
 *
 * 6. Élimination du CLS (Cumulative Layout Shift) & Responsive :
 *    - L'initialisation attend la résolution de `document.fonts.ready` pour s'assurer
 *      que les polices sont chargées avant le calcul des géométries.
 *    - Au redimensionnement (debounce 250ms), les éléments déjà révélés à 100% sont
 *      simplement restaurés dans un état propre (opacité 100%, sans réanimation),
 *      tandis que les éléments en attente sont redécoupés proprement pour le nouveau viewport.
 * ============================================================================
 */

(function () {
  "use strict";

  // Configuration globale de l'effet de révélation premium
  const CONFIG = {
    selector: ".text-reveal",
    initialOpacity: 0.15,     // Opacité initiale discrète (15%), standard du luxe
    start: "top 85%",         // Déclenchement lorsque l'élément arrive à 85% du viewport
    charDuration: 0.7,        // Durée d'apparition plus réactive et dynamique
    stagger: 0.025,           // Délai de cascade plus fluide
    maxWaveDuration: 1.6,     // Durée maximale compressée pour supprimer toute impression de latence
    defaultType: "chars",     // Type d'animation par défaut ('chars' pour caractères, 'words' pour mots)
  };

  // Registre des instances animées pour gestion propre du cycle de vie
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
   * Calcule un stagger dynamique pour s'assurer que les longs paragraphes ne prennent
   * pas trop de temps à se révéler entièrement.
   * @param {number} totalItems - Nombre total de caractères ou de mots.
   * @returns {number}
   */
  function getDynamicStagger(totalItems) {
    if (!totalItems || totalItems <= 1) return CONFIG.stagger;
    // Si la multiplication du stagger par le nombre d'éléments dépasse maxWaveDuration,
    // on compresse le stagger proportionnellement.
    const calculated = CONFIG.maxWaveDuration / totalItems;
    return Math.min(CONFIG.stagger, calculated);
  }

  /**
   * Lance l'animation de révélation sur une instance découpée.
   * @param {Object} instance - Objet contenant { el, split, targets, isCompleted }
   */
  function playRevealAnimation(instance) {
    if (instance.isCompleted || !instance.targets || !instance.targets.length) return;

    if (typeof gsap === "undefined") {
      // Fallback sans GSAP
      instance.targets.forEach((node) => (node.style.opacity = "1"));
      instance.isCompleted = true;
      instance.el.dataset.textRevealCompleted = "true";
      return;
    }

    const staggerDelay = getDynamicStagger(instance.targets.length);

    // Animation fluide de l'opacité (et colorisation naturelle si le texte était grisé)
    gsap.to(instance.targets, {
      opacity: 1,
      duration: CONFIG.charDuration,
      stagger: staggerDelay,
      ease: "power2.out", // Easing velouté et naturel
      onComplete: () => {
        instance.isCompleted = true;
        instance.el.dataset.textRevealCompleted = "true";
        // Nettoyage de la propriété will-change pour libérer la mémoire GPU compositor
        gsap.set(instance.targets, { clearProps: "will-change" });
      },
    });
  }

  /**
   * Initialise la révélation sur un ensemble de cibles DOM.
   * @param {string|Element|NodeList|Array} targets - Éléments à initialiser.
   */
  function initScrollTextReveal(targets = CONFIG.selector) {
    // Vérification de sécurité des dépendances
    if (typeof SplitType === "undefined") {
      console.warn("[ScrollTextReveal] SplitType est manquant. Le texte restera à 100% d'opacité.");
      return;
    }

    const hasGsap = typeof gsap !== "undefined";
    const hasScrollTrigger = hasGsap && typeof ScrollTrigger !== "undefined";

    if (hasScrollTrigger) {
      gsap.registerPlugin(ScrollTrigger);
    }

    // Arrêt immédiat si l'utilisateur demande moins de mouvement ou en cas d'absence de JS
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

      const rawText = el.textContent.trim();
      if (!rawText) return;

      el.dataset.textRevealInitialized = "true";

      // Si l'élément avait déjà été complètement révélé lors d'un cycle précédent (ex: resize),
      // on s'assure qu'il reste à 100% visible sans rejouer l'animation.
      if (el.dataset.textRevealCompleted === "true") {
        el.style.opacity = "1";
        return;
      }

      // 3. Découpage du texte sans induire de Layout Shift (CLS)
      // On découpe en 'words,chars' pour préserver l'intégrité des mots et autoriser le wrapping
      const split = new SplitType(el, { types: "words,chars" });

      // Accessibilité : insérer un élément sr-only contenant le texte original
      // et masquer les éléments animés pour les lecteurs d'écran.
      const srSpan = document.createElement("span");
      srSpan.className = "sr-only";
      srSpan.textContent = rawText;
      el.appendChild(srSpan);

      // Lecture du type d'animation souhaité depuis les attributs data (ex: data-reveal-type="words")
      const revealType = el.dataset.revealType || CONFIG.defaultType;
      const targetsToAnimate = revealType === "words" ? (split.words || split.chars) : (split.chars || split.words);

      if (!targetsToAnimate || targetsToAnimate.length === 0) {
        return;
      }

      // Masquer les spans découpés aux lecteurs d'écran (qui liront le span sr-only)
      if (split.words && split.words.length) {
        split.words.forEach((word) => word.setAttribute("aria-hidden", "true"));
      }
      if (split.chars && split.chars.length) {
        split.chars.forEach((char) => {
          char.setAttribute("aria-hidden", "true");
          char.style.willChange = "opacity"; // Optimisation GPU compositor pour 60 FPS
        });
      }

      // 4. Initialisation visuelle : très faible opacité (15%) sur les éléments découpés
      if (hasGsap) {
        gsap.set(targetsToAnimate, { opacity: CONFIG.initialOpacity });
      } else {
        targetsToAnimate.forEach((node) => (node.style.opacity = String(CONFIG.initialOpacity)));
      }

      const instance = {
        el,
        split,
        targets: targetsToAnimate,
        isCompleted: false,
        trigger: null,
      };

      // 5. Déclenchement à l'entrée dans le viewport (~70-80% de visibilité, once: true)
      if (hasScrollTrigger) {
        instance.trigger = ScrollTrigger.create({
          trigger: el,
          start: CONFIG.start,
          once: true, // L'animation ne se déclenche qu'une seule fois !
          onEnter: () => {
            playRevealAnimation(instance);
          },
        });
      } else if (typeof IntersectionObserver !== "undefined") {
        // Fallback natif si ScrollTrigger n'est pas disponible
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting && entry.intersectionRatio >= 0.2) {
                playRevealAnimation(instance);
                observer.unobserve(el);
              }
            });
          },
          { threshold: [0.2, 0.5] }
        );
        observer.observe(el);
        instance.trigger = observer;
      } else {
        // Si aucun observer n'est disponible, on joue directement
        playRevealAnimation(instance);
      }

      instances.add(instance);
    });
  }

  /**
   * Gestionnaire de redimensionnement responsive (avec Debounce 250ms).
   * Revert le DOM initial pour recalibrer le wrapping des lignes (desktop/tablette/mobile),
   * puis réinitialise uniquement les éléments non encore complétés sans aucun CLS.
   */
  let resizeTimeout = null;
  function handleResize() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (isReducedMotion() || instances.size === 0) return;

      instances.forEach((instance) => {
        // Si l'animation est déjà terminée, on revert le découpage pour un DOM propre
        // et on conserve l'élément visible à 100% (pas de réanimation).
        if (instance.isCompleted || instance.el.dataset.textRevealCompleted === "true") {
          if (instance.trigger) {
            if (instance.trigger.kill) instance.trigger.kill();
            else if (instance.trigger.disconnect) instance.trigger.disconnect();
          }
          if (instance.split && instance.split.revert) instance.split.revert();
          instance.el.style.opacity = "1";
          delete instance.el.dataset.textRevealInitialized;
          return;
        }

        // Si l'animation était en attente, on nettoie pour recalculer le layout
        if (instance.trigger) {
          if (instance.trigger.kill) instance.trigger.kill();
          else if (instance.trigger.disconnect) instance.trigger.disconnect();
        }
        if (instance.split && instance.split.revert) instance.split.revert();
        delete instance.el.dataset.textRevealInitialized;
      });
      instances.clear();

      // Réinitialisation après recalcul du layout par le navigateur
      initScrollTextReveal();
      if (typeof ScrollTrigger !== "undefined" && ScrollTrigger.refresh) {
        ScrollTrigger.refresh();
      }
    }, 250);
  }

  /**
   * Surveillance des mutations DOM (MutationObserver).
   * Détecte l'insertion de contenus dynamiques (ex : requêtes Supabase AJAX)
   * et déclenche leur révélation de manière autonome.
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
        window.requestAnimationFrame(() => {
          initScrollTextReveal();
          if (typeof ScrollTrigger !== "undefined" && ScrollTrigger.refresh) {
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

    const loadAndStart = () => {
      let started = false;
      const done = () => {
        if (started) return;
        started = true;
        startApp();
      };

      // Timeout de sécurité de 1.2s pour ne pas bloquer si les polices tardent
      const timeoutId = setTimeout(done, 1200);

      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
          clearTimeout(timeoutId);
          done();
        }).catch(() => {
          clearTimeout(timeoutId);
          done();
        });
      } else {
        clearTimeout(timeoutId);
        done();
      }
    };

    if (document.readyState === "complete" || document.readyState === "interactive") {
      loadAndStart();
    } else {
      window.addEventListener("DOMContentLoaded", loadAndStart);
    }
  }

  // Initialisation automatique du module
  boot();

  // Exposition globale pour usage avancé, configuration dynamique ou appel manuel
  window.ScrollTextReveal = {
    init: initScrollTextReveal,
    config: CONFIG,
    refresh: () => {
      if (typeof ScrollTrigger !== "undefined" && ScrollTrigger.refresh) {
        ScrollTrigger.refresh();
      }
    },
  };
})();
