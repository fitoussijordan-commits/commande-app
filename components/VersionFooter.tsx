"use client";
// Version de l'app en bas de l'écran ; un tap ouvre le journal des nouveautés.
import { useState } from "react";
import { CHANGELOG } from "@/lib/changelog";
import { useExit } from "@/components/motion";

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || "";
export const APP_TARGET = process.env.NEXT_PUBLIC_APP_TARGET || "web";

export function versionLabel(): string {
  const d = BUILD_TIME ? new Date(BUILD_TIME) : null;
  const when = d && !isNaN(d.getTime())
    ? d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
  return [`Version ${APP_VERSION}`, when, APP_TARGET === "ipad" ? "iPad" : ""].filter(Boolean).join(" · ");
}

const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export default function VersionFooter({ style }: { style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} title="Voir les nouveautés"
        style={{ display: "block", margin: "0 auto", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit",
          fontSize: 11, color: "#94a3b8", padding: "10px 12px", ...style }}>
        {versionLabel()} · <span style={{ textDecoration: "underline" }}>Nouveautés</span>
      </button>
      {open && <Changelog onClose={() => setOpen(false)} />}
    </>
  );
}

function Changelog({ onClose: onCloseProp }: { onClose: () => void }) {
  const [closing, onClose] = useExit(onCloseProp);
  return (
    <div className={closing ? "ov closing" : "ov"} onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "'DM Sans', sans-serif" }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 520, maxHeight: "85vh", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 20, overflow: "hidden", boxShadow: "0 20px 25px rgba(0,0,0,0.12)" }}>
        <div style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)", color: "#fff", padding: "18px 20px", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Nouveautés</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 3 }}>{versionLabel()}</div>
          </div>
          <button onClick={onClose} aria-label="Fermer"
            style={{ width: 32, height: 32, borderRadius: 9, background: "rgba(255,255,255,0.16)", border: "none", color: "#fff", cursor: "pointer", fontSize: 15 }}>✕</button>
        </div>
        <div className="stagger" style={{ overflowY: "auto", padding: "8px 20px 18px" }}>
          {CHANGELOG.map(e => (
            <div key={e.date} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0f766e", textTransform: "capitalize", marginBottom: 6 }}>{dayLabel(e.date)}</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                {e.items.map((it, i) => <li key={i} style={{ fontSize: 13, color: "#334155", lineHeight: 1.45 }}>{it}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
