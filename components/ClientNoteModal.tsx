"use client";
import { useState, useEffect, useRef } from "react";
import * as odoo from "@/lib/odoo";
import * as sync from "@/lib/sync";
import { descToText } from "@/lib/text";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa",
  red: "#dc2626", redSoft: "#fef2f2",
  shadowXl: "0 20px 25px rgba(0,0,0,0.10), 0 8px 10px rgba(0,0,0,0.04)",
};

// Notes DC : champ HTML de la fiche client (x_studio_notes_dc_), et non plus le
// chatter. Chaque note est ajoutée EN TÊTE avec sa date et son auteur ; les
// notes précédentes, saisies dans l'app ou dans Odoo, sont conservées.
const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Props {
  session: odoo.OdooSession;
  client: any;
  onClose: () => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
  autoRecord?: boolean;   // ouvert par le bouton REC : la dictée démarre tout de suite
}

export default function ClientNoteModal({ session, client, onClose, onToast, autoRecord }: Props) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pastNotes, setPastNotes] = useState("");   // contenu actuel des Notes DC, en texte
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [recording, setRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef(""); // texte déjà présent avant le début de la dictée en cours

  useEffect(() => {
    (async () => {
      try {
        const rows = await odoo.searchRead(session, "res.partner", [["id", "=", client.id]], [sync.CLIENT_NOTES_FIELD], 1);
        setPastNotes(descToText(String(rows[0]?.[sync.CLIENT_NOTES_FIELD] || "")).trim());
      } catch {}
      setLoadingHistory(false);
    })();
  }, [session, client.id]);

  // Dictée vocale :
  //  • app iPad (Capacitor) → plugin natif SpeechRecognition (la Web Speech API
  //    n'existe pas dans la WebView iOS) ;
  //  • navigateur → Web Speech API (Safari, Chrome, Edge).
  // Sans l'un ni l'autre : saisie au clavier (le micro du clavier iPad marche aussi).
  const nativeRef = useRef<any>(null);
  const applyDictation = (spoken: string) => {
    const sep = baseTextRef.current && !baseTextRef.current.endsWith(" ") ? " " : "";
    setText(baseTextRef.current + sep + spoken);
  };
  const startDictation = async () => {
    baseTextRef.current = textRef.current;
    const nat = nativeRef.current;
    try {
      if (nat) {
        const perm = await nat.requestPermissions();
        if (perm?.speechRecognition && perm.speechRecognition !== "granted") { setError("Micro refusé — autorise-le dans Réglages › Commande"); return; }
        setRecording(true);
        await nat.start({ language: "fr-FR", partialResults: true, maxResults: 1, popup: false });
      } else if (recognitionRef.current) {
        recognitionRef.current.start();
        setRecording(true);
      }
    } catch { setRecording(false); }
  };
  const stopDictation = () => {
    try { if (nativeRef.current) void nativeRef.current.stop(); else recognitionRef.current?.stop(); } catch {}
    setRecording(false);
  };
  const textRef = useRef("");
  textRef.current = text;

  useEffect(() => {
    const cap = (window as any).Capacitor;
    const nat = cap?.isNativePlatform?.() ? cap.Plugins?.SpeechRecognition : null;
    const handles: any[] = [];
    let rec: any = null;
    if (nat) {
      nativeRef.current = nat;
      Promise.resolve(nat.addListener("partialResults", (d: any) => { if (d?.matches?.[0]) applyDictation(String(d.matches[0])); })).then(h => handles.push(h)).catch(() => {});
      Promise.resolve(nat.addListener("listeningState", (d: any) => { if (d?.status === "stopped") setRecording(false); })).then(h => handles.push(h)).catch(() => {});
    } else {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) { setSpeechSupported(false); return; }
      rec = new SpeechRecognition();
      rec.lang = "fr-FR";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e: any) => {
        let spoken = "";
        for (let i = 0; i < e.results.length; i++) spoken += e.results[i][0].transcript;
        applyDictation(spoken);
      };
      rec.onerror = () => setRecording(false);
      rec.onend = () => setRecording(false);
      recognitionRef.current = rec;
    }
    // Bouton REC de la fiche client : enregistrement direct, sans tap supplémentaire.
    if (autoRecord) void startDictation();
    return () => {
      try { if (nat) void nat.stop(); else rec?.stop(); } catch {}
      handles.forEach(h => { try { h?.remove?.(); } catch {} });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleRecording = () => { if (recording) stopDictation(); else void startDictation(); };

  const handleSave = async () => {
    setError("");
    if (!text.trim()) { setError("Note vide"); return; }
    setSaving(true);
    try {
      if (recording) stopDictation();
      // Ajoutée en tête des Notes DC, datée et signée.
      const now = new Date();
      const stamp = `${now.toLocaleDateString("fr-FR")} ${now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
      const html = `<p><strong>${stamp} — ${escapeHtml(session.name || "")}</strong><br/>`
        + `${escapeHtml(text.trim()).replace(/\n/g, "<br/>")}</p>`;
      try {
        await sync.prependHtmlField(session, "res.partner", client.id, sync.CLIENT_NOTES_FIELD, html);
        onToast("Note ajoutée aux Notes DC de la fiche client", "success");
      } catch (e: any) {
        if (!odoo.isNetworkError(e)) throw e;   // champ absent, droits… : on l'affiche
        // Hors ligne → mise en file, ajoutée au retour du réseau.
        await sync.queueClientNote(client.id, client.name || "client", html);
        onToast("Note enregistrée hors ligne — sera envoyée au retour du réseau", "info");
      }
      onClose();
    } catch (e: any) {
      setError(e.message || "Erreur lors de l'enregistrement");
    }
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 460, maxHeight: "85vh", display: "flex", flexDirection: "column" as const, background: C.white, borderRadius: 20, boxShadow: C.shadowXl, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>

        <div style={{ padding: "22px 24px 16px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#f0fdfa", border: "1.5px solid #ccfbf1", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>Note client</div>
              <div style={{ fontSize: 12, color: C.muted }}>{client?.name}</div>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" as const, padding: "0 24px" }}>
          {/* Historique des notes précédentes */}
          {loadingHistory ? (
            <div style={{ fontSize: 12, color: C.muted, padding: "8px 0" }}>Chargement de l'historique…</div>
          ) : pastNotes ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 8 }}>Notes DC</div>
              <div style={{ background: C.bg, borderRadius: 10, padding: "10px 12px", maxHeight: 200, overflowY: "auto" as const, fontSize: 12.5, color: C.textSec, lineHeight: 1.5, whiteSpace: "pre-wrap" as const }}>
                {pastNotes}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 16 }}>Aucune note précédente pour ce client.</div>
          )}

          {error && (
            <div style={{ background: C.redSoft, color: C.red, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>{error}</div>
          )}

          <div style={{ position: "relative" as const }}>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Compte rendu de visite, informations utiles sur ce client…"
              rows={5}
              style={{ width: "100%", boxSizing: "border-box" as const, padding: "12px 14px", paddingRight: speechSupported ? 48 : 14, border: `1.5px solid ${recording ? C.teal : C.border}`, borderRadius: 12, fontSize: 14, fontFamily: "inherit", color: C.text, outline: "none", resize: "vertical" as const }}
            />
            {speechSupported && (
              <button type="button" onClick={toggleRecording} title={recording ? "Arrêter la dictée" : "Dicter à la voix"}
                style={{ position: "absolute" as const, top: 10, right: 10, width: 32, height: 32, borderRadius: "50%", background: recording ? C.red : C.teal, border: "none", color: "#fff", fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: recording ? "0 0 0 4px rgba(220,38,38,0.15)" : "none", transition: "box-shadow 0.2s" }}>
                {recording ? "⏹" : "🎙️"}
              </button>
            )}
          </div>
          {recording && <div style={{ fontSize: 12, color: C.red, fontWeight: 700, marginTop: 6 }}>● REC — parle normalement, relis puis « Enregistrer »</div>}
          {!speechSupported && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Dictée non disponible sur ce navigateur (utilise Safari, Chrome ou l'app iPad) — saisie au clavier.</div>}
        </div>

        <div style={{ padding: "16px 24px 22px", display: "flex", gap: 10, flexShrink: 0 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: "12px", background: C.bg, color: C.textSec, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Annuler
          </button>
          <button type="button" onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "12px", background: saving ? C.muted : C.teal, color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
