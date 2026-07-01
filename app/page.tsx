"use client";
import { useState, useEffect } from "react";
import * as odoo from "@/lib/odoo";
import LoginScreen from "@/components/LoginScreen";
import OrderScreen from "@/components/OrderScreen";

const LS_SESSION = "commande_session";

export default function HomePage() {
  const [session, setSession] = useState<odoo.OdooSession | null>(null);
  const [ready, setReady] = useState(false);

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

  if (!session) {
    return <LoginScreen onLogin={setSession} />;
  }

  return (
    <OrderScreen
      session={session}
      onBack={handleLogout}
      onToast={(msg) => console.log(msg)}
    />
  );
}
