// lib/cors.ts
// En-têtes CORS pour permettre à l'app native (Capacitor, origine
// capacitor://localhost ou ionic://localhost) d'appeler le proxy hébergé
// sur Vercel. En web classique, l'app et le proxy partagent le domaine, donc
// CORS n'est pas nécessaire — mais ces en-têtes ne gênent pas ce cas-là.

import { NextResponse } from "next/server";

// Origines de confiance : les schémas Capacitor iOS + localhost de dev natif.
// On renvoie l'origine reçue si elle correspond, sinon on autorise largement
// en lecture (le proxy est déjà verrouillé côté SSRF sur ODOO_URL).
export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// Réponse au préflight OPTIONS.
export function preflight(origin: string | null): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

// Ajoute les en-têtes CORS à une réponse existante.
export function withCors(res: NextResponse, origin: string | null): NextResponse {
  const h = corsHeaders(origin);
  Object.entries(h).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}
