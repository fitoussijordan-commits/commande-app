#!/usr/bin/env node
/**
 * Build du front pour Capacitor (export statique dans ./out).
 *
 * Problème : Next.js refuse `output: export` s'il reste des routes API
 * (app/api/**). Or on veut GARDER ces routes pour le déploiement Vercel.
 * Solution : on déplace temporairement app/api hors de l'arborescence le
 * temps de l'export, puis on le remet en place — quoi qu'il arrive.
 *
 * Usage : npm run build:ios
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const apiDir = path.join(root, "app", "api");
const apiStash = path.join(root, ".api-stash");

function move(from, to) {
  if (fs.existsSync(from)) fs.renameSync(from, to);
}

let stashed = false;
try {
  if (fs.existsSync(apiDir)) {
    move(apiDir, apiStash);
    stashed = true;
    console.log("→ app/api mis de côté le temps de l'export statique");
  }

  console.log("→ next build (export statique, CAPACITOR_BUILD=1)…");
  execSync("next build", {
    stdio: "inherit",
    env: { ...process.env, CAPACITOR_BUILD: "1" },
  });

  console.log("→ export terminé dans ./out");
} finally {
  if (stashed) {
    move(apiStash, apiDir);
    console.log("→ app/api restauré");
  }
}
