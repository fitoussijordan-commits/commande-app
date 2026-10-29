"use client";
// Rapport des reprises de périmés, TOUS clients, lu en direct dans Odoo
// (BC portant l'étiquette « Reprise périmé », ou anciens BC PERIM-).
// Mêmes données que l'export Excel : lib/perimesReport.ts.
import { useEffect, useMemo, useState } from "react";
import * as odoo from "@/lib/odoo";
import { apiUrl } from "@/lib/apiBase";
import { loadPerimesReport, type PerimesReport } from "@/lib/perimesReport";
import { odooRecordUrl } from "@/lib/perimes";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  orange: "#ea580c", green: "#16a34a", red: "#dc2626", redSoft: "#fef2f2",
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)",
};

const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const frDay = (s: string) => s ? s.split("-").reverse().join("/") : "";

type Period = "month" | "quarter" | "year" | "all";
const PERIODS: [Period, string][] = [["month", "Ce mois"], ["quarter", "3 mois"], ["year", "Cette année"], ["all", "Tout"]];

function periodRange(p: Period): { from?: string; to?: string } {
  const now = new Date();
  if (p === "month") return { from: day(new Date(now.getFullYear(), now.getMonth(), 1)), to: day(now) };
  if (p === "quarter") return { from: day(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: day(now) };
  if (p === "year") return { from: `${now.getFullYear()}-01-01`, to: day(now) };
  return {};
}

const isNative = () => typeof window !== "undefined" && Boolean((window as any).Capacitor?.isNativePlatform?.());

export default function PerimesReportScreen({ session, onToast }: {
  session: odoo.OdooSession;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [period, setPeriod] = useState<Period>("month");
  const [report, setReport] = useState<PerimesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [openClient, setOpenClient] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = async (p: Period) => {
    setLoading(true); setError("");
    try {
      setReport(await loadPerimesReport(
        (m, d, f, l = 0, o = "") => odoo.searchRead(session, m, d, f, l, o), periodRange(p)));
    } catch (e: any) {
      setError(odoo.isNetworkError(e) ? "Hors ligne — le rapport est lu en direct dans Odoo." : (e?.message || "Lecture impossible"));
    }
    setLoading(false);
  };
  useEffect(() => { void load(period); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  const clients = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = report?.clients || [];
    return t ? list.filter(c => `${c.client} ${c.clientRef} ${c.city}`.toLowerCase().includes(t)) : list;
  }, [report, q]);

  // PC : téléchargement direct. iPad : l'app ne sait pas enregistrer un fichier,
  // il part par mail à l'adresse du compte Odoo.
  const exportExcel = async () => {
    setExporting(true);
    const native = isNative();
    try {
      const res = await fetch(apiUrl("/api/perimes/export"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ odooUrl: session.config.url, sessionId: session.sessionId, ...periodRange(period), deliver: native ? "mail" : "download" }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (native) {
        onToast(`Excel envoyé à ${data.sentTo}`, "success");
      } else {
        const bin = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bin], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        const a = document.createElement("a");
        a.href = url; a.download = data.filename; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e: any) {
      onToast(e instanceof TypeError ? "Réseau indisponible" : `Export impossible : ${e?.message || "erreur"}`, "error");
    }
    setExporting(false);
  };

  const t = report?.totals;
  const kpis: [string, string][] = [
    ["Valeur reprise", t ? fmt(t.repris) : "…"],
    ["Échange", t ? fmt(t.echange) : "…"],
    ["Reprises", t ? String(t.count) : "…"],
    ["Clients", t ? String(t.clients) : "…"],
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto" as const, padding: "24px 20px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" as const }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>Périmés</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>Toutes les reprises, en direct depuis Odoo</div>
          </div>
          <button onClick={() => load(period)} disabled={loading} title="Actualiser" aria-label="Actualiser"
            style={{ width: 44, height: 44, borderRadius: 12, border: `1.5px solid ${C.border}`, background: C.white, cursor: "pointer", color: C.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
              style={{ animation: loading ? "spin 0.9s linear infinite" : "none" }}>
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>
            </svg>
          </button>
          <button onClick={exportExcel} disabled={exporting || !report?.orders.length}
            style={{ height: 44, padding: "0 18px", borderRadius: 12, border: "none", background: report?.orders.length ? C.teal : C.border, color: "#fff", fontSize: 14, fontWeight: 800, cursor: report?.orders.length ? "pointer" : "default", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8l8 8M16 8l-8 8"/>
            </svg>
            {exporting ? "Export…" : isNative() ? "Excel par mail" : "Excel"}
          </button>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        {/* Période + recherche */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 4, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: 4 }}>
            {PERIODS.map(([id, label]) => (
              <button key={id} onClick={() => setPeriod(id)}
                style={{ height: 36, padding: "0 14px", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                  background: period === id ? C.teal : "transparent", color: period === id ? "#fff" : C.textSec }}>
                {label}
              </button>
            ))}
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrer un client…"
            style={{ flex: 1, minWidth: 180, height: 44, borderRadius: 12, border: `1.5px solid ${C.border}`, padding: "0 14px", fontSize: 14, fontFamily: "inherit", background: C.white }} />
        </div>

        {/* Chiffres clés */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
          {kpis.map(([label, value], i) => (
            <div key={label} style={{ background: i === 0 ? C.tealDark : C.white, color: i === 0 ? "#fff" : C.text, border: i === 0 ? "none" : `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", boxShadow: C.shadow }}>
              <div style={{ fontSize: 19, fontWeight: 800 }}>{value}</div>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.04em", opacity: i === 0 ? 0.85 : 1, color: i === 0 ? undefined : C.muted, marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>

        {error && <div style={{ padding: "12px 14px", borderRadius: 12, background: C.redSoft, color: C.red, fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{error}</div>}
        {!loading && !error && clients.length === 0 && (
          <div style={{ textAlign: "center" as const, color: C.muted, padding: 30, fontSize: 14 }}>
            {q ? "Aucun client ne correspond." : "Aucune reprise sur cette période."}
          </div>
        )}

        {/* Par client, dépliable */}
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
          {clients.map(c => {
            const open = openClient === c.clientId;
            const orders = (report?.orders || []).filter(o => o.clientId === c.clientId);
            return (
              <div key={c.clientId} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: C.shadow, overflow: "hidden" }}>
                <button onClick={() => setOpenClient(open ? null : c.clientId)}
                  style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 56, padding: "10px 14px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 800, color: C.text }}>{c.client}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>
                      {[c.clientRef, c.city].filter(Boolean).join(" · ")}
                      {" · "}{c.count} reprise{c.count > 1 ? "s" : ""} · dernière le {frDay(c.last)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" as const }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: C.orange }}>{fmt(c.repris)}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>échange {fmt(c.echange)}</div>
                  </div>
                  <span style={{ color: C.muted }}>{open ? "▴" : "▾"}</span>
                </button>
                {open && (
                  <div style={{ borderTop: `1px solid ${C.border}`, padding: "8px 14px 12px", display: "flex", flexDirection: "column" as const, gap: 10 }}>
                    {orders.map(o => (
                      <div key={o.id}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 4 }}>
                          <a href={odooRecordUrl(session, "sale.order", o.id)} target="_blank" rel="noopener noreferrer"
                            style={{ color: C.teal, fontWeight: 800, textDecoration: "underline" }}>{o.name} ↗</a>
                          <span style={{ color: C.muted }}>{frDay(o.date)} · {o.state} · {o.commercial}</span>
                          <span style={{ marginLeft: "auto", fontWeight: 700, color: C.orange }}>repris {fmt(o.repris)}</span>
                        </div>
                        {(report?.lines || []).filter(l => l.orderId === o.id).map((l, i) => (
                          <div key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: l.type === "Ajustement" ? C.muted : C.textSec, padding: "2px 0 2px 10px" }}>
                            <span style={{ width: 74, flexShrink: 0, fontWeight: 700, color: l.type === "Repris" ? C.orange : l.type === "Échange" ? C.green : C.muted }}>{l.type}</span>
                            <span style={{ flex: 1, minWidth: 0 }}>
                              {l.ref && <span style={{ fontFamily: "monospace", color: C.muted, marginRight: 6 }}>{l.ref}</span>}
                              {l.type === "Ajustement" ? "Ajustement du solde" : l.product}
                              {l.lot && <span style={{ color: C.muted }}> · lot {l.lot}</span>}
                            </span>
                            {l.type !== "Ajustement" && <span style={{ color: C.muted }}>× {l.qty}</span>}
                            <span style={{ width: 80, textAlign: "right" as const, fontWeight: 700 }}>{fmt(l.amount)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
