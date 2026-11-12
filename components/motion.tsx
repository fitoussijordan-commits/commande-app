"use client";
// components/motion.tsx
// Briques d'animation partagées. Les keyframes et classes vivent dans
// app/globals.css (section « MOUVEMENT ») ; ici, uniquement ce qui a besoin
// de React : chiffres qui défilent, fermeture animée, tube qui saute, tube de
// validation, squelettes.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const TUBE = "/tube-purifiant.png";   // 122 × 520, posé sur son capuchon
const TUBE_RATIO = 122 / 520;
// Jonction corps / capuchon, mesurée sur la photo (y = 446 sur 520).
const CAP_AT = 85.8;

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// ── Chiffre qui défile jusqu'à sa nouvelle valeur ───────────────────────────
// `fromZero` : part de 0 au premier affichage (tableau de bord). Sinon la
// première valeur s'affiche telle quelle et seuls les changements défilent.
export function CountUp({ value, format, duration = 450, fromZero = false }: {
  value: number; format: (n: number) => string; duration?: number; fromZero?: boolean;
}) {
  const [shown, setShown] = useState(fromZero ? 0 : value);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;
    if (reducedMotion()) { setShown(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(p >= 1 ? value : from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(shown)}</>;
}

// ── Fermeture animée d'une modale ───────────────────────────────────────────
// const [closing, close] = useExit(onClose) : `close` pose la classe
// « closing » (voir .ov.closing) puis appelle onClose une fois l'animation finie.
export function useExit(onClose: () => void, ms = 170): [boolean, () => void] {
  const [closing, setClosing] = useState(false);
  const ref = useRef(onClose);
  ref.current = onClose;
  const close = useCallback(() => {
    if (reducedMotion()) { ref.current(); return; }
    setClosing(true);
    setTimeout(() => ref.current(), ms);
  }, [ms]);
  return [closing, close];
}

// ── Tube qui saute : attente courte (remplace les « Chargement… ») ──────────
export function TubeLoader({ label, size = 64, style }: { label?: ReactNode; size?: number; style?: CSSProperties }) {
  const hop = Math.round(size * 0.42);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, color: "#94a3b8", ...style }}>
      <div style={{ position: "relative", height: size + hop + 8, width: size, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        <div className="tube-hop-shadow" style={{ position: "absolute", bottom: 0, width: size * 0.5, height: Math.max(5, size * 0.09), borderRadius: "50%", background: "#0f172a" }} />
        <div className="tube-hop" style={{ marginBottom: 4, ["--hop" as any]: `${hop}px` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={TUBE} alt="" style={{ height: size, width: size * TUBE_RATIO, display: "block" }} />
        </div>
      </div>
      {label && <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>}
    </div>
  );
}

// ── Commande validée ────────────────────────────────────────────────────────
// Le tube descend, son capuchon saute, il se pince et dépose une noisette de
// crème ; la pastille s'ouvre et la coche se dessine. `children` remplace la
// coche (ex. icône « hors ligne »).
export function TubeSuccess({ color = "#0d9488", children }: { color?: string; children?: ReactNode }) {
  const D = 84;          // diamètre de la pastille
  const H = 136;         // hauteur du tube
  const W = H * TUBE_RATIO;
  const GAP = 10;        // espace entre le goulot et la pastille
  const img: CSSProperties = { position: "absolute", inset: 0, height: H, width: W, display: "block" };
  return (
    <div style={{ position: "relative", width: D, height: D, margin: "0 auto 18px" }}>
      {/* Onde + pastille + coche */}
      <div className="ts-ring" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color }} />
      <div className="ts-disc" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 10px 24px ${color}55` }}>
        {children ? <div className="ts-icon" style={{ display: "flex" }}>{children}</div> : (
          <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
            <path className="ts-check" d="M12 25l9 9 16-19" />
          </svg>
        )}
      </div>
      {/* Noisette de crème qui tombe du goulot */}
      <div className="ts-drop" style={{ position: "absolute", left: "50%", top: -GAP - 2, width: 13, height: 15, borderRadius: "50% 50% 50% 50% / 40% 40% 60% 60%", background: "#fffdf7", boxShadow: "0 1px 3px rgba(15,23,42,0.25)", ["--fall" as any]: `${GAP + D / 2 - 4}px` }} />
      {/* Tube : la même photo, découpée en corps + capuchon */}
      <div className="ts-tube" style={{ position: "absolute", left: "50%", top: -(H + GAP) + H * (1 - CAP_AT / 100), width: W, height: H, transformOrigin: "50% 100%", filter: "drop-shadow(0 6px 10px rgba(15,23,42,0.18))" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={TUBE} alt="" style={{ ...img, clipPath: `inset(0 0 ${100 - CAP_AT}% 0)` }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="ts-cap" src={TUBE} alt="" style={{ ...img, clipPath: `inset(${CAP_AT}% 0 0 0)` }} />
      </div>
    </div>
  );
}

// ── Squelettes ──────────────────────────────────────────────────────────────
export function Sk({ w = "100%", h = 12, r = 8, style }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties }) {
  return <div className="sk" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

// Grille de cartes produit fantômes (mêmes dimensions que les vraies cartes).
export function CatalogSkeleton({ dense, count = 12 }: { dense?: boolean; count?: number }) {
  if (dense) return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", overflow: "hidden" }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderTop: i ? "1px solid #e2e8f0" : "none" }}>
          <Sk w={42} h={42} r={9} />
          <div style={{ flex: 1 }}><Sk w={`${55 + (i * 13) % 30}%`} h={12} /><Sk w="30%" h={9} style={{ marginTop: 6 }} /></div>
          <Sk w={56} h={14} /><Sk w={112} h={38} r={10} />
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(172px, 1fr))", gap: 10 }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "2px solid #e2e8f0" }}>
          <Sk h={80} r={0} />
          <div style={{ padding: "10px 10px 12px" }}>
            <Sk w="45%" h={9} /><Sk w="90%" h={12} style={{ marginTop: 7 }} /><Sk w="65%" h={12} style={{ marginTop: 5 }} />
            <div style={{ display: "flex", justifyContent: "space-between", margin: "10px 0 8px" }}><Sk w={58} h={16} /><Sk w={32} h={16} /></div>
            <Sk h={44} r={10} /><Sk h={28} r={8} style={{ marginTop: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Lignes fantômes génériques (listes de clients, de commandes…).
export function ListSkeleton({ count = 5, height = 56, style }: { count?: number; height?: number; style?: CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", ...style }}>
      {Array.from({ length: count }, (_, i) => <Sk key={i} h={height} r={14} style={{ opacity: 1 - i * 0.14 }} />)}
    </div>
  );
}
