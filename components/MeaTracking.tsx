"use client";
// Suivi des MEA : résumé par campagne (onglet de l'accueil) et écran de suivi
// (clients qui ont pris / pas pris, offre prévue + note par client).
import { useEffect, useMemo, useState } from "react";
import * as odoo from "@/lib/odoo";
import { loadMeaData, savePlan, planKey, type MeaData, type Plan } from "@/lib/meaTracking";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155", muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", green: "#16a34a", greenSoft: "#f0fdf4",
  orange: "#ea580c", orangeSoft: "#fff7ed",
};
const fmtEUR = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

// ── Onglet de l'accueil : une ligne par campagne active ──
export function MeaSummary({ session, onOpenClient }: { session: odoo.OdooSession; onOpenClient: (c: any) => void }) {
  const [data, setData] = useState<MeaData | null>(null);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMeaData(session)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(odoo.isNetworkError(e) ? "Indisponible hors ligne." : (e?.message || "Lecture impossible")); });
    return () => { cancelled = true; };
  }, [session]);

  if (error) return <div style={{ fontSize: 13, color: C.muted }}>{error}</div>;
  if (!data) return <div style={{ fontSize: 13, color: C.muted }}>…</div>;
  if (!data.campaigns.length) return <div style={{ fontSize: 13, color: C.muted }}>Aucune MEA active.</div>;
  const total = data.clients.length;

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
      {data.campaigns.map(c => {
        const took = Array.from(data.taken.get(c.key)?.values() || []).filter(t => t.state === "pris").length;
        const pct = total ? Math.round((took / total) * 100) : 0;
        return (
          <button key={c.key} onClick={() => setOpenKey(c.key)}
            style={{ textAlign: "left" as const, padding: "9px 12px", borderRadius: 14, border: "none", background: "rgba(255,255,255,0.7)", cursor: "pointer", fontFamily: "inherit" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{c.key}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: C.tealDark, flexShrink: 0 }}>{took} / {total}</span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: "rgba(15,23,42,0.07)", marginTop: 6, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: C.teal }} />
            </div>
          </button>
        );
      })}
      {openKey && (
        <MeaScreen session={session} data={data} initial={openKey} onClose={() => setOpenKey(null)}
          onOpenClient={c => { setOpenKey(null); onOpenClient(c); }}
          onPlanSaved={(k, p) => setData(d => d && { ...d, plans: new Map(d.plans).set(k, p) })} />
      )}
    </div>
  );
}

