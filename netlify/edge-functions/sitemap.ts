// Netlify — plan du site tenu à jour tout seul : pages fixes + séjours publiés + produits.
// Si la base ne répond pas, le fichier sitemap.xml du site est servi à la place.
import { handleSitemap } from "../lib/seo.ts";

type Context = { next: () => Promise<Response> };

export default function handler(request: Request, context: Context): Promise<Response> {
  return handleSitemap(request, () => context.next(), { clean: true });
}

export const config = { path: "/sitemap.xml", onError: "bypass" };
