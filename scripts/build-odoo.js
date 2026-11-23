#!/usr/bin/env node
/**
 * Build du module Odoo 19 « flow_app » : l'app Flow servie par Odoo sous /flow/.
 *
 *  1. Export statique de Next (ODOO_BUILD=1 → basePath /flow, cible « odoo »),
 *     app/api mis de côté le temps de l'export (comme pour Capacitor).
 *  2. Copie de ./out dans odoo/flow_app/static/app.
 *  3. Manifest PWA réécrit pour /flow/.
 *  4. Archive dist/flow_app.zip (dossier flow_app à la racine du zip).
 *
 * Usage : npm run build:odoo
 * Option : ODOO_API_BASE=https://… (Vercel des routes API, défaut flow.dr-hauschka.fr)
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const apiDir = path.join(root, "app", "api");
const apiStash = path.join(root, ".api-stash");
const outDir = path.join(root, "out");
const moduleDir = path.join(root, "odoo", "flow_app");
const appDir = path.join(moduleDir, "static", "app");
const distDir = path.join(root, "dist");
const BASE = "/flow";

let stashed = false;
try {
  if (fs.existsSync(apiDir)) {
    fs.renameSync(apiDir, apiStash);
    stashed = true;
    console.log("→ app/api mis de côté le temps de l'export statique");
  }
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log("→ next build (export statique, ODOO_BUILD=1)…");
  execSync("npx next build", { cwd: root, stdio: "inherit", env: { ...process.env, ODOO_BUILD: "1" } });
} finally {
  if (stashed) {
    fs.renameSync(apiStash, apiDir);
    console.log("→ app/api restauré");
  }
}

// 2. Copie dans le module
fs.rmSync(appDir, { recursive: true, force: true });
fs.cpSync(outDir, appDir, { recursive: true });

// 3. Manifest PWA : chemins sous /flow/
const mf = path.join(appDir, "manifest.webmanifest");
if (fs.existsSync(mf)) {
  const m = JSON.parse(fs.readFileSync(mf, "utf8"));
  m.start_url = `${BASE}/`;
  m.scope = `${BASE}/`;
  m.icons = (m.icons || []).map((i) => ({ ...i, src: i.src.startsWith("/") ? BASE + i.src : i.src }));
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
}

// Version du module = version de l'app (commit), pour s'y retrouver dans Odoo.
let sha = "dev";
try { sha = execSync("git rev-parse --short=7 HEAD", { cwd: root }).toString().trim(); } catch {}
fs.writeFileSync(path.join(appDir, "VERSION"), `${sha}\n${new Date().toISOString()}\n`);

// 4. Zip
fs.mkdirSync(distDir, { recursive: true });
const zip = path.join(distDir, "flow_app.zip");
fs.rmSync(zip, { force: true });
execSync(`zip -qr -X "${zip}" flow_app -x "*.DS_Store" -x "*/__pycache__/*" -x "*.pyc"`, { cwd: path.join(root, "odoo"), stdio: "inherit" });
const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1);
console.log(`→ module prêt : dist/flow_app.zip (${mb} Mo) — app ${sha}`);