// ── Écran de suivi d'une campagne ──
function MeaScreen({ session, data, initial, onClose, onOpenClient, onPlanSaved }: {
  session: odoo.OdooSession; data: MeaData; initial: string; onClose: () => void;
  onOpenClient: (c: any) => void; onPlanSaved: (key: string, p: Plan) => void;
}) {
  const [key, setKey] = useState(initial);
  const [filter, setFilter] = useState<"todo" | "pris" | "tous">("todo");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const camp = data.campaigns.find(c => c.key === key)!;
  const taken = data.taken.get(key) || new Map();

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.clients
      .filter(c => filter === "tous" || (filter === "pris" ? taken.has(c.id) : taken.get(c.id)?.state !== "pris"))
      .filter(c => words.every(w => `${c.name} ${c.city || ""} ${c.ref || ""}`.toLowerCase().includes(w)))
      .sort((a, b) => (Number(b.x_ca_n_1) || 0) - (Number(a.x_ca_n_1) || 0));
  }, [data.clients, taken, filter, q]);
  const tookCount = Array.from(taken.values()).filter(t => t.state === "pris").length;

  const save = async (clientId: number, patch: Partial<Plan>) => {
    if (!data.tracking) return;
    const k = planKey(key, clientId);
    const cur = data.plans.get(k) || { offerId: null, note: "" };
    const next = { ...cur, ...patch };
    if (next.offerId === cur.offerId && next.note === cur.note && cur.id) return;
    setSaving(k); setErr("");
    try {
      const id = await savePlan(session, data.tracking, key, clientId, next);
      onPlanSaved(k, { ...next, id });
    } catch (e: any) {
      setErr(odoo.isNetworkError(e) ? "Hors ligne : prévision non enregistrée" : `Enregistrement refusé : ${e?.message || e}`);
    }
    setSaving(null);
  };

  const pill = (active: boolean): React.CSSProperties => ({
    height: 30, padding: "0 12px", borderRadius: 999, border: `1.5px solid ${active ? C.teal : C.border}`, background: active ? C.teal : C.white,
    color: active ? "#fff" : C.textSec, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" as const,
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: C.bg, display: "flex", flexDirection: "column" as const, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ padding: "16px 20px 12px", background: C.white, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <button onClick={onClose} aria-label="Fermer" style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.border}`, background: C.white, cursor: "pointer", fontSize: 16, color: C.textSec }}>←</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Suivi des MEA</div>
            <div style={{ fontSize: 12, color: C.muted }}>{tookCount} client{tookCount > 1 ? "s" : ""} sur {data.clients.length} ont pris « {key} »</div>
          </div>
        </div>
        {/* Campagnes actives */}
        <div style={{ display: "flex", gap: 6, overflowX: "auto" as const, paddingBottom: 4 }}>
          {data.campaigns.map(c => <button key={c.key} onClick={() => setKey(c.key)} style={pill(c.key === key)}>{c.key}</button>)}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" as const }}>
          <div style={{ display: "flex", background: C.bg, borderRadius: 10, padding: 3 }}>
            {([["todo", "Pas pris"], ["pris", "Pris"], ["tous", "Tous"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => setFilter(v)}
                style={{ height: 28, padding: "0 12px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
                  background: filter === v ? C.white : "transparent", color: filter === v ? C.tealDark : C.muted, boxShadow: filter === v ? "0 1px 4px rgba(15,23,42,0.1)" : "none" }}>{l}</button>
            ))}
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un client…"
            style={{ flex: 1, minWidth: 160, height: 34, padding: "0 12px", borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
        </div>
        {!data.tracking && (
          <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 10, background: C.orangeSoft, color: C.orange, fontSize: 12, fontWeight: 600, lineHeight: 1.45 }}>
            Prévisions non enregistrables : le modèle Studio « Suivi MEA » n'existe pas encore dans Odoo.
          </div>
        )}
        {err && <div style={{ marginTop: 8, fontSize: 12, color: "#dc2626", fontWeight: 600 }}>{err}</div>}
      </div>

      <div style={{ flex: 1, overflowY: "auto" as const, padding: "10px 20px 30px" }}>
        {rows.length === 0 && <div style={{ textAlign: "center" as const, color: C.muted, fontSize: 13, padding: 30 }}>Aucun client.</div>}
        {rows.map(c => {
          const t = taken.get(c.id);
          const k = planKey(key, c.id);
          const plan = data.plans.get(k);
          return (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", marginBottom: 6, borderRadius: 12, background: C.white, border: `1px solid ${C.border}`, flexWrap: "wrap" as const }}>
              <button onClick={() => onOpenClient(c)} title="Ouvrir la fiche client"
                style={{ flex: "1 1 200px", minWidth: 0, textAlign: "left" as const, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{c.name}</div>
                <div style={{ fontSize: 11.5, color: C.muted }}>{[c.city, c.x_ca_n_1 ? `N-1 ${fmtEUR(Number(c.x_ca_n_1))}` : ""].filter(Boolean).join(" · ")}</div>
              </button>
              {/* Statut : pris (offres), devis en cours, ou rien */}
              <span title={t ? t.orders.join(", ") : undefined}
                style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 800, borderRadius: 999, padding: "3px 10px",
                  background: t?.state === "pris" ? C.greenSoft : t ? C.orangeSoft : C.bg, color: t?.state === "pris" ? C.green : t ? C.orange : C.muted }}>
                {t?.state === "pris" ? `Pris · ${t.offers.join(", ")}` : t ? "Devis en cours" : "Pas pris"}
              </span>
              {/* Prévision du commercial */}
              <select value={plan?.offerId || ""} disabled={!data.tracking || saving === k}
                onChange={e => save(c.id, { offerId: e.target.value ? Number(e.target.value) : null })}
                style={{ flexShrink: 0, height: 32, padding: "0 6px", borderRadius: 8, border: `1.5px solid ${plan?.offerId ? C.teal : C.border}`, background: C.white, fontSize: 12.5, fontFamily: "inherit", color: C.text }}>
                <option value="">Offre prévue…</option>
                {camp.offers.map(o => <option key={o.id} value={o.id}>{o.variant}</option>)}
              </select>
              <input key={`${k}-${plan?.note || ""}`} defaultValue={plan?.note || ""} placeholder="Note…" disabled={!data.tracking}
                onBlur={e => save(c.id, { note: e.target.value.trim() })}
                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                style={{ flex: "1 1 180px", minWidth: 140, height: 32, padding: "0 10px", borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 12.5, fontFamily: "inherit", outline: "none" }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
