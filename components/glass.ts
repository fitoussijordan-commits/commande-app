// components/glass.ts
// Style « verre » façon iOS : fond translucide flouté, liseré clair, reflet en
// haut. Ne rend bien que posé sur un fond coloré (voir le fond de ClientStep).
import type { CSSProperties } from "react";

export const GLASS: CSSProperties = {
  background: "rgba(255,255,255,0.58)",
  backdropFilter: "blur(24px) saturate(180%)",
  WebkitBackdropFilter: "blur(24px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.75)",
  boxShadow: "0 10px 34px rgba(15,118,110,0.13), inset 0 1px 0 rgba(255,255,255,0.95)",
  borderRadius: 26,
};

// Pastille de verre plus légère (sélecteurs, puces).
export const GLASS_PILL: CSSProperties = {
  background: "rgba(255,255,255,0.5)",
  backdropFilter: "blur(16px) saturate(170%)",
  WebkitBackdropFilter: "blur(16px) saturate(170%)",
  border: "1px solid rgba(255,255,255,0.7)",
  borderRadius: 999,
};
