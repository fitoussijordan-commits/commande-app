// lib/invoiceDetail.ts
// Détail d'une facture ou d'un avoir pour l'historique client : en-tête,
// lignes, taxes, paiements et avoirs imputés, pièces jointes (PDF de la
// facture), commande d'origine. Tolère les versions d'Odoo (15 → 17+) : on ne
// lit que les champs présents (fields_get).
import * as odoo from "@/lib/odoo";
import { fieldsOf, only } from "@/lib/orderDetail";

export interface InvLine {
  id: number;
  section: "line_section" | "line_note" | null;
  name: string;
  code: string;
  qty: number;
  uom: string | null;
  priceUnit: number;
  discount: number;
  subtotal: number;      // HT
  total: number | null;  // TTC
  taxes: string[];
}
export interface InvPayment {
  label: string;         // « Paiement », « Avoir FAC/… »…
  date: string | null;
  amount: number;
  journal: string | null;
  ref: string | null;
  isRefund: boolean;
}
export interface InvAttachment { id: number; name: string; mimetype: string; size: number; main: boolean }
export interface InvoiceDetail {
  id: number;
  name: string;
  isRefund: boolean;
  date: string | null;
  due: string | null;
  paymentState: string;
  paymentTerm: string | null;
  paymentRef: string | null;
  ref: string | null;
  origin: string | null;
  originOrderId: number | null;
  reversedOf: { id: number; name: string } | null;
  salesperson: string | null;
  billing: { name: string; lines: string[] } | null;
  shipping: { name: string; lines: string[] } | null;
  untaxed: number; tax: number; total: number; residual: number;
  lines: InvLine[];
  payments: InvPayment[];
  attachments: InvAttachment[];
  narration: string | null;
}

const m2oName = (v: any): string | null => (Array.isArray(v) ? String(v[1]) : null);
const m2oId = (v: any): number | null => (Array.isArray(v) ? Number(v[0]) : null);
function splitCode(label: string): { code: string; name: string } {
  const m = /^\s*\[([^\]]+)\]\s*([\s\S]*)$/.exec(label);
  return m ? { code: m[1], name: m[2] } : { code: "", name: label };
}
const htmlToText = (h: any): string | null => {
  if (!h || typeof h !== "string") return null;
  const t = h.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\n{3,}/g, "\n\n").trim();
  return t || null;
};

async function address(session: odoo.OdooSession, id: number | null) {
  if (!id) return null;
  const [p] = await odoo.searchRead(session, "res.partner", [["id", "=", id]],
    ["name", "parent_name", "street", "street2", "zip", "city", "country_id", "vat"], 1).catch(() => []);
  if (!p) return null;
  return {
    name: [p.parent_name, p.name].filter(Boolean).filter((v: any, i: number, a: any[]) => a.indexOf(v) === i).join(" — "),
    lines: [p.street, p.street2, [p.zip, p.city].filter(Boolean).join(" "),
      p.country_id && !/france/i.test(p.country_id[1]) ? p.country_id[1] : "", p.vat ? `TVA ${p.vat}` : ""].filter(Boolean).map(String),
  };
}

