"use client";
// Historique client — onglet Factures : factures et avoirs comptabilisés de
// l'année, avec pour chaque avoir la facture sur laquelle il s'applique :
//   1. avoir créé depuis la facture (champ « reversed_entry_id ») ;
//   2. avoir lettré sur la facture (rapprochement du compte client).
// Les avoirs sans facture liée sont listés à part. La commande d'origine
// (invoice_origin) fait le lien avec le module commande.
import { useEffect, useMemo, useState } from "react";
import { ListSkeleton } from "@/components/motion";
import InvoiceDetailModal from "@/components/InvoiceDetailModal";
import * as odoo from "@/lib/odoo";
import { resolveClientFamily } from "@/lib/perimes";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155", muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa",
  orange: "#ea580c", orangeSoft: "#fff7ed", green: "#16a34a", greenSoft: "#f0fdf4",
  red: "#dc2626", redSoft: "#fef2f2", blue: "#2563eb", blueSoft: "#eff6ff",
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)",
};
const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const dmy = (d?: string) => d ? d.slice(0, 10).split("-").reverse().join("/") : "—";

const PAY: Record<string, { label: string; color: string; bg: string }> = {
  paid:       { label: "Payée",       color: C.green,  bg: C.greenSoft },
  in_payment: { label: "En paiement", color: C.blue,   bg: C.blueSoft },
  partial:    { label: "Partielle",   color: C.orange, bg: C.orangeSoft },
  not_paid:   { label: "Non payée",   color: C.red,    bg: C.redSoft },
  reversed:   { label: "Annulée (avoir)", color: C.muted, bg: C.bg },
};

interface Move {
  id: number; name: string; move_type: string; invoice_date: string; invoice_date_due?: string;
  amount_total: number; amount_residual: number; payment_state: string;
  reversed_entry_id: [number, string] | false; invoice_origin: string | false; ref: string | false;
}
interface Link { refund: Move; amount: number | null }   // null : montant lettré inconnu

