// Comptabilité des revenus Stripe, sans abonnement Stripe payant :
// lit les "balance transactions" (encaissements, remboursements, frais, virements)
// via l'API Stripe standard et les relie aux commandes du site (order_ref, séjours / shop / bons cadeaux).
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@13.11.0?target=deno&no-check=true";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://amesnomades.com";
const ADMIN_EMAILS = new Set(["contact@amesnomades.com", "sarnelli.ap@gmail.com", "revesnomades@gmail.com"]);
const MAX_RANGE_DAYS = 400;

const allowedOrigins = new Set([
  "https://amesnomades.com",
  "https://www.amesnomades.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://localhost:8000",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : SITE_URL,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
  };
}

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(req) });
}

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

// ─── Types renvoyés à la page admin ────────────────────────────────────────
type Split = { sejours: number; boutique: number; bons_cadeaux: number; livraison: number };
type Kind = "paiement" | "remboursement" | "virement" | "frais" | "litige" | "autre";

type Row = {
  id: string;
  date: string;          // ISO
  kind: Kind;
  type: string;          // type Stripe brut
  brut: number;          // euros, signé (remboursement et virement négatifs)
  frais: number;         // euros, frais Stripe (positif = coût)
  net: number;           // euros, signé
  currency: string;
  description: string;
  statut: string;        // available | pending
  disponible_le: string; // ISO
  order_ref: string;
  client: string;
  email: string;
  recu_url: string;
  articles: string;      // libellé lisible des articles
  split: Split | null;   // ventilation du brut (paiements et remboursements)
  bon_utilise: number;   // part payée par bon cadeau (hors Stripe), info
  remise: number;        // remise promo appliquée (info)
};

