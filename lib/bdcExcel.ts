// lib/bdcExcel.ts — généré DANS LE NAVIGATEUR (exceljs chargé à la demande).
// Bon de commande MEA au format des BDC de séminaire (« BDC MEA Sérum tarifs
// 2026 ») : code et libellé client, remise client, une ligne par produit mis en
// avant (code, désignation, EAN, PU HT, PPC TTC, achats N-1, proposition
// commerciale, 2 dates de livraison, total remisé), puis les éléments du kit
// offert. Les totaux restent des formules : le DC peut modifier les quantités.
// Plusieurs clients → un onglet par client dans le même fichier.
import type { PrepCampaign } from "@/lib/rdvPrep";

const TEAL = "FF0F766E", TEAL_SOFT = "FFF0FDFA", BORDER = "FFCBD5E1", MUTED = "FF64748B";
const EUR = '#,##0.00 "€"';
const thin = { style: "thin" as const, color: { argb: BORDER } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

export interface BdcClient { code: string; name: string; discount: number; campaign: PrepCampaign }

const sheetName = (s: string, used: Set<string>) => {
  let n = s.replace(/[\\/*?:[\]]/g, " ").slice(0, 28).trim() || "Client";
  let i = 2; const base = n;
  while (used.has(n)) n = `${base.slice(0, 25)} ${i++}`;
  used.add(n); return n;
};

// Photos produits (image_256 d'Odoo, base64) et logo, comme sur les BDC d'origine.
export interface BdcImages { products: Map<number, { b64: string; w: number; h: number }>; logo?: string }

const imgExt = (b64: string): "png" | "jpeg" | "gif" | null =>
  b64.startsWith("iVBOR") ? "png" : b64.startsWith("/9j/") ? "jpeg" : b64.startsWith("R0lG") ? "gif" : null;

export async function loadBdcImages(session: import("@/lib/odoo").OdooSession, productIds: number[]): Promise<BdcImages> {
  const odoo = await import("@/lib/odoo");
  const products = new Map<number, { b64: string; w: number; h: number }>();
  // Dimensions réelles de l'image : la photo garde ses proportions dans la case.
  const size = (b64: string, ext: string) => new Promise<{ w: number; h: number }>(res => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 });
    im.onerror = () => res({ w: 1, h: 1 });
    im.src = `data:image/${ext};base64,${b64}`;
  });
  if (productIds.length) {
    try {
      const rows: any[] = await odoo.searchRead(session, "product.product", [["id", "in", productIds]], ["id", "image_256"], 0);
      for (const r of rows) {
        const b64 = r.image_256 ? String(r.image_256) : ""; const ext = imgExt(b64);
        if (ext) products.set(r.id, { b64, ...(await size(b64, ext)) });
      }
    } catch { /* sans photos */ }
  }
  let logo: string | undefined;
  try {
    const res = await fetch("/logo-full.png");
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    logo = btoa(bin);
  } catch { /* sans logo */ }
  return { products, logo };
}

export async function buildBdc(clients: BdcClient[], images?: BdcImages): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Commande DC";
  const used = new Set<string>();
  const year = new Date().getFullYear();

  for (const cl of clients) {
    const c = cl.campaign;
    const ws = wb.addWorksheet(sheetName(cl.name, used), { pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = [
      { width: 20 }, { width: 12 }, { width: 44 }, { width: 16 }, { width: 10 }, { width: 10 },
      { width: 12 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 16 },
    ];
    ws.mergeCells("H2:K2");
    if (images?.logo) {
      const id = wb.addImage({ base64: images.logo, extension: "png" });
      ws.addImage(id, { tl: { col: 0.15, row: 1.1 }, ext: { width: 150, height: 58 } });
    }
    const t = ws.getCell("H2");
    t.value = `Bon de Commande ${c.campaign.key}`;
    t.font = { bold: true, size: 16, color: { argb: TEAL } };
    t.alignment = { horizontal: "right" };
    ws.getCell("K3").value = `Tarifs ${year}`;
    ws.getCell("K3").alignment = { horizontal: "right" };
    ws.getCell("K3").font = { color: { argb: MUTED } };

    const label = (cell: string, text: string, value: any) => {
      ws.getCell(cell).value = text; ws.getCell(cell).font = { bold: true };
      const v = ws.getCell(cell.replace(/^[A-Z]/, "E")); v.value = value;
    };
    label("D3", "Code client :", cl.code || "");
    label("D4", "Libellé client :", cl.name);
    ws.getCell("D5").value = "Remise client (%)"; ws.getCell("D5").font = { bold: true };
    ws.getCell("E5").value = cl.discount / 100; ws.getCell("E5").numFmt = "0%";
    ws.getCell("E5").fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_SOFT } };
    ws.getCell("G5").value = c.chosen ? `Variante conseillée : ${c.chosen.name}` : "";
    ws.getCell("G5").font = { italic: true, color: { argb: MUTED }, size: 9 };

    const head = ws.getRow(7);
    head.values = ["", "Code article", "Désignation", "Code EAN", "PU HT €", "PPC TTC €", `Achats ${year - 1}`, "Proposition commerciale",
      "Date de livraison 1\n…… / …… / ……", "Date de livraison 2\n…… / …… / ……", "Total Remisé HT €"];
    head.height = 36;
    head.eachCell((cell, col) => {
      if (col === 1) return;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = box;
    });

    let r = 8;
    const first = r;
    for (const p of c.products) {
      const row = ws.getRow(r);
      row.values = ["", Number(p.code) || p.code, p.name, p.ean ? (Number(p.ean) || p.ean) : "", p.price, p.ppc || null, p.n1 || 0, p.proposal || 0, p.proposal || null, null];
      ws.getCell(`K${r}`).value = { formula: `((E${r}*I${r})+(E${r}*J${r}))*(1-$E$5)` } as any;
      for (const col of ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]) {
        const cell = ws.getCell(`${col}${r}`);
        cell.border = box;
        cell.alignment = { vertical: "middle", horizontal: col === "C" ? "left" : "center", wrapText: col === "C" };
      }
      ["E", "F", "K"].forEach(col => { ws.getCell(`${col}${r}`).numFmt = EUR; });
      ws.getCell(`D${r}`).numFmt = "0";
      ws.getCell(`H${r}`).font = { bold: true, color: { argb: TEAL } };
      // Photo du produit dans la colonne A (ligne haute, comme sur les BDC d'origine).
      const img = images?.products.get(p.product.id);
      const ext = img ? imgExt(img.b64) : null;
      if (img && ext) {
        row.height = 82;
        const box = 100, k = Math.min(box / img.w, box / img.h);
        const w = Math.round(img.w * k), h = Math.round(img.h * k);
        const id = wb.addImage({ base64: img.b64, extension: ext });
        // Centrée dans la colonne A (≈ 145 px de large).
        ws.addImage(id, { tl: { col: Math.max(0, (145 - w) / 2) / 145, row: r - 1 + 0.06 }, ext: { width: w, height: h } });
      } else row.height = 30;
      ws.getCell(`I${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_SOFT } };
      ws.getCell(`J${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL_SOFT } };
      r++;
    }
    const last = Math.max(first, r - 1);
    const tot = ws.getRow(r);
    ws.getCell(`D${r}`).value = "TOTAL";
    for (const col of ["G", "H", "I", "J", "K"]) ws.getCell(`${col}${r}`).value = { formula: `SUM(${col}${first}:${col}${last})` } as any;
    tot.eachCell(cell => { cell.font = { bold: true }; cell.border = box; });
    ws.getCell(`K${r}`).numFmt = EUR;
    r += 2;

    if (c.kit.length) {
      ws.getCell(`C${r}`).value = "Éléments kit offert";
      ws.getCell(`C${r}`).font = { bold: true, color: { argb: TEAL } };
      r++;
      for (const k of c.kit) {
        ws.getCell(`B${r}`).value = Number(k.code) || k.code;
        ws.getCell(`C${r}`).value = k.name;
        ws.getCell(`B${r}`).alignment = { horizontal: "center" };
        r++;
      }
      r++;
    }
    ws.mergeCells(`G${r}:J${r}`);
    ws.getCell(`G${r}`).value = `TOTAL REMISÉ ${c.campaign.key.toUpperCase()} HT €`;
    ws.getCell(`G${r}`).alignment = { horizontal: "right" };
    ws.getCell(`G${r}`).font = { bold: true };
    ws.getCell(`K${r}`).value = { formula: `K${last + 1}` } as any;
    ws.getCell(`K${r}`).numFmt = EUR;
    ws.getCell(`K${r}`).font = { bold: true, color: { argb: TEAL } };
    ws.getCell(`K${r}`).border = box;
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
