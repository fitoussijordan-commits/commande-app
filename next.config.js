/** @type {import('next').NextConfig} */

// Build natif (Capacitor) : export statique du front dans ./out, sans routes API
// (elles restent hébergées sur Vercel et sont appelées en absolu via NEXT_PUBLIC_API_BASE).
// Déclenché par CAPACITOR_BUILD=1 — le build Vercel normal n'est pas affecté.
const isCapacitor = process.env.CAPACITOR_BUILD === "1";

const nextConfig = isCapacitor
  ? {
      reactStrictMode: true,
      output: "export",
      // Les images passent par le proxy Odoo (URL absolue), pas par next/image.
      images: { unoptimized: true },
      // headers() n'est pas supporté en export statique — on l'omet côté natif.
    }
  : {
      reactStrictMode: true,
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
