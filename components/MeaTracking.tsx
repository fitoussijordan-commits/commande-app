"use client";
// Tableau de bord « Mes MEA » (écran indépendant, ouvert depuis l'accueil) :
// pour chaque MEA active, les clients du commercial qui ont pris / ont un devis /
// sont à proposer, leur prochain RDV (ou « Planifier ») et la prévision du
// commercial (offre envisagée + note) — pour préparer ses RDV.
import LogoutButton from "@/components/LogoutButton";
import HomeButton from "@/components/HomeButton";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TubeLoader } from "@/components/motion";
import * as odoo from "@/lib/odoo";
import { linkedPartnerId } from "@/lib/calendar";
import { loadBatchBdc, pricelistDiscount } from "@/lib/rdvPrep";
import { buildBdc, downloadBlob, loadBdcImages } from "@/lib/bdcExcel";
import { loadMeaData, savePlan, planKey, saveLocalPlan, eligibleCount, meaTargets, type MeaData, type Plan } from "@/lib/meaTracking";
import AppointmentModal from "@/components/AppointmentModal";
import { getMineOnly, setMineOnly } from "@/lib/clients";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155", muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", green: "#16a34a", greenSoft: "#f0fdf4",
  orange: "#ea580c", orangeSoft: "#fff7ed", red: "#dc2626",
};
const fmtEUR = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const toOdoo = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
type Status = "todo" | "devis" | "pris" | "ne";
const STAT: Record<Status, { label: string; color: string; soft: string }> = {
  todo: { label: "À proposer", color: "#334155", soft: "#eef2f6" },
  devis: { label: "Devis en cours", color: "#ea580c", soft: "#fff7ed" },
  pris: { label: "Ont pris", color: "#16a34a", soft: "#f0fdf4" },
  ne: { label: "N/A", color: "#94a3b8", soft: "#f1f5f9" },
};

