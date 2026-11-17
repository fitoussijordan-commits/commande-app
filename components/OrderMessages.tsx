"use client";
// Accueil : messages en attente sur mes commandes (chatter Odoo). Un tap ouvre
// la commande en grand avec ses échanges ; une réponse ou « Traité » la retire.
import { useCallback, useEffect, useState } from "react";
import * as odoo from "@/lib/odoo";
import { loadPendingThreads, markDone, type PendingThread } from "@/lib/orderMessages";
import { GLASS } from "@/components/glass";
import { ListSkeleton } from "@/components/motion";
import OrderDetailModal from "@/components/OrderDetailModal";

const C = { text: "#0f172a", textSec: "#334155", muted: "#64748b", teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", orange: "#ea580c", orangeSoft: "#fff7ed", blue: "#2563eb" };
const STATE: Record<string, string> = { draft: "Devis", sent: "Envoyé", sale: "Confirmée", done: "Terminée" };
const when = (d: string) => {
  const t = new Date(d.replace(" ", "T") + "Z");
  const today = new Date();
  return t.toDateString() === today.toDateString()
    ? t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : t.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
};

export default function OrderMessages({ session, onEdit }: { session: odoo.OdooSession; onEdit?: (order: any) => void }) {
  const [threads, setThreads] = useState<PendingThread[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<PendingThread | null>(null);
  const [all, setAll] = useState(false);

  const load = useCallback(() => {
    loadPendingThreads(session).then(t => { setThreads(t); setError(false); }).catch(() => { setThreads([]); setError(true); });
  }, [session]);
  useEffect(() => { load(); }, [load]);

  // Rien en attente : la carte reste discrète (pas de place perdue sur l'accueil).
  if (threads && !threads.length && !error) return null;
  const shown = all ? threads || [] : (threads || []).slice(0, 4);

  return (
    <div style={{ ...GLASS, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: C.text, flex: 1 }}>Messages sur mes commandes</div>
        {threads && threads.length > 0 && <span key={threads.length} className="badge-in" style={{ minWidth: 24, height: 24, borderRadius: 999, background: C.orange, color: "#fff", fontSize: 12.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 7px" }}>{threads.length}</span>}
      </div>
      {!threads && <ListSkeleton count={2} height={58} />}
      {error && <div style={{ fontSize: 13, color: C.muted }}>Messages indisponibles (hors ligne ?)</div>}
      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {shown.map(t => (
          <div key={t.order.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "rgba(255,255,255,0.78)", borderRadius: 14, padding: "10px 12px", borderLeft: `4px solid ${t.mentioned ? C.blue : C.orange}` }}>
            <button onClick={() => setOpen(t)} className="press"
              style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: C.tealDark }}>{t.order.name}</span>
                <span style={{ fontSize: 12, color: C.textSec, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{Array.isArray(t.order.partner_id) ? t.order.partner_id[1] : ""}</span>
                <span style={{ fontSize: 10.5, color: C.muted }}>{STATE[t.order.state] || t.order.state}</span>
                {t.mentioned && <span style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: C.blue, borderRadius: 999, padding: "1px 7px" }}>@ vous</span>}
              </div>
              <div style={{ fontSize: 12.5, color: C.text, marginTop: 3, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>
                <strong>{t.last.author}</strong> : {t.last.text}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
                {when(t.last.date)}{t.count > 1 ? ` · ${t.count} messages` : ""}{t.last.isEmail ? " · e-mail" : ""} · répondre ›
              </div>
            </button>
            <button onClick={() => { markDone(t.order.id, t.last.id); setThreads(ts => (ts || []).filter(x => x.order.id !== t.order.id)); }}
              title="Marquer comme traité (sans répondre)"
              style={{ flexShrink: 0, height: 30, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.teal}55`, background: C.tealSoft, color: C.tealDark, fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
              ✓ Traité
            </button>
          </div>
        ))}
      </div>
      {threads && threads.length > 4 && (
        <button onClick={() => setAll(v => !v)} style={{ marginTop: 8, background: "none", border: "none", padding: 0, color: C.teal, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
          {all ? "Réduire" : `Voir les ${threads.length}`}
        </button>
      )}
      {open && (
        <OrderDetailModal session={session} order={open.order} chatFirst onEdit={onEdit}
          stateLabel={{ label: STATE[open.order.state] || open.order.state, color: C.orange, bg: C.orangeSoft }}
          onClose={() => { setOpen(null); load(); }} />
      )}
    </div>
  );
}
