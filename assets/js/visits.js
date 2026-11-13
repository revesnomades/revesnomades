// visits.js — comptage des visites sans cookie.
// Envoie au serveur : la page, le site d'origine (première page de la visite seulement) et la campagne (utm_source).
// Rien n'est stocké chez le visiteur. Les visites de l'administration ne sont pas comptées.
(() => {
  try {
    // Repère posé dans ce navigateur à l'ouverture de l'administration : mes propres visites ne comptent pas
    try { if (localStorage.getItem("an_admin") === "1") return; } catch (e) {}
    if (navigator.webdriver) return; // navigateur piloté par un robot
    var path = location.pathname || "/";
    // L'hébergeur sert « /boutique » pour « /boutique.html » : on garde un seul nom par page
    if (path !== "/" && !/\.[a-z0-9]+$/i.test(path)) path = path.replace(/\/+$/, "") + ".html";
    if (/^\/(admin-|acces-admin)/i.test(path)) return;

    var query = new URLSearchParams(location.search);
    var page = path;
    // Le séjour ou le produit affiché fait partie de la page
    if (/sejour\.html$/i.test(path) && query.get("slug")) page += "?slug=" + encodeURIComponent(query.get("slug"));
    else if (/produit\.html$/i.test(path) && query.get("id")) page += "?id=" + encodeURIComponent(query.get("id"));

    // Site d'origine : seulement si le visiteur arrive d'un autre site (donc sur la première page de sa visite)
    var origin = "";
    try { var host = new URL(document.referrer).hostname; if (host && host !== location.hostname) origin = host; } catch (e) {}

    var KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4cnh3Z3JnanZlc2V2amtqbXJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNzE4MTIsImV4cCI6MjA4Mjk0NzgxMn0.WQCWMfqGbhbdnYdkcpBAarVJBBstSFAK3_YYn5uNbKI";
    fetch("https://qxrxwgrgjvesevjkjmry.supabase.co/functions/v1/track-visit", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", "apikey": KEY, "Authorization": "Bearer " + KEY },
      body: JSON.stringify({ p: page, r: origin, c: query.get("utm_source") || "" })
    }).catch(function () {});
  } catch (e) {}
})();
