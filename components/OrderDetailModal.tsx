"use client";
// Détail d'une commande (historique client) : livraison, transport et suivi,
// quantités livrées, lots, remises, totaux HT / TVA / TTC.
import { useEffect, useMemo, useState } from "react";
import * as odoo from "@/lib/odoo";
import { loadOrderDetail, type OrderDetail, type DetailLine, type DetailPicking } from "@/lib/orderDetail";
import { odooRecordUrl } from "@/lib/perimes";
import { useExit, TubeLoader, Sk } from "@/components/motion";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155", muted: "#7d8ca3", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  orange: "#ea580c", orangeSoft: "#fff7ed", green: "#16a34a", greenSoft: "#f0fdf4",
  red: "#dc2626", redSoft: "#fef2f2", blue: "#2563eb", blueSoft: "#eff6ff",
  shadowXl: "0 20px 25px rgba(0,0,0,0.10), 0 8px 10px rgba(0,0,0,0.04)",
};
const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const qtyFmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
const odooDate = (s: string) => new Date(s.length > 10 ? s.replace(" ", "T") + "Z" : `${s}T12:00:00`);
const day = (s: string | null) => s ? odooDate(s).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "—";
const monthYear = (s: string) => odooDate(s).toLocaleDateString("fr-FR", { month: "2-digit", year: "numeric" });

const PICK_STATE: Record<string, { label: string; color: string; bg: string }> = {
  draft:     { label: "Brouillon",      color: C.muted,  bg: C.bg },
  waiting:   { label: "En attente",     color: C.orange, bg: C.orangeSoft },
  confirmed: { label: "En attente",     color: C.orange, bg: C.orangeSoft },
  assigned:  { label: "En préparation", color: C.blue,   bg: C.blueSoft },
  done:      { label: "Expédiée",       color: C.green,  bg: C.greenSoft },
};