export default function InvoiceHistory({ session, client, year }: { session: odoo.OdooSession; client: any; year: number }) {
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [links, setLinks] = useState<Map<number, Link[]>>(new Map());   // facture → avoirs
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);          // pièce ouverte dans la fenêtre de détail
  const [filter, setFilter] = useState<"all" | "refunds" | "due">("all");

  useEffect(() => {
    let cancelled = false;
    setMoves(null); setError(""); setLinks(new Map());
    (async () => {
      try {
        const family = await resolveClientFamily(session, client).catch(() => [client.id]);
        const rows: Move[] = await odoo.searchRead(session, "account.move",
          [["partner_id", "child_of", family], ["move_type", "in", ["out_invoice", "out_refund"]], ["state", "=", "posted"],
           ["invoice_date", ">=", `${year}-01-01`], ["invoice_date", "<=", `${year}-12-31`]],
          ["id", "name", "move_type", "invoice_date", "invoice_date_due", "amount_total", "amount_residual", "payment_state", "reversed_entry_id", "invoice_origin", "ref"],
          0, "invoice_date desc, id desc");
        if (cancelled) return;
        const refunds = rows.filter(m => m.move_type === "out_refund");
        const map = new Map<number, Link[]>();
        const add = (invId: number, l: Link) => {
          const arr = map.get(invId) || [];
          const ex = arr.find(x => x.refund.id === l.refund.id);
          if (ex) { if (l.amount != null) ex.amount = (ex.amount || 0) + l.amount; }
          else arr.push(l);
          map.set(invId, arr);
        };
        // Avoirs lettrés sur une facture (rapprochement du compte client), y compris
        // un avoir d'une autre année appliqué sur une facture de l'année (et inversement).
        const byId = new Map<number, Move>(rows.map(m => [m.id, m]));
        try {
          const rLines = await odoo.searchRead(session, "account.move.line",
            [["move_id", "in", rows.map(r => r.id)], ["account_id.account_type", "=", "asset_receivable"]],
            ["move_id", "matched_debit_ids", "matched_credit_ids"], 0);
          const partialIds = Array.from(new Set(rLines.flatMap((l: any) => [...(l.matched_debit_ids || []), ...(l.matched_credit_ids || [])])));
          if (partialIds.length) {
            const partials = await odoo.searchRead(session, "account.partial.reconcile",
              [["id", "in", partialIds]], ["debit_move_id", "credit_move_id", "amount"], 0);
            const lineIds = Array.from(new Set(partials.flatMap((p: any) => [p.debit_move_id?.[0], p.credit_move_id?.[0]]).filter(Boolean)));
            const lines = await odoo.searchRead(session, "account.move.line", [["id", "in", lineIds]], ["move_id"], 0);
            const moveOf = new Map<number, number>(lines.map((l: any) => [l.id, l.move_id?.[0]]));
            const missing = Array.from(new Set(Array.from(moveOf.values()))).filter(id => id && !byId.has(id));
            if (missing.length) {
              const extra: Move[] = await odoo.searchRead(session, "account.move",
                [["id", "in", missing], ["move_type", "in", ["out_invoice", "out_refund"]]],
                ["id", "name", "move_type", "invoice_date", "invoice_date_due", "amount_total", "amount_residual", "payment_state", "reversed_entry_id", "invoice_origin", "ref"], 0);
              extra.forEach(m => byId.set(m.id, m));
            }
            for (const p of partials) {
              const inv = byId.get(moveOf.get(p.debit_move_id?.[0]) || 0);
              const ref = byId.get(moveOf.get(p.credit_move_id?.[0]) || 0);
              if (inv?.move_type === "out_invoice" && ref?.move_type === "out_refund") add(inv.id, { refund: ref, amount: Number(p.amount) || 0 });
            }
          }
        } catch (e) { if (odoo.isNetworkError(e)) throw e; /* droits compta insuffisants : lien « avoir de » seulement */ }
        // Avoir créé depuis la facture (même s'il n'est pas lettré).
        for (const r of refunds) {
          const inv = r.reversed_entry_id ? r.reversed_entry_id[0] : 0;
          if (inv && !(map.get(inv) || []).some(l => l.refund.id === r.id)) add(inv, { refund: r, amount: null });
        }
        if (cancelled) return;
        setLinks(map); setMoves(rows);
      } catch (e: any) {
        if (!cancelled) setError(odoo.isNetworkError(e) ? "Factures indisponibles hors ligne" : `Factures indisponibles : ${e?.message || e}`);
      }
    })();
    return () => { cancelled = true; };
  }, [session, client, year]);

  const { invoices, orphans, totals } = useMemo(() => {
    const all = moves || [];
    const invoices = all.filter(m => m.move_type === "out_invoice");
    // Avoirs rattachés à une facture affichée ; les autres (facture d'une autre année) à part.
    const linked = new Set(invoices.flatMap(m => (links.get(m.id) || []).map(l => l.refund.id)));
    const orphans = all.filter(m => m.move_type === "out_refund" && !linked.has(m.id));
    const inv = invoices.reduce((s, m) => s + m.amount_total, 0);
    const ref = all.filter(m => m.move_type === "out_refund").reduce((s, m) => s + m.amount_total, 0);
    const due = invoices.reduce((s, m) => s + m.amount_residual, 0);
    return { invoices, orphans, totals: { inv, ref, net: inv - ref, due } };
  }, [moves, links]);

  if (error) return <div style={{ textAlign: "center", color: C.muted, padding: 40, fontSize: 13 }}>{error}</div>;
  if (!moves) return <ListSkeleton count={5} height={70} />;
  if (!moves.length) return <div style={{ textAlign: "center", color: C.muted, padding: 40 }}>Aucune facture ni avoir en {year}</div>;

  // Avoir → facture(s) sur lesquelles il est imputé (pour la vue « Avoirs »).
  const refundTargets = new Map<number, string[]>();
  links.forEach((ls, invId) => {
    const inv = (moves || []).find(m => m.id === invId);
    ls.forEach(l => refundTargets.set(l.refund.id, [...(refundTargets.get(l.refund.id) || []), inv?.name || `#${invId}`]));
  });
  const allRefunds = (moves || []).filter(m => m.move_type === "out_refund");
  const dueInvoices = invoices.filter(m => m.amount_residual > 0.01);

  const Tile = ({ id, label, value, color, count }: { id: typeof filter; label: string; value: number; color: string; count: number }) => {
    const active = filter === id;
    return (
      <button onClick={() => setFilter(active ? "all" : id)} className="press"
        style={{ flex: 1, minWidth: 0, textAlign: "left", padding: "10px 12px", background: active ? color : C.white, border: `1.5px solid ${active ? color : C.border}`, borderRadius: 12,
          boxShadow: C.shadow, cursor: "pointer", fontFamily: "inherit" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: active ? "rgba(255,255,255,0.85)" : C.muted, textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", justifyContent: "space-between" }}>
          <span>{label}</span><span>{count}</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: active ? "#fff" : color, marginTop: 2, whiteSpace: "nowrap" }}>{eur(value)}</div>
      </button>
    );
  };
  const RefundRow = ({ r, amount }: { r: Move; amount: number | null }) => (
    <button onClick={() => setOpenId(r.id)} className="press"
      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 10px", borderRadius: 8, background: C.orangeSoft, border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left", fontSize: 12 }}>
      <span style={{ fontWeight: 800, color: C.orange }}>Avoir</span>
      <span style={{ flex: 1, minWidth: 0, color: C.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {r.name} · {dmy(r.invoice_date)}{r.ref ? ` · ${r.ref}` : ""}
      </span>
      <span style={{ fontWeight: 800, color: C.orange, whiteSpace: "nowrap" }}>
        −{eur(amount ?? r.amount_total)}{amount != null && Math.abs(amount - r.amount_total) > 0.01 ? ` / ${eur(r.amount_total)}` : ""}
      </span>
      <span style={{ color: C.orange, fontWeight: 800 }}>›</span>
    </button>
  );
  const InvoiceCard = ({ m }: { m: Move }) => {
    const pay = PAY[m.payment_state] || { label: m.payment_state, color: C.muted, bg: C.bg };
    const refs = links.get(m.id) || [];
    const late = m.amount_residual > 0.01 && m.invoice_date_due && new Date(`${m.invoice_date_due}T23:59:59`) < new Date();
    return (
      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: C.shadow, overflow: "hidden" }}>
        <button onClick={() => setOpenId(m.id)}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 14px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
              {m.name}
              {refs.length > 0 && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 800, color: C.orange, background: C.orangeSoft, borderRadius: 5, padding: "1px 6px" }}>{refs.length} avoir{refs.length > 1 ? "s" : ""}</span>}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              {dmy(m.invoice_date)}{m.invoice_origin ? ` · Cde ${m.invoice_origin}` : ""}
              {m.amount_residual > 0.01 && m.invoice_date_due && <span style={{ color: late ? C.red : C.muted, fontWeight: late ? 700 : 400 }}> · échéance {dmy(m.invoice_date_due)}</span>}
            </div>
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: late ? "#fff" : pay.color, background: late ? C.red : pay.bg, borderRadius: 6, padding: "2px 7px", flexShrink: 0 }}>{late ? "En retard" : pay.label}</span>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.tealDark }}>{eur(m.amount_total)}</div>
            {m.amount_residual > 0.01 && m.payment_state !== "not_paid" && <div style={{ fontSize: 10.5, color: C.red }}>reste {eur(m.amount_residual)}</div>}
          </div>
          <span style={{ color: C.muted, fontSize: 18, lineHeight: 1 }}>›</span>
        </button>
        {refs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 14px 10px" }}>
            {refs.map(l => <RefundRow key={l.refund.id} r={l.refund} amount={l.amount} />)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <Tile id="all" label="Facturé TTC" value={totals.inv} color={C.tealDark} count={invoices.length} />
        <Tile id="refunds" label="Avoirs" value={-totals.ref} color={C.orange} count={allRefunds.length} />
        <Tile id="due" label="Reste dû" value={totals.due} color={totals.due > 0.01 ? C.red : C.green} count={dueInvoices.length} />
      </div>
      {filter !== "all" && (
        <div className="fade-in" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.textSec }}>
          <span>Filtre : <strong>{filter === "refunds" ? "avoirs" : "factures non soldées"}</strong></span>
          <button onClick={() => setFilter("all")} style={{ background: "none", border: "none", color: C.teal, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>Tout afficher</button>
        </div>
      )}

      <div key={filter} className="stagger" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filter === "all" && invoices.map(m => <InvoiceCard key={m.id} m={m} />)}
        {filter === "due" && (dueInvoices.length ? dueInvoices.map(m => <InvoiceCard key={m.id} m={m} />)
          : <div style={{ textAlign: "center", color: C.green, padding: 30, fontWeight: 700 }}>Tout est réglé en {year} ✓</div>)}
        {filter === "refunds" && (allRefunds.length ? allRefunds.map(r => {
          const targets = refundTargets.get(r.id) || (r.reversed_entry_id ? [r.reversed_entry_id[1]] : []);
          const pay = PAY[r.payment_state] || { label: r.payment_state, color: C.muted, bg: C.bg };
          return (
            <button key={r.id} onClick={() => setOpenId(r.id)} className="press"
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: C.white, border: `1px solid ${C.orange}33`, borderLeft: `4px solid ${C.orange}`, borderRadius: 14, boxShadow: C.shadow, padding: "12px 14px", cursor: "pointer", fontFamily: "inherit" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{r.name}</div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                  {dmy(r.invoice_date)}{r.ref ? ` · ${r.ref}` : ""}
                  {targets.length > 0 ? <> · sur <strong style={{ color: C.textSec }}>{targets.join(", ")}</strong></> : " · non rattaché"}
                </div>
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: pay.color, background: pay.bg, borderRadius: 6, padding: "2px 7px", flexShrink: 0 }}>{r.payment_state === "paid" ? "Imputé" : r.payment_state === "not_paid" ? "Non imputé" : pay.label}</span>
              <div style={{ fontSize: 14, fontWeight: 800, color: C.orange, flexShrink: 0 }}>−{eur(r.amount_total)}</div>
              <span style={{ color: C.muted, fontSize: 18, lineHeight: 1 }}>›</span>
            </button>
          );
        }) : <div style={{ textAlign: "center", color: C.muted, padding: 30 }}>Aucun avoir en {year}</div>)}

        {filter === "all" && orphans.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 8 }}>
              Avoirs non rattachés à une facture de {year}
            </div>
            {orphans.map(r => (
              <div key={r.id}>
                <RefundRow r={r} amount={null} />
                {r.reversed_entry_id && <div style={{ fontSize: 10.5, color: C.muted, padding: "2px 10px" }}>avoir de {r.reversed_entry_id[1]}</div>}
              </div>
            ))}
          </>
        )}
      </div>

      {openId != null && (
        <InvoiceDetailModal key={openId} session={session} moveId={openId} onClose={() => setOpenId(null)} onOpenMove={id => setOpenId(id)} />
      )}
    </div>
  );
}
