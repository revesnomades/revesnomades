// Netlify — page de contrôle : https://amesnomades.com/seo-check
import { handleCheck } from "../lib/seo.ts";

export default function handler(_request: Request): Promise<Response> {
  return handleCheck("Netlify");
}

export const config = { path: "/seo-check" };
