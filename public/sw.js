/* Service worker de Flow (version web : navigateur / PWA).
 *
 * But : pouvoir OUVRIR l'app sans réseau. Sans lui, relancer le navigateur
 * hors ligne et taper l'adresse donnait l'erreur du navigateur
 * (Firefox : NS_ERROR_OFFLINE) — les données hors ligne (IndexedDB) étaient là,
 * mais la page elle-même n'était jamais mise en cache.
 *
 * Stratégie :
 *  - Page (navigation)       : réseau d'abord (toujours la dernière version en
 *                              ligne), cache en secours (hors ligne / réseau lent).
 *  - /_next/static/…         : cache d'abord (fichiers versionnés, immuables).
 *  - autres fichiers du site : cache d'abord + rafraîchi en arrière-plan.
 *  - /api/… et autres sites  : JAMAIS en cache (Odoo, proxy) — passent tels quels.
 *
 * Pas utilisé dans l'app iPad (Capacitor) : là, le front est déjà embarqué.
 *
 * Même fichier pour Vercel (app à la racine « / ») et pour le module Odoo
 * flow_app (app sous « /flow/ ») : tous les chemins partent de BASE, déduit de
 * la portée d'enregistrement. Dans Odoo, tout ce qui est hors de /flow/
 * (/web/…, JSON-RPC) n'est jamais touché.
 */
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");   // "" ou "/flow"
const ROOT = BASE + "/";
const SHELL = "flow-shell-v1";     // page HTML + fichiers publics
const STATIC = "flow-static-v1";   // /_next/static (versionnés)
const NAV_TIMEOUT_MS = 6000;       // au-delà, on sert la page en cache

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // Pré-cache : la page + tous les scripts/styles qu'elle référence.
    try {
      const res = await fetch(ROOT, { cache: "no-store" });
      if (isAppPage(res)) {
        const html = await res.clone().text();
        await (await caches.open(SHELL)).put(ROOT, res);
        const assets = staticRefs(html);
        const st = await caches.open(STATIC);
        await Promise.all(assets.map((u) => st.add(u).catch(() => {})));
      }
      const shell = await caches.open(SHELL);
      await Promise.all(["/manifest.webmanifest", "/icons/icon-192.png", "/logo-full.png", "/logo-accueil.png"]
        .map((u) => shell.add(BASE + u).catch(() => {})));
    } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, STATIC];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// La page envoie la liste des fichiers qu'elle a chargés avant que le service
// worker ne la contrôle (première visite) : on les met en cache aussi.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "cache-urls" && Array.isArray(data.urls)) {
    event.waitUntil((async () => {
      const st = await caches.open(STATIC);
      for (const u of data.urls) {
        try {
          const url = new URL(u, self.location.origin);
          if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE + "/_next/static/")) continue;
          if (!(await st.match(url.pathname))) await st.add(url.pathname).catch(() => {});
        } catch {}
      }
    })());
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // Odoo, autres sites
  if (!url.pathname.startsWith(ROOT)) return;               // hors de l'app (dans Odoo : /web/…)
  if (url.pathname.startsWith(BASE + "/api/")) return;      // proxy Odoo : jamais en cache
  if (url.pathname === BASE + "/sw.js" || url.pathname === BASE + "/session") return;

  if (req.mode === "navigate") {
    event.respondWith(navigate(req));
    return;
  }
  if (url.pathname.startsWith(BASE + "/_next/static/")) {
    event.respondWith(cacheFirst(req, STATIC));
    return;
  }
  if (url.searchParams.has("_rsc")) return;                // données de navigation Next
  event.respondWith(staleWhileRevalidate(req, SHELL));
});

async function navigate(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await withTimeout(fetch(req), NAV_TIMEOUT_MS);
    // Une seule page dans l'app : on garde la dernière version sous ROOT.
    // (Pas une page de connexion Odoo vers laquelle on aurait été redirigé.)
    if (isAppPage(res)) {
      await cache.put(ROOT, res.clone());
      pruneStatic(res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cached = await cache.match(ROOT);
    if (cached) return cached;
    return new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>" +
      "<body style='font-family:sans-serif;padding:40px;text-align:center;color:#334155'>" +
      "<h2>Flow est hors ligne</h2><p>Ouvrez l'app une première fois avec du réseau pour pouvoir l'utiliser hors ligne.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

// Après une mise à jour, retire du cache les fichiers des anciennes versions
// (ceux que la nouvelle page ne référence plus). Les morceaux chargés à la
// demande sont remis en cache au fil de l'utilisation (message « cache-urls »).
async function pruneStatic(res) {
  const html = await res.text();
  const wanted = new Set(staticRefs(html));
  if (wanted.size === 0) return;
  const st = await caches.open(STATIC);
  const keys = await st.keys();
  const cached = new Set(keys.map((k) => new URL(k.url).pathname));
  // Nouvelle version = la page référence des fichiers pas encore en cache.
  const isUpdate = [...wanted].some((u) => !cached.has(u));
  if (isUpdate) await Promise.all(keys.filter((k) => !wanted.has(new URL(k.url).pathname)).map((k) => st.delete(k)));
  await Promise.all([...wanted].map((u) => st.match(u).then((hit) => hit || st.add(u).catch(() => {}))));
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => { if (res.ok) cache.put(req, res.clone()).catch(() => {}); return res; })
    .catch(() => undefined);
  return hit || (await net) || new Response("", { status: 504 });
}

// Vraie page de l'app (et pas une redirection vers la connexion Odoo).
function isAppPage(res) {
  if (!res || !res.ok || res.redirected) return false;
  try { return new URL(res.url).pathname === ROOT || new URL(res.url).pathname === BASE; } catch { return false; }
}

// Fichiers /_next/static référencés par la page (avec le préfixe BASE).
function staticRefs(html) {
  const re = new RegExp(BASE.replace(/[/]/g, "\\/") + "\\/_next\\/static\\/[^\"'\\s)]+", "g");
  return Array.from(new Set(html.match(re) || []));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
