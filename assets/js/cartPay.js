import { supabase } from "./supabaseClient.js";

// ✅ Mets tes Stripe Payment Links ici :
const STRIPE_LINK_4J = "https://buy.stripe.com/test_7sY7sF4GJaogdc11oM0ZW06";
const STRIPE_LINK_5J = "https://buy.stripe.com/test_3cI5kx3CFgME4Fv1oM0ZW01";

// (option) paypal
const PAYPAL_LINK = "COLLE_ICI_TON_LIEN_PAYPAL";

function getStayIdFromUrl(){
  const url = new URL(window.location.href);
  return url.searchParams.get("stayId") || url.searchParams.get("stay") || "";
}
function stripeLinkForStay(stayId){
  if(stayId === "4j3n") return STRIPE_LINK_4J;
  if(stayId === "5j4n") return STRIPE_LINK_5J;
  return "";
}

function redirectToAuth(){
  const url = new URL(window.location.href);
  // on garde les paramètres pour revenir au panier
  window.location.href = `compte.html?redirect=${encodeURIComponent(url.pathname + url.search)}`;
}

(async function(){
  const btnPay = document.getElementById("btnPay");
  const payMsg = document.getElementById("payMsg");
  const btnAuth = document.getElementById("btnAuth");
  const cartMsg = document.getElementById("cartMsg");

  const stayId = getStayIdFromUrl();

  // 1) check session
  const { data: { session } } = await supabase.auth.getSession();
  const isLogged = !!session?.user;

  // 2) UI: si pas connecté => bouton auth visible + paiement bloqué
  if(!isLogged){
    btnPay.disabled = true;
    payMsg.textContent = "Connectez-vous pour procéder au paiement.";
    btnAuth.style.display = "inline-flex";
    btnAuth.addEventListener("click", redirectToAuth);
    cartMsg.textContent = "Pour finaliser, merci de créer un compte ou de vous connecter.";
  } else {
    // connecté
    btnPay.disabled = false;
    payMsg.textContent = "";
    btnAuth.style.display = "none";
    cartMsg.textContent = `Connecté(e) : ${session.user.email}`;
  }

  // 3) si l’état change pendant que l’utilisateur est sur la page
  supabase.auth.onAuthStateChange((_event, newSession)=>{
    const logged = !!newSession?.user;
    if(!logged){
      btnPay.disabled = true;
      btnAuth.style.display = "inline-flex";
      payMsg.textContent = "Connectez-vous pour procéder au paiement.";
      cartMsg.textContent = "Pour finaliser, merci de créer un compte ou de vous connecter.";
    } else {
      btnPay.disabled = false;
      btnAuth.style.display = "none";
      payMsg.textContent = "";
      cartMsg.textContent = `Connecté(e) : ${newSession.user.email}`;
    }
  });

  // 4) Procéder au paiement
  btnPay.addEventListener("click", async ()=>{
    // re-check session pour être sûr
    const { data: { session: s2 } } = await supabase.auth.getSession();
    if(!s2?.user){
      redirectToAuth();
      return;
    }

    const method = document.querySelector('input[name="payMethod"]:checked')?.value || "card";

    if(method === "card"){
      const link = stripeLinkForStay(stayId);
      if(!link || link.includes("COLLE_ICI")){
        payMsg.textContent = "Stripe : colle ton Payment Link dans cartPay.js (STRIPE_LINK_4J / STRIPE_LINK_5J).";
        return;
      }
      window.location.href = link;
      return;
    }

    if(method === "paypal"){
      if(!PAYPAL_LINK || PAYPAL_LINK.includes("COLLE_ICI")){
        payMsg.textContent = "PayPal : colle ton lien PayPal dans cartPay.js (PAYPAL_LINK).";
        return;
      }
      window.location.href = PAYPAL_LINK;
      return;
    }

    payMsg.textContent = "Paiement en plusieurs fois : à configurer (Stripe/Klarna/Alma).";
  });
})();
