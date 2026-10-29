"use client";
// Clients à visiter en priorité, d'après leur rythme de visite.
//
// Rythme selon le CA N-1 (res.partner.x_ca_n_1) :
//   ≥ 20 000 €          → tous les mois
//   10 000 – 20 000 €   → tous les 2 mois
//   < 10 000 €          → tous les 4 mois
// Dernière visite = dernier RDV passé et non annulé du commercial avec ce client
// (calendar.event lié à la fiche, ou à défaut portant son code client).
// Clients concernés : ceux dont le commercial est le Vendeur (res.partner.user_id),
// avec un CA N-1 > 0.
import { useEffect, useState } from "react";
import * as odoo from "@/lib/odoo";
import * as sync from "@/lib/sync";
import { GLASS } from "@/components/glass";

const C = {
  white: "#fff", text: "#0f172a", textSec: "#334155", muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  orange: "#ea580c", orangeSoft: "#fff7ed", red: "#dc2626", redSoft: "#fef2f2",
  shadow: "0 2px 8px rgba(15,23,42,0.05)",
};

// Seuils et rythmes : un seul endroit à modifier si la règle change.
const RULES: { min: number; months: number; label: string }[] = [
  { min: 20000, months: 1, label: "mensuel" },
  { min: 10000, months: 2, label: "tous les 2 mois" },
  { min: 0, months: 4, label: "tous les 4 mois" },
];
const SOON_DAYS = 7;          // « à prévoir » : échéance dans la semaine
const HISTORY_MONTHS = 12;    // au-delà, considéré « pas de visite récente »

interface Prio {
  client: any; ca: number; rule: typeof RULES[number];
  lastVisit: Date | null; due: Date; lateDays: number; next: Date | null;
}

const fmtEUR = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const fmtDay = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const odooDate = (s: string) => new Date(String(s).replace(" ", "T") + "Z");
const toOdoo = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

export default function VisitPriority({ session, onOpenClient }: {
  session: odoo.OdooSession;
  onOpenClient: (client: any) => void;
}) {
  const [items, setItems] = useState<Prio[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const clients = await odoo.searchRead(session, "res.partner",
          [["user_id", "=", session.uid], ["customer_rank", ">", 0], ["parent_id", "=", false],
           ["active", "=", true], ["x_ca_n_1", ">", 0]],
          sync.CLIENT_FIELDS, 0, "x_ca_n_1 desc");
        if (!clients.length) { if (!cancelled) setItems([]); return; }

        const now = new Date();
        const since = new Date(now); since.setMonth(since.getMonth() - HISTORY_MONTHS);
        const horizon = new Date(now); horizon.setMonth(horizon.getMonth() + 4);
        // RDV du commercial sur 12 mois passés + 4 mois à venir (pour signaler
        // un client déjà planifié). Repli sans res_model/res_id s'ils manquent.
        const domain = [["user_id", "=", session.uid], ["start", ">=", toOdoo(since)], ["start", "<=", toOdoo(horizon)]];
        const base = ["start", "x_studio_code_client_cli_calendar", "x_studio_annul"];
        let events: any[];
        try { events = await odoo.searchRead(session, "calendar.event", domain, [...base, "res_model", "res_id"], 0); }
        catch (e) {
          if (odoo.isNetworkError(e)) throw e;
          events = await odoo.searchRead(session, "calendar.event", domain, base, 0);
        }

        const byId = new Map<number, any>(clients.map((c: any) => [c.id, c]));
        const byRef = new Map<string, any>();
        for (const c of clients) if (c.ref) byRef.set(String(c.ref).trim().toUpperCase(), c);
        const last = new Map<number, Date>(), next = new Map<number, Date>();
        for (const e of events) {
          if (e.x_studio_annul) continue;
          const c = e.res_model === "res.partner" && byId.get(Number(e.res_id))
            || byRef.get(String(e.x_studio_code_client_cli_calendar || "").trim().toUpperCase());
          if (!c) continue;
          const d = odooDate(e.start);
          if (d <= now) { if (!last.has(c.id) || d > last.get(c.id)!) last.set(c.id, d); }
          else if (!next.has(c.id) || d < next.get(c.id)!) next.set(c.id, d);
        }

        const out: Prio[] = clients.map((c: any) => {
          const ca = Number(c.x_ca_n_1) || 0;
          const rule = RULES.find(r => ca >= r.min) || RULES[RULES.length - 1];
          const lv = last.get(c.id) || null;
          const due = new Date(lv || since);
          due.setMonth(due.getMonth() + rule.months);
          return { client: c, ca, rule, lastVisit: lv, due, next: next.get(c.id) || null,
            lateDays: Math.floor((now.getTime() - due.getTime()) / 86400000) };
        })
          // À visiter : échéance passée ou dans la semaine.
          .filter((p: Prio) => p.lateDays >= -SOON_DAYS)
          // Pas encore planifié d'abord, puis du plus en retard au moins en retard.
          .sort((a: Prio, b: Prio) => Number(!!a.next) - Number(!!b.next) || b.lateDays - a.lateDays);
        if (!cancelled) setItems(out);
      } catch (e: any) {
        if (!cancelled) setError(odoo.isNetworkError(e) ? "Hors ligne" : (e?.message || "Lecture impossible"));
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const toPlan = items?.filter(p => !p.next).length ?? 0;
  const shown = items ? (open ? items : items.slice(0, 5)) : [];

  return (
    <div style={{ ...GLASS, padding: 18, display: "flex", flexDirection: "column" as const, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>À visiter en priorité</div>
        {!!toPlan && (
          <span style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: C.orange, borderRadius: 999, padding: "2px 9px" }}>{toPlan}</span>
        )}
      </div>

      {error && <div style={{ fontSize: 13, color: C.muted }}>{error === "Hors ligne" ? "Indisponible hors ligne." : error}</div>}
      {!error && items === null && <div style={{ fontSize: 13, color: C.muted }}>…</div>}
      {!error && items?.length === 0 && (
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>Tous tes clients sont à jour de leurs visites.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column" as const, gap: 6, overflowY: "auto" as const, maxHeight: open ? 420 : undefined }}>
        {shown.map(p => {
          const late = p.lateDays > 0;
          const color = p.next ? C.tealDark : (late || !p.lastVisit) ? C.red : C.orange;
          return (
            <button key={p.client.id} onClick={() => onOpenClient(p.client)}
              style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left" as const, padding: "9px 12px", borderRadius: 14, border: "none",
                background: "rgba(255,255,255,0.7)", cursor: "pointer", fontFamily: "inherit", opacity: p.next ? 0.65 : 1 }}>
              <span style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.client.name}</span>
                <span style={{ display: "block", fontSize: 11.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {[p.client.city, fmtEUR(p.ca), p.rule.label].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 800, color, textAlign: "right" as const, flexShrink: 0 }}>
                {p.next ? `RDV ${fmtDay(p.next)}`
                  : !p.lastVisit ? `> ${HISTORY_MONTHS} mois`
                  : late ? `+${p.lateDays} j`
                  : `avant ${fmtDay(p.due)}`}
                {p.lastVisit && !p.next && (
                  <span style={{ display: "block", fontSize: 10.5, fontWeight: 600, color: C.muted }}>vu le {fmtDay(p.lastVisit)}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {items && items.length > 5 && (
        <button onClick={() => setOpen(o => !o)}
          style={{ marginTop: 10, alignSelf: "flex-start", background: "none", border: "none", padding: "6px 0", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: C.teal }}>
          {open ? "Réduire" : `Voir tout (${items.length})`}
        </button>
      )}
    </div>
  );
}
