// assets/js/supabaseClient.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://qxrxwgrgjvesevjkjmry.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4cnh3Z3JnanZlc2V2amtqbXJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNzE4MTIsImV4cCI6MjA4Mjk0NzgxMn0.WQCWMfqGbhbdnYdkcpBAarVJBBstSFAK3_YYn5uNbKI"; // <-- ta vraie clé

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

function initUniformHeader() {
  const navInner = document.querySelector(".nav-inner");
  if (!navInner) return;

  const currentPath = window.location.pathname.toLowerCase();
  const isIndex = currentPath === "/" || currentPath.endsWith("/index.html") || currentPath === "" || currentPath.endsWith("/");
  const isSejour = currentPath.includes("sejour");

  let navLeft = navInner.querySelector(".nav-left");
  if (!navLeft) {
    navLeft = document.createElement("nav");
    navLeft.className = "nav-left nav-links-desktop";
    navLeft.setAttribute("aria-label", "Navigation gauche");
    navInner.insertBefore(navLeft, navInner.firstElementChild);
  }

  let leftLinksHTML = "";
  if (!isIndex) {
    leftLinksHTML += `<a href="/index.html">Accueil</a>`;
  }
  if (!isSejour) {
    leftLinksHTML += `<a href="/index.html#sejours">Séjours</a>`;
  }
  leftLinksHTML += `<a href="/boutique.html">Shop</a>`;
  navLeft.innerHTML = leftLinksHTML;

  const mobileMenu = document.querySelector(".mobile-menu");
  if (mobileMenu) {
    let mobileLinksHTML = "";
    if (!isIndex) {
      mobileLinksHTML += `<a href="/index.html">Accueil</a>`;
    }
    if (!isSejour) {
      mobileLinksHTML += `<a href="/index.html#sejours">Séjours</a>`;
    }
    mobileLinksHTML += `<a href="/boutique.html">Shop</a>`;
    mobileLinksHTML += `<a href="/index.html#apropos" data-scroll>À propos</a>`;
    mobileLinksHTML += `<a href="/faq.html">FAQ</a>`;
    mobileLinksHTML += `<a href="/index.html#contact" data-scroll>Contact</a>`;
    mobileLinksHTML += `<a href="/compte.html">Compte</a>`;
    mobileMenu.innerHTML = mobileLinksHTML;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initUniformHeader);
} else {
  initUniformHeader();
}
