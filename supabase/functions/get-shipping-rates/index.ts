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
    const { to_postal_code, to_country, weight_grams } = await req.json();

    const publicKey = Deno.env.get("SENDCLOUD_PUBLIC_KEY");
    const secretKey = Deno.env.get("SENDCLOUD_SECRET_KEY");
    const fromPostal = Deno.env.get("SENDCLOUD_FROM_POSTAL_CODE") || "75001";
    const fromCountry = Deno.env.get("SENDCLOUD_FROM_COUNTRY") || "FR";

    if (!publicKey || !secretKey) {
      return new Response(JSON.stringify({ error: "SendCloud non configuré" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const credentials = btoa(`${publicKey}:${secretKey}`);
    const weight = Math.max(1, Math.round(Number(weight_grams) || 100));

    const params = new URLSearchParams({
      from_postal_code: fromPostal,
      from_country: fromCountry,
      to_postal_code: to_postal_code || "",
      to_country: to_country || "FR",
      weight: String(weight),
      unit: "gram",
    });

    const res = await fetch(`https://panel.sendcloud.sc/api/v2/shipping_methods?${params}`, {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("SendCloud error:", res.status, text);
      return new Response(JSON.stringify({ error: `Erreur SendCloud ${res.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const methods = (data.shipping_methods || [])
      .map((m: Record<string, unknown>) => ({
        id: m.id,
        name: m.name,
        carrier: m.carrier,
        price: Number(m.price) || 0,
        min_weight: Number(m.min_weight) || 0,
        max_weight: Number(m.max_weight) || 99999,
      }))
      // Exclure les méthodes sans prix configuré
      .filter((m: { price: number }) => m.price > 0);

    return new Response(JSON.stringify({ methods }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("get-shipping-rates error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
