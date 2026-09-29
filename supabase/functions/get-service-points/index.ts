import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { postal_code, country } = await req.json();
    if (!postal_code) {
      return new Response(JSON.stringify({ error: "postal_code requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const publicKey = Deno.env.get("SENDCLOUD_PUBLIC_KEY");
    const secretKey = Deno.env.get("SENDCLOUD_SECRET_KEY");

    if (!publicKey || !secretKey) {
      return new Response(JSON.stringify({ error: "SendCloud non configuré" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const credentials = btoa(`${publicKey}:${secretKey}`);
    const params = new URLSearchParams({
      country: (country || "FR").toUpperCase(),
      postal_code: postal_code,
      carrier: "mondialrelay",
    });

    const res = await fetch(`https://panel.sendcloud.sc/api/v2/servicepoints?${params}`, {
      headers: { Authorization: `Basic ${credentials}` },
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`SendCloud service points error ${res.status}: ${txt}`);
    }

    const data = await res.json();
    const raw: Array<Record<string, unknown>> = data.service_points || [];

    // Keep only the first 10, return minimal fields
    const points = raw.slice(0, 10).map((p) => ({
      id: String(p.id || p.code || ""),
      name: String(p.name || ""),
      street: String(p.street || ""),
      house_number: String(p.house_number || ""),
      city: String(p.city || ""),
      postal_code: String(p.postal_code || ""),
      country: String(p.country || country || "FR").toUpperCase(),
      distance: p.distance != null ? Number(p.distance) : null,
      // opening hours as raw string if available
      formatted_opening_times: p.formatted_opening_times || null,
    }));

    return new Response(JSON.stringify({ points }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("get-service-points error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