function Icon({ d, size = 15, color = "currentColor" }: { d: string; size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d={d} /></svg>;
}
const I = {
  pin: "M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  truck: "M1 4h14v11H1zM15 8h4l4 4v3h-8M5.5 18.5a2 2 0 1 0 0-.01M18.5 18.5a2 2 0 1 0 0-.01",
  ext: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01",
  box: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  gift: "M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z",
};

export default function OrderDetailModal({ session, order, stateLabel, onClose: onCloseProp }: {
  session: odoo.OdooSession;
  order: { id: number; name: string; date_order?: string; state: string; amount_total?: number };
  stateLabel: { label: string; color: string; bg: string };
  onClose: () => void;
}) {
  const [closing, onClose] = useExit(onCloseProp);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setDetail(null); setError("");
    loadOrderDetail(session, order.id)
      .then(d => { if (alive) setDetail(d); })
      .catch(e => { if (alive) setError(odoo.isNetworkError(e) ? "Détail indisponible hors ligne" : `Détail indisponible : ${e?.message || e}`); });
    return () => { alive = false; };
  }, [session, order.id]);

  const stats = useMemo(() => {
    if (!detail) return null;
    const sold = detail.lines.filter(l => !l.section && l.productId);
    const qty = sold.reduce((s, l) => s + l.qty, 0);
    const known = sold.every(l => l.delivered != null);
    const delivered = known ? sold.reduce((s, l) => s + Math.min(l.qty, l.delivered || 0), 0) : null;
    const freeValue = sold.filter(l => l.free).reduce((s, l) => s + l.qty * (l.listPrice || l.priceUnit), 0);
    const discount = detail.grossCatalog != null ? Math.max(0, detail.grossCatalog - detail.untaxed) : null;
    return { qty, delivered, freeValue, discount, refs: sold.length };
  }, [detail]);

  const outPickings = detail?.pickings.filter(p => !p.isReturn) || [];
  const carrier = outPickings.find(p => p.carrier)?.carrier || detail?.carrier || null;

  return (
    <div className={closing ? "ov closing" : "ov"} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", display: "flex", flexDirection: "column", background: C.white, borderRadius: 22, boxShadow: C.shadowXl, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>

        {/* ── En-tête ── */}
        <div style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)", color: "#fff", padding: "18px 22px 16px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.06em" }}>Commande</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{order.name}</div>
              <div style={{ fontSize: 12.5, opacity: 0.9, marginTop: 4, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span>{order.date_order ? odooDate(order.date_order).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—"}</span>
                <span style={{ background: "rgba(255,255,255,0.2)", borderRadius: 999, padding: "2px 9px", fontWeight: 700, fontSize: 11.5 }}>{stateLabel.label}</span>
                {detail?.ref && <span>Réf. client : <strong>{detail.ref}</strong></span>}
              </div>
            </div>
            <a href={odooRecordUrl(session, "sale.order", order.id)} target="_blank" rel="noopener noreferrer" title="Ouvrir dans Odoo"
              style={{ height: 32, padding: "0 11px", borderRadius: 9, background: "rgba(255,255,255,0.16)", color: "#fff", textDecoration: "none", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
              Odoo <Icon d={I.ext} size={13} />
            </a>
            <button onClick={onClose} aria-label="Fermer"
              style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.16)", border: "none", color: "#fff", cursor: "pointer", fontSize: 15, flexShrink: 0 }}>✕</button>
          </div>

          {/* Avancement de la livraison */}
          {stats && stats.delivered != null && stats.qty > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                <span>{stats.delivered >= stats.qty ? "Entièrement livrée" : stats.delivered > 0 ? "Livrée en partie" : "Pas encore livrée"}</span>
                <span>{qtyFmt(stats.delivered)} / {qtyFmt(stats.qty)} unités · {stats.refs} réf.</span>
              </div>
              <div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,0.22)", overflow: "hidden" }}>
                <div className="grow-x" style={{ width: `${Math.min(100, (stats.delivered / stats.qty) * 100)}%`, height: "100%", borderRadius: 999, background: stats.delivered >= stats.qty ? "#5eead4" : "#fde68a" }} />
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 6px", background: C.bg }}>
          {error && <div style={{ textAlign: "center", color: C.muted, padding: 30, fontSize: 13 }}>{error}</div>}
          {!error && !detail && <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginBottom: 12 }}>
              <Sk h={110} r={14} /><Sk h={110} r={14} />
            </div>
            <TubeLoader size={52} label="Chargement de la commande…" />
          </>}

          {detail && <>
            {/* ── Livraison + transport ── */}
            <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10, marginBottom: 14 }}>
              <Card icon={I.pin} title="Adresse de livraison">
                {detail.shipping ? <>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{detail.shipping.name}</div>
                  {detail.shipping.lines.map((l, i) => <div key={i} style={{ fontSize: 12.5, color: C.textSec, lineHeight: 1.5 }}>{l}</div>)}
                  {!detail.invoiceSameAsShipping && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Facturée à une autre adresse</div>}
                </> : <div style={{ fontSize: 12.5, color: C.muted }}>Non renseignée</div>}
              </Card>
              <Card icon={I.truck} title="Transport">
                <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{carrier || "Transporteur non renseigné"}</div>
                {outPickings.length === 0 && <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>Aucun bon de livraison</div>}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                  {outPickings.map(p => <PickingRow key={p.id} p={p} showCarrier={!!p.carrier && p.carrier !== carrier} />)}
                </div>
              </Card>
            </div>

            {/* ── Articles ── */}
            <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 2px 8px" }}>Articles</div>
            <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {detail.lines.map(l => <LineRow key={l.id} l={l} />)}
            </div>

            {detail.pickings.some(p => p.isReturn) && (
              <div style={{ marginTop: 12, fontSize: 12, color: C.orange, fontWeight: 700 }}>
                Retour : {detail.pickings.filter(p => p.isReturn).map(p => `${p.name} (${(PICK_STATE[p.state] || { label: p.state }).label.toLowerCase()})`).join(", ")}
              </div>
            )}
          </>}
        </div>

        {/* ── Totaux ── */}
        <div style={{ padding: "12px 22px 16px", borderTop: `1px solid ${C.border}`, background: C.white, flexShrink: 0 }}>
          {detail && stats ? <>
            {stats.discount != null && stats.discount > 0.01 && detail.grossCatalog != null && <>
              <TotalRow label="Prix catalogue" value={eur(detail.grossCatalog)} />
              <TotalRow label={<>Remises accordées{stats.freeValue > 0.01 && <span style={{ color: C.muted, fontWeight: 500 }}> · dont gratuités {eur(stats.freeValue)}</span>}</>}
                value={`−${eur(stats.discount)}`} color={C.orange}
                extra={detail.grossCatalog > 0 ? `${Math.round((stats.discount / detail.grossCatalog) * 100)} %` : undefined} />
            </>}
            <TotalRow label="Total HT" value={eur(detail.untaxed)} strong />
            <TotalRow label="TVA" value={eur(detail.tax)} />
            <TotalRow label="Total TTC" value={eur(detail.total)} />
            {detail.pricelist && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Tarif : {detail.pricelist}</div>}
          </> : (
            <TotalRow label="Total TTC" value={order.amount_total != null ? eur(order.amount_total) : "—"} strong />
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: C.tealDark, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 7 }}>
        <Icon d={icon} size={14} color={C.teal} /> {title}
      </div>
      {children}
    </div>
  );
}

