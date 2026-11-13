// Netlify — pages séjour et produit : écrit le titre, la description, la photo et les données structurées
// du séjour ou du produit demandé dans la page, avant son envoi. Au moindre souci, la page part telle quelle.
// (Le même traitement existe pour Cloudflare Pages dans functions/_middleware.ts.)
import { handlePage } from "../lib/seo.ts";

type Context = { next: () => Promise<Response> };

export default function handler(request: Request, context: Context): Promise<Response> {
  return handlePage(request, () => context.next(), { clean: true });
}

export const config = {
  path: ["/sejour.html", "/sejour", "/produit.html", "/produit"],
  onError: "bypass",
};
