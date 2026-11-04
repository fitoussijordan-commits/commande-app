"use client";
// Carte d'accueil à onglets (pour garder l'accueil lisible) :
//   Priorités (clients à visiter) · Top / Flop (évolution du CA).
// Le suivi des MEA a son propre écran (« Mes MEA », components/MeaTracking).
import { useState } from "react";
import * as odoo from "@/lib/odoo";
import { GLASS } from "@/components/glass";
import VisitPriority from "@/components/VisitPriority";
import TopFlop from "@/components/TopFlop";

type Tab = "prio" | "topflop";

export default function HomeInsights({ session, onOpenClient }: {
  session: odoo.OdooSession;
  onOpenClient: (client: any) => void;
}) {
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = localStorage.getItem("wms_home_tab"); return t === "topflop" ? t : "prio"; } catch { return "prio"; }
  });
  const [prioCount, setPrioCount] = useState(0);
  const choose = (t: Tab) => { setTab(t); try { localStorage.setItem("wms_home_tab", t); } catch {} };
  const tabs: [Tab, string][] = [["prio", "À visiter"], ["topflop", "Top / Flop"]];

  return (
    <div style={{ ...GLASS, padding: 18, display: "flex", flexDirection: "column" as const, minHeight: 0 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 14, background: "rgba(255,255,255,0.5)", borderRadius: 999, padding: 3, alignSelf: "flex-start" }}>
        {tabs.map(([t, l]) => (
          <button key={t} onClick={() => choose(t)}
            style={{ height: 30, padding: "0 13px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 800,
              display: "flex", alignItems: "center", gap: 6,
              background: tab === t ? "rgba(255,255,255,0.95)" : "transparent", color: tab === t ? "#0f766e" : "#64748b",
              boxShadow: tab === t ? "0 2px 8px rgba(15,23,42,0.1)" : "none" }}>
            {l}
            {t === "prio" && prioCount > 0 && <span style={{ fontSize: 11, color: "#fff", background: "#ea580c", borderRadius: 999, padding: "1px 7px" }}>{prioCount}</span>}
          </button>
        ))}
      </div>
      {/* Priorités toujours monté (pastille à jour), masqué hors de son onglet */}
      <div style={{ display: tab === "prio" ? "block" : "none" }}>
        <VisitPriority session={session} onOpenClient={onOpenClient} bare onCount={setPrioCount} />
      </div>
      {tab === "topflop" && <TopFlop session={session} onOpenClient={onOpenClient} />}
    </div>
  );
}
