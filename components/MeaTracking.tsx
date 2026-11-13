"use client";
// Tableau de bord « Mes MEA » (écran indépendant, ouvert depuis l'accueil) :
// pour chaque MEA active, les clients du commercial qui ont pris / ont un devis /
// sont à proposer, leur prochain RDV (ou « Planifier ») et la prévision du
// commercial (offre envisagée + note) — pour préparer ses RDV.
import { useCallback, useEffect, useMemo, useState } from "react";
import { TubeLoader } from "@/components/motion";
import * as odoo from "@/lib/odoo";
import { linkedPartnerId } from "@/lib/calendar";
import { loadBatchBdc, pricelistDiscount } from "@/lib/rdvPrep";
import { buildBdc, downloadBlob, loadBdcImages } from "@/lib/bdcExcel";
import { loadMeaData, savePlan, planKey, localPlans, saveLocalPlan, type MeaData, type Plan } from "@/lib/meaTracking";
import AppointmentModal from "@/components/AppointmentModal";
import { getMineOnly, setMineOnly } from "@/lib/clients";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155", muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", green: "#16a34a", greenSoft: "#f0fdf4",
  orange: "#ea580c", orangeSoft: "#fff7ed", red: "#dc2626",
};
const fmtEUR = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const toOdoo = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
type Status = "todo" | "devis" | "pris";
const STAT: Record<Status, { label: string; color: string; soft: string }> = {
  todo: { label: "À proposer", color: "#334155", soft: "#eef2f6" },
  devis: { label: "Devis en cours", color: "#ea580c", soft: "#fff7ed" },
  pris: { label: "Ont pris", color: "#16a34a", soft: "#f0fdf4" },
};

// Prochain RDV (non annulé) de chaque client, sur les 6 mois à venir.
async function loadNextVisits(session: odoo.OdooSession): Promise<Map<number, Date>> {
  const now = new Date(), to = new Date(); to.setMonth(to.getMonth() + 6);
  const domain = [["user_id", "=", session.uid], ["start", ">=", toOdoo(now)], ["start", "<=", toOdoo(to)]];
  const rows = await odoo.searchRead(session, "calendar.event", domain, ["start", "res_model", "res_id", "x_studio_annul"], 0, "start asc")
    .catch(() => [] as any[]);
  const out = new Map<number, Date>();
  for (const e of rows) {
    const pid = linkedPartnerId(e);
    if (!pid || e.x_studio_annul || out.has(pid)) continue;
    out.set(pid, new Date(String(e.start).replace(" ", "T") + "Z"));
  }
  return out;
}

