// Plan du site, tenu à jour tout seul : pages fixes + tous les séjours publiés + tous les produits.
// Si la base ne répond pas, le fichier sitemap.xml du site est servi à la place.
import { buildSitemap, readRows } from "../lib/seo.ts";

type Context = { next: () => Promise<Response> };

export default async function handler(request: Request, context: Context): Promise<Response> {
  if (request.method !== "GET") return context.next();
  const [stays, products] = await Promise.allSettled([
    readRows("stays?select=slug,published&published=eq.true&order=created_at.desc&limit=500"),
    readRows("products?select=id&order=created_at.desc&limit=1000"),
  ]);
  if (stays.status === "rejected" && products.status === "rejected") return context.next();

  const xml = buildSitemap(
    stays.status === "fulfilled" ? stays.value : [],
    products.status === "fulfilled" ? products.value : [],
  );
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-robots-tag": "noindex",
    },
  });
}

export const config = { path: "/sitemap.xml", onError: "bypass" };
