// lib/network.ts
// Détection de l'état réseau. navigator.onLine est peu fiable (surtout iOS :
// il peut indiquer "en ligne" alors qu'il n'y a aucune connectivité réelle).
// On combine donc l'événement navigateur avec un ping léger vers le proxy Odoo.

"use client";
import { useEffect, useRef, useState, useCallback } from "react";

// Ping léger : on interroge le proxy avec un endpoint volontairement anodin.
// Le proxy répond quel que soit le résultat Odoo ; ce qui nous intéresse est
// uniquement de savoir si la requête HTTP aboutit (réseau up) ou non.
export async function probeConnection(timeoutMs = 4000): Promise<boolean> {
  if (typeof fetch === "undefined") return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/odoo/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ping: true }),
      signal: controller.signal,
      cache: "no-store",
    });
    // Toute réponse HTTP (même 4xx/5xx applicative) prouve que le réseau est là.
    return res.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface NetworkState {
  online: boolean;        // état confirmé (navigator + ping)
  checking: boolean;      // un ping est en cours
  recheck: () => void;    // force une revérification
}

// Hook React : expose l'état réseau confirmé et le revérifie
//  - au montage
//  - sur les événements online/offline du navigateur
//  - toutes les 30 s tant que l'app est visible
export function useNetwork(pollMs = 30000): NetworkState {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [checking, setChecking] = useState(false);
  const mounted = useRef(true);

  const run = useCallback(async () => {
    // Si le navigateur est certain d'être hors ligne, inutile de pinger.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (mounted.current) setOnline(false);
      return;
    }
    setChecking(true);
    const ok = await probeConnection();
    if (mounted.current) {
      setOnline(ok);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    run();

    const onOnline = () => run();
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const interval = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") run();
    }, pollMs);

    return () => {
      mounted.current = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(interval);
    };
  }, [run, pollMs]);

  return { online, checking, recheck: run };
}
