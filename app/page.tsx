"use client";
import { useState, useEffect, useCallback } from "react";
import * as odoo from "@/lib/odoo";
import LoginScreen from "@/components/LoginScreen";
import OrderScreen from "@/components/OrderScreen";

const LS_SESSION = "commande_session";

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

  const handleLogout = () => {
    localStorage.removeItem(LS_SESSION);
    setSession(null);
  };

  if (!ready) return null;

  return (
    <>
      {session ? (
        <OrderScreen session={session} onBack={handleLogout} onToast={toast} />
      ) : (
        <LoginScreen onLogin={setSession} />
      )}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