function PickingRow({ p, showCarrier }: { p: DetailPicking; showCarrier: boolean }) {
  const st = PICK_STATE[p.state] || { label: p.state, color: C.muted, bg: C.bg };
  return (
    <div style={{ borderTop: `1px dashed ${C.border}`, paddingTop: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.textSec }}>{p.name}</span>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: st.color, background: st.bg, borderRadius: 999, padding: "1px 8px" }}>{st.label}</span>
        <span style={{ fontSize: 11.5, color: C.muted }}>{p.done ? "le" : "prévue"} {day(p.date)}</span>
      </div>
      {showCarrier && <div style={{ fontSize: 11.5, color: C.textSec, marginTop: 2 }}>{p.carrier}</div>}
      {p.trackingRef && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: C.textSec, background: C.bg, borderRadius: 6, padding: "2px 7px", userSelect: "all" }}>{p.trackingRef}</span>
          {p.trackingUrl && (
            <a href={p.trackingUrl} target="_blank" rel="noopener noreferrer" className="press"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 12px", borderRadius: 999, background: C.teal, color: "#fff", textDecoration: "none", fontSize: 12, fontWeight: 800 }}>
              Suivre le colis <Icon d={I.ext} size={12} />
            </a>
          )}
        </div>
      )}
      {!p.trackingRef && p.done && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>Pas de numéro de suivi</div>}
    </div>
  );
}

