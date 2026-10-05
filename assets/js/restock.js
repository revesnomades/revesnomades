import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseClient.js?v=3";

// Renvoie { ok: true } | { already: true } | { error: "message" }
export async function subscribeRestock(productId, email) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/restock-signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ product_id: productId, email }),
    });
    const data = await res.json().catch(() => null);
    if (data && (data.ok || data.already || data.error)) return data;
  } catch {
    // Fonction indisponible : on enregistre quand même l'inscription ci-dessous
  }

  const { error } = await supabase
    .from("restock_subscriptions")
    .insert([{ product_id: productId, email: email.trim().toLowerCase() }]);
  if (!error) return { ok: true };
  if (error.code === "23505") return { already: true };
  return { error: error.message };
}
