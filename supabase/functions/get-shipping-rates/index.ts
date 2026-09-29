import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

// ── Tarifs de fallback configurables ─────────────────────────────────────────
// Modifiez ces valeurs selon vos tarifs réels.
// Zone FR = France métropolitaine, EU = Europe, WORLD = reste du monde.
const EU_COUNTRIES = ["BE", "LU", "DE", "ES", "IT", "NL", "PT", "AT", "CH", "GB", "IE", "PL", "SE", "DK", "FI", "NO", "CZ", "HU", "RO", "BG", "HR", "SK", "SI", "EE", "LV", "LT", "CY", "MT", "GR"];

const FALLBACK_RATES: Array<{ id: string; name: string; carrier: string; zone: string[]; brackets: Array<{ max_g: number; price: number }> }> = [
  {
    id: "colissimo-fr",
    name: "Colissimo domicile",
    carrier: "Colissimo",
    zone: ["FR", "MC"],
    brackets: [
      { max_g: 250,  price: 4.95 },
      { max_g: 500,  price: 5.45 },
      { max_g: 1000, price: 6.45 },
      { max_g: 2000, price: 7.90 },
      { max_g: 5000, price: 10.90 },
      { max_g: 99999, price: 14.90 },
    ],
  },
  {
    id: "mondial-relay-fr",
    name: "Mondial Relay (point relais)",
    carrier: "Mondial Relay",
    zone: ["FR", "MC", "BE", "LU", "ES", "PT", "NL", "DE", "AT"],
    brackets: [
      { max_g: 500,  price: 3.90 },
      { max_g: 1000, price: 4.50 },
      { max_g: 2000, price: 5.50 },
      { max_g: 5000, price: 7.90 },
      { max_g: 99999, price: 11.90 },
    ],
  },
  {
    id: "colissimo-eu",
    name: "Colissimo Europe",
    carrier: "Colissimo",
    zone: EU_COUNTRIES,
    brackets: [
      { max_g: 500,  price: 11.90 },
      { max_g: 1000, price: 13.90 },
      { max_g: 2000, price: 16.90 },
      { max_g: 5000, price: 22.90 },
      { max_g: 99999, price: 29.90 },
    ],
  },
  {
    id: "colissimo-world",
    name: "Colissimo International",
    carrier: "Colissimo",
    zone: [], // catch-all : reste du monde
    brackets: [
      { max_g: 500,  price: 19.90 },
      { max_g: 1000, price: 24.90 },
      { max_g: 2000, price: 32.90 },
      { max_g: 5000, price: 44.90 },
      { max_g: 99999, price: 59.90 },
    ],
  },
];

function getFallbackMethods(toCountry: string, weightGrams: number) {
  const country = (toCountry || "FR").toUpperCase();

  // Méthodes avec zone explicite qui correspondent au pays
  const specificRates = FALLBACK_RATES.filter(r => r.zone.length > 0 && r.zone.includes(country));
  // Zone monde (catch-all) uniquement si aucune zone explicite ne correspond
  const worldRates = specificRates.length === 0
    ? FALLBACK_RATES.filter(r => r.zone.length === 0)
    : [];

  return [...specificRates, ...worldRates].map(r => {
    const bracket = r.brackets.find(b => weightGrams <= b.max_g) || r.brackets[r.brackets.length - 1];
    return { id: r.id, name: r.name, carrier: r.carrier, price: bracket.price };
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { to_postal_code, to_country, weight_grams, products_total } = await req.json();
    const weight = Math.max(1, Math.round(Number(weight_grams) || 500));
    const country = (to_country || "FR").toUpperCase();

    // Livraison gratuite dès 100 € d'articles shop (séjours exclus)
    if (Number(products_total) >= 100) {
      return new Response(JSON.stringify({
        methods: [{ id: "free", name: "Livraison offerte", carrier: "", price: 0 }],
        free_shipping: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const publicKey = Deno.env.get("SENDCLOUD_PUBLIC_KEY");
    const secretKey = Deno.env.get("SENDCLOUD_SECRET_KEY");
    const fromPostal = Deno.env.get("SENDCLOUD_FROM_POSTAL_CODE") || "75001";
    const fromCountry = Deno.env.get("SENDCLOUD_FROM_COUNTRY") || "FR";

    // Tenter SendCloud si configuré
    if (publicKey && secretKey) {
      try {
        const credentials = btoa(`${publicKey}:${secretKey}`);
        const params = new URLSearchParams({
          from_postal_code: fromPostal,
          from_country: fromCountry,
          to_postal_code: to_postal_code || "",
          to_country: country,
          weight: String(weight),
          unit: "gram",
        });

        const res = await fetch(`https://panel.sendcloud.sc/api/v2/shipping_methods?${params}`, {
          headers: { Authorization: `Basic ${credentials}` },
        });

        if (res.ok) {
          const data = await res.json();
          const scMethods = (data.shipping_methods || [])
            .map((m: Record<string, unknown>) => ({
              id: String(m.id),
              name: String(m.name),
              carrier: String(m.carrier || ""),
              price: Number(m.price) || 0,
            }))
            .filter((m: { price: number; name: string }) =>
              m.price > 0 && !m.name.toLowerCase().includes("unstamped")
            );

          if (scMethods.length > 0) {
            return new Response(JSON.stringify({ methods: scMethods }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      } catch (e) {
        console.warn("SendCloud unavailable, using fallback rates:", e);
      }
    }

    // Fallback : grille tarifaire interne
    const methods = getFallbackMethods(country, weight);
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
