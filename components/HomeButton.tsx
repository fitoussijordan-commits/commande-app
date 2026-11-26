"use client";
// Bouton « Accueil » : présent sur tous les écrans (sauf l'accueil lui-même), juste
// après la flèche retour. Ferme l'écran en cours et revient à la page d'accueil ;
// le retour est fait par components/OrderScreen, qui écoute « flow:home ».
export const HOME_EVENT = "flow:home";

export default function HomeButton({ size = 36 }: { size?: number }) {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event(HOME_EVENT))}
      title="Revenir à l'accueil" aria-label="Accueil"
      style={{ height: size, padding: "0 12px", borderRadius: 10, background: "#fff", border: "1px solid #e2e8f0", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, flexShrink: 0, color: "#334155", fontFamily: "inherit", fontSize: 13, fontWeight: 700 }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>
      Accueil
    </button>
  );
}
