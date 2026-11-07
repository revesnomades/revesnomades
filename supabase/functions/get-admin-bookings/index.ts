import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_EMAILS = new Set(["contact@amesnomades.com", "sarnelli.ap@gmail.com", "revesnomades@gmail.com"]);

// Données clientes (emails, téléphones) : réservé aux administrateurs connectés
async function requireAdmin(req: Request, supabase: SupabaseClient) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  if (ADMIN_EMAILS.has((user.email || "").toLowerCase())) return user;
  const { data } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "admin" ? user : null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Configuration Supabase manquante" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    if (!(await requireAdmin(req, supabase))) {
      return new Response(JSON.stringify({ error: "Accès réservé aux administrateurs" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch stays with stay_dates
    const { data: stays, error: staysErr } = await supabase
      .from("stays")
      .select("*, stay_dates(*)")
      .order("created_at", { ascending: false });

    if (staysErr) throw staysErr;

    // Fetch all bookings using Service Role Key (bypassing RLS)
    const { data: bookings, error: bookingsErr } = await supabase
      .from("bookings")
      .select("*")
      .order("created_at", { ascending: false });

    if (bookingsErr) throw bookingsErr;

    // Fetch all orders using Service Role Key (bypassing RLS)
    const { data: orders, error: ordersErr } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .order("created_at", { ascending: false });

    if (ordersErr) console.warn("Erreur récuperation orders:", ordersErr);

    // Téléphones des comptes clients (par email), pour les réservations enregistrées avant le numéro obligatoire
    const phones: Record<string, string> = {};
    const { data: profiles, error: profilesErr } = await supabase.from("profiles").select("email, phone").not("phone", "is", null);
    if (profilesErr) console.warn("Erreur récupération téléphones:", profilesErr.message);
    for (const p of profiles || []) {
      if (p.email && p.phone) phones[String(p.email).toLowerCase()] = String(p.phone);
    }

    return new Response(
      JSON.stringify({
        stays: stays || [],
        bookings: bookings || [],
        orders: orders || [],
        phones,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Erreur serveur";
    console.error("get-admin-bookings Error:", errorMsg);
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
