// lib/serviceWorker.ts
// Enregistre le service worker (public/sw.js) qui permet d'OUVRIR l'app web
// sans réseau (navigateur relancé hors ligne, PWA). Voir public/sw.js.
//
// Web (Vercel) et app servie par Odoo (/flow/), en production uniquement : pas dans l'app iPad (Capacitor, front déjà
// embarqué, et les service workers n'y fonctionnent pas), pas en `next dev`
// (fichiers non versionnés : le cache servirait du code périmé).

import { APP_TARGET, asset } from "@/lib/appTarget";

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;
  if (APP_TARGET !== "web" && APP_TARGET !== "odoo") return;
  if (location.protocol !== "https:") return;

  const start = async () => {
    try {
      await navigator.serviceWorker.register(asset("/sw.js"), { scope: asset("/") });
      const reg = await navigator.serviceWorker.ready;

      // Fichiers déjà chargés par la page avant que le service worker ne la
      // contrôle (première visite) → on les lui confie pour la mise en cache.
      const sendLoaded = () => {
        const urls = performance.getEntriesByType("resource").map(e => e.name).filter(u => u.includes("/_next/static/"));
        reg.active?.postMessage({ type: "cache-urls", urls });
      };
      sendLoaded();

      // Morceaux chargés à la demande (export Excel) : préchargés une fois en
      // ligne, pour que l'export marche aussi hors ligne.
      setTimeout(async () => {
        if (!navigator.onLine) return;
        try { await import("exceljs"); } catch {}
        sendLoaded();
      }, 15000);
    } catch (e) {
      console.warn("[sw] enregistrement impossible", e);
    }
  };

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}
