"use client";
import { useState } from "react";
import * as odoo from "@/lib/odoo";
import { apiUrl } from "@/lib/apiBase";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  orange: "#ea580c", orangeSoft: "#fff7ed",
  red: "#dc2626", redSoft: "#fef2f2",
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)",
};

// Suggestions : sans elles, personne ne se sert d'un champ vide. Elles montrent
// aussi le niveau de précision attendu.
const SUGGESTIONS = [
  "Quel est le CA de ce client depuis janvier ?",
  "Quelles références ce client commandait l'an dernier et plus cette année ?",
  "Combien de commandes ce client a-t-il passées cette année ?",
  "Quels sont ses 10 produits les plus commandés sur 12 mois ?",
];

interface Query { model: string; domain: any; fields: string[]; rows: number; error?: string }

export default function AssistantScreen({ session, client }: {
  session: odoo.OdooSession;
  client?: any;
}) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [queries, setQueries] = useState<Query[]>([]);
  const [showQueries, setShowQueries] = useState(false);

  const reset = () => {
    setQ(""); setAnswer(""); setError(""); setQueries([]); setShowQueries(false);
  };

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || loading) return;
    setLoading(true); setAnswer(""); setError(""); setQueries([]);
    try {
      const res = await fetch(apiUrl("/api/assistant"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          odooUrl: session.config.url,
          sessionId: session.sessionId,
          clientId: client?.id,
          clientName: client?.name,
        }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setAnswer(data.answer || "(réponse vide)");
      setQueries(data.queries || []);
    } catch {
      setError("Réseau indisponible — l'assistant ne fonctionne pas hors ligne.");
    }
    setLoading(false);
  };

  return (
    <div style={{ flex: 1, overflowY: "auto" as const, padding: "24px 20px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>Assistant</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 3, marginBottom: 16 }}>
          {client ? client.name : "Données Odoo"} · lecture seule
        </div>

        <textarea value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(q); }}
          rows={3} placeholder="Pose ta question…"
          style={{ width: "100%", boxSizing: "border-box" as const, padding: "12px 14px", border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 15, fontFamily: "inherit", resize: "none" as const, color: C.text, outline: "none" }} />

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={() => ask(q)} disabled={loading || !q.trim()}
            style={{ flex: 1, padding: "12px 0", borderRadius: 999, border: "none", fontFamily: "inherit", fontSize: 14, fontWeight: 800,
              background: !q.trim() ? C.border : C.teal, color: !q.trim() ? C.muted : "#fff",
              cursor: !q.trim() || loading ? "default" : "pointer" }}>
            {loading ? "Recherche dans Odoo…" : "Demander"}
          </button>
          {/* Sans ce bouton, il fallait quitter l'écran et y revenir pour
              repartir d'une question vierge. */}
          {(answer || error) && (
            <button onClick={reset}
              style={{ flexShrink: 0, padding: "12px 16px", borderRadius: 999, border: `1.5px solid ${C.border}`, background: C.white, fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: C.textSec, cursor: "pointer" }}>
              Nouvelle question
            </button>
          )}
        </div>

        {!answer && !loading && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 6 }}>Exemples</div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 5 }}>
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => { setQ(s); ask(s); }}
                  style={{ textAlign: "left" as const, padding: "9px 12px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, color: C.textSec }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 14, padding: "11px 13px", background: C.redSoft, border: `1px solid ${C.red}44`, borderRadius: 12, fontSize: 12.5, color: C.red, lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        {answer && (
          <div style={{ marginTop: 14, padding: "14px 16px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: C.shadow, fontSize: 14, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap" as const }}>
            {answer}
          </div>
        )}

        {/* Les requêtes utilisées, toujours consultables. Un filtre oublié —
            l'état de la commande, la période — fausse le chiffre sans que rien
            ne le signale. C'est le seul moyen de vérifier. */}
        {queries.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setShowQueries(v => !v)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, color: C.muted }}>
              {showQueries ? "Masquer" : "Voir"} les {queries.length} requête{queries.length > 1 ? "s" : ""} Odoo utilisée{queries.length > 1 ? "s" : ""}
            </button>
            {showQueries && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column" as const, gap: 5 }}>
                {queries.map((qu, i) => (
                  <div key={i} style={{ padding: "8px 10px", background: C.bg, borderRadius: 8, fontSize: 10.5, fontFamily: "ui-monospace, monospace", color: C.textSec, overflowX: "auto" as const }}>
                    <div style={{ fontWeight: 700, color: qu.error ? C.red : C.tealDark }}>
                      {qu.model} — {qu.error ? `erreur : ${qu.error}` : `${qu.rows} ligne${qu.rows > 1 ? "s" : ""}`}
                    </div>
                    <div style={{ marginTop: 2 }}>{JSON.stringify(qu.domain)}</div>
                    {qu.fields?.length > 0 && (
                      <div style={{ marginTop: 2, color: C.muted }}>champs : {qu.fields.join(", ")}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!answer && !error && (
          <div style={{ marginTop: 18, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
            Lecture seule, avec vos droits Odoo. Vérifiez un chiffre avant de le transmettre à un client.
          </div>
        )}
      </div>
    </div>
  );
}
