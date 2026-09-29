"use client";
// Écran d'attente pendant la lecture d'un bon (10 à 30 s) : un tube qui saute,
// une barre de progression et les étapes qui se cochent.
//
// La lecture par Claude ne donne aucune progression réelle : la barre avance
// vers un plafond propre à chaque étape (jamais 100 % avant la fin), puis saute
// au palier suivant quand l'étape change vraiment.
//
// Les visuels sont des photos détourées de produits (PNG transparents dans
// public/) : fichiers locaux, donc affichés aussi hors ligne sur l'iPad. Ils
// sautent à tour de rôle ; ceux des côtés penchent vers le centre en l'air.
import { useEffect, useRef, useState } from "react";

// Hauteurs à l'écran proches des proportions réelles (le tube est plus grand).
const PRODUCTS = [
  { src: "/serum-hydratant.png", height: 118 },
  { src: "/tube-purifiant.png", height: 150 },
  { src: "/lotion-tonifiante.png", height: 128 },
];
const JUMP_S = 1.1;

const C = {
  text: "#0f172a", muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  green: "#16a34a",
};

export type BonStep = "lecture" | "catalogue" | "client";

// Bornes de la barre pour chaque étape, et durée typique de la lecture.
const RANGES: Record<BonStep, [number, number]> = {
  lecture: [4, 72], catalogue: [76, 90], client: [91, 98],
};
const READ_TAU_MS = 9000;

const LABELS: Record<BonStep, string> = {
  lecture: "Lecture du bon",
  catalogue: "Recherche des produits",
  client: "Recherche du client",
};

// Petites phrases qui tournent pendant la lecture, la partie la plus longue.
const TIPS = [
  "Déchiffrage des références…",
  "Comptage des unités, pas des colis…",
  "Vérification des EAN…",
  "Les lignes de rubrique sont ignorées…",
];

export default function BonLoader({ step, fileName, withClient }: {
  step: BonStep; fileName: string; withClient: boolean;
}) {
  const steps: BonStep[] = withClient ? ["lecture", "catalogue", "client"] : ["lecture", "catalogue"];
  const [pct, setPct] = useState(RANGES.lecture[0]);
  const [tip, setTip] = useState(0);
  const stepStart = useRef(Date.now());

  useEffect(() => { stepStart.current = Date.now(); }, [step]);

  // Approche exponentielle du plafond de l'étape : rapide au début, puis ralentit.
  useEffect(() => {
    const t = setInterval(() => {
      const [from, to] = RANGES[step];
      const elapsed = Date.now() - stepStart.current;
      const tau = step === "lecture" ? READ_TAU_MS : 1500;
      const target = from + (to - from) * (1 - Math.exp(-elapsed / tau));
      setPct(p => Math.max(p, target));
    }, 120);
    return () => clearInterval(t);
  }, [step]);

  useEffect(() => {
    if (step !== "lecture") return;
    const t = setInterval(() => setTip(i => (i + 1) % TIPS.length), 3200);
    return () => clearInterval(t);
  }, [step]);

  const current = steps.indexOf(step);

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", padding: "12px 0 4px" }}>
      <style>{`
        @keyframes bonTubeJump {
          0%   { transform: translateY(0) scale(1.12, 0.86); }
          12%  { transform: translateY(0) scale(0.94, 1.08); }
          45%  { transform: translateY(-62px) scale(1, 1) rotate(var(--tilt-a)); }
          55%  { transform: translateY(-66px) scale(1, 1) rotate(var(--tilt-b)); }
          88%  { transform: translateY(0) scale(0.96, 1.05); }
          100% { transform: translateY(0) scale(1.12, 0.86); }
        }
        @keyframes bonTubeShadow {
          0%, 100% { transform: scaleX(1.1); opacity: 0.28; }
          50%      { transform: scaleX(0.55); opacity: 0.12; }
        }
        @keyframes bonBarShine {
          from { transform: translateX(-80px); }
          to   { transform: translateX(400px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .bon-tube, .bon-shadow, .bon-shine { animation: none !important; }
        }
      `}</style>

      {/* Produits + ombres, décalés dans le temps pour sauter à tour de rôle */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 18 }}>
        {PRODUCTS.map(({ src, height }, i) => {
          const n = PRODUCTS.length;
          const delay = `-${(i * JUMP_S) / n}s`;
          // Seul au centre : se dandine. Sur un côté : penche vers le centre.
          const side = n === 1 ? 0 : (i - (n - 1) / 2);
          const [a, b] = side === 0 ? ["-6deg", "4deg"] : side < 0 ? ["9deg", "3deg"] : ["-9deg", "-3deg"];
          return (
            <div key={src} style={{ position: "relative" as const, height: 170, width: 90, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
              <div className="bon-shadow" style={{
                position: "absolute" as const, bottom: 2, width: 64, height: 12, borderRadius: "50%",
                background: "#0f172a", animation: `bonTubeShadow ${JUMP_S}s ease-in-out infinite`, animationDelay: delay,
              }} />
              <div className="bon-tube" style={{
                transformOrigin: "50% 100%", marginBottom: 8,
                animation: `bonTubeJump ${JUMP_S}s cubic-bezier(.45,.05,.55,.95) infinite`, animationDelay: delay,
                ["--tilt-a" as any]: a, ["--tilt-b" as any]: b,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" style={{ height, maxWidth: 110, objectFit: "contain" as const, display: "block" }} />
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginTop: 14 }}>{LABELS[step]}…</div>
      <div style={{ fontSize: 13, color: C.muted, marginTop: 4, minHeight: 18 }}>
        {step === "lecture" ? TIPS[tip] : fileName}
      </div>

      {/* Barre */}
      <div style={{ width: "100%", maxWidth: 380, height: 10, borderRadius: 999, background: C.tealMid, marginTop: 18, overflow: "hidden" }}>
        <div style={{
          position: "relative" as const, overflow: "hidden", height: "100%", width: `${pct}%`, borderRadius: 999,
          transition: "width 0.25s linear", background: `linear-gradient(90deg, ${C.teal}, ${C.tealDark})`,
        }}>
          {/* Reflet qui balaie la barre */}
          <div className="bon-shine" style={{
            position: "absolute" as const, inset: 0, width: 80,
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent)",
            animation: "bonBarShine 1.4s linear infinite",
          }} />
        </div>
      </div>

      {/* Étapes */}
      <div style={{ display: "flex", gap: 18, marginTop: 16, flexWrap: "wrap" as const, justifyContent: "center" }}>
        {steps.map((s, i) => {
          const done = i < current, active = i === current;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: done ? C.green : active ? C.tealDark : C.muted }}>
              <span style={{
                width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                background: done ? C.green : active ? C.teal : C.border, color: "#fff", fontSize: 11,
              }}>
                {done ? "✓" : i + 1}
              </span>
              {LABELS[s]}
            </div>
          );
        })}
      </div>
    </div>
  );
}
