import { supabase } from "./supabaseClient.js";

const FAV_KEY = "rn_favs";
const OWNER_KEY = "rn_favs_owner";
let userId = null;
let started = false;

export function getFavorites() {
  try {
    const ids = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
    return Array.isArray(ids) ? ids : [];
  } catch { return []; }
}

function saveFavorites(ids) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); } catch {}
  window.dispatchEvent(new CustomEvent("favs:updated", { detail: { ids } }));
}

export function isFavorite(id) {
  return getFavorites().includes(id);
}

export function removeFavoritesLocally(ids) {
  saveFavorites(getFavorites().filter(id => !ids.includes(id)));
}

export async function toggleFavorite(id) {
  const ids = getFavorites();
  const added = !ids.includes(id);
  saveFavorites(added ? [...ids, id] : ids.filter(x => x !== id));

  if (userId) {
    const { error } = added
      ? await supabase.from("favorites").upsert({ user_id: userId, product_id: id }, { onConflict: "user_id,product_id", ignoreDuplicates: true })
      : await supabase.from("favorites").delete().eq("user_id", userId).eq("product_id", id);
    if (error) console.warn("Favoris : synchronisation impossible", error.message);
  }
  return added;
}

function getOwner() {
  try { return localStorage.getItem(OWNER_KEY); } catch { return null; }
}

function setOwner(id) {
  try { id ? localStorage.setItem(OWNER_KEY, id) : localStorage.removeItem(OWNER_KEY); } catch {}
}

async function syncWithAccount(user) {
  userId = user.id;
  // Favoris laissés par un autre compte sur cet appareil : on ne les fusionne pas
  const owner = getOwner();
  if (owner && owner !== userId) saveFavorites([]);
  setOwner(userId);
  const { data, error } = await supabase.from("favorites").select("product_id").eq("user_id", userId);
  if (error) { console.warn("Favoris : lecture du compte impossible", error.message); return; }

  const remote = data.map(r => r.product_id);
  const missing = getFavorites().filter(id => !remote.includes(id));
  let toUpload = [];
  if (missing.length) {
    // Ignore les produits supprimés entre-temps
    const { data: existing } = await supabase.from("products").select("id").in("id", missing);
    toUpload = (existing || []).map(p => p.id);
    if (toUpload.length) {
      const { error: upErr } = await supabase
        .from("favorites")
        .upsert(toUpload.map(product_id => ({ user_id: userId, product_id })), { onConflict: "user_id,product_id", ignoreDuplicates: true });
      if (upErr) console.warn("Favoris : envoi vers le compte impossible", upErr.message);
    }
  }
  saveFavorites([...new Set([...remote, ...toUpload])]);
}

export function favButtonHtml(id, extraClass = "") {
  const on = isFavorite(id);
  return `<button type="button" class="fav-btn ${extraClass}${on ? " is-fav" : ""}" data-fav-id="${id}" aria-pressed="${on}" aria-label="${on ? "Retirer des favoris" : "Ajouter aux favoris"}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.6 4.5 7.1 4.5c2 0 3.6 1.1 4.9 2.9 1.3-1.8 2.9-2.9 4.9-2.9 3.5 0 5.7 3.5 4.4 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z"/></svg>
  </button>`;
}

function refreshFavButtons() {
  const ids = getFavorites();
  document.querySelectorAll(".fav-btn[data-fav-id]").forEach(btn => {
    const on = ids.includes(btn.dataset.favId);
    btn.classList.toggle("is-fav", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Retirer des favoris" : "Ajouter aux favoris");
  });
}

export function initFavorites() {
  if (started) return;
  started = true;

  document.addEventListener("click", e => {
    const btn = e.target.closest(".fav-btn[data-fav-id]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(btn.dataset.favId);
  });
  window.addEventListener("favs:updated", refreshFavButtons);
  window.addEventListener("storage", e => { if (e.key === FAV_KEY) refreshFavButtons(); });

  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    // setTimeout : Supabase déconseille d'appeler l'API directement dans ce callback
    if (user && user.id !== userId) setTimeout(() => syncWithAccount(user), 0);
    else if (!user && (userId || getOwner())) {
      // Déconnexion (ici, dans un autre onglet ou session expirée) : on vide les favoris du compte
      userId = null;
      setOwner(null);
      saveFavorites([]);
    }
  });
}
