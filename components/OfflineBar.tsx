// components/OfflineBar.tsx
// État réseau + hors-ligne, version « pastille » : un petit bouton d'état qui
// vit DANS la top bar (plus de bandeau permanent qui mange l'écran).
//  - Pastille : point de couleur + libellé court + compteur file si besoin.
//  - Tap → panneau consolidé : réseau, données locales (téléchargement catalogue,
//    progression, dernière synchro), file d'envoi détaillée (statut + erreur Odoo
//    exacte + tout réessayer + suppression).
//  - La synchro auto au retour réseau est inchangée.
//
// Volontairement non-invasif : ce composant ne touche pas la logique existante
// d'OrderScreen, il s'appuie sur lib/network.ts, lib/sync.ts et lib/localdb.ts.

"use client";
import { useEffect, useState, useCallback } from "react";
import * as odoo from "@/lib/odoo";
import { useNetwork } from "@/lib/network";
import * as sync from "@/lib/sync";
import { getQueuedOrders, deleteQueuedOrder, QueuedOrder } from "@/lib/localdb";

function fmtDate(ts?: number): string {
  if (!ts) return "jamais";
  const d = new Date(ts);
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtPrice(n: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);
}

// Statuts de la file : libellé + couleurs du badge.
const STATUS_UI: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "En attente", color: "#92400e", bg: "#fef3c7" },
  syncing: { label: "Envoi…",     color: "#1d4ed8", bg: "#dbeafe" },
  synced:  { label: "Envoyée ✓",  color: "#166534", bg: "#dcfce7" },
  error:   { label: "Échec",      color: "#991b1b", bg: "#fee2e2" },
};

