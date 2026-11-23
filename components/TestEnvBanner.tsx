"use client";
// Signale clairement une base Odoo de TEST (staging) : toute URL qui ne contient
// pas « prod-main » n'est pas la production.
//
// Affichage (une fois connecté seulement — pas sur l'écran de connexion) :
// étiquette rouge « BASE DE TEST » en haut au centre, et « [TEST] » devant le
// titre de l'onglet (web).
// En position fixe, z-index maximal et pointer-events: none : visible au-dessus
// de tous les écrans et modales (eux-mêmes en position fixe), sans jamais
// bloquer un tap ni décaler la mise en page.
import { useEffect } from "react";

export function isTestOdooUrl(url: string | undefined | null): boolean {
  const u = (url || "").trim().toLowerCase();
  return u !== "" && !u.includes("prod-main");
}

const RED = "#dc2626";

export default function TestEnvBanner({ url, db }: { url: string | undefined | null; db?: string }) {
  const isTest = isTestOdooUrl(url);

  useEffect(() => {
    if (!isTest) return;
    const base = document.title.replace(/^\[TEST\] /, "");
    document.title = `[TEST] ${base}`;
    return () => { document.title = document.title.replace(/^\[TEST\] /, ""); };
  }, [isTest]);

  if (!isTest) return null;

  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 2147483000, pointerEvents: "none" }}>
      {/* Étiquette en haut au centre, sous la barre de statut iOS */}
      <div style={{
        position: "absolute", top: "env(safe-area-inset-top)", left: "50%", transform: "translateX(-50%)",
        background: RED, color: "#fff", fontFamily: "'DM Sans', sans-serif",
        fontSize: 10, fontWeight: 800, letterSpacing: 1, lineHeight: "16px",
        padding: "0 10px 1px", borderRadius: "0 0 8px 8px", whiteSpace: "nowrap",
        boxShadow: "0 2px 6px rgba(220,38,38,0.35)", maxWidth: "90vw", overflow: "hidden", textOverflow: "ellipsis",
      }}>
        BASE DE TEST{db ? ` · ${db}` : ""}
      </div>
    </div>
  );
}
