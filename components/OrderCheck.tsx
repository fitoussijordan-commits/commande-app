"use client";
// Contrôle de cohérence avant validation (bouton « Check » du panier) :
//   • montant comparé aux commandes des 12 derniers mois du client ;
//   • gratuités : valeur catalogue et part de la commande (quota à définir) ;
//   • ruptures et franco de port.
// Informatif : rien n'est bloqué.
import { useEffect, useState } from "react";
import * as odoo from "@/lib/odoo";
import { FRANCO_HT, SHIPPING_FEE_HT } from "@/lib/franco";

const C = {
  white: "#fff", bg: "#f8fafc", text: "#0f172a", textSec: "#334155", muted: "#94a3b8", border: "#e2e8f0",
  green: "#16a34a", greenSoft: "#f0fdf4", orange: "#ea580c", orangeSoft: "#fff7ed", red: "#dc2626", redSoft: "#fef2f2",
  teal: "#0d9488",
};
const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

interface Props {
  session: odoo.OdooSession;
  client: any;
  netTotal: number;                         // HT, après remises, hors frais de port
  giftValue: number; giftCount: number;     // gratuités : valeur catalogue, nombre d'articles
  ruptures: { name: string; code?: string; qty: number; stock: number }[];
  shippingFee: boolean;
  onClose: () => void;
}

export default function OrderCheck({ session, client, netTotal, giftValue, giftCount, ruptures, shippingFee, onClose }: Props) {
  const [hist, setHist] = useState<{ avg: number; count: number; last?: { name: string; amount: number; date: string } } | null>(null);
  const [histError, setHistError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const since = new Date(); since.setFullYear(since.getFullYear() - 1);
        const rows = await odoo.searchRead(session, "sale.order",
          [["partner_id", "child_of", client.id], ["state", "in", ["sale", "done"]], ["date_order", ">=", since.toISOString().slice(0, 10)], ["amount_untaxed", ">", 0]],
          ["name", "amount_untaxed", "date_order"], 200, "date_order desc");
        const avg = rows.length ? rows.reduce((s: number, r: any) => s + (r.amount_untaxed || 0), 0) / rows.length : 0;
        setHist({ avg, count: rows.length, last: rows[0] ? { name: rows[0].name, amount: rows[0].amount_untaxed, date: String(rows[0].date_order).slice(0, 10) } : undefined });
      } catch { setHistError(true); }
    })();
  }, [session, client.id]);

  const ratio = hist && hist.avg > 0 ? netTotal / hist.avg : null;
  const amountTone = ratio == null ? "muted" : ratio < 0.5 || ratio > 2 ? "orange" : "green";
  const giftPct = netTotal > 0 ? (giftValue / netTotal) * 100 : 0;

  const Row = ({ tone, title, children }: { tone: "green" | "orange" | "red" | "muted"; title: string; children: React.ReactNode }) => {
    const col = tone === "green" ? C.green : tone === "orange" ? C.orange : tone === "red" ? C.red : C.muted;
    const bg = tone === "green" ? C.greenSoft : tone === "orange" ? C.orangeSoft : tone === "red" ? C.redSoft : C.bg;
    return (
      <div style={{ background: bg, borderRadius: 12, padding: "11px 13px", marginBottom: 10, borderLeft: `4px solid ${col}` }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: col, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: C.textSec, lineHeight: 1.5 }}>{children}</div>
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, maxHeight: "85vh", overflowY: "auto", background: C.white, borderRadius: 18, padding: "20px 20px 16px", boxShadow: "0 20px 25px rgba(0,0,0,0.12)", fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>Check de la commande</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 16, color: C.muted, cursor: "pointer" }}>✕</button>
        </div>

        <Row tone={amountTone} title="Montant">
          Cette commande : <strong>{eur(netTotal)} HT</strong><br />
          {histError ? "Historique indisponible (hors ligne ?)"
            : !hist ? "Chargement de l'historique…"
            : hist.count === 0 ? "Aucune commande confirmée sur les 12 derniers mois."
            : <>Moyenne sur 12 mois : <strong>{eur(hist.avg)} HT</strong> ({hist.count} commande{hist.count > 1 ? "s" : ""})
                {ratio != null && <> · {ratio >= 1 ? "+" : "−"}{Math.abs(Math.round((ratio - 1) * 100))} %</>}
                {hist.last && <><br />Dernière : {hist.last.name} · {eur(hist.last.amount)} · {hist.last.date.split("-").reverse().join("/")}</>}
                {amountTone === "orange" && <><br /><strong style={{ color: C.orange }}>Écart important avec l'habitude du client.</strong></>}</>}
        </Row>

        <Row tone={giftCount ? "muted" : "green"} title="Gratuités">
          {giftCount === 0 ? "Aucune gratuité." : <>
            {giftCount} article{giftCount > 1 ? "s" : ""} offert{giftCount > 1 ? "s" : ""} · valeur catalogue <strong>{eur(giftValue)}</strong>
            {netTotal > 0 && <> · {Math.round(giftPct)} % de la commande</>}
            <br /><span style={{ color: C.muted }}>Quota de gratuités : à définir.</span>
          </>}
        </Row>

        <Row tone={ruptures.length ? "red" : "green"} title="Ruptures">
          {ruptures.length === 0 ? "Tout est en stock." : <>
            {ruptures.map((r, i) => <div key={i}>• {r.code ? `${r.code} — ` : ""}{r.name} : {r.qty} demandé{r.qty > 1 ? "s" : ""}, {r.stock} dispo</div>)}
            <div style={{ marginTop: 4 }}>Le service client vérifiera (réservations possibles).</div>
          </>}
        </Row>

        <Row tone={shippingFee ? "orange" : "green"} title="Franco de port">
          {shippingFee
            ? <>Sous le franco de {eur(FRANCO_HT)} HT : frais de livraison de <strong>{eur(SHIPPING_FEE_HT)} HT</strong> ajoutés. Il manque {eur(FRANCO_HT - netTotal)}.</>
            : netTotal > 0 ? <>Franco atteint ({eur(FRANCO_HT)} HT).</> : "Panier vide."}
        </Row>
      </div>
    </div>
  );
}
