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

  const hasCookie = document.cookie.includes("an_admin_session=1");

  if(hasCookie){
    checkMaintenanceAccess().then(isAdmin => {
      if(!isAdmin){
        document.cookie = "an_admin_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax";
        window.location.href = "/maintenance.html";
      }
    });
    return;
  }

  const isAdmin = await checkMaintenanceAccess();

  if(!isAdmin){
    const path = window.location.pathname;
    if(!path.includes("maintenance") && !path.includes("compte")){
      window.location.href = "/maintenance.html";
    }
  }
}
