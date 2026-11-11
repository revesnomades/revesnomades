// Points relais Mondial Relay les plus proches d'une adresse, via l'API « service points » de Sendcloud.
// Doc : GET https://servicepoints.sendcloud.sc/api/v2/service-points?country=FR&carrier=mondial_relay&address=…&radius=…
// Prérequis côté Sendcloud : dans l'intégration API, « Points relais » activé et Mondial Relay coché.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

const SERVICE_POINTS_URL = "https://servicepoints.sendcloud.sc/api/v2/service-points";
const CARRIER = "mondial_relay";
// Rayon élargi par étapes : on s'arrête dès qu'il y a assez de choix
const RADII_METERS = [5000, 15000, 50000];
const ENOUGH_POINTS = 5;
const MAX_POINTS = 15;

type RawPoint = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\r\n<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const isMondialRelay = (p: RawPoint) => String(p.carrier || "").toLowerCase().replace(/[\s-]/g, "_").includes("mondial");

// Horaires : Sendcloud renvoie { "0": ["09:00 - 12:00", …], … "6": [] } (0 = lundi)
function openingTimes(p: RawPoint): string[][] | null {
  const raw = p.formatted_opening_times;
  if (!raw || typeof raw !== "object") return null;
  const days: string[][] = [];
  for (let d = 0; d < 7; d++) {
    const slots = (raw as Record<string, unknown>)[String(d)];
    days.push(Array.isArray(slots) ? slots.map(s => clean(s, 30)).filter(Boolean) : []);
  }
  return days.some(d => d.length) ? days : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const postal = clean(body.postal_code, 12);
    const city = clean(body.city, 80);
    const street = clean(body.line1 ?? body.street, 120);
    const country = (clean(body.country, 2) || "FR").toUpperCase();
    if (!postal) return json({ error: "postal_code requis" }, 400);

    const publicKey = Deno.env.get("SENDCLOUD_PUBLIC_KEY");
    const secretKey = Deno.env.get("SENDCLOUD_SECRET_KEY");
    if (!publicKey || !secretKey) return json({ error: "SendCloud non configuré" }, 500);
    const credentials = btoa(`${publicKey}:${secretKey}`);

    const debug: string[] = [];
    let lastStatus = 0;

    // Un appel Sendcloud ; renvoie uniquement des points Mondial Relay
    async function search(address: string, radius: number, withCarrier: boolean): Promise<RawPoint[] | null> {
      const params = new URLSearchParams({ country, address, radius: String(radius) });
      if (withCarrier) params.set("carrier", CARRIER);
      const res = await fetch(`${SERVICE_POINTS_URL}?${params}`, {
        headers: { Authorization: `Basic ${credentials}`, Accept: "application/json" },
      });
      lastStatus = res.status;
      const text = await res.text();
      if (!res.ok) {
        debug.push(`${withCarrier ? CARRIER : "tous"} r=${radius} « ${address} » → HTTP ${res.status} ${text.slice(0, 160)}`);
        return null;
      }
      let data: unknown;
      try { data = JSON.parse(text); } catch { debug.push(`réponse illisible (${text.length} octets)`); return null; }
      const list: RawPoint[] = Array.isArray(data)
        ? data
        : ((data as Record<string, unknown>)?.service_points as RawPoint[]) || ((data as Record<string, unknown>)?.results as RawPoint[]) || [];
      const points = list.filter(p => p && typeof p === "object" && isMondialRelay(p) && p.is_active !== false);
      debug.push(`${withCarrier ? CARRIER : "tous"} r=${radius} « ${address} » → ${list.length} reçus, ${points.length} Mondial Relay`);
      return points;
    }

    // Adresse de référence : la rue si elle est connue, sinon le code postal et la ville
    const postalCity = [postal, city].filter(Boolean).join(" ");
    const candidates = [...new Set([street ? `${street}, ${postalCity}` : "", postalCity].filter(Boolean))];

    let best: RawPoint[] = [];
    let usedAddress = "";
    let usedRadius = 0;
    let withCarrier = true;

    let anyAnswer = false; // Sendcloud a répondu correctement au moins une fois

    search: for (let i = 0; i < RADII_METERS.length; i++) {
      const radius = RADII_METERS[i];
      for (const address of candidates) {
        const found = await search(address, radius, withCarrier);
        if (found === null) {
          if (lastStatus === 401 || lastStatus === 403) break search; // clés refusées : inutile d'insister
          continue; // adresse non comprise : on essaie la suivante (code postal + ville)
        }
        anyAnswer = true;
        if (found.length > best.length) { best = found; usedAddress = address; usedRadius = radius; }
        if (found.length >= ENOUGH_POINTS) break search;
        if (found.length > 0) break; // cette adresse est comprise : on élargit seulement le rayon
      }
      // Aucune réponse valable avec le filtre transporteur : on redemande tous les transporteurs
      // (seuls les points Mondial Relay sont gardés)
      if (!anyAnswer && withCarrier) { withCarrier = false; i--; }
      else if (!anyAnswer) break;
    }

    console.log("get-service-points :", debug.join(" | "));

    if (!best.length && (lastStatus === 401 || lastStatus === 403)) {
      return json({ points: [], reason: "sendcloud_auth", debug });
    }
    // Sendcloud n'a jamais répondu correctement : ce n'est pas « aucun point relais »
    if (!anyAnswer) return json({ points: [], reason: "sendcloud_error", debug });

    // Du plus proche au plus loin
    const points = best
      .map((p) => {
        const lat = Number(p.latitude), lng = Number(p.longitude);
        return {
          id: String(p.id ?? ""),
          code: String(p.code ?? ""),
          name: clean(p.name, 80),
          street: clean(p.street, 100),
          house_number: clean(p.house_number, 12),
          city: clean(p.city, 80),
          postal_code: clean(p.postal_code, 12),
          country: (clean(p.country, 2) || country).toUpperCase(),
          distance: p.distance != null && Number.isFinite(Number(p.distance)) ? Math.round(Number(p.distance)) : null,
          latitude: Number.isFinite(lat) ? lat : null,
          longitude: Number.isFinite(lng) ? lng : null,
          locker: /locker|consigne/i.test(`${p.general_shop_type ?? ""} ${p.shop_type ?? ""} ${p.name ?? ""}`),
          opening_times: openingTimes(p),
        };
      })
      .filter(p => p.id && p.name);

    // Sans distance, on garde l'ordre renvoyé par Sendcloud
    if (points.some(p => p.distance != null)) {
      points.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    }

    return json({
      points: points.slice(0, MAX_POINTS),
      reference: usedAddress,
      radius_km: usedRadius / 1000,
      ...(points.length ? {} : { reason: "none_found" }),
      debug,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur inconnue";
    console.error("get-service-points error:", msg);
    return json({ error: msg }, 500);
  }
});
