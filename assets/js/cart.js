// assets/js/cart.js
import { STRIPE_STAYS } from "./stripeLinks.js";
import { supabase } from "./supabaseClient.js"; // garde au cas où (session)
import { getNextEventForStay, getMissingForEvent } from "./supabaseApi.js";

const $ = (id) => document.getElementById(id);

const els = {
  title: $("cartStayTitle"),
  basePrice: $("cartBasePrice"),
  qty: $("cartQty"),
  minus: $("qtyMinus"),
  plus: $("qtyPlus"),
  room: $("cartRoom"),
  total: $("cartTotal"),
  missing: $("cartMissing"),
  msg: $("cartMsg"),
  btn: $("btnConfirm"),
};

const STAYS = {
  // stayId supabase -> infos
  "5j4n": { name: "Séjour en Camargue", price: 970 },
  "4j3n": { name: "Voyage à Taghazout", price: 780 },

  // fallback si tu passes stay=camargue/taghazout dans l'URL
  camargue: { stayId: "5j4n", name: "Séjour en Camargue", price: 970 },
  taghazout: { stayId: "4j3n", name: "Voyage à Taghazout", price: 780 },
};

function euro(n){ return `${Math.round(Number(n) || 0)}€`; }
function setText(el, t){ if(el) el.textContent = t ?? ""; }

function getParams(){
  return new URLSearchParams(location.search);
}

async function getUserSession(){
  try{
    const { data } = await supabase.auth.getSession();
    return data?.session || null;
  }catch(e){
    return null;
  }
}

async function resolveStay(params){
  // priorité: stayId
  let stayId = params.get("stayId") || params.get("stay_id") || "";
  let stayKey = params.get("stay") || ""; // "camargue" ou "taghazout"
  let priceFromUrl = Number(params.get("price") || 0);

  if(!stayId && stayKey && STAYS[stayKey]?.stayId){
    stayId = STAYS[stayKey].stayId;
  }

  const info = STAYS[stayId] || STAYS[stayKey] || { name:"Séjour", price: priceFromUrl || 0 };
  const price = priceFromUrl || info.price || 0;

  return { stayId, name: info.name || "Séjour", price };
}

async function resolveEventId(stayId, params){
  const fromUrl = params.get("eventId") || params.get("event_id") || "";
  if(fromUrl) return fromUrl;

  try{
    const ev = await getNextEventForStay(stayId);
    return ev?.id || "";
  }catch(e){
    return "";
  }
}

function ensureRoomOptions(){
  // si tes options disparaissent, on force un fallback
  if(!els.room) return;

  if(els.room.options.length === 0){
    els.room.innerHTML = `
      <option value="double_partagee">Chambre double partagée</option>
      <option value="individuelle">Chambre individuelle (+120€)</option>
    `;
  }
}

async function init(){
  if(!els.btn){
    // pas sur panier.html
    return;
  }

  ensureRoomOptions();

  const params = getParams();
  const { stayId, name, price } = await resolveStay(params);
  const eventId = await resolveEventId(stayId, params);

  // affichage titre / prix
  setText(els.title, name);
  setText(els.basePrice, price ? `Prix : ${euro(price)} / personne` : "Prix : —");

  // qty
  let qty = 1;
  const updateTotal = () => {
    setText(els.qty, String(qty));
    const total = price * qty; // (si tu veux supplément chambre, dis-moi)
    setText(els.total, total ? euro(total) : "—");
  };
  updateTotal();

  els.minus?.addEventListener("click", () => { qty = Math.max(1, qty - 1); updateTotal(); });
  els.plus?.addEventListener("click", () => { qty = Math.min(8, qty + 1); updateTotal(); });

  // décompte manquantes
  try{
    if(eventId){
      const missing = await getMissingForEvent(eventId);
      setText(els.missing,
        missing > 0
          ? `Encore ${missing} réservations nécessaires pour valider ce séjour.`
          : `Séjour validé (minimum atteint).`
      );
    }else{
      setText(els.missing, "Dates en cours de mise à jour.");
    }
  }catch(e){
    setText(els.missing, "Décompte indisponible.");
  }

  // bouton = payer sur Stripe (ou login si pas connecté)
  const session = await getUserSession();

  if(!session){
    els.btn.textContent = "Créer un compte / Se connecter";
    els.btn.onclick = () => {
      sessionStorage.setItem("allowCart","1");
      sessionStorage.setItem("pendingStayId", stayId);
      sessionStorage.setItem("pendingEventId", eventId);
      sessionStorage.setItem("pendingQty", String(qty));
      sessionStorage.setItem("pendingRoom", els.room?.value || "");
      window.location.href = "compte.html";
    };
    return;
  }

  els.btn.textContent = "Payer sur Stripe";
  els.btn.onclick = () => {
    setText(els.msg, "");

    const link = STRIPE_STAYS[stayId];
    if(!link || !link.startsWith("https://buy.stripe.com/")){
      setText(els.msg, "Lien Stripe manquant/incorrect. Vérifie assets/js/stripeLinks.js.");
      return;
    }

    // Payment Link + quantité
    const url = new URL(link);
    url.searchParams.set("quantity", String(qty));

    // infos optionnelles
    url.searchParams.set("stayId", stayId);
    if(eventId) url.searchParams.set("eventId", eventId);
    if(els.room?.value) url.searchParams.set("room", els.room.value);

    window.location.href = url.toString();
  };
}

init();
