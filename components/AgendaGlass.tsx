"use client";
// Agenda compact de l'écran d'accueil (« Choisir un client ») : semaine ou mois,
// en verre façon iOS. Toucher un jour (ou un RDV, ou « Ouvrir le planning »)
// ouvre le planning complet sur ce jour-là.
import { useEffect, useMemo, useState } from "react";
import * as odoo from "@/lib/odoo";
import { GLASS, GLASS_PILL } from "@/components/glass";
import { eventOnDay, ALLDAY_FIELDS, linkedPartnerId } from "@/lib/calendar";

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

export default function AgendaGlass({ session, onOpenPlanning, onOpenClient, onOrder }: {
  session: odoo.OdooSession;
  onOpenPlanning: (day: Date) => void;
  onOpenClient?: (partnerId: number) => void;   // tap sur un RDV lié à un client → sa fiche
  onOrder?: (partnerId: number) => void;        // bouton « Commander » → catalogue du client
}) {
  const [view, setView] = useState<"week" | "month">(() => {
    try { return localStorage.getItem("wms_agenda_view") === "month" ? "month" : "week"; } catch { return "week"; }
  });
  const [offset, setOffset] = useState(0);          // semaines ou mois
  const [selected, setSelected] = useState(() => new Date());
  const [events, setEvents] = useState<any[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "offline">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  // Synchro Outlook à l'ouverture, puis rechargement si Outlook a changé.
  useEffect(() => { odoo.syncOutlookNow(session).then(changed => { if (changed) setReloadKey(k => k + 1); }); }, [session]);
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
        const domain = [["user_id", "=", session.uid], ["start", "<", toOdoo(end)], ["stop", ">=", toOdoo(days[0])], ["active", "in", [true, false]]];
        const BASE = ["id", "name", "start", "stop", ...ALLDAY_FIELDS, "location", "x_studio_annul", "active"];
        // res_model / res_id = client lié au RDV (cf. AppointmentModal) ; repli
        // sans ces champs s'ils n'existent pas sur l'instance.
        let rows: any[];
        try {
          rows = await odoo.searchRead(session, "calendar.event", domain, [...BASE, "res_model", "res_id"], 600, "start asc");
        } catch (e) {
          if (odoo.isNetworkError(e)) throw e;
          rows = await odoo.searchRead(session, "calendar.event", domain, BASE, 600, "start asc");
        }
        // RDV lié à un client : « Visite de <client> à <ville> ».
        const ids = Array.from(new Set(rows.filter(r => linkedPartnerId(r)).map(r => linkedPartnerId(r)!)));
        if (ids.length) {
          try {
            const partners = await odoo.searchRead(session, "res.partner", [["id", "in", ids]], ["id", "name", "city", "street", "zip"], ids.length);
            const byId = new Map(partners.map((p: any) => [p.id, p]));
            rows = rows.map(r => {
              const p: any = linkedPartnerId(r) && byId.get(linkedPartnerId(r)!);
              return p ? { ...r, _p: p, label: `Visite de ${p.name}${p.city ? ` à ${p.city}` : r.location ? ` à ${r.location}` : ""}` } : r;
            });
          } catch {}
        }
        if (!cancelled) { setEvents(rows); setState("ok"); }
      } catch {
        if (!cancelled) { setEvents([]); setState("offline"); }
      }
    })();
    return () => { cancelled = true; };
  }, [session, days, reloadKey]);

  const cancelled = (e: any) => Boolean(e.x_studio_annul) || e.active === false;
  const countOn = (d: Date) => events.filter(e => !cancelled(e) && eventOnDay(e, d)).length;
  const dayEvents = events.filter(e => eventOnDay(e, selected));
  // Prochain RDV du jour (en cours ou à venir, non annulé) : mis en avant.
  const nextId = sameDay(selected, today)
    ? dayEvents.find(e => !cancelled(e) && !e.allday && fromOdoo(e.stop || e.start).getTime() >= Date.now() - (e.stop ? 0 : 3600_000))?.id
    : undefined;
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
            <button key={d.toISOString()} onClick={() => { setSelected(d); onOpenPlanning(d); }}
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
        <div className="stagger" style={{ display: "flex", flexDirection: "column" as const, gap: 8, maxHeight: 340, overflowY: "auto" as const }}>
          {dayEvents.map(e => {
            const p = e._p;
            const off = cancelled(e);
            const isNext = e.id === nextId;
            const addr = p ? [p.street, p.zip, p.city].filter(Boolean).join(" ") : "";
            return (
              <div key={e.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: isNext ? "12px 12px" : "8px 12px", borderRadius: 16,
                  background: isNext ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.7)", opacity: off ? 0.55 : 1,
                  boxShadow: isNext ? "0 6px 18px rgba(13,148,136,0.18), inset 0 0 0 1.5px rgba(13,148,136,0.45)" : "none" }}>
                <button onClick={() => p && onOpenClient ? onOpenClient(p.id) : onOpenPlanning(selected)}
                  style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const, minHeight: 40 }}>
                  <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: off ? C.faint : C.teal, flexShrink: 0 }} />
                  <span style={{ width: 48, flexShrink: 0 }}>
                    <span style={{ display: "block", fontSize: isNext ? 15 : 13, fontWeight: 800, color: C.tealDark }}>{e.allday ? "Journée" : hhmm(fromOdoo(e.start))}</span>
                    {isNext && <span style={{ display: "block", fontSize: 9.5, fontWeight: 800, color: C.teal, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Prochain</span>}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: isNext ? 15.5 : 13.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, textDecoration: off ? "line-through" : "none" }}>
                      {p ? p.name : (e.allday && e.location) || e.name}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                      {p ? [p.city, e.name].filter(Boolean).join(" · ") : e.location || ""}
                    </span>
                  </span>
                </button>
                {p && !off && addr && (
                  <a href={`https://maps.apple.com/?daddr=${encodeURIComponent(addr)}`} target="_blank" rel="noopener noreferrer" title="Itinéraire" aria-label={`Itinéraire vers ${p.name}`}
                    style={{ ...GLASS_PILL, width: 40, height: 40, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.textSec, background: "rgba(255,255,255,0.85)" }}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>
                  </a>
                )}
                {p && !off && onOrder && (
                  <button onClick={() => onOrder(p.id)}
                    style={{ height: 40, padding: "0 16px", flexShrink: 0, borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13.5, fontWeight: 800,
                      background: isNext ? C.teal : "rgba(13,148,136,0.12)", color: isNext ? "#fff" : C.tealDark, boxShadow: isNext ? "0 6px 14px rgba(13,148,136,0.3)" : "none" }}>
                    Commander
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <button onClick={() => onOpenPlanning(selected)}
        style={{ marginTop: 12, alignSelf: "flex-start", background: "none", border: "none", padding: "6px 0", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: C.teal }}>
        Ouvrir le planning ↗
      </button>
    </div>
  );
}
