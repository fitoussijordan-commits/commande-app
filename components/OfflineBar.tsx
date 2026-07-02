// components/OfflineBar.tsx
// Barre d'état hors ligne autonome, à monter dans OrderScreen.
//  - Affiche l'état réseau (en ligne / hors ligne, vérification en cours)
//  - Bouton « Préparer le hors-ligne » : télécharge catalogue + clients en local
//  - Compteur de commandes en attente + synchro automatique au retour du réseau
//
// Volontairement non-invasif : ce composant ne touche pas la logique existante
// d'OrderScreen, il s'appuie sur lib/network.ts, lib/sync.ts et lib/localdb.ts.

"use client";
import { useEffect, useState, useCallback } from "react";
import * as odoo from "@/lib/odoo";
import { useNetwork } from "@/lib/network";
import * as sync from "@/lib/sync";
import { getPendingCount } from "@/lib/localdb";

function fmtDate(ts?: number): string {
  if (!ts) return "jamais";
  const d = new Date(ts);
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function OfflineBar({
  session,
  onToast,
}: {
  session: odoo.OdooSession;
  onToast?: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const { online, checking, recheck } = useNetwork();
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState<number | undefined>(undefined);
  const [preloading, setPreloading] = useState(false);
  const [progress, setProgress] = useState<sync.SyncProgress | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setPending(await getPendingCount());
      setLastSync(await sync.getLastSync());
    } catch {}
  }, []);

  useEffect(() => {
    refreshStatus();
    // Rafraîchit le compteur régulièrement pour refléter une commande
    // mise en file depuis l'écran de commande, sans câblage inter-composant.
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
    setPreloading(true);
    setProgress({ step: "Démarrage", done: 0, total: 3 });
    try {
      const res = await sync.preloadCatalog(session, setProgress);
      onToast?.(`Hors-ligne prêt : ${res.products} produits, ${res.clients} clients`, "success");
      await refreshStatus();
    } catch (e: any) {
      onToast?.("Échec du préchargement : " + (e?.message || e), "error");
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
      if (res.failed > 0) onToast?.(`${res.failed} commande(s) en échec`, "error");
      await refreshStatus();
    } catch (e: any) {
      onToast?.("Erreur de synchro : " + (e?.message || e), "error");
    } finally {
      setSyncing(false);
    }
  };

  const dot = online ? "#16a34a" : "#dc2626";
  const label = checking ? "Vérification…" : online ? "En ligne" : "Hors ligne";

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        padding: "8px 14px", background: online ? "#f0fdf4" : "#fef2f2",
        border: `1px solid ${online ? "#bbf7d0" : "#fecaca"}`, borderRadius: 12,
        fontFamily: "'DM Sans', sans-serif", fontSize: 13,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, color: online ? "#166534" : "#991b1b" }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: dot, display: "inline-block" }} />
        {label}
      </span>

      <span style={{ color: "#6b7280" }}>
        Dernière synchro cache : {fmtDate(lastSync)}
      </span>

      {pending > 0 && (
        <span style={{
          background: "#fef3c7", color: "#92400e", padding: "2px 10px",
          borderRadius: 999, fontWeight: 700,
        }}>
          {pending} commande{pending > 1 ? "s" : ""} en attente
        </span>
      )}

      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        {progress && (
          <span style={{ color: "#6b7280" }}>{progress.step} ({progress.done}/{progress.total})</span>
        )}

        <button
          onClick={doPreload}
          disabled={preloading || !online}
          style={btnStyle(preloading || !online)}
        >
          {preloading ? "Préparation…" : "Préparer le hors-ligne"}
        </button>

        {pending > 0 && (
          <button
            onClick={doSync}
            disabled={syncing || !online}
            style={btnStyle(syncing || !online, "#0f766e")}
          >
            {syncing ? "Synchro…" : "Synchroniser"}
          </button>
        )}

        {!online && (
          <button onClick={recheck} style={btnStyle(false, "#4b5563")}>
            Revérifier
          </button>
        )}
      </div>
    </div>
  );
}

function btnStyle(disabled: boolean, bg = "#7c3aed"): React.CSSProperties {
  return {
    background: disabled ? "#d1d5db" : bg,
    color: "#fff", border: "none", borderRadius: 8,
    padding: "6px 12px", fontWeight: 700, fontSize: 12,
    cursor: disabled ? "default" : "pointer",
    fontFamily: "'DM Sans', sans-serif",
  };
}
