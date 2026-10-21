const CART_KEY = "rn_cart";

export function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); }
  catch { return []; }
}

function saveCart(cart) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
  window.dispatchEvent(new CustomEvent("cart:updated", { detail: { cart } }));
}

// Seuil de livraison offerte (articles du shop, hors séjours) — doit rester aligné avec get-shipping-rates
export const FREE_SHIPPING_THRESHOLD = 100;

export function formatPrice(n) {
  return (Number(n) || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "\u00a0€";
}

export function getQuantityInCart(id, type = "product") {
  return getCart().find(i => i.id === id && i.type === type)?.quantity || 0;
}

export function getProductsTotal() {
  return getCart().filter(i => i.type === "product").reduce((s, i) => s + (Number(i.price) || 0) * i.quantity, 0);
}

// Renvoie true si l'article a été ajouté, false si le stock maximum était déjà atteint
export function addToCart(item) {
  const cart = getCart();
  const idx = cart.findIndex(i => i.id === item.id && i.type === item.type);
  let added = true;
  if (idx >= 0) {
    const max = item.maxStock ?? cart[idx].maxStock ?? 99;
    if (item.maxStock != null) cart[idx].maxStock = item.maxStock;
    added = cart[idx].quantity < max;
    cart[idx].quantity = Math.min(cart[idx].quantity + 1, max);
  } else {
    cart.push({ ...item, quantity: item.quantity || 1 });
  }
  saveCart(cart);
  return added;
}

export function removeFromCart(id, type) {
  saveCart(getCart().filter(i => !(i.id === id && i.type === type)));
}

export function setQuantity(id, type, qty) {
  const cart = getCart();
  const item = cart.find(i => i.id === id && i.type === type);
  if (!item) return;
  item.quantity = Math.max(1, Math.min(qty, item.maxStock ?? 99));
  saveCart(cart);
}

export function setMaxStock(id, type, max) {
  const cart = getCart();
  const item = cart.find(i => i.id === id && i.type === type);
  if (!item) return;
  item.maxStock = max;
  item.quantity = Math.min(item.quantity, max);
  saveCart(cart.filter(i => i.quantity > 0));
}

// Met à jour les champs d'un article (ex. prix relu en base) sans toucher à la quantité
export function updateCartItem(id, type, patch) {
  const cart = getCart();
  const item = cart.find(i => i.id === id && i.type === type);
  if (!item) return;
  Object.assign(item, patch);
  saveCart(cart);
}

export function getCartCount() {
  return getCart().reduce((sum, i) => sum + i.quantity, 0);
}

export function getCartTotal() {
  return getCart().reduce((sum, i) => sum + i.price * i.quantity, 0);
}

export function clearCart() {
  try { localStorage.removeItem(CART_KEY); } catch {}
  window.dispatchEvent(new CustomEvent("cart:updated", { detail: { cart: [] } }));
}

export function initCartBadge() {
  const update = () => {
    const count = getCartCount();
    document.querySelectorAll(".cart-badge").forEach(el => {
      el.textContent = count;
      el.style.display = count > 0 ? "flex" : "none";
    });
    document.querySelectorAll(".cart-nav-link").forEach(el => {
      el.setAttribute("aria-label", `Panier (${count} article${count > 1 ? "s" : ""})`);
    });
  };
  update();
  window.addEventListener("cart:updated", update);
}
