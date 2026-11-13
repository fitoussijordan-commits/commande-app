"use client";
// Tableau de bord du commercial (écran à part, ouvert depuis l'accueil) :
// chiffres clés de l'année vs N-1, CA par mois, top / flop 20, meilleurs CA,
// suivi des MEA et clients à visiter.
import { useEffect, useState } from "react";
import { CountUp, Sk } from "@/components/motion";
import * as odoo from "@/lib/odoo";
import { loadSalesStats, type SalesStats } from "@/lib/salesStats";
import { loadMeaData, type MeaData } from "@/lib/meaTracking";
import TopFlop from "@/components/TopFlop";
import VisitPriority from "@/components/VisitPriority";
import MeaDashboard from "@/components/MeaTracking";
import { getMineOnly } from "@/lib/clients";

const C = {
  bg: "#f4f6f9", white: "#fff", text: "#0f172a", textSec: "#334155", muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", prev: "#cbd5e1", green: "#16a34a", red: "#dc2626",
};
const fmtEUR = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const fmtK = (n: number) => n >= 1000 ? `${Math.round(n / 1000)} k€` : `${Math.round(n)} €`;
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, borderRadius: 18, border: `1px solid ${C.border}`, padding: 18, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 800, color: C.text }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Evol({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <span style={{ fontSize: 12, color: C.muted }}>N-1 : —</span>;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: up ? C.green : C.red }}>
      {up ? "▲" : "▼"} {up ? "+" : ""}{pct} % <span style={{ color: C.muted, fontWeight: 500 }}>vs N-1</span>
    </span>
  );
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div style={{ background: C.white, borderRadius: 18, border: `1px solid ${C.border}`, padding: "14px 18px" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: "4px 0 2px", letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums" as const }}>{value}</div>
      {sub}
    </div>
  );
}

// CA par mois : année en cours vs N-1 (barres groupées, survol = détail).
function MonthChart({ st }: { st: SalesStats }) {
  const [hover, setHover] = useState<number | null>(null);
  const nowM = new Date().getMonth();
  const max = Math.max(1, ...st.months.cur, ...st.months.prevFull);
  const H = 160;
  return (
    <div>
      <div style={{ display: "flex", gap: 14, fontSize: 12, color: C.textSec, marginBottom: 10 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: C.teal, marginRight: 5 }} />{st.year}</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: C.prev, marginRight: 5 }} />{st.year - 1}</span>
      </div>
      <div style={{ position: "relative" as const, display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 6, alignItems: "end", height: H, borderBottom: `1px solid ${C.border}` }}>
        {MONTHS.map((m, i) => {
          const cur = st.months.cur[i], prev = st.months.prevFull[i];
          return (
            <div key={m} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(h => h === i ? null : i)}
              style={{ height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, cursor: "default", background: hover === i ? "rgba(15,23,42,0.04)" : "transparent", borderRadius: 6 }}>
              <div className="grow-y" style={{ animationDelay: `${i * 30}ms`, width: "38%", height: `${(prev / max) * 100}%`, background: C.prev, borderRadius: "4px 4px 0 0", minHeight: prev ? 2 : 0 }} />
              <div className="grow-y" style={{ animationDelay: `${i * 30 + 90}ms`, width: "38%", height: `${(cur / max) * 100}%`, background: i <= nowM ? C.teal : "transparent", borderRadius: "4px 4px 0 0", minHeight: cur ? 2 : 0 }} />
            </div>
          );
        })}
        {hover != null && (
          <div style={{ position: "absolute" as const, top: 0, left: `${Math.min(80, (hover / 12) * 100)}%`, background: C.text, color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 12, pointerEvents: "none" as const, whiteSpace: "nowrap" as const }}>
            <div style={{ fontWeight: 800, textTransform: "capitalize" as const }}>{MONTHS[hover]}</div>
            <div>{st.year} : {hover <= nowM ? fmtEUR(st.months.cur[hover]) : "—"}</div>
            <div style={{ opacity: 0.75 }}>{st.year - 1} : {fmtEUR(st.months.prevFull[hover])}</div>
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 6, marginTop: 6 }}>
        {MONTHS.map((m, i) => <div key={m} style={{ textAlign: "center" as const, fontSize: 10.5, color: i === nowM ? C.tealDark : C.muted, fontWeight: i === nowM ? 800 : 500 }}>{m}</div>)}
      </div>
    </div>
  );
}

