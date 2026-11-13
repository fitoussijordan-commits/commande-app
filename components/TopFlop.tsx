"use client";
// Top 20 / flop 20 des clients du commercial : CA HT depuis le 1er janvier
// comparé à la même période de l'an dernier (lib/salesStats), classé
// par écart en euros — un petit client à +300 % ne passe pas devant un gros
// client qui gagne 5 000 €.
import { useEffect, useState } from "react";
import * as odoo from "@/lib/odoo";
import { loadSalesStats } from "@/lib/salesStats";

const C = {
  text: "#0f172a", muted: "#94a3b8", teal: "#0d9488", green: "#16a34a", red: "#dc2626",
};
const fmtEUR = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const N = 20;

interface Row { client: any; cur: number; prev: number; delta: number }

export default function TopFlop({ session, onOpenClient }: {
  session: odoo.OdooSession;
  onOpenClient: (client: any) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"top" | "flop">("top");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await loadSalesStats(session);
        if (!cancelled) setRows(st.clients.filter(r => r.delta !== 0));
      } catch (e: any) {
        if (!cancelled) setError(odoo.isNetworkError(e) ? "Indisponible hors ligne." : (e?.message || "Lecture impossible"));
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const list = rows
    ? (tab === "top" ? rows.filter(r => r.delta > 0).sort((a, b) => b.delta - a.delta)
                     : rows.filter(r => r.delta < 0).sort((a, b) => a.delta - b.delta)).slice(0, N)
    : [];
  const shown = open ? list : list.slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, fontSize: 11.5, color: C.muted }}>CA à date N vs CA à date N-1 (comme la fiche client)</div>
        <div style={{ display: "flex", background: "rgba(255,255,255,0.6)", borderRadius: 999, padding: 3 }}>
          {([["top", `Top ${N}`], ["flop", `Flop ${N}`]] as const).map(([v, l]) => (
            <button key={v} onClick={() => { setTab(v); setOpen(false); }}
              style={{ height: 26, padding: "0 11px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700,
                background: tab === v ? "#fff" : "transparent", color: tab === v ? (v === "top" ? C.green : C.red) : C.muted,
                boxShadow: tab === v ? "0 2px 8px rgba(15,23,42,0.1)" : "none" }}>{l}</button>
          ))}
        </div>
      </div>

      {error && <div style={{ fontSize: 13, color: C.muted }}>{error}</div>}
      {!error && rows === null && <div style={{ fontSize: 13, color: C.muted }}>…</div>}
      {!error && rows && list.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>Aucun client {tab === "top" ? "en progression" : "en recul"}.</div>}

      <div key={tab} className="stagger" style={{ display: "flex", flexDirection: "column" as const, gap: 6, overflowY: "auto" as const, maxHeight: open ? 420 : undefined }}>
        {shown.map((r, i) => {
          const pct = r.prev > 0 ? Math.round((r.delta / r.prev) * 100) : null;
          const color = r.delta >= 0 ? C.green : C.red;
          return (
            <button key={r.client.id} onClick={() => onOpenClient(r.client)}
              style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left" as const, padding: "8px 12px", borderRadius: 14, border: "none",
                background: "rgba(255,255,255,0.7)", cursor: "pointer", fontFamily: "inherit" }}>
              <span style={{ width: 18, fontSize: 11, fontWeight: 800, color: C.muted, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{r.client.name}</span>
                <span style={{ display: "block", fontSize: 11.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {[r.client.city, `${fmtEUR(r.cur)} (N-1 : ${fmtEUR(r.prev)})`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span style={{ textAlign: "right" as const, flexShrink: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, color }}>{r.delta > 0 ? "+" : "−"}{fmtEUR(Math.abs(r.delta))}</span>
                <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color }}>{pct == null ? "nouveau" : `${pct > 0 ? "+" : ""}${pct} %`}</span>
              </span>
            </button>
          );
        })}
      </div>

      {list.length > 5 && (
        <button onClick={() => setOpen(o => !o)}
          style={{ marginTop: 10, alignSelf: "flex-start", background: "none", border: "none", padding: "6px 0", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: C.teal }}>
          {open ? "Réduire" : `Voir les ${list.length}`}
        </button>
      )}
    </div>
  );
}
