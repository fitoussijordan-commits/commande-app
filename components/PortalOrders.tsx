"use client";
// Accueil : commandes portail (WALA) à valider par le DC — les siennes seulement.
// Valider = étiquette « Validé DC » ; Compléter = ajouter des articles à la
// commande depuis le catalogue (puis validée DC) ; un tap ouvre le détail.
import { useCallback, useEffect, useState } from "react";
import * as odoo from "@/lib/odoo";
import { loadPortalOrders, validatePortalOrder, type PortalOrder } from "@/lib/portalOrders";
import { GLASS } from "@/components/glass";
import { ListSkeleton } from "@/components/motion";
import OrderDetailModal from "@/components/OrderDetailModal";

const C = { text: "#0f172a", textSec: "#334155", muted: "#64748b", teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", orange: "#ea580c", orangeSoft: "#fff7ed", violet: "#7c3aed", violetSoft: "#f5f3ff" };
const eur = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
const day = (d: string) => new Date(d.replace(" ", "T") + "Z").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });

export default function PortalOrders({ session, onToast, onComplete }: {
  session: odoo.OdooSession;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
  onComplete: (o: PortalOrder) => void;     // ajouter des articles à la commande
}) {
  const [orders, setOrders] = useState<PortalOrder[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [open, setOpen] = useState<PortalOrder | null>(null);
  const [all, setAll] = useState(false);

  const load = useCallback(() => {
    loadPortalOrders(session).then(o => { setOrders(o); setError(false); }).catch(() => { setOrders([]); setError(true); });
  }, [session]);
  useEffect(() => { load(); }, [load]);

  if (orders && !orders.length && !error) return null;
  const shown = all ? orders || [] : (orders || []).slice(0, 4);

  const validate = async (o: PortalOrder) => {
    setBusy(o.id);
    try {
      await validatePortalOrder(session, o.id, `Validée DC depuis l'app (${session.name}).`);
      setOrders(list => (list || []).filter(x => x.id !== o.id));
      onToast(`${o.name} validée DC`, "success");
    } catch (e: any) { onToast(odoo.isNetworkError(e) ? "Hors ligne : validation impossible" : `Validation refusée : ${e?.message || e}`, "error"); }
    setBusy(null);
  };

  return (
    <div style={{ ...GLASS, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.text, flex: 1 }}>Commandes portail à valider</div>
        {orders && orders.length > 0 && <span key={orders.length} className="badge-in" style={{ minWidth: 24, height: 24, borderRadius: 999, background: C.violet, color: "#fff", fontSize: 12.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 7px" }}>{orders.length}</span>}
      </div>
      {!orders && <ListSkeleton count={2} height={58} />}
      {error && <div style={{ fontSize: 13, color: C.muted }}>Commandes portail indisponibles (hors ligne ?)</div>}
      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.map(o => (
          <div key={o.id} style={{ background: "rgba(255,255,255,0.78)", borderRadius: 14, padding: "10px 12px", borderLeft: `4px solid ${C.violet}` }}>
            <button onClick={() => setOpen(o)} className="press"
              style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: C.tealDark }}>{o.name}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: C.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{Array.isArray(o.partner_id) ? o.partner_id[1] : ""}</span>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>{eur(o.amount_untaxed || o.amount_total || 0)}</span>
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Portail · {day(o.date_order)} · HT · voir le détail ›</div>
            </button>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={() => validate(o)} disabled={busy === o.id}
                style={{ flex: 1, height: 32, borderRadius: 8, border: "none", background: C.teal, color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                {busy === o.id ? "…" : "✓ Valider DC"}
              </button>
              <button onClick={() => onComplete(o)}
                style={{ flex: 1, height: 32, borderRadius: 8, border: `1.5px solid ${C.violet}`, background: C.violetSoft, color: C.violet, fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                + Compléter
              </button>
            </div>
          </div>
        ))}
      </div>
      {orders && orders.length > 4 && (
        <button onClick={() => setAll(v => !v)} style={{ marginTop: 8, background: "none", border: "none", padding: 0, color: C.teal, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
          {all ? "Réduire" : `Voir les ${orders.length}`}
        </button>
      )}
      {open && (
        <OrderDetailModal session={session} order={open}
          stateLabel={{ label: "Portail · à valider", color: C.violet, bg: C.violetSoft }}
          onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
