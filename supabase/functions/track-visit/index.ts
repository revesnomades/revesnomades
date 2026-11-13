// Compte une visite de page publique, sans cookie.
// Reçoit { p: chemin, r: domaine d'origine (première page seulement), c: campagne utm_source }.
// Répond toujours « ok » : le visiteur ne voit jamais d'erreur.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanCampaign, cleanPath, cleanReferrer, clientIp, deviceOf, isBot, visitorHash } from "../_shared/visits.ts";
import { parisDate } from "../_shared/report.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};
const ok = () => new Response("ok", { status: 200, headers: { ...corsHeaders, "Content-Type": "text/plain" } });

// Seul le site peut déclarer des visites
const ALLOWED_ORIGINS = /^https:\/\/(www\.)?amesnomades\.com$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

serve(async (req) => {
  if (req.method !== "POST") return ok();
  try {
    const origin = req.headers.get("origin") || "";
    if (origin && !ALLOWED_ORIGINS.test(origin)) return ok();

    const userAgent = req.headers.get("user-agent") || "";
    if (isBot(userAgent)) return ok();

    const raw = await req.text();
    if (raw.length > 2000) return ok();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(raw); } catch { return ok(); }

    const path = cleanPath(body.p);
    if (!path) return ok(); // administration, page technique ou chemin invalide

    const supabaseUrl = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return ok();

    // Empreinte du jour : l'adresse IP sert au calcul puis est oubliée
    const hash = await visitorHash(clientIp(req.headers), userAgent, parisDate(new Date()), serviceKey);

    const supabase = createClient(supabaseUrl, serviceKey);
    // Doublons (même visiteur, même page, moins de 10 s) et plafond d'écritures par minute : gérés dans la base
    const { error } = await supabase.rpc("record_visit", {
      p_path: path,
      p_referrer: cleanReferrer(body.r),
      p_campaign: cleanCampaign(body.c),
      p_device: deviceOf(userAgent),
      p_hash: hash,
    });
    if (error) console.error("track-visit :", error.message);
  } catch (e) {
    console.error("track-visit :", e instanceof Error ? e.message : e);
  }
  return ok();
});
