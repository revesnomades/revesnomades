// Gestion accès admin pendant la maintenance
import { supabase } from "./supabaseClient.js";

// MAINTENANCE : passer à false quand le site est ouvert au public
export const MAINTENANCE_MODE = true;

export async function checkMaintenanceAccess(){
  if(!MAINTENANCE_MODE) return true;

  const { data: { user } } = await supabase.auth.getUser();
  if(!user) return false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return profile?.role === "admin";
}

export async function initPageWithMaintenanceCheck(){
  if(!MAINTENANCE_MODE) return;

  const isAdmin = await checkMaintenanceAccess();

  if(!isAdmin){
    const path = window.location.pathname;
    if(!path.includes("maintenance") && !path.includes("compte")){
      window.location.href = "/maintenance.html";
    }
  }
}
