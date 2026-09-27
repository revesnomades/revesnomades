const CART_KEY = "rn_cart";

export function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || "[]"); }
  catch { return []; }
}

function saveCart(cart) {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
  window.dispatchEvent(new CustomEvent("cart:updated", { detail: { cart } }));
}

export function addToCart(item) {
  const cart = getCart();
  const idx = cart.findIndex(i => i.id === item.id && i.type === item.type);
  if (idx >= 0) {
    const max = item.maxStock ?? cart[idx].maxStock ?? 99;
    cart[idx].quantity = Math.min(cart[idx].quantity + 1, max);
  } else {
    cart.push({ ...item, quantity: item.quantity || 1 });
  }
  saveCart(cart);
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
