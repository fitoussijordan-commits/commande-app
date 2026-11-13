"use client";
// Attente pendant la création du devis : les produits qui sautent (comme à la
// lecture d'un bon), une barre de progression et les étapes qui se cochent.
// Pas de progression réelle côté Odoo : la barre avance vers le plafond de
// l'étape en cours, puis saute au palier suivant quand l'étape change.
import { useEffect, useRef, useState } from "react";
import { ProductsHop } from "@/components/BonLoader";

export type SubmitStep = "prep" | "devis" | "logistique" | "gratuit" | "final";

const LABELS: Record<SubmitStep, string> = {
  prep: "Préparation",
  devis: "Création du devis",
  logistique: "Transmission à la logistique",
  gratuit: "BC gratuit",
  final: "Finalisation",
};
const RANGES: Record<SubmitStep, [number, number]> = {
  prep: [3, 15], devis: [16, 70], logistique: [71, 88], gratuit: [89, 95], final: [96, 99],
};
const TIPS = ["Envoi des lignes à Odoo…", "Application des remises…", "Calcul des prix et des taxes…", "Rattachement des offres…"];

export default function OrderSubmitLoader({ step, steps, clientName }: { step: SubmitStep; steps: SubmitStep[]; clientName: string }) {
  const [pct, setPct] = useState(RANGES.prep[0]);
  const [tip, setTip] = useState(0);
  const start = useRef(Date.now());
  useEffect(() => { start.current = Date.now(); setPct(p => Math.max(p, RANGES[step][0])); }, [step]);
  useEffect(() => {
    const t = setInterval(() => {
      const [from, to] = RANGES[step];
      const target = from + (to - from) * (1 - Math.exp(-(Date.now() - start.current) / (step === "devis" ? 2500 : 1200)));
      setPct(p => Math.max(p, target));
    }, 100);
    return () => clearInterval(t);
  }, [step]);
  useEffect(() => { const t = setInterval(() => setTip(i => (i + 1) % TIPS.length), 2200); return () => clearInterval(t); }, []);
  const current = steps.indexOf(step);

  return (
    <div className="ov" style={{ position: "fixed", inset: 0, zIndex: 600, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: 24, padding: "26px 26px 22px", boxShadow: "0 20px 25px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <ProductsHop />
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 14 }}>{LABELS[step]}…</div>
        <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4, minHeight: 18 }}>{step === "devis" ? TIPS[tip] : clientName}</div>
        <div style={{ width: "100%", height: 10, borderRadius: 999, background: "#ccfbf1", marginTop: 18, overflow: "hidden" }}>
          <div style={{ position: "relative", overflow: "hidden", height: "100%", width: `${pct}%`, borderRadius: 999, transition: "width 0.25s linear", background: "linear-gradient(90deg, #0d9488, #0f766e)" }}>
            <div className="bon-shine" style={{ position: "absolute", inset: 0, width: 80, background: "linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent)", animation: "bonBarShine 1.4s linear infinite" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, marginTop: 16, flexWrap: "wrap", justifyContent: "center" }}>
          {steps.map((s, i) => {
            const done = i < current, active = i === current;
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: done ? "#16a34a" : active ? "#0f766e" : "#94a3b8" }}>
                <span style={{ width: 18, height: 18, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: done ? "#16a34a" : active ? "#0d9488" : "#e2e8f0", color: "#fff", fontSize: 11 }}>
                  {done ? "✓" : i + 1}
                </span>
                {LABELS[s]}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
