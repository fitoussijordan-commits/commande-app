// lib/perimesExcel.ts — SERVEUR UNIQUEMENT (exceljs).
// Classeur Excel du rapport des périmés, mis en forme pour être lu tel quel :
// Synthèse (chiffres clés + tableau par client), Détail (toutes les lignes, lien
// Odoo sur chaque BC), Par produit (les références les plus reprises).
import ExcelJS from "exceljs";
import type { PerimesReport } from "@/lib/perimesReport";

const TEAL = "FF0F766E", TEAL_MID = "FFCCFBF1", TEAL_SOFT = "FFF0FDFA", BORDER = "FFE2E8F0";
const ORANGE = "FFEA580C", GREEN = "FF16A34A", MUTED = "FF64748B", TEXT = "FF0F172A";
const EUR = '#,##0.00 "€";[Red]-#,##0.00 "€"';
const DATE = "dd/mm/yyyy";

const thin = { style: "thin" as const, color: { argb: BORDER } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

function toDate(s: string): Date | string {
  const d = new Date(`${s}T12:00:00`);
  return isNaN(d.getTime()) ? s : d;
}

function frDate(s?: string) {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

// En-tête de tableau : teal, texte blanc gras, centré verticalement.
function styleHeader(row: ExcelJS.Row) {
  row.height = 26;
  row.eachCell(c => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    c.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
    c.border = box;
  });
}

// Lignes de données : bandes alternées et bordures fines.
function styleBody(ws: ExcelJS.Worksheet, from: number, to: number, cols: number) {
  for (let r = from; r <= to; r++) {
    const row = ws.getRow(r);
    row.height = 20;
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      cell.border = box;
      cell.alignment = { vertical: "middle", ...(cell.alignment || {}) };
      if ((r - from) % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_SOFT } };
    }
  }
}

