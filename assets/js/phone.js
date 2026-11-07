// assets/js/phone.js — numéro de téléphone des clientes (obligatoire pour créer un compte et réserver)
import { supabase } from "./supabaseClient.js?v=3";

const PENDING_KEY = "rn_pending_phone";

// Met le numéro au format international : 06 12 34 56 78 → +33612345678 ; 0032… → +32…
export function normalizePhone(raw) {
  let v = String(raw || "").replace(/[\s.\-()\/]/g, "");
  if (v.startsWith("00")) v = "+" + v.slice(2);
  if (/^0[1-9]\d{8}$/.test(v)) v = "+33" + v.slice(1);
  return /^\+[1-9]\d{7,14}$/.test(v) ? v : "";
}

export const PHONE_HINT = "Indique un numéro de téléphone valide : 10 chiffres (06 12 34 56 78) ou au format international (+32 470 12 34 56).";

// Affichage lisible : +33612345678 → 06 12 34 56 78
export function formatPhone(v) {
  const s = String(v || "");
  if (/^\+33[1-9]\d{8}$/.test(s)) return ("0" + s.slice(3)).replace(/(\d{2})(?=\d)/g, "$1 ");
  return s;
}

// Numéro saisi avant une connexion Google : gardé le temps de l'aller-retour
export function rememberPendingPhone(phone) {
  try { localStorage.setItem(PENDING_KEY, phone); } catch {}
}

// Un seul chargement par compte, même si la page le demande plusieurs fois en même temps
const loaded = new Map();

export async function savePhone(user, phone) {
  // upsert : un compte créé avec Google n'a pas toujours de ligne profil
  const { error } = await supabase.from("profiles").upsert({ id: user.id, email: user.email, phone }, { onConflict: "id" });
  if (error) return error;
  loaded.set(user.id, Promise.resolve(phone));
  await supabase.auth.updateUser({ data: { phone } }).catch(() => {});
  return null;
}

// Numéro du compte connecté. S'il manque au profil, on enregistre celui saisi
// avant une connexion Google, ou celui gardé dans les données du compte.
export function getProfilePhone(user) {
  if (!user) return Promise.resolve("");
  if (!loaded.has(user.id)) loaded.set(user.id, loadProfilePhone(user));
  return loaded.get(user.id);
}

async function loadProfilePhone(user) {
  let pending = "";
  try { pending = localStorage.getItem(PENDING_KEY) || ""; localStorage.removeItem(PENDING_KEY); } catch {}
  let phone = "";
  try {
    const { data } = await supabase.from("profiles").select("phone").eq("id", user.id).maybeSingle();
    phone = data?.phone || "";
  } catch (e) {
    console.warn("Lecture du téléphone impossible :", e);
  }
  if (phone) return phone;
  const candidate = normalizePhone(pending) || normalizePhone(user.user_metadata?.phone);
  if (candidate && !(await savePhone(user, candidate))) return candidate;
  return "";
}
