"use client";
// Détail d'une facture ou d'un avoir (historique client) : montants, échéance,
// paiements et avoirs imputés, lignes, adresses, PDF et pièces jointes,
// commande d'origine — sans aller dans Odoo.
import { useEffect, useState } from "react";
import * as odoo from "@/lib/odoo";
import { loadInvoiceDetail, openAttachment, type InvoiceDetail, type InvAttachment } from "@/lib/invoiceDetail";
import { odooRecordUrl } from "@/lib/perimes";
import { useExit, TubeLoader, Sk } from "@/components/motion";
import OrderDetailModal from "@/components/OrderDetailModal";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155", muted: "#7d8ca3", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa",
  orange: "#ea580c", orangeSoft: "#fff7ed", green: "#16a34a", greenSoft: "#f0fdf4",
  red: "#dc2626", redSoft: "#fef2f2", blue: "#2563eb", blueSoft: "#eff6ff",
  shadowXl: "0 20px 25px rgba(0,0,0,0.10), 0 8px 10px rgba(0,0,0,0.04)",
};
const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const qtyFmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
const dlong = (s: string | null) => s ? new Date(`${s.slice(0, 10)}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "—";
const dshort = (s: string | null) => s ? s.slice(0, 10).split("-").reverse().join("/") : "—";
const kb = (n: number) => n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;

export const PAY_STATE: Record<string, { label: string; color: string; bg: string }> = {
  paid:       { label: "Payée",           color: C.green,  bg: C.greenSoft },
  in_payment: { label: "En paiement",     color: C.blue,   bg: C.blueSoft },
  partial:    { label: "Partielle",       color: C.orange, bg: C.orangeSoft },
  not_paid:   { label: "Non payée",       color: C.red,    bg: C.redSoft },
  reversed:   { label: "Annulée (avoir)", color: C.muted,  bg: C.bg },
};

function Icon({ d, size = 15, color = "currentColor" }: { d: string; size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d={d} /></svg>;
}
const I = {
  ext: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  file: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h4",
  clip: "M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l8-8",
  cash: "M2 7h20v10H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M6 7v10M18 7v10",
  pin: "M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  box: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  cal: "M3 5h18v16H3zM16 3v4M8 3v4M3 11h18",
};

export default function InvoiceDetailModal({ session, moveId, onClose: onCloseProp, onOpenMove }: {
  session: odoo.OdooSession;
  moveId: number;
  onClose: () => void;
  onOpenMove?: (id: number) => void;     // ouvrir une autre pièce (facture d'origine d'un avoir)
}) {
  const [closing, onClose] = useExit(onCloseProp);
  const [d, setD] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState("");
  const [busyAtt, setBusyAtt] = useState<number | null>(null);
  const [attError, setAttError] = useState("");
  const [showOrder, setShowOrder] = useState(false);

  useEffect(() => {
    let alive = true;
    setD(null); setError("");
    loadInvoiceDetail(session, moveId)
      .then(x => { if (alive) setD(x); })
      .catch(e => { if (alive) setError(odoo.isNetworkError(e) ? "Détail indisponible hors ligne" : `Détail indisponible : ${e?.message || e}`); });
    return () => { alive = false; };
  }, [session, moveId]);

  const openAtt = async (a: InvAttachment) => {
    setBusyAtt(a.id); setAttError("");
    try { await openAttachment(session, a); }
    catch (e: any) { setAttError(odoo.isNetworkError(e) ? "Pièce jointe indisponible hors ligne" : `Ouverture impossible : ${e?.message || e}`); }
    setBusyAtt(null);
  };

  const pay = d ? (PAY_STATE[d.paymentState] || { label: d.paymentState, color: C.muted, bg: C.bg }) : null;
  const refundTone = d?.isRefund;
  const head = refundTone ? "linear-gradient(135deg, #ea580c, #c2410c)" : "linear-gradient(135deg, #0d9488, #0f766e)";
  const overdue = d && !d.isRefund && d.residual > 0.01 && d.due && new Date(`${d.due}T23:59:59`) < new Date();
  const paidPct = d && d.total > 0 ? Math.min(100, ((d.total - d.residual) / d.total) * 100) : 0;
  const pdf = d?.attachments.find(a => a.mimetype === "application/pdf");

  return (
    <>
    <div className={closing ? "ov closing" : "ov"} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 210, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", display: "flex", flexDirection: "column", background: C.white, borderRadius: 22, boxShadow: C.shadowXl, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>

        {/* ── En-tête ── */}
        <div style={{ background: head, color: "#fff", padding: "18px 22px 16px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.06em" }}>{d ? (d.isRefund ? "Avoir" : "Facture") : "Pièce"}</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{d?.name || "…"}</div>
              {d && (
                <div style={{ fontSize: 12.5, opacity: 0.92, marginTop: 4, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span>{dlong(d.date)}</span>
                  {pay && <span style={{ background: "rgba(255,255,255,0.2)", borderRadius: 999, padding: "2px 9px", fontWeight: 700, fontSize: 11.5 }}>{pay.label}</span>}
                  {overdue && <span style={{ background: "#fff", color: C.red, borderRadius: 999, padding: "2px 9px", fontWeight: 800, fontSize: 11.5 }}>En retard</span>}
                </div>
              )}
            </div>
            {pdf && (
              <button onClick={() => openAtt(pdf)} disabled={busyAtt === pdf.id}
                style={{ height: 32, padding: "0 12px", borderRadius: 9, background: "#fff", color: refundTone ? C.orange : C.tealDark, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 800, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <Icon d={I.file} size={14} /> {busyAtt === pdf.id ? "Ouverture…" : "PDF"}
              </button>
            )}
            <a href={odooRecordUrl(session, "account.move", moveId)} target="_blank" rel="noopener noreferrer" title="Ouvrir dans Odoo"
              style={{ height: 32, padding: "0 11px", borderRadius: 9, background: "rgba(255,255,255,0.16)", color: "#fff", textDecoration: "none", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
              Odoo <Icon d={I.ext} size={13} />
            </a>
            <button onClick={onClose} aria-label="Fermer"
              style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.16)", border: "none", color: "#fff", cursor: "pointer", fontSize: 15, flexShrink: 0 }}>✕</button>
          </div>

          {/* Montant + règlement */}
          {d && (
            <div style={{ marginTop: 14, display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 700 }}>{d.isRefund ? "Montant de l'avoir TTC" : "Montant TTC"}</div>
                <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>{d.isRefund ? "−" : ""}{eur(d.total)}</div>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginBottom: 5 }}>
                  <span>{d.residual > 0.01 ? `Reste ${d.isRefund ? "à imputer" : "dû"} : ${eur(d.residual)}` : d.isRefund ? "Entièrement imputé" : "Entièrement réglée"}</span>
                  {!d.isRefund && d.due && <span style={{ opacity: 0.9 }}>Échéance {dshort(d.due)}</span>}
                </div>
                <div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,0.22)", overflow: "hidden" }}>
                  <div className="grow-x" style={{ width: `${paidPct}%`, height: "100%", borderRadius: 999, background: paidPct >= 99.9 ? "#bbf7d0" : "#fde68a" }} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 8px", background: C.bg }}>
          {error && <div style={{ textAlign: "center", color: C.muted, padding: 30, fontSize: 13 }}>{error}</div>}
          {!error && !d && <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 12 }}>
              <Sk h={96} r={14} /><Sk h={96} r={14} /><Sk h={96} r={14} />
            </div>
            <TubeLoader size={52} label="Chargement de la pièce…" />
          </>}

          {d && <>
            {/* ── Infos ── */}
            <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginBottom: 14 }}>
              <Card icon={I.cal} title="Références">
                <Info label="Date" value={dshort(d.date)} />
                {!d.isRefund && <Info label="Échéance" value={dshort(d.due)} alert={!!overdue} />}
                {d.paymentTerm && <Info label="Conditions" value={d.paymentTerm} />}
                {d.paymentRef && <Info label="Réf. paiement" value={d.paymentRef} mono />}
                {d.ref && <Info label="Réf. client" value={d.ref} />}
                {d.salesperson && <Info label="Commercial" value={d.salesperson} />}
              </Card>
              <Card icon={I.box} title={d.isRefund ? "Origine" : "Commande"}>
                {d.reversedOf && (
                  <button onClick={() => onOpenMove?.(d.reversedOf!.id)} className="press"
                    style={{ display: "block", width: "100%", textAlign: "left", background: C.orangeSoft, border: "none", borderRadius: 9, padding: "7px 10px", cursor: onOpenMove ? "pointer" : "default", fontFamily: "inherit", marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: C.orange, fontWeight: 700 }}>Avoir de la facture</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{d.reversedOf.name} {onOpenMove && "→"}</div>
                  </button>
                )}
                {d.origin ? (
                  d.originOrderId ? (
                    <button onClick={() => setShowOrder(true)} className="press"
                      style={{ display: "block", width: "100%", textAlign: "left", background: C.tealSoft, border: "none", borderRadius: 9, padding: "7px 10px", cursor: "pointer", fontFamily: "inherit" }}>
                      <div style={{ fontSize: 11, color: C.tealDark, fontWeight: 700 }}>Commande d'origine</div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{d.origin} →</div>
                      <div style={{ fontSize: 11, color: C.muted }}>Livraison, lots, suivi du colis</div>
                    </button>
                  ) : <Info label="Origine" value={d.origin} />
                ) : !d.reversedOf && <div style={{ fontSize: 12.5, color: C.muted }}>Aucune commande liée</div>}
              </Card>
              <Card icon={I.pin} title="Facturé à">
                {d.billing ? <>
                  <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{d.billing.name}</div>
                  {d.billing.lines.map((l, i) => <div key={i} style={{ fontSize: 12, color: C.textSec, lineHeight: 1.45 }}>{l}</div>)}
                </> : <div style={{ fontSize: 12.5, color: C.muted }}>—</div>}
                {d.shipping && <>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginTop: 7 }}>Livré à</div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{d.shipping.name}</div>
                  {d.shipping.lines.map((l, i) => <div key={i} style={{ fontSize: 12, color: C.textSec, lineHeight: 1.45 }}>{l}</div>)}
                </>}
              </Card>
            </div>

            {/* ── Règlements ── */}
            <Section title={d.isRefund ? "Imputations" : "Règlements"} icon={I.cash}>
              {d.payments.length === 0 ? (
                <div style={{ fontSize: 12.5, color: d.residual > 0.01 ? C.red : C.muted, padding: "2px 2px 4px" }}>
                  {d.residual > 0.01 ? (d.isRefund ? "Pas encore imputé." : "Aucun règlement reçu.") : "—"}
                </div>
              ) : d.payments.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 12px" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: p.isRefund ? C.orange : C.green, background: p.isRefund ? C.orangeSoft : C.greenSoft, borderRadius: 999, padding: "2px 8px", flexShrink: 0 }}>{p.label}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: C.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {dshort(p.date)}{p.journal ? ` · ${p.journal}` : ""}{p.ref ? ` · ${p.ref}` : ""}
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: p.isRefund ? C.orange : C.green }}>{eur(p.amount)}</span>
                </div>
              ))}
            </Section>

            {/* ── Lignes ── */}
            <Section title={`Articles (${d.lines.filter(l => !l.section).length})`} icon={I.box}>
              {d.lines.map(l => l.section ? (
                <div key={l.id} style={{ fontSize: 11.5, fontWeight: l.section === "line_section" ? 800 : 500, fontStyle: l.section === "line_note" ? "italic" : "normal",
                  color: l.section === "line_section" ? C.tealDark : C.muted, padding: "8px 4px 2px", textTransform: l.section === "line_section" ? "uppercase" : "none" }}>{l.name}</div>
              ) : (
                <div key={l.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: C.white, border: `1px solid ${l.discount >= 99.99 ? `${C.green}44` : C.border}`, borderRadius: 12, padding: "9px 12px" }}>
                  <div style={{ width: 46, flexShrink: 0, borderRadius: 9, background: C.bg, textAlign: "center", padding: "5px 0" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: C.text, lineHeight: 1.1 }}>{qtyFmt(l.qty)}</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: C.muted, textTransform: "uppercase" }}>{(l.uom || "u").slice(0, 6)}</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{l.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 3, fontSize: 11.5, color: C.muted }}>
                      {l.code && <span style={{ fontFamily: "ui-monospace, monospace" }}>{l.code}</span>}
                      <span>{qtyFmt(l.qty)} × {eur(l.priceUnit)}</span>
                      {l.discount >= 99.99 ? <Chip color={C.green} bg={C.greenSoft}>Offert</Chip>
                        : l.discount > 0 && <Chip color={C.orange} bg={C.orangeSoft}>Remise −{qtyFmt(l.discount)} %</Chip>}
                      {l.taxes.map(t => <span key={t} style={{ fontSize: 10.5 }}>{t}</span>)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: d.isRefund ? C.orange : C.tealDark }}>{eur(l.subtotal)}</div>
                    <div style={{ fontSize: 10, color: C.muted }}>HT{l.total != null ? ` · ${eur(l.total)} TTC` : ""}</div>
                  </div>
                </div>
              ))}
            </Section>

            {/* ── Pièces jointes ── */}
            <Section title={`Pièces jointes (${d.attachments.length})`} icon={I.clip}>
              {d.attachments.length === 0 && <div style={{ fontSize: 12.5, color: C.muted, padding: "2px 2px 4px" }}>Aucune pièce jointe (le PDF reste disponible dans Odoo).</div>}
              {d.attachments.map(a => (
                <button key={a.id} onClick={() => openAtt(a)} disabled={busyAtt === a.id} className="press"
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: C.white, border: `1px solid ${a.main ? C.teal : C.border}`, borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontFamily: "inherit" }}>
                  <span style={{ width: 34, height: 34, borderRadius: 8, background: a.mimetype === "application/pdf" ? C.redSoft : C.bg, color: a.mimetype === "application/pdf" ? C.red : C.muted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
                    {a.mimetype === "application/pdf" ? "PDF" : <Icon d={I.file} size={16} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                    <span style={{ display: "block", fontSize: 11, color: C.muted }}>{a.main ? "Document de la facture · " : ""}{kb(a.size)}</span>
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.teal }}>{busyAtt === a.id ? "…" : "Ouvrir"}</span>
                </button>
              ))}
              {attError && <div style={{ fontSize: 12, color: C.red, marginTop: 4 }}>{attError}</div>}
            </Section>

            {d.narration && (
              <Section title="Conditions / mentions" icon={I.file}>
                <div style={{ fontSize: 12, color: C.textSec, whiteSpace: "pre-wrap", lineHeight: 1.5, background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px" }}>{d.narration}</div>
              </Section>
            )}
          </>}
        </div>

        {/* ── Totaux ── */}
        {d && (
          <div style={{ padding: "12px 22px 16px", borderTop: `1px solid ${C.border}`, background: C.white, flexShrink: 0 }}>
            <Total label="Total HT" value={eur(d.untaxed)} />
            <Total label="TVA" value={eur(d.tax)} />
            <Total label="Total TTC" value={`${d.isRefund ? "−" : ""}${eur(d.total)}`} strong color={d.isRefund ? C.orange : C.tealDark} />
            {d.residual > 0.01 && <Total label={d.isRefund ? "Reste à imputer" : "Reste dû"} value={eur(d.residual)} color={d.isRefund ? C.orange : C.red} />}
          </div>
        )}
      </div>
    </div>
    {showOrder && d?.originOrderId && (
      <OrderDetailModal session={session} order={{ id: d.originOrderId, name: d.origin || "", state: "sale" }}
        stateLabel={{ label: "Commande", color: C.green, bg: C.greenSoft }} onClose={() => setShowOrder(false)} />
    )}
    </>
  );
}

function Card({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: "11px 13px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: C.tealDark, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 7 }}>
        <Icon d={icon} size={14} color={C.teal} /> {title}
      </div>
      {children}
    </div>
  );
}
function Info({ label, value, mono, alert }: { label: string; value: string; mono?: boolean; alert?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "1px 0" }}>
      <span style={{ color: C.muted }}>{label}</span>
      <span style={{ fontWeight: 700, color: alert ? C.red : C.text, textAlign: "right", fontFamily: mono ? "ui-monospace, monospace" : "inherit", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
    </div>
  );
}
function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 2px 7px" }}>
        <Icon d={icon} size={13} /> {title}
      </div>
      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  );
}
function Chip({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return <span style={{ fontSize: 10.5, fontWeight: 800, color, background: bg, borderRadius: 999, padding: "1px 7px" }}>{children}</span>;
}
function Total({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "2px 0" }}>
      <span style={{ fontSize: strong ? 13.5 : 12.5, fontWeight: strong ? 800 : 600, color: strong ? C.text : color || C.textSec }}>{label}</span>
      <span style={{ fontSize: strong ? 18 : 13, fontWeight: 800, color: color || C.textSec }}>{value}</span>
    </div>
  );
}
