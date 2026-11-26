"use client";
// Bouton « Se déconnecter », toujours le DERNIER (le plus à droite) de l'en-tête de
// chaque écran. Confirmation explicite : hors ligne, impossible de se reconnecter
// (Odoo doit vérifier le mot de passe). La déconnexion elle-même est faite par
// app/page.tsx, qui écoute l'événement « flow:logout ».
export const LOGOUT_EVENT = "flow:logout";

export default function LogoutButton({ size = 36 }: { size?: number }) {
  return (
    <button
      onClick={() => {
        if (window.confirm("Se déconnecter d'Odoo ?\n\nAttention : hors ligne, impossible de se reconnecter. En tournée, reste connecté.")) {
          window.dispatchEvent(new Event(LOGOUT_EVENT));
        }
      }}
      title="Se déconnecter" aria-label="Se déconnecter"
      style={{ width: size, height: size, borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginLeft: "auto" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>
    </button>
  );
}
