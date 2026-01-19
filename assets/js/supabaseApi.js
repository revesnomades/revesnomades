import { supabase } from "./supabaseClient.js";

export const MIN_BOOKINGS = 10;

/* =========================
   REDIRECTIONS AUTH (signup + reset)
   - à adapter si ton site a un domaine en prod
========================= */
export const AUTH_REDIRECTS = {
  signup: `${window.location.origin}/compte.html`,          // après confirmation d'email
  reset:  `${window.location.origin}/compte.html#reset`,    // après clic "reset password"
};

/** Inscription (avec redirect email) */
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: AUTH_REDIRECTS.signup,
    },
  });
  if (error) throw error;
  return data;
}

/** Connexion */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

/** Déconnexion */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Envoi email "Mot de passe oublié" (avec redirect vers compte.html#reset) */
export async function sendPasswordReset(email) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: AUTH_REDIRECTS.reset,
  });
  if (error) throw error;
  return data;
}

/** Mise à jour du mot de passe (après ouverture du lien reçu) */
export async function updatePassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (error) throw error;
  return data;
}

/* =========================
   DATA
========================= */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUpcomingEvents() {
  const today = new Date().toISOString().slice(0,10);
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .gte("start_date", today)
    .order("start_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getNextEventForStay(stayId) {
  const today = new Date().toISOString().slice(0,10);
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("stay_id", stayId)
    .gte("start_date", today)
    .order("start_date", { ascending: true })
    .limit(1);
  if (error) throw error;
  return (data && data[0]) ? data[0] : null;
}

export async function getBookingsCountForEvent(eventId) {
  const { data, error } = await supabase
    .from("bookings")
    .select("places")
    .eq("event_id", eventId);
  if (error) throw error;
  return (data || []).reduce((sum, r) => sum + (Number(r.places) || 0), 0);
}

export async function getMissingForEvent(eventId) {
  const total = await getBookingsCountForEvent(eventId);
  return Math.max(0, MIN_BOOKINGS - total);
}

/**
 * Réservation depuis panier.
 * ⚠️ Ajoute colonne room_type si tu veux la stocker (voir note en bas).
 */
export async function createBooking(eventId, places=1, roomType="double_partagee") {
  const session = await getSession();
  if (!session) throw new Error("Vous devez être connecté(e) pour réserver.");

  const { data, error } = await supabase
    .from("bookings")
    .insert({
      user_id: session.user.id,
      event_id: eventId,
      places: Number(places) || 1,
      room_type: roomType, // si colonne existe
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

export async function subscribeNewsletter(name, email) {
  const { error } = await supabase
    .from("newsletter")
    .insert({ name, email });
  if (error) throw error;
}

export async function sendMessage(subject, name, email, message) {
  const { error } = await supabase
    .from("messages")
    .insert({ subject, name, email, message });
  if (error) throw error;
}