export default function Dashboard({ session, onClose, onOpenClient, onToast }: {
  session: odoo.OdooSession;
  onClose: () => void;
  onOpenClient: (c: any) => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [st, setSt] = useState<SalesStats | null>(null);
  const [mea, setMea] = useState<MeaData | null>(null);
  const [error, setError] = useState("");
  const [showMea, setShowMea] = useState(false);
  const [bestAll, setBestAll] = useState(false);

  useEffect(() => {
    loadSalesStats(session).then(setSt)
      .catch(e => setError(odoo.isNetworkError(e) ? "Tableau de bord indisponible hors ligne." : (e?.message || "Lecture impossible")));
    loadMeaData(session, getMineOnly()).then(setMea).catch(() => {});
  }, [session]);

  const best = st ? [...st.clients].filter(c => c.cur > 0).sort((a, b) => b.cur - a.cur) : [];
  const avgCur = st && st.kpi.ordersCur ? st.kpi.cur / st.kpi.ordersCur : 0;
  const avgPrev = st && st.kpi.ordersPrev ? st.kpi.prev / st.kpi.ordersPrev : 0;
  const today = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

  return (
    <div className="ov-full" style={{ position: "fixed", inset: 0, zIndex: 250, background: C.bg, overflowY: "auto" as const, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "20px 24px 40px" }}>
        {/* En-tête */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <button onClick={onClose} title="Revenir à l'accueil"
            style={{ height: 38, padding: "0 14px", borderRadius: 11, border: `1px solid ${C.border}`, background: C.white, cursor: "pointer", color: C.textSec, display: "flex", alignItems: "center", gap: 7, fontFamily: "inherit", fontSize: 13, fontWeight: 700 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>
            Accueil
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: C.text }}>Mon tableau de bord</div>
            <div style={{ fontSize: 12.5, color: C.muted }}>Du 1er janvier au {today} {st?.year || ""}, comparé à la même période {st ? st.year - 1 : "N-1"} · {st?.caFromOdoo ? "CA : champs Odoo « CA à date » (comme la fiche client) · commandes et graphique : commandes confirmées HT" : "commandes confirmées, CA HT"}</div>
          </div>
        </div>

        {error && <div style={{ padding: 30, textAlign: "center" as const, color: C.muted }}>{error}</div>}
        {!error && !st && <>
          {/* Squelette : mêmes blocs que le tableau de bord chargé */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 14 }}>
            {[0, 1, 2, 3].map(i => <Sk key={i} h={92} r={18} />)}
          </div>
          <Sk h={250} r={18} style={{ marginBottom: 14 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14 }}>
            <Sk h={320} r={18} /><Sk h={320} r={18} />
          </div>
        </>}

        {st && st.clients.length === 0 && (
          <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 12, background: "#fff7ed", color: "#ea580c", fontSize: 13, fontWeight: 600 }}>
            Aucun client n'a ton nom comme Vendeur dans Odoo : les chiffres sont vides. Ils se remplissent dès que des clients te sont attribués.
          </div>
        )}
        {st && <>
          {/* Chiffres clés */}
          <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 14 }}>
            <Kpi label="CA HT" value={<CountUp fromZero duration={900} value={st.kpi.cur} format={fmtEUR} />} sub={<Evol cur={st.kpi.cur} prev={st.kpi.prev} />} />
            <Kpi label="Commandes" value={<CountUp fromZero duration={900} value={st.kpi.ordersCur} format={n => String(Math.round(n))} />} sub={<Evol cur={st.kpi.ordersCur} prev={st.kpi.ordersPrev} />} />
            <Kpi label="Panier moyen" value={<CountUp fromZero duration={900} value={avgCur} format={fmtEUR} />} sub={<Evol cur={avgCur} prev={avgPrev} />} />
            <Kpi label="Clients commandeurs" value={<CountUp fromZero duration={900} value={st.kpi.clientsCur} format={n => String(Math.round(n))} />} sub={<Evol cur={st.kpi.clientsCur} prev={st.kpi.clientsPrev} />} />
          </div>

          {/* CA par mois */}
          <div style={{ marginBottom: 14 }}>
            <Card title="CA par mois"><MonthChart st={st} /></Card>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14, marginBottom: 14, alignItems: "start" }}>
            <Card title="Évolution par client"><TopFlop session={session} onOpenClient={onOpenClient} /></Card>
            <Card title="Meilleurs CA">
              <div className="stagger" style={{ display: "flex", flexDirection: "column" as const, gap: 2 }}>
                {(bestAll ? best.slice(0, 20) : best.slice(0, 8)).map((r, i) => (
                  <button key={r.client.id} onClick={() => onOpenClient(r.client)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px", border: "none", borderBottom: `1px solid ${C.border}`, background: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const }}>
                    <span style={{ width: 18, fontSize: 11, fontWeight: 800, color: C.muted }}>{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{r.client.name}</span>
                      <span style={{ display: "block", fontSize: 11.5, color: C.muted }}>{[r.client.city, `${r.ordersCur} commande${r.ordersCur > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span style={{ textAlign: "right" as const }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: C.text }}>{fmtK(r.cur)}</span>
                      <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: r.delta >= 0 ? C.green : C.red }}>{r.prev ? `${r.delta >= 0 ? "+" : ""}${Math.round((r.delta / r.prev) * 100)} %` : "nouveau"}</span>
                    </span>
                  </button>
                ))}
              </div>
              {best.length > 8 && (
                <button onClick={() => setBestAll(v => !v)} style={{ marginTop: 10, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: C.teal }}>
                  {bestAll ? "Réduire" : "Voir les 20"}
                </button>
              )}
            </Card>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14, alignItems: "start" }}>
            <Card title="Mes MEA" right={
              <button onClick={() => setShowMea(true)} style={{ height: 30, padding: "0 12px", borderRadius: 9, border: `1.5px solid ${C.teal}`, background: C.white, color: C.tealDark, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                Ouvrir le suivi
              </button>}>
              {!mea && <div style={{ fontSize: 13, color: C.muted }}>…</div>}
              {mea && !mea.campaigns.length && <div style={{ fontSize: 13, color: C.muted }}>Aucune MEA active.</div>}
              {mea && mea.campaigns.map(c => {
                const took = Array.from(mea.taken.get(c.key)?.values() || []).filter(t => t.state === "pris").length;
                const total = mea.clients.length;
                const pct = total ? Math.round((took / total) * 100) : 0;
                return (
                  <button key={c.key} onClick={() => setShowMea(true)}
                    style={{ display: "block", width: "100%", textAlign: "left" as const, padding: "10px 0", border: "none", borderBottom: `1px solid ${C.border}`, background: "none", cursor: "pointer", fontFamily: "inherit" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{c.key}</span>
                      <span style={{ fontSize: 12, color: C.muted }}>{took} / {total}</span>
                      <span style={{ fontSize: 15, fontWeight: 800, color: C.tealDark, minWidth: 44, textAlign: "right" as const }}>{pct}%</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: "#eef2f6", marginTop: 7, overflow: "hidden" }}>
                      <div className="grow-x" style={{ width: `${pct}%`, height: "100%", background: C.teal, borderRadius: 3 }} />
                    </div>
                  </button>
                );
              })}
            </Card>
            <Card title="À visiter en priorité">
              <VisitPriority session={session} onOpenClient={onOpenClient} bare />
            </Card>
          </div>
        </>}
      </div>

      {showMea && <MeaDashboard session={session} onClose={() => setShowMea(false)} onOpenClient={c => { setShowMea(false); onOpenClient(c); }} onToast={onToast} />}
    </div>
  );
}
