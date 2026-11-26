"use client";
// Préparation de RDV : CA à date, offres du cycle faites / à faire (offre
// prévue + note), quantités proposées par produit (modifiables) avec export du
// BDC Excel (case N/A : offre non proposée au client).
import LogoutButton from "@/components/LogoutButton";
import HomeButton from "@/components/HomeButton";
import { useEffect, useMemo, useState } from "react";
import * as odoo from "@/lib/odoo";
import { loadRdvPrep, type RdvPrep, type PrepCampaign } from "@/lib/rdvPrep";
import { savePlan, saveLocalPlan, planKey, type Plan } from "@/lib/meaTracking";
import { buildBdc, downloadBlob, loadBdcImages } from "@/lib/bdcExcel";
import { saleStep } from "@/lib/productFields";
import { useExit, TubeLoader, Sk, CountUp } from "@/components/motion";

const C = {
  bg: "#f4f6f9", white: "#fff", text: "#0f172a", textSec: "#334155", muted: "#7d8ca3", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  orange: "#ea580c", orangeSoft: "#fff7ed", green: "#16a34a", greenSoft: "#f0fdf4", red: "#dc2626", redSoft: "#fef2f2",
};
const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const eur2 = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const q = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("fr-FR", { maximumFractionDigits: 1 }));

const STATUS = {
  pris: { label: "Faite", color: C.green, bg: C.greenSoft },
  devis: { label: "En devis", color: C.orange, bg: C.orangeSoft },
  todo: { label: "À proposer", color: C.red, bg: C.redSoft },
  na: { label: "N/A", color: "#94a3b8", bg: "#f1f5f9" },
};