export async function loadInvoiceDetail(session: odoo.OdooSession, moveId: number): Promise<InvoiceDetail> {
  const [mF, lF] = await Promise.all([fieldsOf(session, "account.move"), fieldsOf(session, "account.move.line")]);
  const [m] = await odoo.searchRead(session, "account.move", [["id", "=", moveId]],
    only(mF, ["id", "name", "move_type", "invoice_date", "invoice_date_due", "payment_state", "invoice_payment_term_id",
      "payment_reference", "ref", "invoice_origin", "reversed_entry_id", "invoice_user_id", "partner_id", "partner_shipping_id",
      "amount_untaxed", "amount_tax", "amount_total", "amount_residual", "invoice_payments_widget", "narration",
      "invoice_pdf_report_id", "message_main_attachment_id"]), 1);
  if (!m) throw new Error("Pièce introuvable");

  // Lignes visibles de la facture (produits, rubriques, notes) — pas les lignes
  // de taxe ni de compte client.
  const v16 = "display_type" in lF && !("exclude_from_invoice_tab" in lF);
  const raw: any[] = await odoo.searchRead(session, "account.move.line", [["move_id", "=", moveId]],
    only(lF, ["id", "sequence", "display_type", "product_id", "name", "quantity", "product_uom_id", "price_unit", "discount",
      "price_subtotal", "price_total", "tax_ids", "exclude_from_invoice_tab"]), 0, "sequence, id");
  const visible = raw.filter(l => {
    if ("exclude_from_invoice_tab" in l) return !l.exclude_from_invoice_tab;                 // Odoo ≤ 15
    if (v16) return ["product", "line_section", "line_note"].includes(l.display_type);       // Odoo 16+
    return !!l.product_id;
  });
  const taxIds = Array.from(new Set(visible.flatMap(l => l.tax_ids || [])));
  const taxName = new Map<number, string>();
  if (taxIds.length) {
    const taxes: any[] = await odoo.searchRead(session, "account.tax", [["id", "in", taxIds]], ["id", "name"], 0).catch(() => []);
    for (const t of taxes) taxName.set(t.id, String(t.name));
  }
  const lines: InvLine[] = visible.map(l => {
    const section = l.display_type === "line_section" || l.display_type === "line_note" ? l.display_type : null;
    const { code, name } = splitCode(m2oName(l.product_id) || String(l.name || ""));
    return {
      id: l.id, section, name: section ? String(l.name || "") : name, code,
      qty: Number(l.quantity) || 0, uom: m2oName(l.product_uom_id),
      priceUnit: Number(l.price_unit) || 0, discount: Number(l.discount) || 0,
      subtotal: Number(l.price_subtotal) || 0, total: "price_total" in l ? Number(l.price_total) || 0 : null,
      taxes: (l.tax_ids || []).map((id: number) => taxName.get(id)).filter(Boolean) as string[],
    };
  });

  // Paiements et avoirs imputés (widget de paiement d'Odoo : JSON ou objet selon la version).
  let widget: any = m.invoice_payments_widget;
  if (typeof widget === "string") { try { widget = JSON.parse(widget); } catch { widget = null; } }
  const payments: InvPayment[] = (widget?.content || []).map((c: any) => {
    const ref = c.ref ? String(c.ref) : null;
    const isRefund = !c.account_payment_id && /^(R|AV|RFAC|RINV)|avoir|refund|credit/i.test(`${ref || ""} ${c.name || ""}`);
    return {
      label: isRefund ? "Avoir" : "Paiement",
      date: c.date || null, amount: Number(c.amount) || 0,
      journal: c.journal_name || null, ref, isRefund,
    };
  });

  // Pièces jointes : PDF de la facture en premier.
  const mainId = m2oId(m.invoice_pdf_report_id) || m2oId(m.message_main_attachment_id);
  const att: any[] = await odoo.searchRead(session, "ir.attachment",
    [["res_model", "=", "account.move"], ["res_id", "=", moveId]],
    ["id", "name", "mimetype", "file_size"], 50, "id desc").catch((e: any) => { if (odoo.isNetworkError(e)) throw e; return []; });
  const attachments: InvAttachment[] = att.map(a => ({
    id: a.id, name: String(a.name || "Pièce jointe"), mimetype: String(a.mimetype || ""), size: Number(a.file_size) || 0, main: a.id === mainId,
  })).sort((a, b) => Number(b.main) - Number(a.main) || Number(b.mimetype === "application/pdf") - Number(a.mimetype === "application/pdf"));

  // Commande d'origine (pour ouvrir son détail : livraison, lots, suivi).
  let originOrderId: number | null = null;
  const origin = m.invoice_origin ? String(m.invoice_origin) : null;
  if (origin) {
    const first = origin.split(/[,\s]+/).filter(Boolean)[0];
    const so: any[] = await odoo.searchRead(session, "sale.order", [["name", "=", first]], ["id"], 1).catch(() => []);
    originOrderId = so[0]?.id || null;
  }

  const [billing, shipping] = await Promise.all([
    address(session, m2oId(m.partner_id)),
    m2oId(m.partner_shipping_id) && m2oId(m.partner_shipping_id) !== m2oId(m.partner_id) ? address(session, m2oId(m.partner_shipping_id)) : Promise.resolve(null),
  ]);

  return {
    id: m.id, name: String(m.name), isRefund: m.move_type === "out_refund",
    date: m.invoice_date || null, due: m.invoice_date_due || null,
    paymentState: String(m.payment_state || ""), paymentTerm: m2oName(m.invoice_payment_term_id),
    paymentRef: m.payment_reference ? String(m.payment_reference) : null,
    ref: m.ref ? String(m.ref) : null, origin, originOrderId,
    reversedOf: Array.isArray(m.reversed_entry_id) ? { id: m.reversed_entry_id[0], name: String(m.reversed_entry_id[1]) } : null,
    salesperson: m2oName(m.invoice_user_id),
    billing, shipping,
    untaxed: Number(m.amount_untaxed) || 0, tax: Number(m.amount_tax) || 0, total: Number(m.amount_total) || 0,
    residual: Number(m.amount_residual) || 0,
    lines, payments, attachments, narration: htmlToText(m.narration),
  };
}

// Contenu d'une pièce jointe (base64) → ouverture dans un nouvel onglet ou
// téléchargement. Passe par l'API Odoo : pas besoin d'être connecté à Odoo.
export async function openAttachment(session: odoo.OdooSession, a: InvAttachment): Promise<void> {
  const rows: any[] = await odoo.searchRead(session, "ir.attachment", [["id", "=", a.id]], ["datas"], 1);
  const b64 = rows[0]?.datas;
  if (!b64) throw new Error("Pièce jointe vide");
  const bin = atob(String(b64));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: a.mimetype || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    const link = document.createElement("a");
    link.href = url; link.download = a.name; document.body.appendChild(link); link.click(); link.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
