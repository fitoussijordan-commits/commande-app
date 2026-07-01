"use client";
import { useState, useEffect, useRef } from "react";
import * as odoo from "@/lib/odoo";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa",
  red: "#dc2626", redSoft: "#fef2f2",
  shadowXl: "0 20px 25px rgba(0,0,0,0.10), 0 8px 10px rgba(0,0,0,0.04)",
};

// Odoo stocke le corps des messages en HTML — on l'affiche en texte simple.
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
function fmtDate(iso: string): string {
  try {
    const d = new Date(iso.replace(" ", "T") + "Z"); // Odoo renvoie du UTC naïf
    return d.toLocaleDateString("fr-FR") + " à " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

interface PastNote { id: number; body: string; date: string; author: string }

interface Props {
  session: odoo.OdooSession;
  client: any;
  onClose: () => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}

export default function ClientNoteModal({ session, client, onClose, onToast }: Props) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pastNotes, setPastNotes] = useState<PastNote[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [recording, setRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef(""); // texte déjà présent avant le début de la dictée en cours

  useEffect(() => {
    (async () => {
      try {
        const rows = await odoo.searchRead(session, "mail.message",
          [["res_id", "=", client.id], ["model", "=", "res.partner"], ["message_type", "in", ["comment"]]],
          ["id", "body", "date", "author_id"], 15, "date desc");
        setPastNotes(rows
          .map((r: any) => ({ id: r.id, body: stripHtml(r.body || ""), date: r.date, author: Array.isArray(r.author_id) ? r.author_id[1] : "" }))
          .filter((r: PastNote) => r.body.length > 0));
      } catch {}
      setLoadingHistory(false);
    })();
  }, [session, client.id]);

  // Dictée vocale — Web Speech API (dispo sur Safari iOS récent). Repli silencieux si absente :
  // le bouton micro ne s'affiche simplement pas, la saisie au clavier reste toujours possible.
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { setSpeechSupported(false); return; }
    const rec = new SpeechRecognition();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let finalTranscript = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTranscript += t;
        else interim += t;
      }
      const sep = baseTextRef.current && !baseTextRef.current.endsWith(" ") ? " " : "";
      setText(baseTextRef.current + sep + finalTranscript + interim);
    };
    rec.onerror = () => setRecording(false);
    rec.onend = () => setRecording(false);
    recognitionRef.current = rec;
    return () => { try { rec.stop(); } catch {} };
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) return;
    if (recording) {
      recognitionRef.current.stop();
      setRecording(false);
    } else {
      baseTextRef.current = text;
      try {
        recognitionRef.current.start();
        setRecording(true);
      } catch {}
    }
  };

  const handleSave = async () => {
    setError("");
    if (!text.trim()) { setError("Note vide"); return; }
    setSaving(true);
    try {
      if (recording) { recognitionRef.current?.stop(); setRecording(false); }
      // Note interne (pas d'e-mail envoyé) sur le chatter de la fiche client.
      await odoo.callMethod(session, "res.partner", "message_post", [[client.id]], {
        body: text.trim().replace(/\n/g, "<br/>"),
        message_type: "comment",
        subtype_xmlid: "mail.mt_note",
      });
      onToast("Note enregistrée sur la fiche client", "success");
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
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg, #0d9488, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🗒️</div>
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
          ) : pastNotes.length > 0 ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 8 }}>Historique</div>
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 8, maxHeight: 180, overflowY: "auto" as const }}>
                {pastNotes.map(n => (
                  <div key={n.id} style={{ background: C.bg, borderRadius: 10, padding: "8px 10px" }}>
                    <div style={{ fontSize: 12, color: C.textSec, lineHeight: 1.4 }}>{n.body}</div>
                    <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>{n.author} · {fmtDate(n.date)}</div>
                  </div>
                ))}
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
          {recording && <div style={{ fontSize: 11, color: C.teal, fontWeight: 600, marginTop: 6 }}>🔴 Dictée en cours — parle normalement, réécoute/corrige avant d'enregistrer</div>}
          {!speechSupported && <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>Dictée vocale non disponible sur ce navigateur — saisie au clavier uniquement.</div>}
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
