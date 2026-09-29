"use client";
// Écran d'attente pendant la lecture d'un bon (10 à 30 s) : un tube qui saute,
// une barre de progression et les étapes qui se cochent.
//
// La lecture par Claude ne donne aucune progression réelle : la barre avance
// vers un plafond propre à chaque étape (jamais 100 % avant la fin), puis saute
// au palier suivant quand l'étape change vraiment.
//
// Le visuel est un tube dessiné en SVG. Pour mettre une vraie photo détourée,
// déposer un PNG transparent et renseigner TUBE_IMAGE (ex. "/tube-purifiant.png").
import { useEffect, useRef, useState } from "react";

const TUBE_IMAGE = "";

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
          45%  { transform: translateY(-62px) scale(1, 1) rotate(-6deg); }
          55%  { transform: translateY(-66px) scale(1, 1) rotate(4deg); }
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

      {/* Tube + ombre */}
      <div style={{ position: "relative" as const, height: 170, width: 120, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
        <div className="bon-shadow" style={{
          position: "absolute" as const, bottom: 2, width: 70, height: 12, borderRadius: "50%",
          background: "#0f172a", animation: "bonTubeShadow 1.1s ease-in-out infinite",
        }} />
        <div className="bon-tube" style={{
          transformOrigin: "50% 100%", marginBottom: 8,
          animation: "bonTubeJump 1.1s cubic-bezier(.45,.05,.55,.95) infinite",
        }}>
          {TUBE_IMAGE
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={TUBE_IMAGE} alt="" style={{ height: 130, display: "block" }} />
            : <TubeSvg />}
        </div>
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

// Tube de Crème Purifiante dessiné (en attendant une photo détourée) : tube
// blanc, soudure en haut, bande orange, bouchon blanc en bas.
function TubeSvg() {
  return (
    <svg width="44" height="150" viewBox="0 0 60 204" aria-hidden="true">
      <defs>
        <linearGradient id="bonTubeBody" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#dcdcdc" />
          <stop offset="0.12" stopColor="#f7f7f7" />
          <stop offset="0.5" stopColor="#ffffff" />
          <stop offset="0.88" stopColor="#f3f3f3" />
          <stop offset="1" stopColor="#d2d2d2" />
        </linearGradient>
        <linearGradient id="bonTubeBand" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#e8870a" />
          <stop offset="0.5" stopColor="#f7a21b" />
          <stop offset="1" stopColor="#e3830a" />
        </linearGradient>
      </defs>
      {/* Soudure */}
      <rect x="0.5" y="0.5" width="59" height="12" rx="1.5" fill="url(#bonTubeBody)" stroke="#d6d6d6" strokeWidth="0.8" />
      <line x1="2" y1="9" x2="58" y2="9" stroke="#e2e2e2" strokeWidth="0.8" />
      {/* Corps, légèrement resserré vers le bouchon */}
      <path d="M1 12 H59 L56 176 H4 Z" fill="url(#bonTubeBody)" stroke="#d9d9d9" strokeWidth="0.8" />
      {/* Marque et logo */}
      <text x="30" y="30" textAnchor="middle" fontFamily="Georgia, serif" fontSize="6" fill="#3a3a3a">Dr. Hauschka</text>
      <circle cx="30" cy="38" r="2.6" fill="none" stroke="#3a3a3a" strokeWidth="0.9" />
      <circle cx="30" cy="38" r="0.9" fill="#3a3a3a" />
      {/* Nom du produit */}
      <text x="48" y="128" textAnchor="end" fontFamily="Helvetica, Arial, sans-serif" fontSize="4.6" fill="#3a3a3a">Crème</text>
      <text x="48" y="134" textAnchor="end" fontFamily="Helvetica, Arial, sans-serif" fontSize="4.6" fill="#3a3a3a">Purifiante</text>
      <text x="48" y="140" textAnchor="end" fontFamily="Helvetica, Arial, sans-serif" fontSize="4.6" fill="#3a3a3a">pour le Visage</text>
      {/* Bande orange */}
      <path d="M2.3 152 H57.7 L57.2 162 H2.8 Z" fill="url(#bonTubeBand)" />
      {/* Bouchon */}
      <rect x="6" y="176" width="48" height="27" rx="3" fill="url(#bonTubeBody)" stroke="#d6d6d6" strokeWidth="0.8" />
      <line x1="6.5" y1="179" x2="53.5" y2="179" stroke="#e4e4e4" strokeWidth="0.8" />
    </svg>
  );
}
