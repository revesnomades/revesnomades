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
    const countryCode = (country || "FR").toUpperCase();

    // Try known Mondial Relay carrier slugs in order, then fallback without carrier filter
    const carrierSlugs = ["mondial_relay", "mondialrelay", "MR"];
    let raw: Array<Record<string, unknown>> = [];

    for (const slug of carrierSlugs) {
      const params = new URLSearchParams({
        country: countryCode,
        postal_code: postal_code,
        carrier: slug,
      });
      const res = await fetch(`https://panel.sendcloud.sc/api/v2/servicepoints?${params}`, {
        headers: { Authorization: `Basic ${credentials}` },
      });
      if (res.ok) {
        const data = await res.json();
        raw = data.service_points || [];
        if (raw.length > 0) break;
      }
    }

    // Last resort: fetch all service points and filter by name
    if (raw.length === 0) {
      const params = new URLSearchParams({ country: countryCode, postal_code: postal_code });
      const res = await fetch(`https://panel.sendcloud.sc/api/v2/servicepoints?${params}`, {
        headers: { Authorization: `Basic ${credentials}` },
      });
      if (res.ok) {
        const data = await res.json();
        const all: Array<Record<string, unknown>> = data.service_points || [];
        raw = all.filter(p =>
          String(p.carrier || "").toLowerCase().includes("mondial") ||
          String(p.carrier || "").toLowerCase().includes("mr")
        );
        if (raw.length === 0) raw = all; // show all if no MR found
      }
    }

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
