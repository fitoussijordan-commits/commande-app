// lib/geo.ts
// Géolocalisation qui marche AUSSI en natif (Capacitor iOS).
//
// Problème : dans la WebView native (WKWebView), `navigator.geolocation` ne
// fonctionne pas — l'appel reste bloqué sans succès ni erreur. Il faut passer
// par le plugin natif @capacitor/geolocation (bridge vers le GPS iOS).
//
// On accède au plugin via `window.Capacitor.Plugins.Geolocation` (enregistré
// quand le plugin est installé + `npx cap sync`), sans import statique — ainsi
// le code compile même si le package n'est pas encore installé côté web.

export interface Coords { latitude: number; longitude: number; }

function isNative(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).Capacitor?.isNativePlatform?.());
}

export async function getCurrentPosition(timeoutMs = 12000): Promise<Coords> {
  // ── Chemin natif : plugin Capacitor Geolocation ──
  if (isNative()) {
    const Geo = (window as any).Capacitor?.Plugins?.Geolocation;
    if (!Geo) {
      throw new Error("Plugin de géolocalisation manquant (npm i @capacitor/geolocation + cap sync)");
    }
    try { await Geo.requestPermissions?.(); } catch {}
    // Sécurité anti-blocage : on rejette nous-mêmes après le timeout.
    const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Localisation : délai dépassé")), timeoutMs)),
      ]);
    const pos: any = await withTimeout(Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: timeoutMs }));
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  }

  // ── Chemin web : API navigateur ──
  return new Promise<Coords>((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("Géolocalisation non disponible sur cet appareil"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      (e) => reject(new Error(e?.message || "Position refusée ou indisponible")),
      { enableHighAccuracy: true, timeout: timeoutMs }
    );
  });
}
