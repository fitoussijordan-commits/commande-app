// lib/officeToText.ts — SERVEUR UNIQUEMENT.
// Claude ne lit pas directement Word ni Excel : on les convertit en texte
// structuré avant de les lui envoyer.
//   • Word (.docx) → HTML (mammoth) : les tableaux du bon restent des <table>.
//   • Excel (.xlsx) → une ligne par rangée, cellules séparées par « | », une
//     section par feuille.
//   • CSV → texte tel quel.
// Le même HTML sert d'aperçu dans l'app (iframe sandboxée, sans script).
import mammoth from "mammoth";
import ExcelJS from "exceljs";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CSV_MIME = "text/csv";

const MAX_CHARS = 150_000;    // largement assez pour un bon ; borne le coût
const MAX_ROWS = 2_000;       // par feuille

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface Converted { text: string; previewHtml: string; label: string }

export async function docxToText(buf: Buffer): Promise<Converted> {
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  return { text: value.slice(0, MAX_CHARS), previewHtml: value, label: "document Word converti en HTML" };
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toLocaleDateString("fr-FR");
  if (typeof v === "object") {
    const o = v as any;
    if ("result" in o) return cellText(o.result);            // formule : valeur calculée
    if ("richText" in o) return o.richText.map((r: any) => r.text).join("");
    if ("text" in o) return String(o.text);                    // lien
    return "";
  }
  return String(v);
}

export async function xlsxToText(buf: Buffer): Promise<Converted> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const parts: string[] = [];
  const html: string[] = [];
  wb.eachSheet(ws => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, row => {
      if (rows.length >= MAX_ROWS) return;
      const cells: string[] = [];
      for (let c = 1; c <= ws.actualColumnCount; c++) cells.push(cellText(row.getCell(c).value).trim());
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some(Boolean)) rows.push(cells);
    });
    if (!rows.length) return;
    parts.push(`### Feuille « ${ws.name} »\n` + rows.map(r => r.join(" | ")).join("\n"));
    html.push(`<h3>${esc(ws.name)}</h3><table>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`);
  });
  if (!parts.length) throw new Error("Classeur Excel vide");
  return { text: parts.join("\n\n").slice(0, MAX_CHARS), previewHtml: html.join(""), label: "classeur Excel converti en texte (cellules séparées par « | »)" };
}

export function csvToText(buf: Buffer): Converted {
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const rows = text.split(/\r?\n/).filter(Boolean).slice(0, MAX_ROWS);
  const sep = (rows[0]?.match(/;/g)?.length || 0) >= (rows[0]?.match(/,/g)?.length || 0) ? ";" : ",";
  const html = `<table>${rows.map(r => `<tr>${r.split(sep).map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
  return { text: text.slice(0, MAX_CHARS), previewHtml: html, label: "fichier CSV" };
}

// Habillage de l'aperçu : lisible, tableaux bordés, aucune ressource externe.
export function previewPage(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,Helvetica,Arial,sans-serif;font-size:13px;color:#0f172a;margin:16px;line-height:1.4}
table{border-collapse:collapse;margin:8px 0;width:100%}td,th{border:1px solid #e2e8f0;padding:4px 6px;vertical-align:top}
tr:nth-child(even) td{background:#f8fafc}h3{font-size:13px;color:#0f766e;margin:16px 0 4px}img{max-width:100%}
</style></head><body>${body}</body></html>`;
}
