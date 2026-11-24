// lib/bonSheets.ts — SERVEUR UNIQUEMENT.
// Tableurs des bons de commande, comme le module Odoo « sale_order_ocr_import »
// (document_reader.py) :
//   • « Accord périmés » (onglet du même nom) : lu directement, sans Claude ;
//   • « BDC Offline » (nom du fichier ou structure) : seul l'onglet Synthèse est lu ;
//   • autres Excel / CSV : Claude ne reçoit qu'un APERÇU (40 premières + 5
//     dernières lignes) et indique la feuille et les colonnes ; toutes les lignes
//     sont lues ici. Les colonnes Code article / EAN sont vérifiées d'après leur
//     CONTENU (formats + codes connus dans Odoo), jamais d'après leur intitulé.
import ExcelJS from "exceljs";

export interface Sheet { title: string; visible: boolean; rows: any[][] }
export interface Known { codes: Set<string>; barcodes: Set<string> }
export interface RawLine {
  code_article: string | null; ean: string | null; designation: string | null;
  quantite: number | null; quantite_gratuite?: number | null; commentaire?: string | null;
}
export interface Extraction {
  reference_commande_client?: string | null;
  lignes: RawLine[];
  lignes_ignorees?: string[];
  remarques?: string | null;
  code_client?: string | null;
  source?: string;
}

// ── Formatage des cellules (≈ _fmt) ───────────────────────────────────────
class Percent { constructor(public v: number) {} }

