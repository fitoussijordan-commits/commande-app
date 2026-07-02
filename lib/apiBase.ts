// lib/apiBase.ts
// Base URL des routes API (le proxy Odoo).
//
// - En web (déployé sur Vercel) : chemin relatif "" → "/api/odoo/proxy".
// - En natif (Capacitor iOS) : le front est embarqué dans l'app, il n'y a pas
//   de serveur local. On doit appeler le proxy hébergé sur Vercel en absolu.
//   On lit NEXT_PUBLIC_API_BASE (injecté au build), ex :
//   NEXT_PUBLIC_API_BASE=https://commande-app-tan.vercel.app
//
// Détection natif : Capacitor expose window.Capacitor. Si présent et qu'une base
// est configurée, on l'utilise ; sinon on reste en relatif.

export function apiBase(): string {
  const configured = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const isNative = Boolean((window as any).Capacitor?.isNativePlatform?.());
    if (isNative && configured) return configured;
  }
  return "";
}

// Construit l'URL complète d'une route API.
export function apiUrl(path: string): string {
  const base = apiBase();
  return `${base}${path.startsWith("/") ? path : "/" + path}`;
}
