// lib/network.ts
// Détection de l'état réseau. navigator.onLine est peu fiable (surtout iOS :
// il peut indiquer "en ligne" alors qu'il n'y a aucune connectivité réelle).
// On combine donc l'événement navigateur avec un ping léger vers le proxy Odoo.

"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { apiUrl } from "@/lib/apiBase";

// Ping : une réponse HTTP du proxy prouve que le réseau est là. Avec l'URL Odoo
// (et la session), le proxy teste AUSSI la base Odoo : `odoo` vaut alors
// true/false. Sans cible, `odoo` reste null (non testé).
export interface Probe { net: boolean; odoo: boolean | null; odooError?: string }
export interface OdooTarget { odooUrl: string; sessionId?: string }

export async function probeOdoo(target?: OdooTarget, timeoutMs = 9000): Promise<Probe> {
  if (typeof fetch === "undefined") return { net: false, odoo: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl("/api/odoo/proxy"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ping: true, ...(target || {}) }),
      signal: controller.signal,
      cache: "no-store",
    });
    const d = await res.json().catch(() => ({}));
    return { net: res.status > 0, odoo: typeof d.odoo === "boolean" ? d.odoo : null, odooError: d.odooError };
  } catch {
    return { net: false, odoo: null };
  } finally {
    clearTimeout(timer);
  }
}

export interface NetworkState {
  online: boolean;        // état confirmé (navigator + ping)
  checking: boolean;      // un ping est en cours
  recheck: () => void;    // force une revérification
  odooUp: boolean | null; // la base Odoo répond (null = pas encore testé)
  odooError?: string;     // cause quand odooUp === false
}

// Hook React : expose l'état réseau confirmé et le revérifie
//  - au montage
//  - sur les événements online/offline du navigateur
//  - toutes les 30 s tant que l'app est visible
export function useNetwork(pollMs = 30000, target?: OdooTarget): NetworkState {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [checking, setChecking] = useState(false);
  const [odooUp, setOdooUp] = useState<boolean | null>(null);
  const [odooError, setOdooError] = useState<string | undefined>(undefined);
  const mounted = useRef(true);
  const targetRef = useRef(target);
  targetRef.current = target;

  const run = useCallback(async () => {
    // Si le navigateur est certain d'être hors ligne, c'est fiable → hors ligne.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (mounted.current) setOnline(false);
      return;
    }
    // navigator dit "en ligne" : on le croit tout de suite (évite un faux hors-ligne
    // le temps du ping). Le ping ne fait que confirmer/rafraîchir en arrière-plan
    // et ne repasse JAMAIS l'app hors ligne à lui seul (un ping peut échouer pour
    // du CORS/préflight alors que le réseau est bien là).
    if (mounted.current) setOnline(true);
    setChecking(true);
    const p = await probeOdoo(targetRef.current).catch(() => ({ net: false, odoo: null } as Probe));
    if (mounted.current) {
      // Le ping ne décide que de l'état ODOO : réseau KO sur ping → on ne sait
      // pas (CORS…), on garde le dernier état connu.
      if (p.net && p.odoo !== null) { setOdooUp(p.odoo); setOdooError(p.odoo ? undefined : p.odooError); }
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

  return { online, checking, recheck: run, odooUp, odooError };
}
