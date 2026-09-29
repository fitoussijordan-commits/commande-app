"use client";
// Pavé numérique de saisie de quantité (tactile, touches de 52 px).
// Partagé par la prise de commande et l'import de bon de commande.
import { useState } from "react";

const C = {
  bg: "#f8fafc", text: "#0f172a", muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  shadowXl: "0 20px 25px rgba(0,0,0,0.10), 0 8px 10px rgba(0,0,0,0.04)",
};

export default function QtyPad({ name, initial, onSet, onClose }: {
  name: string; initial: number; onSet: (n: number) => void; onClose: () => void;
}) {
  const [val, setVal] = useState("");                      // saisie en cours ("" = quantité actuelle)
  const shown = val === "" ? String(initial) : val;
  const commit = (n?: number) => {
    const q = n ?? (parseInt(shown, 10) || 0);
    onSet(Math.max(0, Math.min(9999, q)));
    onClose();
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 304, background: "#fff", borderRadius: 20, boxShadow: C.shadowXl, padding: 18, fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{name}</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: val === "" ? C.muted : C.text, textAlign: "center" as const, padding: "6px 0 10px" }}>{shown}</div>

        {/* Presets colis : AJOUTE à la quantité actuelle (réassort rapide) */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {[6, 12, 24].map(n => (
            <button key={n} onClick={() => commit((parseInt(shown, 10) || 0) + n)}
              style={{ flex: 1, height: 40, background: C.tealSoft, border: `1px solid ${C.tealMid}`, borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: C.tealDark, cursor: "pointer", fontFamily: "inherit" }}>
              +{n}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {keys.map(k => (
            <button key={k}
              onClick={() => {
                if (k === "C") setVal("0");
                else if (k === "⌫") setVal(v => (v === "" ? "" : v.slice(0, -1)));
                else setVal(v => ((v === "" || v === "0" ? k : v + k)).slice(0, 4));
              }}
              style={{ height: 52, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 20, fontWeight: 700, color: k === "C" || k === "⌫" ? C.muted : C.text, cursor: "pointer", fontFamily: "inherit" }}>
              {k}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={onClose}
            style={{ flex: 1, height: 48, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 14, color: C.muted, cursor: "pointer", fontFamily: "inherit" }}>
            Annuler
          </button>
          <button onClick={() => commit()}
            style={{ flex: 2, height: 48, background: C.teal, border: "none", borderRadius: 12, fontSize: 15, fontWeight: 800, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
            Valider
          </button>
        </div>
      </div>
    </div>
  );
}
