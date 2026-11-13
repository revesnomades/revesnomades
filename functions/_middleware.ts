// Cloudflare Pages — référencement des pages séjour et produit, plan du site automatique, page de contrôle.
// Ce fichier n'est appelé que pour les adresses listées dans _routes.json ; tout le reste du site est
// servi directement, sans passer par ici. Au moindre souci, la page ou le fichier d'origine est servi tel quel.
import { handleCheck, handlePage, handleSitemap, SUPABASE_URL, type Fetcher } from "../netlify/lib/seo.ts";

type Env = { SEO_DB_URL?: string };
type Context = { request: Request; env: Env; next: () => Promise<Response> };

const PAGE = /^\/(sejour|produit)(\.html)?\/?$/i;

export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context;
  // Un seul appel à la suite de la chaîne, même si un traitement échoue après l'avoir lancé
  let pending: Promise<Response> | null = null;
  const next = () => pending ??= context.next();
  try {
    const path = new URL(request.url).pathname;
    // SEO_DB_URL : adresse de base de remplacement, utilisée seulement pour les essais en local
    const fetcher: Fetcher | undefined = env?.SEO_DB_URL
      ? (url, init) => fetch(url.replace(SUPABASE_URL, env.SEO_DB_URL!), init)
      : undefined;

    if (path === "/seo-check") return await handleCheck("Cloudflare Pages", { fetcher });
    // Chez Cloudflare Pages, /page.html est redirigé vers /page : le plan du site donne les adresses sans « .html »
    if (path === "/sitemap.xml") return await handleSitemap(request, next, { fetcher, clean: true });
    if (PAGE.test(path)) return await handlePage(request, next, { fetcher });
  } catch (e) {
    console.error("seo :", e instanceof Error ? e.message : e);
  }
  return next();
}