export default function OfflineBar({
  session,
  onToast,
}: {
  session: odoo.OdooSession;
  onToast?: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const { online, checking, recheck } = useNetwork();
  const [queue, setQueue] = useState<QueuedOrder[]>([]);
  const [lastSync, setLastSync] = useState<number | undefined>(undefined);
  const [preloading, setPreloading] = useState(false);
  const [progress, setProgress] = useState<sync.SyncProgress | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [preloadError, setPreloadError] = useState<string>("");
  const [showPanel, setShowPanel] = useState(false);

  // File non-envoyée = pending + error + syncing (envoi interrompu, sera rejoué).
  const pending = queue.filter(o => o.status !== "synced").length;
  const errCount = queue.filter(o => o.status === "error").length;

  const refreshStatus = useCallback(async () => {
    try { setQueue(await getQueuedOrders()); } catch {}
    try { setLastSync(await sync.getLastSync()); } catch {}
  }, []);

  useEffect(() => {
    refreshStatus();
    // Rafraîchit régulièrement pour refléter une commande mise en file depuis
    // l'écran de commande, sans câblage inter-composant.
    const t = setInterval(refreshStatus, 5000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  // Synchro automatique dès qu'on repasse en ligne s'il y a des commandes en attente.
  useEffect(() => {
    if (online && pending > 0 && !syncing) {
      void doSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const doPreload = async () => {
    if (!online) { onToast?.("Connexion requise pour préparer le hors-ligne", "error"); return; }
    setPreloadError("");
    setPreloading(true);
    setProgress({ step: "Démarrage", done: 0, total: 4 });
    try {
      const res = await sync.preloadCatalog(session, setProgress);
      // Rend visible un éventuel échec du chargement MEA (au lieu de l'ignorer).
      if (res.meaError) onToast?.("MEA non chargées : " + res.meaError, "error");
      onToast?.(`Catalogue prêt : ${res.products} produits, ${res.clients} clients, ${res.mea} offres. Téléchargement des images…`, "success");
      // Puis les images produit (le plus lourd) — reprend là où c'était si interrompu.
      const img = await sync.preloadImages(session, setProgress);
      onToast?.(`Hors-ligne prêt : ${res.products} produits, ${res.clients} clients, ${res.mea} offres, ${img.downloaded} images`, "success");
      await refreshStatus();
    } catch (e: any) {
      const msg = e?.message || String(e);
      onToast?.("Échec du préchargement : " + msg, "error");
      setPreloadError(msg);   // affiché de façon persistante dans le panneau
    } finally {
      setPreloading(false);
      setProgress(null);
    }
  };

  const doSync = async () => {
    if (!online) { onToast?.("Hors ligne — synchro impossible", "error"); return; }
    setSyncing(true);
    try {
      const res = await sync.flushQueue(session);
      if (res.synced > 0) onToast?.(`${res.synced} commande(s) synchronisée(s)`, "success");
      // Affiche la VRAIE cause du premier échec (avant : juste « en échec », aveugle).
      if (res.failed > 0) onToast?.(`${res.failed} en échec — ${res.errors[0] || "erreur inconnue"}`, "error");
      await refreshStatus();
    } catch (e: any) {
      onToast?.("Erreur de synchro : " + (e?.message || e), "error");
    } finally {
      setSyncing(false);
    }
  };

  const removeItem = async (o: QueuedOrder) => {
    if (o.id == null) return;
    if (o.status !== "synced") {
      const ok = window.confirm(`Supprimer « ${o.label} » ?\n\nElle ne sera JAMAIS envoyée à Odoo. À refaire à la main si besoin.`);
      if (!ok) return;
    }
    await deleteQueuedOrder(o.id);
    await refreshStatus();
  };

  // ── Pastille : couleur + libellé selon l'état ────────────────────────────
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const pill = preloading
    ? { bg: "#f0fdfa", border: "#99f6e4", color: "#0f766e", dot: "#0d9488", label: progress && progress.total > 10 ? `Images ${pct}%` : (progress?.step || "Préparation…") }
    : !online
      ? { bg: "#fef2f2", border: "#fecaca", color: "#991b1b", dot: "#dc2626", label: "Hors ligne" }
      : syncing
        ? { bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8", dot: "#2563eb", label: "Synchro…" }
        : checking
          ? { bg: "#f8fafc", border: "#e2e8f0", color: "#64748b", dot: "#94a3b8", label: "Vérification…" }
          : { bg: "#f0fdf4", border: "#bbf7d0", color: "#166534", dot: "#16a34a", label: "En ligne" };

  return (
    <>
      <button
        onClick={() => setShowPanel(true)}
        title="Réseau, données locales et file d'envoi"
        style={{
          display: "inline-flex", alignItems: "center", gap: 7, height: 36,
          padding: "0 12px", borderRadius: 10, cursor: "pointer",
          background: pill.bg, border: `1px solid ${pill.border}`,
          fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, fontWeight: 700,
          color: pill.color, flexShrink: 0,
        }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: pill.dot, flexShrink: 0 }} />
        {pill.label}
        {pending > 0 && (
          <span style={{
            background: errCount > 0 ? "#fee2e2" : "#fef3c7",
            color: errCount > 0 ? "#991b1b" : "#92400e",
            border: `1px solid ${errCount > 0 ? "#fecaca" : "#fde68a"}`,
            borderRadius: 999, padding: "1px 8px", fontSize: 11.5, fontWeight: 800,
          }}>
            {pending}
          </span>
        )}
      </button>

      {/* ── Panneau consolidé : réseau + données locales + file d'envoi ── */}
      {showPanel && (
        <div
          onClick={() => setShowPanel(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 300, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", fontFamily: "'DM Sans', sans-serif" }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: 440, maxWidth: "94vw", maxHeight: "84vh", marginTop: "calc(env(safe-area-inset-top) + 52px)", marginRight: 14, background: "#fff", borderRadius: 16, boxShadow: "0 20px 25px rgba(0,0,0,0.10), 0 8px 10px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

            {/* En-tête : état réseau */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: pill.dot, flexShrink: 0 }} />
              <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a", flex: 1 }}>
                {checking ? "Vérification…" : online ? "En ligne" : "Hors ligne"}
              </div>
              {!online && (
                <button onClick={recheck} style={btnStyle(false, "#4b5563")}>Revérifier</button>
              )}
              <button onClick={() => setShowPanel(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
            </div>

            {/* Données locales : préchargement du catalogue pour le hors-ligne */}
            <div style={{ padding: "12px 18px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#334155" }}>Données locales (mode hors ligne)</div>
                  <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2 }}>
                    {progress ? `${progress.step} — ${progress.done}/${progress.total}` : `Dernière mise à jour : ${fmtDate(lastSync)}`}
                  </div>
                </div>
                <button onClick={doPreload} disabled={preloading || !online} style={btnStyle(preloading || !online)}>
                  {preloading ? "Téléchargement…" : "Télécharger"}
                </button>
              </div>
              {preloading && progress && progress.total > 0 && (
                <div style={{ marginTop: 8, height: 6, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: "#0d9488", borderRadius: 999, transition: "width 0.3s" }} />
                </div>
              )}
              {preloadError && (
                <div style={{ marginTop: 8, padding: "8px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 11.5, color: "#991b1b", lineHeight: 1.45, wordBreak: "break-word" }}>
                  Échec du préchargement : {preloadError}
                </div>
              )}
            </div>

            {/* File d'envoi */}
            <div style={{ padding: "12px 18px 8px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "#334155", flex: 1 }}>
                File d'envoi ({queue.length})
              </div>
              {pending > 0 && (
                <button onClick={doSync} disabled={syncing || !online} style={btnStyle(syncing || !online, "#0f766e")}>
                  {syncing ? "Synchro…" : "Tout réessayer"}
                </button>
              )}
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {queue.length === 0 ? (
                <div style={{ padding: "8px 18px 24px", color: "#94a3b8", fontSize: 12.5 }}>
                  Rien en attente — tout est dans Odoo.
                </div>
              ) : [...queue].reverse().map(o => {
                const st = STATUS_UI[o.status] || STATUS_UI.pending;
                return (
                  <div key={o.id} style={{ padding: "10px 18px", borderTop: "1px solid #f1f5f9" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                          {fmtDate(o.createdAt)}
                          {typeof o.total === "number" && o.total > 0 && ` · ${fmtPrice(o.total)}`}
                          {(o.attempts || 0) > 1 && ` · ${o.attempts} tentatives`}
                          {o.odooId ? ` · Odoo #${o.odooId}` : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.bg, borderRadius: 8, padding: "3px 9px", flexShrink: 0 }}>{st.label}</span>
                      <button onClick={() => removeItem(o)} title={o.status === "synced" ? "Effacer de la liste" : "Supprimer (ne sera pas envoyée)"}
                        style={{ background: "transparent", border: "1px solid #e2e8f0", borderRadius: 8, padding: "4px 8px", cursor: "pointer", color: "#94a3b8", fontSize: 12, flexShrink: 0, fontFamily: "inherit" }}>
                        ✕
                      </button>
                    </div>
                    {/* La cause exacte du refus Odoo — c'est ÇA qu'il faut lire pour corriger */}
                    {o.status === "error" && o.lastError && (
                      <div style={{ marginTop: 8, padding: "8px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, fontSize: 11.5, color: "#991b1b", lineHeight: 1.45, wordBreak: "break-word", maxHeight: 110, overflowY: "auto" }}>
                        {o.lastError}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function btnStyle(disabled: boolean, bg = "#0f766e"): React.CSSProperties {
  return {
    background: disabled ? "#d1d5db" : bg,
    color: "#fff", border: "none", borderRadius: 8,
    padding: "6px 12px", fontWeight: 700, fontSize: 12,
    cursor: disabled ? "default" : "pointer",
    fontFamily: "'DM Sans', sans-serif", flexShrink: 0,
  };
}
