"use client";
// Top 20 / flop 20 des clients du commercial : CA HT depuis le 1er janvier
// comparé à la même période de l'an dernier (commandes confirmées), classé
// par écart en euros — un petit client à +300 % ne passe pas devant un gros
// client qui gagne 5 000 €.
import { useEffect, useState } from "react";
import * as odoo from "@/lib/odoo";
import * as sync from "@/lib/sync";

const C = {
  text: "#0f172a", muted: "#94a3b8", teal: "#0d9488", green: "#16a34a", red: "#dc2626",
};
const fmtEUR = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const toOdoo = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const N = 20;

interface Row { client: any; cur: number; prev: number; delta: number }

export default function TopFlop({ session, onOpenClient }: {
  session: odoo.OdooSession;
  onOpenClient: (client: any) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"top" | "flop">("top");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const now = new Date();
        const y = now.getFullYear();
        const curFrom = new Date(y, 0, 1), prevFrom = new Date(y - 1, 0, 1);
        const prevTo = new Date(now); prevTo.setFullYear(y - 1);     // même jour l'an dernier
        const orders = await odoo.searchRead(session, "sale.order",
          [["state", "in", ["sale", "done"]], ["date_order", ">=", toOdoo(prevFrom)],
           ["partner_id.commercial_partner_id.user_id", "=", session.uid]],
          ["partner_id", "amount_untaxed", "date_order"], 0);
        // Commandes passées sur une adresse de livraison : rattachées à la société.
        const pids = Array.from(new Set(orders.map((o: any) => o.partner_id?.[0]).filter(Boolean)));
        const partners = pids.length
          ? await odoo.searchRead(session, "res.partner", [["id", "in", pids]], ["id", "commercial_partner_id"], 0) : [];
        const toCompany = new Map<number, number>(partners.map((p: any) => [p.id, p.commercial_partner_id?.[0] || p.id]));
        const sums = new Map<number, { cur: number; prev: number }>();
        for (const o of orders) {
          const cid = toCompany.get(o.partner_id?.[0]) || o.partner_id?.[0];
          if (!cid) continue;
          const d = new Date(String(o.date_order).replace(" ", "T") + "Z");
          const s = sums.get(cid) || { cur: 0, prev: 0 };
          if (d >= curFrom) s.cur += o.amount_untaxed || 0;
          else if (d <= prevTo) s.prev += o.amount_untaxed || 0;
          sums.set(cid, s);
        }
        const ids = Array.from(sums.keys());
        const clients = ids.length
          ? await odoo.searchRead(session, "res.partner", [["id", "in", ids]], sync.CLIENT_FIELDS, 0) : [];
        const out: Row[] = clients.map((c: any) => {
          const s = sums.get(c.id)!;
          return { client: c, cur: s.cur, prev: s.prev, delta: s.cur - s.prev };
        }).filter((r: Row) => r.delta !== 0);
        if (!cancelled) setRows(out);
      } catch (e: any) {
        if (!cancelled) setError(odoo.isNetworkError(e) ? "Indisponible hors ligne." : (e?.message || "Lecture impossible"));
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const list = rows
    ? (tab === "top" ? rows.filter(r => r.delta > 0).sort((a, b) => b.delta - a.delta)
                     : rows.filter(r => r.delta < 0).sort((a, b) => a.delta - b.delta)).slice(0, N)
    : [];
  const shown = open ? list : list.slice(0, 5);

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, fontSize: 11.5, color: C.muted }}>CA HT depuis le 1er janvier vs même période N-1</div>
        <div style={{ display: "flex", background: "rgba(255,255,255,0.6)", borderRadius: 999, padding: 3 }}>
          {([["top", `Top ${N}`], ["flop", `Flop ${N}`]] as const).map(([v, l]) => (
            <button key={v} onClick={() => { setTab(v); setOpen(false); }}
              style={{ height: 26, padding: "0 11px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700,
                background: tab === v ? "#fff" : "transparent", color: tab === v ? (v === "top" ? C.green : C.red) : C.muted,
                boxShadow: tab === v ? "0 2px 8px rgba(15,23,42,0.1)" : "none" }}>{l}</button>
          ))}
        </div>
      </div>

      {error && <div style={{ fontSize: 13, color: C.muted }}>{error}</div>}
      {!error && rows === null && <div style={{ fontSize: 13, color: C.muted }}>…</div>}
      {!error && rows && list.length === 0 && <div style={{ fontSize: 13, color: C.muted }}>Aucun client {tab === "top" ? "en progression" : "en recul"}.</div>}

      <div style={{ display: "flex", flexDirection: "column" as const, gap: 6, overflowY: "auto" as const, maxHeight: open ? 420 : undefined }}>
        {shown.map((r, i) => {
          const pct = r.prev > 0 ? Math.round((r.delta / r.prev) * 100) : null;
          const color = r.delta >= 0 ? C.green : C.red;
          return (
            <button key={r.client.id} onClick={() => onOpenClient(r.client)}
              style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left" as const, padding: "8px 12px", borderRadius: 14, border: "none",
                background: "rgba(255,255,255,0.7)", cursor: "pointer", fontFamily: "inherit" }}>
              <span style={{ width: 18, fontSize: 11, fontWeight: 800, color: C.muted, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{r.client.name}</span>
                <span style={{ display: "block", fontSize: 11.5, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {[r.client.city, `${fmtEUR(r.cur)} (N-1 : ${fmtEUR(r.prev)})`].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span style={{ textAlign: "right" as const, flexShrink: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, color }}>{r.delta > 0 ? "+" : "−"}{fmtEUR(Math.abs(r.delta))}</span>
                <span style={{ display: "block", fontSize: 10.5, fontWeight: 700, color }}>{pct == null ? "nouveau" : `${pct > 0 ? "+" : ""}${pct} %`}</span>
              </span>
            </button>
          );
        })}
      </div>

      {list.length > 5 && (
        <button onClick={() => setOpen(o => !o)}
          style={{ marginTop: 10, alignSelf: "flex-start", background: "none", border: "none", padding: "6px 0", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: C.teal }}>
          {open ? "Réduire" : `Voir les ${list.length}`}
        </button>
      )}
    </div>
  );
}
