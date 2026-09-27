import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    let email = "";
    try {
      const body = await req.json();
      email = body.email || "";
    } catch (_) {
      // Body optionnel
    }

    // Récupérer l'email depuis le token JWT si non transmis explicitement dans le body
    const authHeader = req.headers.get("Authorization");
    if (!email && authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const supabaseAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey);
      const { data: { user } } = await supabaseAuth.auth.getUser(token);
      if (user?.email) {
        email = user.email;
      }
    }

    if (!email) {
      return new Response(JSON.stringify({ error: "Email utilisateur requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch séjours pour enrichir les titres/dates
    const { data: stays } = await supabase
      .from("stays")
      .select("id, title, published, is_single_day, stay_dates(*)");

    // Fetch réservations de l'utilisateur (via Service Role Key pour contourner RLS)
    const { data: bookings, error: bookingsErr } = await supabase
      .from("bookings")
      .select("*")
      .ilike("customer_email", cleanEmail)
      .order("created_at", { ascending: false });

    if (bookingsErr) throw bookingsErr;

    // Fetch commandes de l'utilisateur (via Service Role Key pour contourner RLS)
    const { data: orders, error: ordersErr } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .ilike("customer_email", cleanEmail)
      .order("created_at", { ascending: false });

    if (ordersErr) console.warn("Erreur récuperation orders user:", ordersErr);

    return new Response(
      JSON.stringify({
        email: cleanEmail,
        stays: stays || [],
        bookings: bookings || [],
        orders: orders || []
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Erreur serveur";
    console.error("get-user-bookings Error:", errorMsg);
    return new Response(JSON.stringify({ error: errorMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