function LineRow({ l }: { l: DetailLine }) {
  if (l.section) return (
    <div style={{ fontSize: l.section === "line_section" ? 11.5 : 11.5, fontWeight: l.section === "line_section" ? 800 : 500, fontStyle: l.section === "line_note" ? "italic" : "normal",
      color: l.section === "line_section" ? C.tealDark : C.muted, padding: "8px 4px 2px", textTransform: l.section === "line_section" ? "uppercase" : "none", letterSpacing: l.section === "line_section" ? "0.04em" : 0 }}>
      {l.name}
    </div>
  );
  // Ligne sans article (remise globale, frais…) : discrète.
  if (!l.productId) return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 12px", fontSize: 12.5, color: l.subtotal < 0 ? C.orange : C.textSec }}>
      <span>{l.name}</span><strong>{eur(l.subtotal)}</strong>
    </div>
  );

  const full = l.delivered != null && l.delivered >= l.qty - 1e-6;
  const none = l.delivered != null && l.delivered <= 1e-6;
  const dColor = l.delivered == null ? C.muted : full ? C.green : none ? C.muted : C.orange;
  const dBg = l.delivered == null ? C.bg : full ? C.greenSoft : none ? C.bg : C.orangeSoft;
  // Remise du tarif client par rapport au prix catalogue.
  const tariffPct = l.listPrice && l.listPrice - l.priceUnit > 0.005 && !l.free ? Math.round((1 - l.priceUnit / l.listPrice) * 100) : 0;

  return (
    <div style={{ display: "flex", gap: 12, background: C.white, border: `1px solid ${l.free ? `${C.green}44` : C.border}`, borderRadius: 12, padding: "10px 12px", alignItems: "flex-start" }}>
      {/* Quantité livrée, bien visible */}
      <div title={l.delivered == null ? "Quantité livrée inconnue" : `${qtyFmt(l.delivered)} livré(s) sur ${qtyFmt(l.qty)} commandé(s)`}
        style={{ width: 62, flexShrink: 0, borderRadius: 10, background: dBg, color: dColor, textAlign: "center", padding: "6px 0" }}>
        <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.1 }}>
          {l.delivered == null ? qtyFmt(l.qty) : qtyFmt(l.delivered)}
          {l.delivered != null && !full && <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.8 }}>/{qtyFmt(l.qty)}</span>}
        </div>
        <div style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 1 }}>
          {l.delivered == null ? "commandé" : full ? "livré" + (l.qty > 1 ? "s" : "") : none ? "à livrer" : "livrés"}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{l.name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 3, fontSize: 11.5, color: C.muted }}>
          {l.code && <span style={{ fontFamily: "ui-monospace, monospace" }}>{l.code}</span>}
          <span>{qtyFmt(l.qty)} × {eur(l.priceUnit)}</span>
          {tariffPct > 0 && <span style={{ textDecoration: "line-through" }}>{eur(l.listPrice!)}</span>}
          {l.free ? <Chip color={C.green} bg={C.greenSoft} icon={I.gift}>Offert</Chip> : <>
            {tariffPct > 0 && <Chip color={C.blue} bg={C.blueSoft} icon={I.tag}>Tarif −{tariffPct} %</Chip>}
            {l.discount > 0 && <Chip color={C.orange} bg={C.orangeSoft} icon={I.tag}>Remise −{qtyFmt(l.discount)} %</Chip>}
          </>}
        </div>
        {/* Lots livrés */}
        {l.lots.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
            {l.lots.map(lot => (
              <span key={lot.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: C.textSec, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "2px 7px" }}>
                <Icon d={I.box} size={11} color={C.muted} />
                Lot {lot.name}
                <span style={{ color: C.muted, fontWeight: 600 }}>· {qtyFmt(lot.qty)} u{lot.expiry ? ` · exp. ${monthYear(lot.expiry)}` : ""}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: l.free ? C.green : C.tealDark }}>{eur(l.subtotal)}</div>
        <div style={{ fontSize: 10, color: C.muted }}>HT</div>
      </div>
    </div>
  );
}

function Chip({ color, bg, icon, children }: { color: string; bg: string; icon: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 800, color, background: bg, borderRadius: 999, padding: "1px 7px" }}>
      <Icon d={icon} size={10} color={color} />{children}
    </span>
  );
}

function TotalRow({ label, value, color, strong, extra }: { label: React.ReactNode; value: string; color?: string; strong?: boolean; extra?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "2px 0" }}>
      <span style={{ fontSize: strong ? 13.5 : 12.5, fontWeight: strong ? 800 : 600, color: color || (strong ? C.text : C.textSec) }}>{label}</span>
      <span style={{ fontSize: strong ? 18 : 13, fontWeight: 800, color: color || (strong ? C.tealDark : C.textSec) }}>
        {extra && <span style={{ fontSize: 11, fontWeight: 700, marginRight: 6 }}>{extra}</span>}{value}
      </span>
    </div>
  );
}
