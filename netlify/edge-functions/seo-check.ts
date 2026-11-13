// Page de contrôle : https://amesnomades.com/seo-check
// Si cette page s'affiche, les fonctions Netlify sont en service ; elle dit aussi si la base répond.
import { readRows } from "../lib/seo.ts";

export default async function handler(_request: Request): Promise<Response> {
  const [stays, products] = await Promise.allSettled([
    readRows("stays?select=slug&published=eq.true&limit=500"),
    readRows("products?select=id&limit=1000"),
  ]);
  const why = (r: PromiseRejectedResult) => r.reason instanceof Error ? r.reason.message : String(r.reason);
  const lines = [
    "Fonctions Netlify : actives",
    stays.status === "fulfilled" ? `Séjours publiés lus dans la base : ${stays.value.length}` : `Séjours publiés : lecture impossible (${why(stays)})`,
    products.status === "fulfilled" ? `Produits lus dans la base : ${products.value.length}` : `Produits : lecture impossible (${why(products)})`,
  ];
  return new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

export const config = { path: "/seo-check" };
