/** @type {import('next').NextConfig} */

// Build natif (Capacitor) : export statique du front dans ./out, sans routes API
// (elles restent hébergées sur Vercel et sont appelées en absolu via NEXT_PUBLIC_API_BASE).
// Déclenché par CAPACITOR_BUILD=1 — le build Vercel normal n'est pas affecté.
const isCapacitor = process.env.CAPACITOR_BUILD === "1";
// Build du module Odoo (scripts/build-odoo.js) : export statique servi par Odoo
// sous /flow/ (module flow_app). ODOO_BUILD=1.
const isOdoo = process.env.ODOO_BUILD === "1";
const ODOO_BASE = "/flow";

// Version affichée en bas de l'app (et journalisée au lancement) : commit
// déployé + heure du build. Vercel fournit le commit ; en local, git.
let sha = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7);
if (!sha) { try { sha = require("child_process").execSync("git rev-parse --short=7 HEAD").toString().trim(); } catch { sha = "dev"; } }
const appEnv = {
  NEXT_PUBLIC_APP_VERSION: sha,
  NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  NEXT_PUBLIC_APP_TARGET: isOdoo ? "odoo" : isCapacitor ? "ipad" : "web",
  NEXT_PUBLIC_BASE_PATH: isOdoo ? ODOO_BASE : "",
  // Dans Odoo, les routes API restantes (assistant, import de bons, export
  // périmés) sont appelées sur Vercel.
  ...(isOdoo ? { NEXT_PUBLIC_API_BASE: process.env.ODOO_API_BASE || "https://flow.dr-hauschka.fr" } : {}),
};

const nextConfig = isOdoo
  ? {
      reactStrictMode: true,
      env: appEnv,
      output: "export",
      basePath: ODOO_BASE,
      trailingSlash: true,        // page servie en /flow/ (portée du service worker)
      images: { unoptimized: true },
    }
  : isCapacitor
  ? {
      reactStrictMode: true,
      env: appEnv,
      output: "export",
      // Les images passent par le proxy Odoo (URL absolue), pas par next/image.
      images: { unoptimized: true },
      // headers() n'est pas supporté en export statique — on l'omet côté natif.
    }
  : {
      reactStrictMode: true,
      env: appEnv,
      async headers() {
        return [
          {
            source: "/(.*)",
            headers: [
              { key: "X-Frame-Options", value: "DENY" },
              { key: "X-Content-Type-Options", value: "nosniff" },
              { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
              { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self)" },
            ],
          },
        ];
      },
    };

module.exports = nextConfig;
