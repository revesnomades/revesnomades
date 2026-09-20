// assets/js/cartPay.js
import { supabase } from "./supabaseClient.js";

document.addEventListener("DOMContentLoaded", async () => {
  const btnAuth = document.getElementById("btnAuth");
  const btnPay = document.getElementById("btnPay");
  const payMsg = document.getElementById("payMsg");
  const cartMsg = document.getElementById("cartMsg");

  // Check Auth State
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    if (btnAuth) {
      btnAuth.textContent = `Connecté : ${user.email}`;
      btnAuth.style.background = "#4f8c5b";
      btnAuth.style.color = "#fff";
      btnAuth.onclick = () => { window.location.href = "compte.html"; };
    }
  } else {
    if (btnAuth) {
      btnAuth.textContent = "Se connecter / Créer un compte";
      btnAuth.onclick = () => {
        window.location.href = `signup.html?redirect=${encodeURIComponent(window.location.href)}`;
      };
    }
  }

  if (btnPay) {
    btnPay.addEventListener("click", async () => {
      if (payMsg) {
        payMsg.style.color = "var(--text)";
        payMsg.textContent = "Initialisation du paiement…";
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert("Veuillez vous connecter ou créer un compte pour poursuivre le paiement.");
        window.location.href = `signup.html?redirect=${encodeURIComponent(window.location.href)}`;
        return;
      }

      // Read cart items from localStorage or page element
      let cartItems = [];
      try {
        const rawCart = localStorage.getItem("rn_cart");
        if (rawCart) {
          cartItems = JSON.parse(rawCart);
        }
      } catch (e) {
        console.warn("Erreur lecture panier localStorage:", e);
      }

      if (!cartItems || cartItems.length === 0) {
        // Fallback default item if cart empty
        const titleEl = document.getElementById("cartStayTitle");
        const priceEl = document.getElementById("cartTotal");
        const itemTitle = titleEl ? titleEl.textContent : "Séjour / Article Boutique";
        const itemPrice = priceEl ? parseFloat(priceEl.textContent) || 120 : 120;
        
        cartItems = [{
          id: "cart_item",
          title: itemTitle,
          price: itemPrice,
          quantity: 1,
          type: "product"
        }];
      }

      const { data: sessionData, error: sessionErr } = await supabase.functions.invoke("create-checkout-session", {
        body: {
          items: cartItems,
          userId: user.id,
          userEmail: user.email,
          returnUrl: window.location.origin
        }
      });

      if (sessionErr || !sessionData?.url) {
        console.error("Erreur Checkout:", sessionErr);
        if (payMsg) {
          payMsg.style.color = "#c00";
          payMsg.textContent = "Erreur lors de l'initialisation du paiement Stripe.";
        }
        return;
      }

      if (payMsg) {
        payMsg.style.color = "#4f8c5b";
        payMsg.textContent = "Redirection vers Stripe…";
      }

      window.location.href = sessionData.url;
    });
  }
});