type SessionInfo = {
  order_ref: string;
  articles: string;
  split: Split;
  bon_utilise: number;
  remise: number;
  email: string;
  name: string;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const cents = (n: unknown) => (Number(n) || 0) / 100;

function parseJson<T>(raw: string | undefined, fallback: T): T {
  try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

function kindOf(bt: any): Kind {
  const cat = String(bt.reporting_category || bt.type || "");
  if (cat === "charge" || cat === "payment") return "paiement";
  if (cat === "refund" || cat === "payment_refund" || cat === "refund_failure") return "remboursement";
  if (cat === "payout" || cat === "payout_reversal" || cat === "payout_failure") return "virement";
  if (cat === "fee" || cat === "stripe_fee" || cat === "tax") return "frais";
  if (cat === "dispute" || cat === "dispute_reversal" || cat === "adjustment") return "litige";
  return "autre";
}

// Ventile le montant encaissé entre séjours / shop / bons cadeaux / livraison
// à partir des métadonnées de la session Checkout (prix déjà remisés).
function sessionInfo(session: any): SessionInfo {
  const meta = session?.metadata || {};
  const items = parseJson<Array<{ type: string; name: string; qty: number; price?: number; d?: number }>>(meta.cart_items, []);
  const gifts = parseJson<Array<{ amount: number; to?: string }>>(meta.gift_items, []);
  const split: Split = { sejours: 0, boutique: 0, bons_cadeaux: 0, livraison: 0 };
  for (const it of items) {
    const line = (Number(it.price) || 0) * (Number(it.qty) || 1) - (Number(it.d) || 0);
    if (it.type === "sejour") split.sejours += line;
    else if (it.type === "gift_card") split.bons_cadeaux += line;
    else split.boutique += line;
  }
  for (const g of gifts) split.bons_cadeaux += Number(g.amount) || 0;
  split.livraison = cents(session?.shipping_cost?.amount_total);

  const giftUsed = Number(meta.gift_amount) || 0;
  // Si une partie a été payée par bon cadeau, le brut Stripe est plus petit : on répartit au prorata
  const sum = split.sejours + split.boutique + split.bons_cadeaux + split.livraison;
  const charged = cents(session?.amount_total);
  if (giftUsed > 0 && sum > 0 && charged > 0 && charged < sum) {
    const f = charged / sum;
    split.sejours *= f; split.boutique *= f; split.bons_cadeaux *= f; split.livraison *= f;
  }
  (Object.keys(split) as Array<keyof Split>).forEach(k => split[k] = r2(split[k]));

  const articles = [
    ...items.map(i => `${i.name} ×${i.qty}`),
    ...gifts.map(g => `Bon cadeau ${Number(g.amount).toFixed(0)} €${g.to ? ` pour ${g.to}` : ""}`),
  ].join(", ");
  return {
    order_ref: String(meta.order_ref || ""),
    articles,
    split,
    bon_utilise: giftUsed,
    remise: Number(meta.discount_amount) || 0,
    email: session?.customer_details?.email || meta.user_email || "",
    name: session?.shipping_details?.name || session?.customer_details?.name || "",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!supabaseUrl || !serviceRoleKey || !stripeKey) return json(req, { error: "Configuration manquante" }, 500);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const admin = await requireAdmin(req, supabase);
    if (!admin) return json(req, { error: "Accès réservé aux administrateurs" }, 403);

    const body = await req.json().catch(() => ({}));
    const from = Math.floor(Number(body.from) || 0);
    const to = Math.floor(Number(body.to) || 0);
    if (!from || !to || to < from) return json(req, { error: "Période invalide" }, 400);
    if ((to - from) / 86400 > MAX_RANGE_DAYS) return json(req, { error: `Période limitée à ${MAX_RANGE_DAYS} jours` }, 400);

    const stripe = new Stripe(stripeKey, { apiVersion: "2022-11-15", httpClient: Stripe.createFetchHttpClient() });

    // 1. Toutes les opérations du solde Stripe sur la période (paginé)
    const txs: any[] = [];
    let starting_after: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await stripe.balanceTransactions.list({
        created: { gte: from, lte: to },
        limit: 100,
        expand: ["data.source"],
        ...(starting_after ? { starting_after } : {}),
      });
      txs.push(...res.data);
      if (!res.has_more || !res.data.length) break;
      starting_after = res.data[res.data.length - 1].id;
    }

    // 2. Relier chaque paiement / remboursement à sa session Checkout (order_ref, articles)
    const piIds = new Set<string>();
    for (const bt of txs) {
      const src = bt.source;
      if (!src || typeof src !== "object") continue;
      const pi = typeof src.payment_intent === "string" ? src.payment_intent : src.payment_intent?.id;
      if (pi) piIds.add(pi);
    }
    const sessions = new Map<string, SessionInfo>();
    const ids = [...piIds];
    for (let i = 0; i < ids.length; i += 8) {
      await Promise.all(ids.slice(i, i + 8).map(async (pi) => {
        try {
          const list = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 });
          if (list.data[0]) sessions.set(pi, sessionInfo(list.data[0]));
        } catch (e) {
          console.warn("session introuvable pour", pi, (e as Error).message);
        }
      }));
    }

    // 3. Lignes normalisées
    const rows: Row[] = txs.map((bt) => {
      const src = (bt.source && typeof bt.source === "object") ? bt.source : null;
      const pi = src ? (typeof src.payment_intent === "string" ? src.payment_intent : src.payment_intent?.id) : "";
      const info = pi ? sessions.get(pi) : undefined;
      const kind = kindOf(bt);
      const brut = cents(bt.amount);
      const frais = cents(bt.fee);
      const refundOfCharge = kind === "remboursement" && info ? info.split : null;
      let split: Split | null = null;
      if (kind === "paiement" && info) split = info.split;
      else if (refundOfCharge) {
        // Remboursement : même ventilation que le paiement, au prorata du montant remboursé
        const sum = refundOfCharge.sejours + refundOfCharge.boutique + refundOfCharge.bons_cadeaux + refundOfCharge.livraison;
        const f = sum > 0 ? brut / sum : 0;
        split = { sejours: r2(refundOfCharge.sejours * f), boutique: r2(refundOfCharge.boutique * f), bons_cadeaux: r2(refundOfCharge.bons_cadeaux * f), livraison: r2(refundOfCharge.livraison * f) };
      }
      const billing = src?.billing_details || {};
      return {
        id: bt.id,
        date: new Date(bt.created * 1000).toISOString(),
        kind,
        type: String(bt.type || ""),
        brut,
        frais,
        net: cents(bt.net),
        currency: String(bt.currency || "eur").toUpperCase(),
        description: String(bt.description || src?.description || ""),
        statut: String(bt.status || ""),
        disponible_le: new Date((bt.available_on || bt.created) * 1000).toISOString(),
        order_ref: info?.order_ref || String(src?.metadata?.order_ref || ""),
        client: info?.name || billing.name || src?.shipping?.name || "",
        email: info?.email || billing.email || src?.receipt_email || "",
        recu_url: String(src?.receipt_url || ""),
        articles: info?.articles || "",
        split,
        bon_utilise: kind === "paiement" ? (info?.bon_utilise || 0) : 0,
        remise: kind === "paiement" ? (info?.remise || 0) : 0,
      };
    });

    // 4. Bons cadeaux utilisés sur la période (paiements hors Stripe, pour information)
    let giftRedemptions = 0;
    try {
      const { data } = await supabase.from("gift_card_redemptions").select("amount")
        .gte("created_at", new Date(from * 1000).toISOString()).lte("created_at", new Date(to * 1000).toISOString());
      giftRedemptions = r2((data || []).reduce((s: number, x: any) => s + (Number(x.amount) || 0), 0));
    } catch (e) { console.warn("gift_card_redemptions :", (e as Error).message); }

    // 5. Solde Stripe actuel
    let balance: { disponible: number; en_attente: number } | null = null;
    try {
      const b = await stripe.balance.retrieve();
      const sum = (arr: any[]) => r2((arr || []).filter(x => x.currency === "eur").reduce((s, x) => s + cents(x.amount), 0));
      balance = { disponible: sum(b.available), en_attente: sum(b.pending) };
    } catch (e) { console.warn("balance :", (e as Error).message); }

    return json(req, { rows, gift_redemptions: giftRedemptions, balance, period: { from, to }, livemode: !stripeKey.startsWith("sk_test") });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur serveur";
    console.error("stripe-accounting :", msg);
    return json(req, { error: msg }, 500);
  }
});
