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

    // Try without carrier filter first (most reliable), then filter by carrier name
    const debugLog: string[] = [];
    let raw: Array<Record<string, unknown>> = [];

    {
      const params = new URLSearchParams({ country: countryCode, postal_code: postal_code });
      const res = await fetch(`https://panel.sendcloud.sc/api/v2/servicepoints?${params}`, {
        headers: { Authorization: `Basic ${credentials}` },
      });
      const body = await res.text();
      debugLog.push(`no-carrier: status=${res.status} body_len=${body.length}`);
      if (res.ok) {
        try {
          const data = JSON.parse(body);
          const all: Array<Record<string, unknown>> = data.service_points || [];
          debugLog.push(`total_points=${all.length} keys=${all[0] ? Object.keys(all[0]).join(",") : "none"}`);
          // Try to find Mondial Relay points
          const mr = all.filter(p =>
            String(p.carrier || "").toLowerCase().includes("mondial") ||
            String(p.carrier || "").toLowerCase().includes("mr") ||
            String(p.name || "").toLowerCase().includes("mondial")
          );
          raw = mr.length > 0 ? mr : all;
          debugLog.push(`mr_points=${mr.length} total_used=${raw.length}`);
        } catch (e) {
          debugLog.push(`parse_error=${e}`);
        }
      } else {
        debugLog.push(`body_preview=${body.slice(0, 200)}`);
      }
    }

    // Try with carrier slugs if still empty
    if (raw.length === 0) {
      for (const slug of ["mondial_relay", "mondialrelay", "MR"]) {
        const params = new URLSearchParams({ country: countryCode, postal_code: postal_code, carrier: slug });
        const res = await fetch(`https://panel.sendcloud.sc/api/v2/servicepoints?${params}`, {
          headers: { Authorization: `Basic ${credentials}` },
        });
        const body = await res.text();
        debugLog.push(`carrier=${slug} status=${res.status}`);
        if (res.ok) {
          try {
            const data = JSON.parse(body);
            raw = data.service_points || [];
            debugLog.push(`points=${raw.length}`);
            if (raw.length > 0) break;
          } catch (_) { /* ignore */ }
        }
      }
    }

    console.log("get-service-points debug:", debugLog.join(" | "));

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

    return new Response(JSON.stringify({ points, _debug: debugLog }), {
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