// Bandeau titre + sous-titre sur toute la largeur de la feuille.
function titleBlock(ws: ExcelJS.Worksheet, cols: number, title: string, subtitle: string) {
  ws.mergeCells(1, 1, 1, cols);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { bold: true, size: 18, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  t.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(1).height = 38;
  ws.mergeCells(2, 1, 2, cols);
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { italic: true, size: 10, color: { argb: MUTED } };
  s.alignment = { vertical: "middle", indent: 1 };
  ws.getRow(2).height = 22;
}

export async function buildPerimesWorkbook(rep: PerimesReport, opts: {
  odooBase: string; from?: string; to?: string; author: string;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Commande";
  wb.created = new Date();

  const period = opts.from || opts.to
    ? `du ${frDate(opts.from) || "début"} au ${frDate(opts.to) || "aujourd'hui"}`
    : "toutes les reprises";
  const generated = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
  const subtitle = `Période : ${period} · généré le ${generated} par ${opts.author}`;
  const odooUrl = (id: number) => `${opts.odooBase}/web#id=${id}&model=sale.order&view_type=form`;

  // ── Synthèse ──────────────────────────────────────────────────────────────
  const ws = wb.addWorksheet("Synthèse", { views: [{ state: "frozen", ySplit: 8, showGridLines: false }] });
  ws.columns = [
    { width: 40 }, { width: 13 }, { width: 18 }, { width: 11 },
    { width: 17 }, { width: 15 }, { width: 15 }, { width: 16 },
  ];
  titleBlock(ws, 8, "Reprises de périmés", subtitle);

  // Chiffres clés : 4 cartes de 2 colonnes.
  const kpis: [string, number | string, string?][] = [
    ["VALEUR REPRISE", rep.totals.repris, EUR],
    ["PRODUITS D'ÉCHANGE", rep.totals.echange, EUR],
    ["REPRISES", rep.totals.count],
    ["CLIENTS", rep.totals.clients],
  ];
  kpis.forEach(([label, value, fmt], i) => {
    const c1 = 1 + i * 2, c2 = c1 + 1;
    ws.mergeCells(4, c1, 4, c2); ws.mergeCells(5, c1, 5, c2);
    const l = ws.getCell(4, c1), v = ws.getCell(5, c1);
    l.value = label;
    l.font = { bold: true, size: 9, color: { argb: MUTED } };
    v.value = value;
    v.font = { bold: true, size: 18, color: { argb: TEAL } };
    if (fmt) v.numFmt = fmt;
    for (const cell of [l, v]) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_SOFT } };
      cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    }
  });
  ws.getRow(4).height = 20; ws.getRow(5).height = 32;

  const head = ws.getRow(8);
  head.values = ["Client", "Code", "Ville", "Reprises", "Valeur reprise", "Échange", "Ajustement", "Dernière reprise"];
  styleHeader(head);
  let r = 9;
  for (const c of rep.clients) {
    const row = ws.getRow(r++);
    row.values = [c.client, c.clientRef, c.city, c.count, c.repris, c.echange, c.ajustement, toDate(c.last)];
    row.getCell(1).font = { bold: true, color: { argb: TEXT } };
    [5, 6, 7].forEach(i => { row.getCell(i).numFmt = EUR; });
    row.getCell(8).numFmt = DATE;
    row.getCell(4).alignment = { horizontal: "center" };
  }
  const last = r - 1;
  if (last >= 9) {
    styleBody(ws, 9, last, 8);
    ws.autoFilter = { from: { row: 8, column: 1 }, to: { row: last, column: 8 } };
  }
  // Ligne Total en formules : elle reste juste si l'on filtre ou corrige dans Excel.
  // `result` = valeur déjà calculée : l'aperçu de Mail sur iPad (Quick Look) ne
  // recalcule pas les formules, il afficherait un total vide.
  const sum = (col: string, result: number) => ({ formula: `SUM(${col}9:${col}${Math.max(last, 9)})`, result });
  const cs = rep.clients;
  const tot = ws.getRow(r);
  tot.values = ["Total", "", "",
    sum("D", cs.reduce((a, c) => a + c.count, 0)),
    sum("E", rep.totals.repris), sum("F", rep.totals.echange),
    sum("G", Math.round(cs.reduce((a, c) => a + c.ajustement, 0) * 100) / 100), ""];
  tot.height = 24;
  tot.eachCell({ includeEmpty: true }, (c, i) => {
    if (i > 8) return;
    c.font = { bold: true, color: { argb: TEAL } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_MID } };
    c.border = { top: { style: "medium", color: { argb: TEAL } }, bottom: thin };
    c.alignment = { vertical: "middle", indent: i === 1 ? 1 : 0, horizontal: i === 4 ? "center" : undefined };
    if (i >= 5 && i <= 7) c.numFmt = EUR;
  });

  // ── Détail ────────────────────────────────────────────────────────────────
  const wd = wb.addWorksheet("Détail", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
  wd.columns = [
    { width: 12 }, { width: 11 }, { width: 34 }, { width: 11 }, { width: 20 }, { width: 12 },
    { width: 11 }, { width: 40 }, { width: 20 }, { width: 7 }, { width: 13 }, { width: 14 }, { width: 13 },
  ];
  titleBlock(wd, 13, "Détail des reprises", subtitle);
  const dh = wd.getRow(4);
  dh.values = ["Date", "BC", "Client", "Code client", "Commercial", "Type", "Réf.", "Produit", "Lot", "Qté", "P.U.", "Montant", "État"];
  styleHeader(dh);
  let d = 5;
  for (const l of rep.lines) {
    const row = wd.getRow(d++);
    // Lien en formule HYPERLINK (et non objet hyperlink d'exceljs : ses liens
    // débordaient sur les cellules de même adresse des autres onglets).
    const link = { formula: `HYPERLINK("${odooUrl(l.orderId)}","${l.orderName.replace(/"/g, "")}")`, result: l.orderName };
    row.values = [toDate(l.date), link, l.client, l.clientRef,
      l.commercial, l.type, l.ref, l.product, l.lot, l.qty, l.unit, l.amount, l.state];
    row.getCell(1).numFmt = DATE;
    row.getCell(2).font = { color: { argb: TEAL }, underline: true };
    row.getCell(6).font = { bold: true, color: { argb: l.type === "Repris" ? ORANGE : l.type === "Échange" ? GREEN : MUTED } };
    row.getCell(10).alignment = { horizontal: "center" };
    row.getCell(11).numFmt = EUR; row.getCell(12).numFmt = EUR;
    if (l.type === "Ajustement") row.getCell(8).font = { italic: true, color: { argb: MUTED } };
  }
  if (d - 1 >= 5) {
    styleBody(wd, 5, d - 1, 13);
    wd.autoFilter = { from: { row: 4, column: 1 }, to: { row: d - 1, column: 13 } };
  }

  // ── Par produit ───────────────────────────────────────────────────────────
  const byProduct = new Map<string, { ref: string; product: string; qty: number; value: number; clients: Set<number> }>();
  for (const l of rep.lines) {
    if (l.type !== "Repris") continue;
    const key = l.ref || l.product;
    const p = byProduct.get(key) || { ref: l.ref, product: l.product, qty: 0, value: 0, clients: new Set<number>() };
    p.qty += l.qty; p.value += -l.amount; p.clients.add(l.clientId);
    byProduct.set(key, p);
  }
  const wp = wb.addWorksheet("Par produit", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
  wp.columns = [{ width: 12 }, { width: 46 }, { width: 13 }, { width: 17 }, { width: 11 }];
  titleBlock(wp, 5, "Produits les plus repris", subtitle);
  const ph = wp.getRow(4);
  ph.values = ["Réf.", "Produit", "Qté reprise", "Valeur reprise", "Clients"];
  styleHeader(ph);
  let pr = 5;
  for (const p of Array.from(byProduct.values()).sort((a, b) => b.value - a.value)) {
    const row = wp.getRow(pr++);
    row.values = [p.ref, p.product, p.qty, Math.round(p.value * 100) / 100, p.clients.size];
    row.getCell(3).alignment = { horizontal: "center" };
    row.getCell(4).numFmt = EUR;
    row.getCell(5).alignment = { horizontal: "center" };
  }
  if (pr - 1 >= 5) {
    styleBody(wp, 5, pr - 1, 5);
    wp.autoFilter = { from: { row: 4, column: 1 }, to: { row: pr - 1, column: 5 } };
  }

  for (const sheet of [ws, wd, wp]) {
    sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    // Police explicite partout (Arial : présente sur iPad, Mac et Windows) — sans elle, l'aperçu iPad retombe sur une police à empattements.
    sheet.eachRow({ includeEmpty: true }, row => row.eachCell({ includeEmpty: true }, c => {
      c.font = { name: "Arial", size: 10, ...(c.font || {}) };
    }));
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