export default function RdvPrepModal({ session, client, onClose: onCloseProp, onToast, onCreateQuote }: {
  session: odoo.OdooSession; client: any; onClose: () => void;
  onCreateQuote?: (templateId: number, qtys: Record<number, number>) => void;   // proposition → panier
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [closing, onClose] = useExit(onCloseProp);
  const [data, setData] = useState<RdvPrep | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<number, number>>>({});   // campagne → produit → quantité
  const [variantSel, setVariantSel] = useState<Record<string, number>>({});        // campagne → variante (modèle) du BDC

  useEffect(() => {
    let alive = true;
    loadRdvPrep(session, client)
      .then(d => { if (!alive) return; setData(d); setOpen(d.campaigns.find(c => c.status === "todo")?.campaign.key || null); })
      .catch(e => { if (alive) setError(odoo.isNetworkError(e) ? "Préparation indisponible hors ligne." : `Lecture impossible : ${e?.message || e}`); });
    return () => { alive = false; };
  }, [session, client]);

  const evo = data && data.ca.n != null && data.ca.n1 ? ((data.ca.n - data.ca.n1) / data.ca.n1) * 100 : null;
  const counts = useMemo(() => {
    const c = { pris: 0, devis: 0, todo: 0 };
    data?.campaigns.forEach(x => { if (!(x.status === "todo" && x.plan?.ineligible)) c[x.status]++; });
    return c;
  }, [data]);

  // Variante affichée / exportée : choisie à la main, sinon celle de l'« Offre
  // prévue » (même nom que le modèle), sinon la variante conseillée.
  const fold = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const viewOf = (pc: PrepCampaign): PrepCampaign => {
    let id = variantSel[pc.campaign.key];
    if (id == null && pc.plan?.offerId) {
      const off = pc.campaign.offers.find(o => o.id === pc.plan!.offerId);
      const m = off && pc.variants.find(v => fold(v.name) === fold(off.name))
        || off && pc.variants.find(v => fold(v.name).endsWith(fold(off.variant)));
      if (m) id = m.id;
    }
    const opt = id != null ? pc.options[id] : null;
    return opt ? { ...pc, chosen: opt.chosen, reason: opt.reason, products: opt.products, free: opt.free } : pc;
  };
  const pickVariant = (pc: PrepCampaign, id: number) => {
    setVariantSel(v => ({ ...v, [pc.campaign.key]: id }));
    setEdits(e => ({ ...e, [pc.campaign.key]: {} }));
  };

  const qtyOf = (pc: PrepCampaign, pid: number, def: number) => edits[pc.campaign.key]?.[pid] ?? def;
  const setQty = (pc: PrepCampaign, pid: number, v: number) =>
    setEdits(e => ({ ...e, [pc.campaign.key]: { ...(e[pc.campaign.key] || {}), [pid]: Math.max(0, v) } }));

  const save = async (pc: PrepCampaign, patch: Partial<Plan>) => {
    if (!data) return;
    const cur = pc.plan || { offerId: null, note: "" };
    const next: Plan = { ...cur, ...patch };
    if (next.offerId === cur.offerId && next.note === cur.note && !!next.ineligible === !!cur.ineligible) return;
    try {
      if (data.tracking) next.id = await savePlan(session, data.tracking, pc.campaign.key, client.id, next);
      else saveLocalPlan(planKey(pc.campaign.key, client.id), next);
      setData(d => d && { ...d, campaigns: d.campaigns.map(x => x.campaign.key === pc.campaign.key ? { ...x, plan: next } : x) });
      if (patch.offerId !== undefined) setVariantSel(v => { const n = { ...v }; delete n[pc.campaign.key]; return n; });
    } catch (e: any) { onToast(odoo.isNetworkError(e) ? "Hors ligne : non enregistré" : `Enregistrement refusé : ${e?.message || e}`, "error"); }
  };

  const exportBdc = async (pc: PrepCampaign) => {
    if (!data) return;
    const withEdits: PrepCampaign = { ...pc, products: pc.products.map(p => ({ ...p, proposal: qtyOf(pc, p.product.id, p.proposal) })) };
    try {
      const images = await loadBdcImages(session, withEdits.products.map(p => p.product.id));
      const blob = await buildBdc([{ code: String(client.ref || ""), name: String(client.name), discount: data.discount, campaign: withEdits }], images);
      downloadBlob(blob, `BDC ${pc.campaign.key} - ${client.name}.xlsx`.replace(/[\\/:*?"<>|]/g, " "));
      onToast("BDC Excel généré", "success");
    } catch (e: any) { onToast(`Génération impossible : ${e?.message || e}`, "error"); }
  };

  return (
    <div className={closing ? "ov closing" : "ov-full"} style={{ position: "fixed", inset: 0, zIndex: 260, background: C.bg, overflowY: "auto", fontFamily: "'DM Sans', sans-serif", paddingTop: "env(safe-area-inset-top)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "18px 22px 40px" }}>
        {/* En-tête */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <HomeButton size={38} />
          <button onClick={onClose} aria-label="Retour"
            style={{ width: 38, height: 38, borderRadius: 11, border: `1px solid ${C.border}`, background: C.white, cursor: "pointer", fontSize: 16 }}>←</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Préparation de RDV</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.name}</div>
          </div>
          {data?.pricelist && <span style={{ fontSize: 12, fontWeight: 700, color: C.tealDark, background: C.tealSoft, borderRadius: 999, padding: "4px 10px" }}>{data.pricelist}</span>}
          <LogoutButton size={38} />
        </div>

        {error && <div style={{ padding: 40, textAlign: "center", color: C.muted }}>{error}</div>}
        {!error && !data && <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
            {[0, 1, 2, 3].map(i => <Sk key={i} h={84} r={16} />)}
          </div>
          <TubeLoader label="Préparation du RDV… (historique, offres, propositions)" />
        </>}

        {data && <>
          {/* Chiffres */}
          <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 18 }}>
            <Kpi label="CA à date N" value={data.ca.n != null ? <CountUp fromZero value={data.ca.n} format={eur} /> : "—"} />
            <Kpi label="CA à date N-1" value={data.ca.n1 != null ? <CountUp fromZero value={data.ca.n1} format={eur} /> : "—"} />
            <Kpi label="Évolution" value={evo == null ? "—" : `${evo >= 0 ? "+" : ""}${evo.toFixed(1)} %`} color={evo == null ? C.text : evo >= 0 ? C.green : C.red} />
            <Kpi label="Offres du cycle" value={`${counts.pris} faite${counts.pris > 1 ? "s" : ""} · ${counts.todo} à proposer`} small />
          </div>

          {/* Offres du cycle */}
          <SectionTitle>Offres du cycle</SectionTitle>
          {!data.tracking && <div style={{ fontSize: 11.5, color: C.orange, margin: "-4px 2px 8px" }}>Offre prévue et notes gardées sur cet appareil (modèle Odoo « Suivi MEA » absent).</div>}
          {data.campaigns.length === 0 && <div style={{ color: C.muted, fontSize: 13, padding: 10 }}>Aucune MEA active.</div>}
          <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 22 }}>
            {data.campaigns.map(pc0 => {
              const pc = viewOf(pc0);
              // N/A : le DC ne proposera pas cette offre au client (champ « éligible » du suivi MEA).
              const na = pc.status === "todo" && !!pc.plan?.ineligible;
              const st = STATUS[na ? "na" : pc.status];
              const isOpen = open === pc.campaign.key;
              // Prix remisé MEA (remise de l'offre), puis remise client.
              const total = pc.products.reduce((s, p) => s + qtyOf(pc, p.product.id, p.proposal) * p.price * (1 - (p.meaPct || 0) / 100), 0) * (1 - data.discount / 100);
              const units = pc.products.reduce((s, p) => s + qtyOf(pc, p.product.id, p.proposal), 0);
              return (
                <div key={pc.campaign.key} style={{ opacity: na ? 0.6 : 1, background: C.white, border: `1px solid ${C.border}`, borderLeft: `4px solid ${st.color}`, borderRadius: 14, overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", flexWrap: "wrap" }}>
                    <button onClick={() => setOpen(isOpen ? null : pc.campaign.key)}
                      style={{ flex: "1 1 260px", minWidth: 0, display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", padding: 0 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: st.color, background: st.bg, borderRadius: 999, padding: "2px 9px", flexShrink: 0 }}>{st.label}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: C.text }}>{pc.campaign.key}</span>
                        <span style={{ display: "block", fontSize: 11.5, color: C.muted }}>
                          {pc.status !== "todo" ? `${pc.orders.join(", ")} · ${pc.variantsTaken.join(", ")}` : na ? "Offre non proposée à ce client" : pc.chosen ? `Proposition : ${units} u. · ${eur2(total)} HT remisé` : `${pc.products.length} produits`}
                        </span>
                      </span>
                      <span style={{ marginLeft: "auto", color: C.muted, fontSize: 16, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</span>
                    </button>
                    {pc.status === "todo" && (
                      <div style={{ display: "flex", gap: 6, flex: "1 1 320px" }}>
                        <select value={pc.plan?.offerId || ""} onChange={e => save(pc, { offerId: e.target.value ? Number(e.target.value) : null })}
                          style={{ width: 150, height: 32, borderRadius: 8, border: `1px solid ${pc.plan?.offerId ? C.teal : C.border}`, background: pc.plan?.offerId ? C.tealSoft : C.white, fontSize: 12.5, fontFamily: "inherit" }}>
                          <option value="">Offre prévue…</option>
                          {pc.campaign.offers.map(o => <option key={o.id} value={o.id}>{o.variant}</option>)}
                        </select>
                        <input key={pc.plan?.note || ""} defaultValue={pc.plan?.note || ""} placeholder="Note pour le RDV…"
                          onBlur={e => save(pc, { note: e.target.value.trim() })}
                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          style={{ flex: 1, minWidth: 0, height: 32, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, fontSize: 12.5, fontFamily: "inherit" }} />
                        <label title="Offre non proposée à ce client (N/A) : elle sort des offres à proposer"
                          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 800, color: na ? C.textSec : C.muted, cursor: "pointer", flexShrink: 0 }}>
                          <input type="checkbox" checked={na} onChange={e => save(pc, { ineligible: e.target.checked })}
                            style={{ width: 18, height: 18, accentColor: C.textSec, cursor: "pointer" }} />
                          N/A
                        </label>
                      </div>
                    )}
                  </div>

                  {isOpen && (
                    <div className="reveal" style={{ borderTop: `1px solid ${C.border}`, padding: "10px 14px 14px", background: "#fbfcfd" }}>
                      {pc.variants.length > 1 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                          {pc.variants.map(v => {
                            const on = pc.chosen?.id === v.id;
                            const label = v.name.startsWith(pc.campaign.key) ? v.name.slice(pc.campaign.key.length).replace(/^\s*-\s*/, "") || v.name : v.name;
                            return (
                              <button key={v.id} onClick={() => pickVariant(pc, v.id)}
                                style={{ height: 28, padding: "0 10px", borderRadius: 999, border: `1.5px solid ${on ? C.teal : C.border}`, background: on ? C.tealSoft : C.white, color: on ? C.tealDark : C.textSec, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                                {label}{v.total ? ` · ${v.total} u.` : ""}{pc0.chosen?.id === v.id ? " ★" : ""}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: C.textSec, marginBottom: 8 }}>{pc.reason}{pc0.chosen && pc.variants.length > 1 ? " ★ = variante conseillée d'après les achats du client." : ""}</div>
                      {pc.products.length === 0 ? <div style={{ fontSize: 12.5, color: C.muted }}>Aucun produit de vente dans les modèles de cette offre (offre sans BDC).</div> : (
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                            <thead>
                              <tr style={{ color: C.muted, fontSize: 11, textAlign: "right" }}>
                                <th style={{ textAlign: "left", padding: "4px 6px" }}>Produit</th>
                                <th style={{ padding: "4px 6px" }}>PU HT</th>
                                <th style={{ padding: "4px 6px" }}>PU remisé MEA</th>
                                <th style={{ padding: "4px 6px" }} title="Livré sur toute l'année précédente (mouvements de stock terminés, retours déduits, hors gratuités)">Achats N-1 (année)</th>
                                <th style={{ padding: "4px 6px" }}>Achats N (à date)</th>
                                <th style={{ padding: "4px 6px", textAlign: "center" }}>Proposition</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pc.products.map(p => {
                                const v = qtyOf(pc, p.product.id, p.proposal); const step = saleStep(p.product);
                                return (
                                  <tr key={p.product.id} style={{ borderTop: `1px solid ${C.border}` }}>
                                    <td style={{ padding: "6px" }}>
                                      <div style={{ fontWeight: 700, color: C.text }}>{p.name}</div>
                                      <div style={{ fontSize: 10.5, color: C.muted, fontFamily: "ui-monospace, monospace" }}>{p.code}{p.ean ? ` · ${p.ean}` : ""}</div>
                                    </td>
                                    <td style={{ padding: "6px", textAlign: "right", color: C.textSec, whiteSpace: "nowrap" }}>{eur2(p.price)}</td>
                                    <td style={{ padding: "6px", textAlign: "right", whiteSpace: "nowrap", fontWeight: 800, color: p.meaPct > 0 ? C.tealDark : C.textSec }}>
                                      {eur2(p.price * (1 - (p.meaPct || 0) / 100))}
                                      {p.meaPct > 0 && <div style={{ fontSize: 10, fontWeight: 700, color: C.orange }}>−{q(p.meaPct)} %</div>}
                                    </td>
                                    <td style={{ padding: "6px", textAlign: "right", fontWeight: 700, color: p.n1 ? C.text : C.muted }}>{q(p.n1)}</td>
                                    <td style={{ padding: "6px", textAlign: "right", color: p.n < p.n1 ? C.orange : C.green }}>{q(p.n)}</td>
                                    <td style={{ padding: "6px" }}>
                                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                                        <button onClick={() => setQty(pc, p.product.id, v - step)} style={stepBtn(C.redSoft, C.red)}>−</button>
                                        <span key={v} className="qty-pop" style={{ minWidth: 30, textAlign: "center", fontWeight: 800, color: C.tealDark }}>{v}</span>
                                        <button onClick={() => setQty(pc, p.product.id, v + step)} style={stepBtn(C.tealSoft, C.teal)}>+</button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {pc.free.length > 0 && <div style={{ fontSize: 11.5, color: C.tealDark, marginTop: 8, fontWeight: 700 }}>Unités gratuites : {pc.free.map(f => `${f.qty} × ${f.name}`).join(" · ")}</div>}
                      {pc.kit.length > 0 && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>Kit offert (hors BDC) : {pc.kit.map(k => k.name).join(" · ")}</div>}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{units} u. · {eur2(total)} HT remisé{data.discount ? ` (−${data.discount} %)` : ""}</span>
                        <span style={{ flex: 1 }} />
                        <button onClick={() => exportBdc(pc)} disabled={!pc.products.length}
                          title={pc.products.length ? "" : "Pas de BDC pour cette offre (aucun produit de vente)"}
                          style={{ height: 34, padding: "0 14px", borderRadius: 10, border: "none", background: pc.products.length ? C.teal : "#cbd5e1", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: pc.products.length ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
                          {pc.products.length ? "Générer le BDC (Excel)" : "Pas de BDC pour cette offre"}
                        </button>
                        {onCreateQuote && pc.chosen && pc.products.length > 0 && (
                          <button onClick={() => onCreateQuote(pc.chosen!.id, Object.fromEntries(pc.products.map(p => [p.product.id, qtyOf(pc, p.product.id, p.proposal)])))}
                            title="Ouvre le panier avec cette variante et ces quantités (gratuités et remise de la MEA comprises) — il reste à vérifier et créer le devis"
                            style={{ height: 34, padding: "0 14px", borderRadius: 10, border: "none", background: C.tealDark, color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                            Créer le devis →
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

        </>}
      </div>
    </div>
  );
}

const stepBtn = (bg: string, color: string): React.CSSProperties => ({ width: 30, height: 30, borderRadius: 8, border: "none", background: bg, color, fontSize: 16, fontWeight: 800, cursor: "pointer" });

function Kpi({ label, value, color, small }: { label: string; value: React.ReactNode; color?: string; small?: boolean }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 16, padding: "12px 16px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted }}>{label}</div>
      <div style={{ fontSize: small ? 15 : 24, fontWeight: 800, color: color || C.text, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 2px 10px" }}>{children}</div>;
}
