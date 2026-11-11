import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

// ── Grille tarifaire de la livraison ─────────────────────────────────────────
// C'est CETTE grille qui fixe les modes et les prix proposés dans le panier.
// Pour changer un prix : modifier « price » dans la tranche de poids voulue (max_g = poids maximum en grammes).
// Zone FR = France métropolitaine, EU = Europe, WORLD = reste du monde.
// (L'ancien appel aux tarifs Sendcloud est retiré : il lisait les prix au mauvais endroit de la réponse,
//  ne renvoyait donc jamais rien, et cette grille s'appliquait déjà dans tous les cas.)
const EU_COUNTRIES = ["BE", "LU", "DE", "ES", "IT", "NL", "PT", "AT", "CH", "GB", "IE", "PL", "SE", "DK", "FI", "NO", "CZ", "HU", "RO", "BG", "HR", "SK", "SI", "EE", "LV", "LT", "CY", "MT", "GR"];

const SHIPPING_RATES: Array<{ id: string; name: string; carrier: string; delivery_time: string; zone: string[]; brackets: Array<{ max_g: number; price: number }> }> = [
  {
    id: "colissimo-fr",
    name: "Colissimo domicile",
    carrier: "Colissimo",
    delivery_time: "2 à 3 jours ouvrés",
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
    // Retrait en point relais : la cliente choisit son point dans le panier (fonction get-service-points).
    // Tarifs de départ = grille publique Mondial Relay de juin 2026 (3 à 5 kg : estimation). À ajuster.
    id: "mondial-relay-fr",
    name: "Mondial Relay · Point Relais",
    carrier: "Mondial Relay",
    delivery_time: "3 à 5 jours ouvrés",
    zone: ["FR"],
    brackets: [
      { max_g: 500,   price: 4.15 },
      { max_g: 1000,  price: 5.99 },
      { max_g: 3000,  price: 7.99 },
      { max_g: 5000,  price: 9.99 },
      { max_g: 10000, price: 15.99 },
      { max_g: 30000, price: 25.99 }, // au-delà de 30 kg : non proposé
    ],
  },
  {
    id: "colissimo-eu",
    name: "Colissimo Europe",
    carrier: "Colissimo",
    delivery_time: "4 à 7 jours ouvrés",
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
    delivery_time: "7 à 14 jours ouvrés",
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

function getMethods(toCountry: string, weightGrams: number) {
  const country = (toCountry || "FR").toUpperCase();

  // Méthodes avec zone explicite qui correspondent au pays
  const specificRates = SHIPPING_RATES.filter(r => r.zone.length > 0 && r.zone.includes(country));
  // Zone monde (catch-all) uniquement si aucune zone explicite ne correspond
  const worldRates = specificRates.length === 0
    ? SHIPPING_RATES.filter(r => r.zone.length === 0)
    : [];

  return [...specificRates, ...worldRates].flatMap(r => {
    const last = r.brackets[r.brackets.length - 1];
    // Dernière tranche « ouverte » (99999 g) : toujours proposée. Sinon, colis trop lourd : mode non proposé.
    const bracket = r.brackets.find(b => weightGrams <= b.max_g) || (last.max_g >= 99999 ? last : null);
    return bracket ? [{ id: r.id, name: r.name, carrier: r.carrier, delivery_time: r.delivery_time, price: bracket.price }] : [];
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { to_country, weight_grams, products_total } = await req.json();
    const weight = Math.max(1, Math.round(Number(weight_grams) || 500));
    const country = (to_country || "FR").toUpperCase();

    // Livraison gratuite dès 100 € d'articles shop (séjours exclus)
    if (Number(products_total) >= 100) {
      return new Response(JSON.stringify({
        methods: [{ id: "free", name: "Livraison offerte", carrier: "", price: 0 }],
        free_shipping: true,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Modes et prix : grille tarifaire ci-dessus
    const methods = getMethods(country, weight);
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
