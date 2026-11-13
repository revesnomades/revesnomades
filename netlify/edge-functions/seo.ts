// Pages séjour et produit : écrit le titre, la description, la photo et les données structurées du séjour
// ou du produit demandé dans la page, avant son envoi. Sans cela, Google et les aperçus de liens
// (WhatsApp, Instagram, Facebook) voient la même page générique pour tous les séjours et tous les produits.
// Au moindre souci (base lente, page inattendue), la page part telle quelle : rien ne casse.
import { applyMeta, metaForUrl, type PageMeta } from "../lib/seo.ts";

type Context = { next: () => Promise<Response> };

export default async function handler(request: Request, context: Context): Promise<Response> {
  if (request.method !== "GET") return context.next();

  // La page et les informations du séjour ou du produit sont demandées en même temps
  const [response, meta] = await Promise.all([
    context.next(),
    metaForUrl(new URL(request.url)).catch((e): PageMeta | null => {
      console.error("seo :", e instanceof Error ? e.message : e);
      return null;
    }),
  ]);
  if (!meta || response.status !== 200) return response;
  if (!(response.headers.get("content-type") || "").includes("text/html")) return response;

  const original = await response.text();
  let html = original;
  try { html = applyMeta(original, meta); } catch (e) { console.error("seo :", e instanceof Error ? e.message : e); }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  // La page dépend maintenant de la base : les repères « inchangée depuis… » du fichier ne valent plus
  headers.delete("etag");
  headers.delete("last-modified");
  return new Response(html, { status: 200, headers });
}

export const config = {
  path: ["/sejour.html", "/sejour", "/produit.html", "/produit"],
  onError: "bypass",
};