export function fmt(v: any): string {
  if (v == null) return "";
  if (v instanceof Percent) return `${fmt(Math.round(v.v * 100 * 10000) / 10000)} %`;
  if (typeof v === "boolean") return v ? "VRAI" : "FAUX";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (v instanceof Date) {
    const d = (n: number) => String(n).padStart(2, "0");
    return `${d(v.getUTCDate())}/${d(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
  }
  return String(v).replace(/\n/g, " ").trim();
}

export function norm(v: any): string {
  return String(v ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}

function cellValue(cell: ExcelJS.Cell): any {
  let v: any = cell.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) v = v.result;                        // formule : valeur calculée
    else if ("richText" in v) v = v.richText.map((r: any) => r.text).join("");
    else if ("text" in v) v = v.text;                        // lien
    else if ("error" in v) v = null;
    else v = null;
  }
  if (typeof v === "number" && String(cell.numFmt || "").includes("%")) return new Percent(v);
  return v ?? null;
}

// ── Lecture ───────────────────────────────────────────────────────────────
export async function readXlsx(buf: Buffer): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const sheets: Sheet[] = [];
  wb.eachSheet(ws => {
    const rows: any[][] = [];
    const width = ws.actualColumnCount || ws.columnCount || 0;
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: any[] = [];
      for (let c = 1; c <= width; c++) cells.push(cellValue(row.getCell(c)));
      rows.push(cells);
    }
    sheets.push({ title: ws.name, visible: (ws.state || "visible") === "visible", rows });
  });
  return sheets;
}

function decode(buf: Buffer): string {
  const utf8 = buf.toString("utf8");
  // Octets invalides en UTF-8 → fichier Windows (cp1252 ≈ latin1).
  return (utf8.includes("�") ? buf.toString("latin1") : utf8).replace(/^﻿/, "");
}

export function readCsv(buf: Buffer): Sheet[] {
  const text = decode(buf);
  const sample = text.slice(0, 5000).split(/\r?\n/).slice(0, 20);
  const delims = [";", ",", "\t", "|"];
  const delimiter = delims
    .map(d => ({ d, n: sample.map(l => l.split(d).length - 1) }))
    .filter(x => x.n[0] > 0 && x.n.filter(Boolean).every(c => c === x.n[0]))
    .sort((a, b) => b.n[0] - a.n[0])[0]?.d
    || delims.sort((a, b) => (text.split(b).length) - (text.split(a).length))[0] || ";";
  const rows: any[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delimiter) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); rows.push(row); row = []; cur = "";
    } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return [{ title: "CSV", visible: true, rows }];
}

// ── Aperçu envoyé à Claude ────────────────────────────────────────────────
const PREVIEW_HEAD_ROWS = 40;
const PREVIEW_TAIL_ROWS = 5;

export function colLetter(index: number): string {
  let letters = "", n = index + 1;
  while (n) { const rest = (n - 1) % 26; letters = String.fromCharCode(65 + rest) + letters; n = Math.floor((n - 1) / 26); }
  return letters;
}
export function colIndex(letters: any): number | null {
  const l = String(letters || "").trim().toUpperCase();
  if (!l || !/^[A-Z]+$/.test(l)) return null;
  let idx = 0;
  for (const ch of l) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

export function sheetsPreview(sheets: Sheet[], filename: string): string {
  const out = [`Aperçu du fichier « ${filename} ». Chaque ligne commence par son numéro (L…) ; les colonnes sont nommées A, B, C… comme dans Excel.`];
  sheets.forEach((s, n) => {
    const filled = s.rows.map((r, i) => [i + 1, r] as [number, any[]]).filter(([, r]) => r.some(v => fmt(v)));
    if (!filled.length) return;
    const width = Math.max(...filled.map(([, r]) => r.length));
    out.push(`\n=== Feuille ${n + 1} : « ${s.title} »${s.visible ? "" : " (masquée)"} – ${filled.length} lignes non vides ===`);
    out.push("Col.\t" + Array.from({ length: width }, (_, i) => colLetter(i)).join("\t"));
    let shown: ([number, any[]] | null)[] = filled.slice(0, PREVIEW_HEAD_ROWS);
    if (filled.length > PREVIEW_HEAD_ROWS) shown = [...shown, null, ...filled.slice(-PREVIEW_TAIL_ROWS)];
    for (const x of shown) {
      if (!x) { out.push(`… (${filled.length - shown.length + 1} lignes non affichées) …`); continue; }
      out.push(`L${x[0]}\t${x[1].map(v => fmt(v).slice(0, 60)).join("\t")}`);
    }
  });
  return out.join("\n");
}

// ── Code article / EAN d'après le contenu ─────────────────────────────────
// Code article : 7 chiffres en général (1010101), parfois 6 ou 9, ou L4010203.
// EAN : 13 chiffres (4020829…), parfois 11, 12, 14 ou 15.
const CODE_RE = /^(?:\d{6,9}|[A-Z]\d{6,8})$/;
const EAN_RE = /^\d{11,15}$/;

export const normBarcode = (v: any) => String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");

export function cellKind(value: string, known?: Known | null): "code" | "ean" | null {
  const v = String(value || "").replace(/ /g, "").toUpperCase();
  if (!v) return null;
  if (known) {
    if (known.codes.has(v)) return "code";
    if (/^\d+$/.test(v) && known.barcodes.has(normBarcode(v))) return "ean";
  }
  if (/^\d+$/.test(v) && v.replace(/^0+/, "").startsWith("4020829") && v.length >= 11) return "ean";
  if (EAN_RE.test(v)) return "ean";
  if (CODE_RE.test(v)) return "code";
  return null;
}

function detectCodeEanColumns(rows: any[][], exclude: Set<number | null>, known?: Known | null): [number | null, number | null] {
  const width = Math.max(0, ...rows.map(r => r.length));
  const scores = new Map<string, number>();
  for (let col = 0; col < width; col++) {
    if (exclude.has(col)) continue;
    const values = rows.map(r => (col < r.length ? fmt(r[col]) : "")).filter(Boolean);
    if (!values.length) continue;
    const counts = { code: 0, ean: 0 };
    for (const v of values) {
      const kind = cellKind(v, known);
      if (!kind) continue;
      const vv = v.replace(/ /g, "").toUpperCase();
      const inOdoo = !!known && (known.codes.has(vv) || known.barcodes.has(normBarcode(vv)));
      counts[kind] += inOdoo ? 2 : 1;
      if (kind === "code" && vv.startsWith("10")) counts[kind] += 0.25;
    }
    for (const kind of ["code", "ean"] as const) {
      const hits = values.filter(v => cellKind(v, known) === kind).length;
      if (hits >= Math.min(2, values.length) && hits >= 0.6 * values.length) scores.set(`${kind}:${col}`, counts[kind]);
    }
  }
  const best = (kind: string, skip: number | null = null): number | null => {
    let bestCol: number | null = null, bestScore = -Infinity;
    for (const [k, sc] of Array.from(scores.entries())) {
      const [kk, c] = k.split(":"); const col = Number(c);
      if (kk !== kind || col === skip) continue;
      if (sc > bestScore || (sc === bestScore && bestCol != null && col > bestCol)) { bestScore = sc; bestCol = col; }
    }
    return bestCol;
  };
  const codeCol = best("code");
  return [codeCol, best("ean", codeCol)];
}

function toNumber(v: any): number | null {
  if (v == null || v === "" || typeof v === "boolean") return null;
  if (v instanceof Percent) return v.v;
  if (typeof v === "number") return v;
  const m = String(v).replace(/[\s  ]/g, "").replace(",", ".").match(/^[+-]?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

const TOTAL_WORDS = ["total", "sous-total", "sous total", "tva", "port", "remise", "net a payer"];

export interface Mapping {
  feuille?: number; premiere_ligne?: number; derniere_ligne?: number | null;
  colonne_quantite?: string; colonne_code_article?: string | null; colonne_ean?: string | null;
  colonne_designation?: string | null; colonne_ug?: string | null;
  reference_commande_client?: string | null; remarques?: string | null;
}

// Plan de colonnes de Claude appliqué à toutes les lignes (≈ extract_with_mapping).
export function extractWithMapping(sheets: Sheet[], mapping: Mapping, known?: Known | null): Extraction | null {
  const sheet = sheets[(Number(mapping.feuille) || 1) - 1];
  if (!sheet) return null;
  const { title, rows } = sheet;
  const qtyCol = colIndex(mapping.colonne_quantite);
  let codeCol = colIndex(mapping.colonne_code_article);
  let eanCol = colIndex(mapping.colonne_ean);
  let labelCol = colIndex(mapping.colonne_designation);
  const ugCol = colIndex(mapping.colonne_ug);
  if (qtyCol == null) return null;
  const first = Math.max(Number(mapping.premiere_ligne) || 1, 1);
  const last = Number(mapping.derniere_ligne) || rows.length;
  const cell = (row: any[], col: number | null) => (col != null && col < row.length ? row[col] : null);

  const dataRows = rows.slice(first - 1, Math.min(last, rows.length));
  const [foundCode, foundEan] = detectCodeEanColumns(dataRows, new Set([qtyCol, ugCol]), known);
  const m: Mapping = { ...mapping };
  if (foundCode != null || foundEan != null) {
    const newCode = foundCode != null ? foundCode : codeCol;
    let newEan = foundEan != null ? foundEan : eanCol;
    if (newEan === newCode) newEan = null;
    if (newCode !== codeCol || newEan !== eanCol) {
      if (labelCol != null && (labelCol === newCode || labelCol === newEan)) labelCol = null;
      codeCol = newCode; eanCol = newEan;
      m.colonne_code_article = codeCol != null ? colLetter(codeCol) : null;
      m.colonne_ean = eanCol != null ? colLetter(eanCol) : null;
    }
  }
  if (codeCol == null && eanCol == null && labelCol == null) return null;

  const lignes: RawLine[] = [];
  const ignored: string[] = [];
  let withoutQty = 0;
  for (let number = first; number <= Math.min(last, rows.length); number++) {
    const row = rows[number - 1] || [];
    const code = fmt(cell(row, codeCol)), ean = fmt(cell(row, eanCol)), label = fmt(cell(row, labelCol));
    if (!(code || ean || label)) continue;
    if (!(code || ean) && TOTAL_WORDS.some(w => norm(label).includes(w))) { ignored.push(`L${number} ${label}`); continue; }
    const rawQty = cell(row, qtyCol);
    const qty = toNumber(rawQty);
    const free = ugCol != null ? toNumber(cell(row, ugCol)) : null;
    if (qty == null && fmt(rawQty) && !(free && free > 0)) continue;   // en-tête ou texte
    if ((!qty || qty <= 0) && !(free && free > 0)) { withoutQty++; continue; }
    const eanClean = ean.replace(/ /g, "");
    lignes.push({
      code_article: code || null,
      // EAN uniquement s'il n'a que des chiffres (ignore « 999999L4010203 »)
      ean: /^\d+$/.test(eanClean) ? eanClean : null,
      designation: label || null,
      quantite: qty && qty > 0 ? qty : 0,
      quantite_gratuite: free && free > 0 ? free : null,
      commentaire: null,
    });
  }
  if (withoutQty) ignored.push(`${withoutQty} ligne(s) sans quantité (articles non commandés)`);
  const parts = [`quantité ${m.colonne_quantite}`,
    codeCol != null ? `code ${m.colonne_code_article}` : "",
    eanCol != null ? `EAN ${m.colonne_ean}` : "",
    labelCol != null ? `libellé ${m.colonne_designation}` : ""].filter(Boolean);
  return {
    reference_commande_client: mapping.reference_commande_client || null,
    lignes,
    lignes_ignorees: ignored,
    remarques: `Feuille « ${title} » ; colonnes : ${parts.join(", ")}.${mapping.remarques ? " " + mapping.remarques : ""}`,
  };
}

// ── BDC Offline ───────────────────────────────────────────────────────────
export function isBdcOfflineFilename(filename: string): boolean {
  const base = String(filename || "").split(/[\\/]/).pop() || "";
  return /^bdc[\s_-]*offline/i.test(base);
}

function bdcColumns(header: any[]): boolean {
  const cells = (header || []).map(norm);
  if (!cells.length || cells[0] !== "quantite") return false;
  const find = (...p: string[]) => cells.findIndex(t => p.some(x => t.startsWith(x)));
  return find("reference interne", "reference", "ref") >= 0 && find("nom", "libelle", "designation") >= 0;
}

export function isBdcOfflineStructure(sheets: Sheet[]): boolean {
  if (!sheets.length) return false;
  const productSheets = sheets.filter(s => !/^(synthese|_)/.test(norm(s.title)) && s.rows.length && bdcColumns(s.rows[0])).length;
  const hasSynthese = norm(sheets[0].title).startsWith("synthese");
  return productSheets >= 2 || (productSheets >= 1 && hasSynthese);
}

// ── Formulaire « Accord périmés » (lu sans Claude) ────────────────────────
export function parseAccordPerimes(sheets: Sheet[]): Extraction | null {
  const sheet = sheets.find(s => norm(s.title) === "accord perimes");
  if (!sheet) return null;
  const rows = sheet.rows;
  let headerIdx = -1, refCol = 1, labelCol: number | null = null, qtyCol = 4;
  const infos: Record<string, string> = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], cells = row.map(norm);
    cells.forEach((t, j) => {
      if (j + 1 >= row.length) return;
      if (t.startsWith("code client")) infos.code_client = fmt(row[j + 1]);
      else if (t.startsWith("date de la demande")) infos.date = fmt(row[j + 1]);
      else if (t.startsWith("nom du magasin")) infos.magasin = fmt(row[j + 1]);
    });
    if (cells.some(t => t.includes("produits a expedier"))) {
      headerIdx = i;
      qtyCol = cells.findIndex(t => t.includes("produits a expedier"));
      const r = cells.findIndex(t => t.startsWith("ref")); refCol = r >= 0 ? r : 1;
      const l = cells.findIndex(t => t.startsWith("libelle")); labelCol = l >= 0 ? l : null;
      break;
    }
  }
  if (headerIdx < 0) return null;
  const cell = (row: any[], col: number | null) => (col != null && col < row.length ? row[col] : null);
  const lignes: RawLine[] = [], ignored: string[] = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const ref = fmt(cell(row, refCol));
    if (!ref) continue;
    const label = fmt(cell(row, labelCol));
    let qty: any = cell(row, qtyCol);
    if (typeof qty === "string") { const n = parseFloat(qty.replace(",", ".").trim() || "0"); qty = isNaN(n) ? null : n; }
    if (qty instanceof Percent) qty = qty.v;
    if (qty == null || typeof qty !== "number") return null;   // valeurs calculées absentes : Claude lira
    if (qty <= 0) { ignored.push(`${ref} ${label} (quantité à expédier = 0)`); continue; }
    lignes.push({ code_article: ref, ean: null, designation: label, quantite: qty, commentaire: null });
  }
  const details = [
    infos.magasin && `magasin ${infos.magasin}`,
    infos.code_client && `code client ${infos.code_client}`,
    infos.date && `demande du ${infos.date.trim()}`,
  ].filter(Boolean);
  return {
    reference_commande_client: `Accord périmés ${(infos.date || "").trim()}`.trim(),
    lignes,
    lignes_ignorees: ignored,
    remarques: `Formulaire « Accord périmés » lu directement (sans appel à Claude)${details.length ? " : " + details.join(", ") : ""}.`,
    code_client: infos.code_client || null,
    source: "accord_perimes",
  };
}

// Aperçu HTML des feuilles pour l'app (le navigateur n'affiche pas un .xlsx).
export function sheetsHtml(sheets: Sheet[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return sheets.map(s => {
    const rows = s.rows.filter(r => r.some(v => fmt(v))).slice(0, 2000);
    if (!rows.length) return "";
    return `<h3>${esc(s.title)}</h3><table>${rows.map(r => `<tr>${r.map(c => `<td>${esc(fmt(c))}</td>`).join("")}</tr>`).join("")}</table>`;
  }).join("");
}
