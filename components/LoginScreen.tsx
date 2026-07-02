"use client";
import { useState, useEffect } from "react";
import * as odoo from "@/lib/odoo";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e",
  red: "#dc2626", redSoft: "#fef2f2",
  shadowMd: "0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.05)",
  shadowXl: "0 20px 25px rgba(0,0,0,0.10), 0 8px 10px rgba(0,0,0,0.04)",
};

// Config (URL + base) mémorisée séparément de la session pour ne pas la resaisir
// à chaque connexion — seuls identifiants sont redemandés si la session expire.
const LS_CONFIG = "commande_config";

interface Props {
  onLogin: (session: odoo.OdooSession) => void;
}

export default function LoginScreen({ onLogin }: Props) {
  const [url, setUrl] = useState("");
  const [db, setDb] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CONFIG);
      if (raw) {
        const cfg = JSON.parse(raw);
        setUrl(cfg.url || "");
        setDb(cfg.db || "");
        setLogin(cfg.login || "");
      }
    } catch {}
    // iOS/WKWebView peut ouvrir le clavier en mettant le focus sur un champ au
    // lancement. On retire le focus au montage ET après un court délai, car iOS
    // le redonne parfois après le premier rendu.
    const blurAll = () => { try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch {} };
    blurAll();
    const t1 = setTimeout(blurAll, 100);
    const t2 = setTimeout(blurAll, 400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!url.trim() || !db.trim() || !login.trim() || !password) {
      setError("Tous les champs sont requis");
      return;
    }
    setLoading(true);
    try {
      const cleanUrl = url.trim().replace(/\/$/, "");
      const session = await odoo.authenticate({ url: cleanUrl, db: db.trim() }, login.trim(), password);
      localStorage.setItem(LS_CONFIG, JSON.stringify({ url: cleanUrl, db: db.trim(), login: login.trim() }));
      onLogin(session);
    } catch (e: any) {
      setError(e.message || "Connexion impossible");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", padding: 20 }}>
      <form onSubmit={handleSubmit} style={{ width: "100%", maxWidth: 380, background: C.white, borderRadius: 20, padding: "36px 32px", boxShadow: C.shadowXl }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: "linear-gradient(135deg, #0d9488, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: 28 }}>📋</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>Prise de commande</div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>Connexion à Odoo</div>
        </div>

        {error && (
          <div style={{ background: C.redSoft, color: C.red, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <Field label="URL Odoo" value={url} onChange={setUrl} placeholder="https://monentreprise.odoo.com" />
        <Field label="Base de données" value={db} onChange={setDb} placeholder="monentreprise" />
        <Field label="Identifiant" value={login} onChange={setLogin} placeholder="prenom.nom@entreprise.fr" />
        <Field label="Mot de passe" value={password} onChange={setPassword} placeholder="••••••••" type="password" />

        <button type="submit" disabled={loading}
          style={{ width: "100%", marginTop: 8, padding: "14px", background: loading ? C.muted : C.teal, color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: loading ? "default" : "pointer", fontFamily: "inherit" }}>
          {loading ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.textSec, marginBottom: 6 }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px", border: `1.5px solid ${C.border}`, borderRadius: 10, fontSize: 14, fontFamily: "inherit", color: C.text, outline: "none" }}
      />
    </div>
  );
}
