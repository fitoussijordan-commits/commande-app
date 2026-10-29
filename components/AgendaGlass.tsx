"use client";
// Agenda compact de l'écran d'accueil (« Choisir un client ») : semaine ou mois,
// en verre façon iOS. Toucher un jour montre ses RDV ; « Ouvrir le planning »
// (ou un RDV) ouvre le planning complet sur cette semaine.
import { useEffect, useMemo, useState } from "react";
import * as odoo from "@/lib/odoo";
import { GLASS, GLASS_PILL } from "@/components/glass";

const C = {
  text: "#0f172a", textSec: "#334155", muted: "#64748b", faint: "#94a3b8",
  teal: "#0d9488", tealDark: "#0f766e",
};
const DAYS = ["L", "M", "M", "J", "V", "S", "D"];

const startOfWeek = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fromOdoo = (s: string) => new Date(String(s).replace(" ", "T") + "Z");
const toOdoo = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const hhmm = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export default function AgendaGlass({ session, onOpenPlanning }: {
  session: odoo.OdooSession;
  onOpenPlanning: (day: Date) => void;
}) {
  const [view, setView] = useState<"week" | "month">(() => {
    try { return localStorage.getItem("wms_agenda_view") === "month" ? "month" : "week"; } catch { return "week"; }
  });
  const [offset, setOffset] = useState(0);          // semaines ou mois
  const [selected, setSelected] = useState(() => new Date());
  const [events, setEvents] = useState<any[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "offline">("loading");
  const today = new Date();

  const chooseView = (v: "week" | "month") => {
    setView(v); setOffset(0); setSelected(new Date());
    try { localStorage.setItem("wms_agenda_view", v); } catch {}
  };

  // Jours affichés : 7 (semaine) ou la grille complète du mois.
  const { days, monthRef } = useMemo(() => {
    if (view === "week") {
      const m = startOfWeek(new Date());
      m.setDate(m.getDate() + offset * 7);
      return { days: Array.from({ length: 7 }, (_, i) => { const d = new Date(m); d.setDate(m.getDate() + i); return d; }), monthRef: m };
    }
    const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const end = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const out: Date[] = [];
    for (let d = startOfWeek(first); out.length < 42 && (d <= end || out.length % 7 !== 0); d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return { days: out, monthRef: first };
  }, [view, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState("loading");
      const end = new Date(days[days.length - 1]); end.setDate(end.getDate() + 1);
      try {
        const rows = await odoo.searchRead(session, "calendar.event",
          [["user_id", "=", session.uid], ["start", "<", toOdoo(end)], ["stop", ">=", toOdoo(days[0])], ["active", "in", [true, false]]],
          ["id", "name", "start", "x_studio_annul", "active"], 600, "start asc");
        if (!cancelled) { setEvents(rows); setState("ok"); }
      } catch {
        if (!cancelled) { setEvents([]); setState("offline"); }
      }
    })();
    return () => { cancelled = true; };
  }, [session, days]);

  const cancelled = (e: any) => Boolean(e.x_studio_annul) || e.active === false;
  const countOn = (d: Date) => events.filter(e => !cancelled(e) && sameDay(fromOdoo(e.start), d)).length;
  const dayEvents = events.filter(e => sameDay(fromOdoo(e.start), selected));
  const label = view === "month"
    ? monthRef.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase())
    : `${days[0].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;

  const navBtn: React.CSSProperties = { ...GLASS_PILL, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.textSec, padding: 0 };

  return (
    <div style={{ ...GLASS, padding: 18, display: "flex", flexDirection: "column" as const, minHeight: 0 }}>
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" as const }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>Agenda</div>
          <div style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>{label}</div>
        </div>
        <div style={{ ...GLASS_PILL, display: "flex", padding: 3 }}>
          {([["week", "Semaine"], ["month", "Mois"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => chooseView(v)}
              style={{ height: 28, padding: "0 12px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
                background: view === v ? "rgba(255,255,255,0.95)" : "transparent", color: view === v ? C.tealDark : C.muted,
                boxShadow: view === v ? "0 2px 8px rgba(15,23,42,0.1)" : "none" }}>
              {l}
            </button>
          ))}
        </div>
        <button onClick={() => setOffset(o => o - 1)} style={navBtn} aria-label="Précédent">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <button onClick={() => setOffset(o => o + 1)} style={navBtn} aria-label="Suivant">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>

      {/* Jours */}
      {view === "month" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 4 }}>
          {DAYS.map((d, i) => <div key={i} style={{ textAlign: "center" as const, fontSize: 10.5, fontWeight: 700, color: C.faint }}>{d}</div>)}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: view === "week" ? 6 : 2 }}>
        {days.map(d => {
          const n = countOn(d);
          const isSel = sameDay(d, selected), isToday = sameDay(d, today);
          const out = view === "month" && d.getMonth() !== monthRef.getMonth();
          return (
            <button key={d.toISOString()} onClick={() => setSelected(d)}
              style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 3, padding: view === "week" ? "8px 0" : "5px 0", minHeight: 44,
                border: "none", borderRadius: 14, cursor: "pointer", fontFamily: "inherit", opacity: out ? 0.35 : 1,
                background: isSel ? C.teal : isToday ? "rgba(13,148,136,0.12)" : "transparent",
                boxShadow: isSel ? "0 6px 16px rgba(13,148,136,0.35)" : "none" }}>
              {view === "week" && <span style={{ fontSize: 10.5, fontWeight: 700, color: isSel ? "rgba(255,255,255,0.8)" : C.faint }}>{DAYS[(d.getDay() + 6) % 7]}</span>}
              <span style={{ fontSize: view === "week" ? 17 : 13.5, fontWeight: 800, color: isSel ? "#fff" : isToday ? C.tealDark : C.text }}>{d.getDate()}</span>
              {/* Points = nombre de RDV (3 max) */}
              <span style={{ display: "flex", gap: 2, height: 5 }}>
                {Array.from({ length: Math.min(n, 3) }).map((_, i) => (
                  <span key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: isSel ? "#fff" : C.teal }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {/* RDV du jour sélectionné */}
      <div style={{ marginTop: 14, borderTop: "1px solid rgba(15,23,42,0.07)", paddingTop: 12, flex: 1, minHeight: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>
          {sameDay(selected, today) ? "Aujourd'hui" : selected.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
        </div>
        {state === "offline" && <div style={{ fontSize: 13, color: C.muted }}>Agenda indisponible hors ligne.</div>}
        {state !== "offline" && dayEvents.length === 0 && (
          <div style={{ fontSize: 13, color: C.faint }}>{state === "loading" ? "…" : "Rien de prévu."}</div>
        )}
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 6, maxHeight: 200, overflowY: "auto" as const }}>
          {dayEvents.map(e => (
            <button key={e.id} onClick={() => onOpenPlanning(selected)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 14, border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const,
                background: "rgba(255,255,255,0.7)", opacity: cancelled(e) ? 0.55 : 1 }}>
              <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: cancelled(e) ? C.faint : C.teal }} />
              <span style={{ fontSize: 12.5, fontWeight: 800, color: C.tealDark, width: 42, flexShrink: 0 }}>{hhmm(fromOdoo(e.start))}</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, textDecoration: cancelled(e) ? "line-through" : "none" }}>{e.name}</span>
            </button>
          ))}
        </div>
      </div>

      <button onClick={() => onOpenPlanning(selected)}
        style={{ marginTop: 12, alignSelf: "flex-start", background: "none", border: "none", padding: "6px 0", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: C.teal }}>
        Ouvrir le planning ↗
      </button>
    </div>
  );
}