export default function MeaDashboard({ session, onClose, onOpenClient, onToast }: {
  session: odoo.OdooSession;
  onClose: () => void;
  onOpenClient: (c: any) => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [data, setData] = useState<MeaData | null>(null);
  const [visits, setVisits] = useState<Map<number, Date>>(new Map());
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const [filter, setFilter] = useState<Status>("todo");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [rdvFor, setRdvFor] = useState<any>(null);
  const [mine, setMine] = useState(getMineOnly);
  const [showAll, setShowAll] = useState(false);
  const [bdcBusy, setBdcBusy] = useState(false);   // MEA actives seulement (par défaut) / toutes   // Mes clients / Tous (même choix que la recherche)

  const reloadVisits = useCallback(() => { loadNextVisits(session).then(setVisits); }, [session]);
  useEffect(() => {
    setData(null); setError("");
    loadMeaData(session, mine)
      .then(d => {
        if (!d.tracking) { const lp = localPlans(); d.plans = new Map(Object.entries(lp)); }
        setData(d); setKey(k => d.campaigns.some(c => c.key === k && (showAll || c.active)) ? k : (d.campaigns.find(c => showAll || c.active) || d.campaigns[0])?.key || "");
      })
      .catch(e => setError(odoo.isNetworkError(e) ? "Indisponible hors ligne." : (e?.message || "Lecture impossible")));
    reloadVisits();
  }, [session, reloadVisits, mine]);

  const taken = data?.taken.get(key) || new Map();
  const status = (id: number): Status => taken.get(id)?.state === "pris" ? "pris" : taken.has(id) ? "devis" : "todo";
  const counts: Record<Status, number> = { todo: 0, devis: 0, pris: 0 };
  data?.clients.forEach(c => counts[status(c.id)]++);

  const rows = useMemo(() => {
    if (!data) return [];
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.clients
      .filter(c => status(c.id) === filter)
      .filter(c => words.every(w => `${c.name} ${c.city || ""} ${c.ref || ""}`.toLowerCase().includes(w)))
      .sort((a, b) => (Number(b.x_ca_n_1) || 0) - (Number(a.x_ca_n_1) || 0));
  }, [data, taken, filter, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (clientId: number, patch: Partial<Plan>) => {
    if (!data) return;
    const k = planKey(key, clientId);
    const cur = data.plans.get(k) || { offerId: null, note: "" };
    const next = { ...cur, ...patch };
    if (next.offerId === cur.offerId && next.note === cur.note) return;
    if (!data.tracking) {
      saveLocalPlan(k, next);
      setData(d => d && { ...d, plans: new Map(d.plans).set(k, next) });
      return;
    }
    setSaving(k); setErr("");
    try {
      const id = await savePlan(session, data.tracking, key, clientId, next);
      setData(d => d && { ...d, plans: new Map(d.plans).set(k, { ...next, id }) });
    } catch (e: any) {
      setErr(odoo.isNetworkError(e) ? "Hors ligne : prévision non enregistrée" : `Enregistrement refusé : ${e?.message || e}`);
    }
    setSaving(null);
  };

  // MEA proposables à un client : celles qu'il n'a pas prises (avec l'offre prévue si elle est notée).
  const meaLabel = (k: string, clientId: number) => {
    const plan = data?.plans.get(planKey(k, clientId));
    const v = plan?.offerId && data?.campaigns.find(c => c.key === k)?.offers.find(o => o.id === plan.offerId)?.variant;
    return v ? `${k} (${v})` : k;
  };
  const meaOptionsFor = (clientId: number) =>
    (data?.campaigns || []).filter(c => c.active && data?.taken.get(c.key)?.get(clientId)?.state !== "pris").map(c => meaLabel(c.key, clientId));
  const camp = data?.campaigns.find(c => c.key === key);

  // BDC de séminaire pour les clients affichés : achats N-1 et proposition par client.
  const exportBdcs = async () => {
    if (!camp || !rows.length) return;
    if (rows.length > 150 && !window.confirm(`Générer ${rows.length} BDC (un onglet par client) ? Cela peut prendre un moment.`)) return;
    setBdcBusy(true);
    try {
      const list = await loadBatchBdc(session, camp, rows);
      const images = await loadBdcImages(session, list[0]?.campaign.products.map(p => p.product.id) || []);
      const blob = await buildBdc(list.map(x => ({
        code: String(x.client.ref || ""), name: String(x.client.name || ""),
        discount: pricelistDiscount(Array.isArray(x.client.property_product_pricelist) ? x.client.property_product_pricelist[1] : ""),
        campaign: x.campaign,
      })), images);
      downloadBlob(blob, `BDC ${camp.key} - ${rows.length} clients.xlsx`.replace(/[\\/:*?"<>|]/g, " "));
      onToast(`${rows.length} BDC générés`, "success");
    } catch (e: any) { onToast(odoo.isNetworkError(e) ? "Hors ligne : génération impossible" : `Génération impossible : ${e?.message || e}`, "error"); }
    setBdcBusy(false);
  };
  const total = data?.clients.length || 0;
  const GRID = "minmax(0, 2fr) 120px 140px minmax(0, 1.6fr)";

  return (
    <div className="ov-full" style={{ position: "fixed", inset: 0, zIndex: 300, background: C.bg, display: "flex", flexDirection: "column" as const, fontFamily: "'DM Sans', sans-serif" }}>
      {/* En-tête */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 24px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={onClose} aria-label="Retour"
              style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${C.border}`, background: C.white, cursor: "pointer", color: C.textSec, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>Mes MEA</div>
              <div style={{ fontSize: 12.5, color: C.muted }}>Qui a pris, à qui les proposer, et quand je les vois</div>
            </div>
            <button onClick={() => setMine(m => { setMineOnly(!m); return !m; })}
              title={mine ? "Mes clients uniquement — toucher pour tous les clients" : "Tous les clients — toucher pour les miens"}
              style={{ height: 38, padding: "0 14px", borderRadius: 10, border: `1.5px solid ${mine ? C.teal : C.border}`, background: mine ? C.teal : C.white, color: mine ? "#fff" : C.textSec, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" as const }}>
              {mine ? "Mes clients" : "Tous les clients"}
            </button>
            {/* BDC de séminaire : un onglet Excel par client de la liste affichée */}
            {camp && rows.length > 0 && (
              <button onClick={exportBdcs} disabled={bdcBusy} title="Générer les BDC Excel de cette MEA pour les clients affichés (un onglet par client)"
                style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "none", background: C.teal, color: "#fff", fontSize: 13, fontWeight: 800, cursor: bdcBusy ? "default" : "pointer", fontFamily: "inherit", opacity: bdcBusy ? 0.6 : 1, whiteSpace: "nowrap" as const }}>
                {bdcBusy ? "Génération…" : `BDC Excel (${rows.length})`}
              </button>
            )}
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un client…"
              style={{ width: 230, height: 38, padding: "0 12px", borderRadius: 10, border: `1.5px solid ${C.border}`, fontSize: 13, fontFamily: "inherit", outline: "none" }} />
          </div>

          {/* Campagnes actives */}
          {data && data.campaigns.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
              {([[false, `Actives (${data.campaigns.filter(c => c.active).length})`], [true, `Toutes (${data.campaigns.length})`]] as const).map(([v, l]) => (
                <button key={String(v)} onClick={() => { setShowAll(v); if (!v && !data.campaigns.find(c => c.key === key)?.active) setKey(data.campaigns.find(c => c.active)?.key || ""); }}
                  style={{ height: 30, padding: "0 12px", borderRadius: 999, border: `1.5px solid ${showAll === v ? C.teal : C.border}`, background: showAll === v ? C.tealSoft : C.white,
                    color: showAll === v ? C.tealDark : C.textSec, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
              ))}
            </div>
          )}
          {data && data.campaigns.length > 0 && (
            <div style={{ display: "flex", gap: 10, overflowX: "auto" as const, marginTop: 10, paddingBottom: 2 }}>
              {data.campaigns.filter(c => showAll || c.active).map(c => {
                const took = Array.from(data.taken.get(c.key)?.values() || []).filter(t => t.state === "pris").length;
                const pct = total ? Math.round((took / total) * 100) : 0;
                const sel = c.key === key;
                return (
                  <button key={c.key} onClick={() => setKey(c.key)}
                    style={{ flex: "0 0 220px", textAlign: "left" as const, padding: "12px 14px", borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
                      border: `2px solid ${sel ? C.teal : C.border}`, background: sel ? C.tealSoft : C.white }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{c.key}</span>
                      <span style={{ fontSize: 18, fontWeight: 800, color: C.tealDark }}>{pct}%</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{took} / {total} clients · {c.offers.map(o => o.variant).join(" · ")}</div>
                    <div style={{ height: 4, borderRadius: 2, background: "rgba(15,23,42,0.07)", marginTop: 8, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: C.teal }} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Compteurs = filtres */}
          {data && camp && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
              {(["todo", "devis", "pris"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  style={{ textAlign: "left" as const, padding: "9px 14px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "baseline", gap: 8,
                    border: `2px solid ${filter === f ? STAT[f].color : "transparent"}`, background: STAT[f].soft }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: STAT[f].color }}>{counts[f]}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: STAT[f].color }}>{STAT[f].label}</span>
                </button>
              ))}
            </div>
          )}

          {data && !data.tracking && (
            <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 10, background: C.orangeSoft, color: C.orange, fontSize: 12, fontWeight: 600 }}>
              Offre prévue et notes enregistrées sur cet appareil seulement : le modèle Studio « Suivi MEA » n'existe pas encore dans Odoo.
            </div>
          )}
          {err && <div style={{ marginTop: 8, fontSize: 12, color: C.red, fontWeight: 600 }}>{err}</div>}
        </div>
      </div>

      {/* Liste des clients */}
      <div style={{ flex: 1, overflowY: "auto" as const }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "8px 24px 30px" }}>
          {error && <div style={{ textAlign: "center" as const, color: C.muted, fontSize: 13, padding: 30 }}>{error}</div>}
          {!error && !data && <TubeLoader label="Chargement du suivi MEA…" />}
          {data && !data.campaigns.length && <div style={{ textAlign: "center" as const, color: C.muted, fontSize: 13, padding: 30 }}>Aucune MEA active.</div>}
          {data && camp && <>
            <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "10px 14px 8px", fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
              <span>Client</span><span>Prochain RDV</span><span>{filter === "todo" ? "Offre prévue" : "Offre"}</span><span>Note</span>
            </div>
            <div style={{ background: C.white, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden" }}>
              {rows.length === 0 && <div style={{ textAlign: "center" as const, color: C.muted, fontSize: 13, padding: 30 }}>
                {data.clients.length === 0 && mine ? "Aucun client n'a ton nom comme Vendeur dans Odoo — passe sur « Tous les clients »." : "Aucun client."}
              </div>}
              {rows.map((c, i) => {
                const t = taken.get(c.id);
                const k = planKey(key, c.id);
                const plan = data.plans.get(k);
                const next = visits.get(c.id);
                return (
                  <div key={c.id} style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, alignItems: "center", padding: "10px 14px", borderTop: i ? `1px solid ${C.border}` : "none" }}>
                    <button onClick={() => onOpenClient(c)} title="Ouvrir la fiche client"
                      style={{ minWidth: 0, textAlign: "left" as const, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{c.name}</div>
                      <div style={{ fontSize: 11.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                        {[c.city, c.x_ca_n_1 ? `N-1 ${fmtEUR(Number(c.x_ca_n_1))}` : ""].filter(Boolean).join(" · ")}
                      </div>
                    </button>
                    {next ? (
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: C.tealDark }}>
                        {next.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                      </span>
                    ) : (
                      <button onClick={() => setRdvFor(c)}
                        style={{ justifySelf: "start", height: 30, padding: "0 12px", borderRadius: 8, border: `1.5px solid ${C.teal}`, background: C.white, color: C.tealDark, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                        + Planifier
                      </button>
                    )}
                    {t ? (
                      <span title={t.orders.join(", ")} style={{ fontSize: 12.5, fontWeight: 700, color: t.state === "pris" ? C.green : C.orange, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                        {t.offers.join(", ")}
                      </span>
                    ) : (
                      <select value={plan?.offerId || ""} disabled={saving === k}
                        onChange={e => save(c.id, { offerId: e.target.value ? Number(e.target.value) : null })}
                        style={{ width: "100%", height: 32, padding: "0 6px", borderRadius: 8, border: `1px solid ${plan?.offerId ? C.teal : C.border}`, background: plan?.offerId ? C.tealSoft : C.white, fontSize: 12.5, fontFamily: "inherit", color: plan?.offerId ? C.tealDark : C.muted, fontWeight: plan?.offerId ? 700 : 500 }}>
                        <option value="">—</option>
                        {camp.offers.map(o => <option key={o.id} value={o.id}>{o.variant}</option>)}
                      </select>
                    )}
                    <input key={`${k}-${plan?.note || ""}`} defaultValue={plan?.note || ""} placeholder="Ajouter une note…"
                      onBlur={e => save(c.id, { note: e.target.value.trim() })}
                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      style={{ width: "100%", boxSizing: "border-box" as const, height: 32, padding: "0 10px", borderRadius: 8, border: "1px solid transparent", background: C.bg, fontSize: 12.5, fontFamily: "inherit", outline: "none", color: C.text }} />
                  </div>
                );
              })}
            </div>
          </>}
        </div>
      </div>

      {rdvFor && (
        <AppointmentModal session={session} client={rdvFor}
          meaOptions={meaOptionsFor(rdvFor.id)} meaChecked={[meaLabel(key, rdvFor.id)]}
          onClose={() => { setRdvFor(null); reloadVisits(); }}
          onToast={onToast} />
      )}
    </div>
  );
}
