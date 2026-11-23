// lib/appTarget.ts
// Cible du build, figée au moment du build (next.config.js) :
//  - "web"   : Vercel (flow.dr-hauschka.fr) — Odoo joint via le proxy /api/odoo/proxy.
//  - "ipad"  : app Capacitor — même proxy, appelé en absolu sur Vercel.
//  - "odoo"  : app servie PAR Odoo (module flow_app, URL /flow/) — Odoo est sur
//              le même domaine : appels JSON-RPC directs avec le cookie de session
//              Odoo, sans proxy ni écran de connexion (on est déjà connecté à Odoo).
//              Les autres routes API (assistant, import de bons, export périmés)
//              restent sur Vercel (NEXT_PUBLIC_API_BASE).

export const APP_TARGET = process.env.NEXT_PUBLIC_APP_TARGET || "web";
export const IS_ODOO = APP_TARGET === "odoo";

// Préfixe des URL de l'app : "" sur Vercel, "/flow" dans Odoo.
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");

// Fichier de public/ (logos, icônes…) : à utiliser pour tout chemin absolu,
// sinon il pointerait à la racine d'Odoo au lieu de /flow/.
export function asset(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : "/" + path}`;
}