// Clients « indirects » : étiquette contenant « indirect » sur la fiche client,
// ou sur au moins une de leurs commandes (ex. « CA indirect », « CA Indirect Mlle Bio »).
async function loadIndirect(session: odoo.OdooSession, ids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  if (!ids.length) return out;
  const byTag: any[] = await odoo.searchRead(session, "res.partner", [["id", "in", ids], ["category_id.name", "ilike", "indirect"]], ["id"], 0).catch(() => []);
  byTag.forEach(p => out.add(p.id));
  const orders: any[] = await odoo.searchRead(session, "sale.order",
    [["partner_id.commercial_partner_id", "in", ids], ["tag_ids.name", "ilike", "indirect"], ["state", "!=", "cancel"]], ["partner_id"], 0).catch(() => []);
  const pids = Array.from(new Set(orders.map(o => o.partner_id?.[0]).filter(Boolean))) as number[];
  if (pids.length) {
    const parts: any[] = await odoo.searchRead(session, "res.partner", [["id", "in", pids]], ["commercial_partner_id"], 0).catch(() => []);
    parts.forEach(p => out.add(p.commercial_partner_id?.[0] || p.id));
  }
  return out;
}

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
  const [raw, setData] = useState<MeaData | null>(null);
  // Clients directs / indirects : étiquette « CA indirect » (fiche client ou
  // commandes). Le filtre s'applique à tout l'écran (cartes, % et liste).
  const [kind, setKind] = useState<"all" | "direct" | "indirect">("all");
  const [indirect, setIndirect] = useState<Set<number> | null>(null);
  useEffect(() => {
    if (!raw || indirect) return;
    let alive = true;
    loadIndirect(session, raw.clients.map(c => c.id)).then(s => { if (alive) setIndirect(s); }).catch(() => { if (alive) setIndirect(new Set()); });
    return () => { alive = false; };
  }, [raw, indirect, session]);
  const data = useMemo(() => !raw || kind === "all" || !indirect ? raw
    : { ...raw, clients: raw.clients.filter(c => indirect.has(c.id) === (kind === "indirect")) }, [raw, kind, indirect]);
  const [info, setInfo] = useState<string | null>(null);   // carte MEA dont le détail (ⓘ) est ouvert
  // Un tap ailleurs referme le détail.
  useEffect(() => {
    if (!info) return;
    const close = () => setInfo(null);
    const t = setTimeout(() => document.addEventListener("click", close), 0);
    return () => { clearTimeout(t); document.removeEventListener("click", close); };
  }, [info]);
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
  const [bdcBusy, setBdcBusy] = useState(false);
  const [sortBy, setSortBy] = useState<"ca_desc" | "ca_asc" | "name">("ca_desc");   // tri des clients   // MEA actives seulement (par défaut) / toutes   // Mes clients / Tous (même choix que la recherche)

  const reloadVisits = useCallback(() => { loadNextVisits(session).then(setVisits); }, [session]);
  useEffect(() => {
    setData(null); setError(""); setIndirect(null);
    loadMeaData(session, mine)
      .then(d => {
        setData(d); setKey(k => d.campaigns.some(c => c.key === k && (showAll || c.active)) ? k : (d.campaigns.find(c => showAll || c.active) || d.campaigns[0])?.key || "");
      })
      .catch(e => setError(odoo.isNetworkError(e) ? "Indisponible hors ligne." : (e?.message || "Lecture impossible")));
    reloadVisits();
  }, [session, reloadVisits, mine]);

  const taken = data?.taken.get(key) || new Map();
  // Non éligible : coché par le DC (client qui ne peut pas recevoir cette MEA) —
  // sorti du calcul de placement, sauf s'il l'a quand même prise.
  const isIneligible = (k: string, id: number) => !!data?.plans.get(planKey(k, id))?.ineligible;
  const status = (id: number): Status => taken.get(id)?.state === "pris" ? "pris" : taken.has(id) ? "devis" : isIneligible(key, id) ? "ne" : "todo";
  const counts: Record<Status, number> = { todo: 0, devis: 0, pris: 0, ne: 0 };
  // MEA « Exclusif Institut / Revendeur » : seuls les clients de ce type (et ceux
  // qui l'ont déjà prise) sont listés.
  const camp = data?.campaigns.find(c => c.key === key);
  const inScope = (c: any) => !camp || taken.has(c.id) || meaTargets(camp, c);
  data?.clients.filter(inScope).forEach(c => counts[status(c.id)]++);

  const rows = useMemo(() => {
    if (!data) return [];
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return data.clients
      .filter(inScope)
      .filter(c => status(c.id) === filter)
      .filter(c => words.every(w => `${c.name} ${c.city || ""} ${c.ref || ""}`.toLowerCase().includes(w)))
      .sort((a, b) => sortBy === "name" ? String(a.name).localeCompare(String(b.name), "fr")
        : sortBy === "ca_asc" ? (Number(a.x_ca_n_1) || 0) - (Number(b.x_ca_n_1) || 0)
        : (Number(b.x_ca_n_1) || 0) - (Number(a.x_ca_n_1) || 0));
  }, [data, taken, filter, q, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (clientId: number, patch: Partial<Plan>) => {
    if (!data) return;
    const k = planKey(key, clientId);
    const cur = data.plans.get(k) || { offerId: null, note: "" };
    const next = { ...cur, ...patch };
    if (next.offerId === cur.offerId && next.note === cur.note && !!next.ineligible === !!cur.ineligible) return;
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
    (data?.campaigns || []).filter(c => c.active && data?.taken.get(c.key)?.get(clientId)?.state !== "pris"
      && meaTargets(c, data?.clients.find(x => x.id === clientId))).map(c => meaLabel(c.key, clientId));

  // BDC de séminaire pour les clients affichés : achats N-1 et proposition par client.
  const exportBdcs = async () => {
    if (!camp || !rows.length) return;
    if (rows.length > 150 && !window.confirm(`Générer ${rows.length} BDC (un onglet par client) ? Cela peut prendre un moment.`)) return;
    setBdcBusy(true);
    try {
      const list = await loadBatchBdc(session, camp, rows);
      if (!list.some(x => x.campaign.products.length)) { onToast("Pas de BDC pour cette offre (aucun produit de vente dans ses modèles)", "info"); setBdcBusy(false); return; }
      const images = await loadBdcImages(session, Array.from(new Set(list.flatMap(x => x.campaign.products.map(p => p.product.id)))));
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
  const GRID = "minmax(0, 2fr) 120px 140px minmax(0, 1.6fr) 92px";

  return (
    <div className="ov-full" style={{ position: "fixed", inset: 0, zIndex: 300, background: C.bg, display: "flex", flexDirection: "column" as const, fontFamily: "'DM Sans', sans-serif" }}>
      {/* En-tête */}
      <div style={{ background: C.white, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 24px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <HomeButton />
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
            <LogoutButton size={38} />
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8, marginTop: 10 }}>
              {data.campaigns.filter(c => (showAll || c.active) && c.key).map(c => {
                const tk = data.taken.get(c.key);
                const took = Array.from(tk?.values() || []).filter(t => t.state === "pris").length;
                // Base du placement : clients éligibles (les « non éligibles » sont retirés).
                const elig = eligibleCount(data, c.key);
                const pct = elig ? Math.round((took / elig) * 100) : 0;
                const sel = c.key === key;
                return (
                  <div key={c.key} role="button" tabIndex={0} onClick={() => setKey(c.key)}
                    onKeyDown={e => { if (e.key === "Enter") setKey(c.key); }}
                    style={{ position: "relative" as const, textAlign: "left" as const, padding: "9px 12px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                      border: `2px solid ${sel ? C.teal : C.border}`, background: sel ? C.tealSoft : C.white }}>
                    {/* En un coup d'œil : nom, placés / clients, % de placement */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                      <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: C.text, lineHeight: 1.25, minHeight: 32, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>{c.key.replace(/^MEA\s+/i, "")}</div>
                      {/* ⓘ : nom complet et variantes de la MEA */}
                      <button onClick={e => { e.stopPropagation(); setInfo(info === c.key ? null : c.key); }} aria-label="Détail de la MEA"
                        style={{ flexShrink: 0, width: 20, height: 20, borderRadius: 999, border: `1.5px solid ${info === c.key ? C.teal : C.muted}`, background: info === c.key ? C.teal : "transparent", color: info === c.key ? "#fff" : C.muted, fontSize: 11, fontWeight: 800, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1, cursor: "pointer", padding: 0 }}>i</button>
                    </div>
                    {info === c.key && (() => {
                      const byVariant = new Map<string, number>();
                      data.taken.get(c.key)?.forEach(t => { if (t.state === "pris") t.offers.forEach(v => byVariant.set(v, (byVariant.get(v) || 0) + 1)); });
                      const variants = Array.from(new Set(c.offers.map(o => o.variant)));
                      return (
                        <div onClick={e => e.stopPropagation()} className="reveal"
                          style={{ position: "absolute" as const, zIndex: 20, top: "100%", left: 0, marginTop: 6, width: 280, maxWidth: "80vw", background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 12px 30px rgba(15,23,42,0.18)", padding: "10px 12px", cursor: "default" }}>
                          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, lineHeight: 1.3 }}>{c.key}</div>
                          <div style={{ fontSize: 11, color: c.active ? C.tealDark : C.muted, fontWeight: 700, marginTop: 2 }}>{c.active ? "Active" : "Terminée"} · {variants.length} variante{variants.length > 1 ? "s" : ""}</div>
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column" as const, gap: 3 }}>
                            {variants.map(v => (
                              <div key={v} style={{ display: "flex", gap: 8, fontSize: 12, color: C.textSec }}>
                                <span style={{ flex: 1, minWidth: 0 }}>• {v}</span>
                                {byVariant.get(v) ? <span style={{ fontWeight: 800, color: C.tealDark, whiteSpace: "nowrap" as const }}>{byVariant.get(v)} pris</span> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: C.textSec }}>{took}<span style={{ color: C.muted, fontWeight: 600 }}>/{elig}</span></span>
                      <span style={{ fontSize: 17, fontWeight: 800, color: C.tealDark }}>{pct}%</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: "rgba(15,23,42,0.07)", marginTop: 6, overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: C.teal }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Compteurs = filtres */}
          {data && camp && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginTop: 12 }}>
              {(["todo", "devis", "pris", "ne"] as const).map(f => (
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
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>Client
                <select value={kind} onChange={e => setKind(e.target.value as any)} title="Clients directs / indirects (étiquette « CA indirect »)"
                  style={{ height: 24, borderRadius: 6, border: `1px solid ${kind !== "all" ? C.teal : C.border}`, background: kind !== "all" ? C.tealSoft : C.white, fontSize: 11, fontWeight: 700, color: kind !== "all" ? C.tealDark : C.textSec, fontFamily: "inherit", textTransform: "none" as const }}>
                  <option value="all">Directs + indirects</option>
                  <option value="direct">Directs</option>
                  <option value="indirect">Indirects{indirect ? ` (${indirect.size})` : ""}</option>
                </select>
                <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} title="Trier les clients"
                  style={{ height: 24, borderRadius: 6, border: `1px solid ${C.border}`, background: C.white, fontSize: 11, fontWeight: 700, color: C.textSec, fontFamily: "inherit", textTransform: "none" as const }}>
                  <option value="ca_desc">CA N-1 ↓</option>
                  <option value="ca_asc">CA N-1 ↑</option>
                  <option value="name">Nom A→Z</option>
                </select>
              </span><span>Prochain RDV</span><span>{filter === "todo" || filter === "ne" ? "Offre prévue" : "Offre"}</span><span>Note</span><span title="Client qui ne peut pas recevoir cette MEA : retiré du calcul de placement">N/A</span>
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
                    {t ? <span /> : (
                      <label title="Ce client ne peut pas recevoir cette MEA : il sort du calcul de placement"
                        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: plan?.ineligible ? C.textSec : C.muted, cursor: "pointer" }}>
                        <input type="checkbox" checked={!!plan?.ineligible} disabled={saving === k}
                          onChange={e => save(c.id, { ineligible: e.target.checked })}
                          style={{ width: 18, height: 18, accentColor: C.textSec, cursor: "pointer" }} />
                        N/A
                      </label>
                    )}
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
