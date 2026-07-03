"use client";
import { useState, useEffect, useCallback, useRef, Component, type ReactNode } from "react";
import * as odoo from "@/lib/odoo";
import LoginScreen from "@/components/LoginScreen";
import OrderScreen from "@/components/OrderScreen";

const LS_SESSION = "commande_session";

// ── Filet de sécurité : écran de secours en cas de crash JS ──────────────────
// Sans lui, une erreur de rendu = page blanche définitive sur l'iPad en tournée.
// Les brouillons, le cache et la file d'envoi sont persistés (localStorage /
// IndexedDB) : recharger ne perd RIEN.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", padding: 24 }}>
          <div style={{ maxWidth: 420, width: "100%", background: "#fff", borderRadius: 20, padding: "36px 32px", textAlign: "center", boxShadow: "0 20px 25px rgba(0,0,0,0.10), 0 8px 10px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>L'application a rencontré un problème</div>
            <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5, marginBottom: 8 }}>
              Tes brouillons et commandes en attente sont conservés sur l'appareil — recharger ne perd rien.
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", marginBottom: 20, wordBreak: "break-word", maxHeight: 60, overflow: "hidden" }}>
              {String(this.state.error?.message || this.state.error)}
            </div>
            <button onClick={() => window.location.reload()}
              style={{ padding: "13px 28px", background: "#0d9488", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Recharger l'application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Toasts globaux ────────────────────────────────────────────────────────────
// Avant : onToast={(msg) => console.log(msg)} → AUCUN message n'était visible
// (confirmations, erreurs de préchargement, synchro…). Ici : vrai affichage.
type ToastType = "success" | "error" | "info";
interface Toast { id: number; msg: string; type: ToastType }

const TOAST_COLORS: Record<ToastType, { bg: string; icon: string }> = {
  success: { bg: "#16a34a", icon: "✓" },
  error:   { bg: "#dc2626", icon: "✕" },
  info:    { bg: "#0f172a", icon: "ℹ" },
};

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: "fixed", top: "calc(env(safe-area-inset-top) + 12px)", left: "50%",
      transform: "translateX(-50%)", zIndex: 500, display: "flex",
      flexDirection: "column", gap: 8, alignItems: "center", pointerEvents: "none",
      fontFamily: "'DM Sans', sans-serif", width: "min(92vw, 560px)",
    }}>
      {toasts.map(t => (
        <button key={t.id} onClick={() => onDismiss(t.id)}
          style={{
            pointerEvents: "auto", display: "flex", alignItems: "center", gap: 10,
            maxWidth: "100%", padding: "11px 16px", background: TOAST_COLORS[t.type].bg,
            color: "#fff", border: "none", borderRadius: 12, cursor: "pointer",
            fontFamily: "inherit", fontSize: 13, fontWeight: 600, textAlign: "left",
            boxShadow: "0 10px 25px rgba(15,23,42,0.25)", lineHeight: 1.4,
          }}>
          <span style={{
            flexShrink: 0, width: 20, height: 20, borderRadius: "50%",
            background: "rgba(255,255,255,0.22)", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 11,
          }}>{TOAST_COLORS[t.type].icon}</span>
          {t.msg}
        </button>
      ))}
    </div>
  );
}

export default function HomePage() {
  const [session, setSession] = useState<odoo.OdooSession | null>(null);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((msg: string, type: ToastType = "info") => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-2), { id, msg, type }]); // max 3 visibles
    // Les erreurs restent plus longtemps à l'écran
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), type === "error" ? 6000 : 3500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  // Restaure la session au chargement (évite de se reconnecter à chaque ouverture)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_SESSION);
      if (raw) setSession(JSON.parse(raw));
    } catch {}
    setReady(true);
  }, []);

  // Persiste la session dès qu'elle change (login, ou refresh du session_id par lib/odoo.ts)
  useEffect(() => {
    if (session) localStorage.setItem(LS_SESSION, JSON.stringify(session));
  }, [session]);

  // Session Odoo expirée (détectée par lib/odoo.ts) : avant, c'était silencieusement
  // traité comme du hors-ligne — le commercial voyait des données en cache sans savoir
  // que sa session était morte. On prévient clairement, SANS déconnecter (règle absolue).
  const lastSessionToastRef = useRef(0);
  useEffect(() => {
    const onExpired = () => {
      const now = Date.now();
      if (now - lastSessionToastRef.current < 60_000) return; // anti-spam : 1 toast/min max
      lastSessionToastRef.current = now;
      toast("Session Odoo expirée — déconnecte-toi puis reconnecte-toi (avec du réseau)", "error");
    };
    window.addEventListener("odoo:session-expired", onExpired);
    return () => window.removeEventListener("odoo:session-expired", onExpired);
  }, [toast]);

  const handleLogout = () => {
    localStorage.removeItem(LS_SESSION);
    setSession(null);
  };

  if (!ready) return null;

  return (
    <ErrorBoundary>
      {session ? (
        <OrderScreen session={session} onBack={handleLogout} onToast={toast} />
      ) : (
        <LoginScreen onLogin={setSession} />
      )}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </ErrorBoundary>
  );
}
