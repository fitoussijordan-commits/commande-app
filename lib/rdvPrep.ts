// lib/rdvPrep.ts
// Préparation de RDV (demande des DC) : pour un client, en un coup d'œil
//   • CA à date N / N-1 (champs Odoo, comme la fiche client) ;
//   • offres du cycle (campagnes MEA actives) : faites / en devis / à faire,
//     avec l'offre prévue et la note ;
//   • pour les offres à faire : quantités proposées par produit, d'après les
//     achats N-1 du client et les paliers (variantes) des modèles de devis ;
//   • plus grosses baisses par produit (quantités à date N vs N-1).
import * as odoo from "@/lib/odoo";
import { resolveClientFamily } from "@/lib/perimes";
import { caDateFields } from "@/lib/salesStats";
import { loadCampaigns, clientPlans, planKey, type MeaCampaign, type Plan, type TrackingModel } from "@/lib/meaTracking";
import { templateLineMeta } from "@/lib/orderOffers";
import { optionalProductFields, saleStep, ppcOf } from "@/lib/productFields";

export interface PrepProduct {
  product: any;
  code: string; name: string; ean: string;
  price: number;          // PU HT catalogue
  ppc: number;            // prix public conseillé TTC (0 si inconnu)
  templateQty: number;    // quantité du modèle (variante conseillée)
  n1: number;             // achats N-1 (année civile précédente)
  n: number;              // achats depuis le 1er janvier
  proposal: number;       // proposition commerciale
}
export interface PrepVariant { id: number; name: string; total: number }
export interface PrepCampaign {
  campaign: MeaCampaign;
  status: "pris" | "devis" | "todo";
  orders: string[]; variantsTaken: string[];
  plan: Plan | null;
  variants: PrepVariant[];
  chosen: PrepVariant | null;      // variante conseillée
  reason: string;                  // pourquoi cette proposition
  products: PrepProduct[];
  kit: { code: string; name: string }[];
}
export interface ProductTrend { product: any; code: string; name: string; n1: number; n: number; diff: number; amountN1: number; amountN: number }
export interface RdvPrep {
  ca: { n: number | null; n1: number | null };
  discount: number;                // remise client (%) lue dans le nom du tarif
  pricelist: string | null;
  campaigns: PrepCampaign[];
  drops: ProductTrend[];
  tracking: TrackingModel | null;
  family: number[];
}

const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const m2oId = (v: any): number | null => (Array.isArray(v) ? Number(v[0]) : null);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Remise client lue dans le nom du tarif : « Tarif 2026 17% (EUR) » → 17.
export function pricelistDiscount(name: string | null | undefined): number {
  const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(String(name || ""));
  return m ? Number(m[1].replace(",", ".")) : 0;
}

// Quantités vendues par produit sur une période (commandes confirmées).
async function qtyByProduct(session: odoo.OdooSession, family: number[], from: string, to: string, productIds?: number[]) {
  const domain: any[] = [["order_id.partner_id", "child_of", family], ["order_id.state", "in", ["sale", "done"]],
    ["order_id.date_order", ">=", `${from} 00:00:00`], ["order_id.date_order", "<=", `${to} 23:59:59`], ["product_id", "!=", false]];
  if (productIds) domain.push(["product_id", "in", productIds]);
  const rows: any[] = await odoo.searchRead(session, "sale.order.line", domain, ["product_id", "product_uom_qty", "price_subtotal"], 0);
  const out = new Map<number, { qty: number; amount: number; label: string }>();
  for (const r of rows) {
    const id = m2oId(r.product_id); if (!id) continue;
    const cur = out.get(id) || { qty: 0, amount: 0, label: String(r.product_id[1]) };
    cur.qty += Number(r.product_uom_qty) || 0; cur.amount += Number(r.price_subtotal) || 0;
    out.set(id, cur);
  }
  return out;
}

function splitCode(label: string) {
  const m = /^\s*\[([^\]]+)\]\s*([\s\S]*)$/.exec(label);
  return m ? { code: m[1], name: m[2] } : { code: "", name: label };
}
const snap = (p: any, q: number) => { const s = saleStep(p); return q <= 0 ? 0 : Math.max(s, Math.round(q / s) * s); };

// ── Modèles de devis d'une campagne → produits mis en avant, kit, variantes ──
export interface TemplateCtx { tLines: any[]; tlm: { discount?: string; freeType?: string }; pMap: Map<number, any>; templates: any[] }
export interface CampaignBase { campaign: MeaCampaign; variants: PrepVariant[]; tpls: any[]; prodLines: any[]; kit: { code: string; name: string }[]; linesOf: (tpl: any) => any[]; isKit: (l: any) => boolean }

export const templatesOf = (templates: any[], c: MeaCampaign) =>
  templates.filter(t => fold(String(t.name || "")).startsWith(fold(c.key)) && !/implantation/i.test(String(t.name)));

export function campaignBase(ctx: TemplateCtx, c: MeaCampaign): CampaignBase {
  const tpls = templatesOf(ctx.templates, c);
  const linesOf = (tpl: any) => ctx.tLines.filter(l => (tpl.sale_order_template_line_ids || []).includes(l.id) && l.product_id && !l.display_type);
  const isKit = (l: any) => (ctx.tlm.discount ? Number(l[ctx.tlm.discount]) || 0 : 0) >= 99.99 || !!(ctx.tlm.freeType && l[ctx.tlm.freeType]);
  const variants: PrepVariant[] = tpls.map(tpl => ({
    id: tpl.id, name: String(tpl.name),
    total: linesOf(tpl).filter(l => !isKit(l)).reduce((s, l) => s + (Number(l.product_uom_qty) || 0), 0),
  })).sort((a, b) => a.total - b.total);
  const seen = new Set<number>(); const kitSeen = new Set<number>();
  const prodLines: any[] = []; const kit: { code: string; name: string }[] = [];
  for (const tpl of tpls) for (const l of linesOf(tpl)) {
    const pid = m2oId(l.product_id)!; const p = ctx.pMap.get(pid); if (!p) continue;
    if (isKit(l)) { if (!kitSeen.has(pid)) { kitSeen.add(pid); kit.push({ code: String(p.default_code || ""), name: String(p.name) }); } continue; }
    if (!seen.has(pid)) { seen.add(pid); prodLines.push(p); }
  }
  return { campaign: c, variants, tpls, prodLines, kit, linesOf, isKit };
}

// Proposition : variante la plus grande atteinte par les achats N-1 du client
// (sinon la plus petite), répartie selon son mix d'achats N-1.
export function propose(base: CampaignBase, n1Map: Map<number, { qty: number }>, nMap: Map<number, { qty: number }>, y: number) {
  const { variants, tpls, prodLines, linesOf, isKit } = base;
  const n1Total = prodLines.reduce((s, p) => s + (n1Map.get(p.id)?.qty || 0), 0);
  const withTotal = variants.filter(v => v.total > 0);
  const reach = withTotal.filter(v => v.total <= n1Total);
  const chosen = reach.length ? reach[reach.length - 1] : withTotal[0] || null;
  const chosenTpl = chosen ? tpls.find(tp => tp.id === chosen.id) : null;
  const tplQty = (pid: number) => chosenTpl ? linesOf(chosenTpl).filter(l => m2oId(l.product_id) === pid && !isKit(l)).reduce((s, l) => s + (Number(l.product_uom_qty) || 0), 0) : 0;
  const products: PrepProduct[] = prodLines.map(p => {
    const { code, name } = splitCode(String(p.name || ""));
    return {
      product: p, code: String(p.default_code || code), name: name.replace(/\u200b/g, ""), ean: String(p.barcode || ""),
      price: Number(p.lst_price) || 0, ppc: ppcOf(p), templateQty: tplQty(p.id),
      n1: n1Map.get(p.id)?.qty || 0, n: nMap.get(p.id)?.qty || 0, proposal: 0,
    };
  });
  let reason: string;
  if (chosen && n1Total > 0) {
    products.forEach(x => { x.proposal = snap(x.product, (chosen.total * x.n1) / n1Total); });
    let diff = chosen.total - products.reduce((s, x) => s + x.proposal, 0);
    const byN1 = [...products].sort((a, b) => b.n1 - a.n1);
    for (let i = 0; diff > 0 && i < 200; i++) { const x = byN1[i % byN1.length]; const st = saleStep(x.product); x.proposal += st; diff -= st; }
    reason = `Variante « ${chosen.name.slice(chosen.name.lastIndexOf(" - ") + 3) || chosen.name} » (${chosen.total} u.) : le client a acheté ${Math.round(n1Total)} u. de ces produits en ${y - 1}, réparties selon ses achats.`;
  } else if (chosen) {
    products.forEach(x => { x.proposal = x.templateQty; });
    reason = `Pas d'achat de ces produits en ${y - 1} : quantités du palier d'entrée (${chosen.total} u.).`;
  } else {
    products.forEach(x => { x.proposal = snap(x.product, x.n1); });
    reason = n1Total > 0 ? `Quantités achetées en ${y - 1} (pas de palier dans le modèle).` : `Pas d'historique ni de palier : à compléter.`;
  }
  return { chosen, reason, products };
}

// Contexte des modèles (lignes, articles) pour une liste de campagnes.
export async function loadTemplateCtx(session: odoo.OdooSession, campaigns: MeaCampaign[]): Promise<TemplateCtx> {
  const tlm = await templateLineMeta(session);
  const templates: any[] = await odoo.searchRead(session, "sale.order.template", [], ["id", "name", "sale_order_template_line_ids"], 0).catch(() => []);
  const used = campaigns.flatMap(c => templatesOf(templates, c));
  const lineIds = used.flatMap(t => t.sale_order_template_line_ids || []);
  const tLines: any[] = lineIds.length ? await odoo.searchRead(session, "sale.order.template.line", [["id", "in", lineIds]],
    ["id", "product_id", "product_uom_qty", "display_type", "sequence", ...(tlm.discount ? [tlm.discount] : []), ...(tlm.freeType ? [tlm.freeType] : [])], 0, "sequence, id") : [];
  const productIds = Array.from(new Set(tLines.map(l => m2oId(l.product_id)).filter(Boolean))) as number[];
  const products: any[] = productIds.length ? await odoo.searchRead(session, "product.product", [["id", "in", productIds]],
    ["id", "name", "default_code", "barcode", "lst_price", "product_tmpl_id", ...await optionalProductFields(session)], 0) : [];
  return { tLines, tlm, templates, pMap: new Map<number, any>(products.map(p => [p.id, p])) };
}

// ── BDC en lot (fin de séminaire) : une campagne, plusieurs clients ──────────
// Une seule requête d'historique pour tous les clients (regroupée par société).
export async function loadBatchBdc(session: odoo.OdooSession, campaign: MeaCampaign, clients: any[]) {
  const y = new Date().getFullYear();
  const ctx = await loadTemplateCtx(session, [campaign]);
  const base = campaignBase(ctx, campaign);
  const pids = base.prodLines.map(p => p.id);
  const ids = clients.map(c => c.id);
  const byClient = new Map<number, { n1: Map<number, { qty: number }>; n: Map<number, { qty: number }> }>();
  if (pids.length && ids.length) {
    const rows: any[] = await odoo.searchRead(session, "sale.order.line",
      [["order_id.partner_id.commercial_partner_id", "in", ids], ["order_id.state", "in", ["sale", "done"]],
       ["order_id.date_order", ">=", `${y - 1}-01-01 00:00:00`], ["product_id", "in", pids]],
      ["product_id", "product_uom_qty", "order_id"], 0);
    // Société et date de chaque commande.
    const orderIds = Array.from(new Set(rows.map(r => m2oId(r.order_id)).filter(Boolean))) as number[];
    const orders: any[] = orderIds.length ? await odoo.searchRead(session, "sale.order", [["id", "in", orderIds]], ["id", "date_order", "partner_id"], 0) : [];
    const partnerIds = Array.from(new Set(orders.map(o => m2oId(o.partner_id)).filter(Boolean))) as number[];
    const partners: any[] = partnerIds.length ? await odoo.searchRead(session, "res.partner", [["id", "in", partnerIds]], ["id", "commercial_partner_id"], 0) : [];
    const company = new Map<number, number>(partners.map(p => [p.id, m2oId(p.commercial_partner_id) || p.id]));
    const oInfo = new Map<number, { cid: number; year: number }>(orders.map(o => [o.id, { cid: company.get(m2oId(o.partner_id)!) || m2oId(o.partner_id)!, year: Number(String(o.date_order).slice(0, 4)) }]));
    for (const r of rows) {
      const info = oInfo.get(m2oId(r.order_id)!); if (!info) continue;
      const b = byClient.get(info.cid) || { n1: new Map(), n: new Map() };
      const m = info.year === y ? b.n : info.year === y - 1 ? b.n1 : null; if (!m) continue;
      const pid = m2oId(r.product_id)!;
      m.set(pid, { qty: (m.get(pid)?.qty || 0) + (Number(r.product_uom_qty) || 0) });
      byClient.set(info.cid, b);
    }
  }
  return clients.map(c => {
    const h = byClient.get(c.id) || { n1: new Map(), n: new Map() };
    const { chosen, reason, products } = propose(base, h.n1, h.n, y);
    const pc: PrepCampaign = { campaign, status: "todo", orders: [], variantsTaken: [], plan: null, variants: base.variants, chosen, reason, products, kit: base.kit };
    return { client: c, campaign: pc };
  });
}

export async function loadRdvPrep(session: odoo.OdooSession, client: any): Promise<RdvPrep> {
  const family = await resolveClientFamily(session, client).catch(() => [client.id]);
  const now = new Date(), y = now.getFullYear();
  const todayN = ymd(now);
  const sameDayN1 = new Date(now); sameDayN1.setFullYear(y - 1);

  // ── CA à date (champs Odoo) + tarif ──
  const caF = await caDateFields(session);
  const [cRow] = await odoo.searchRead(session, "res.partner", [["id", "=", client.id]],
    ["property_product_pricelist", ...(caF.n ? [caF.n] : []), ...(caF.n1 ? [caF.n1] : [])], 1);
  const pricelist = Array.isArray(cRow?.property_product_pricelist) ? String(cRow.property_product_pricelist[1]) : null;

  // ── Campagnes du cycle + statut pour ce client ──
  const { campaigns, offersField, offerCampaign, offerRows } = await loadCampaigns(session);
  const active = campaigns.filter(c => c.active);
  const offerIds = active.flatMap(c => c.offers.map(o => o.id));
  const taken = new Map<string, { state: "pris" | "devis"; orders: string[]; variants: string[] }>();
  if (offerIds.length) {
    const orders: any[] = await odoo.searchRead(session, "sale.order",
      [["partner_id", "child_of", family], [offersField, "in", offerIds], ["state", "in", ["draft", "sent", "sale", "done"]]],
      ["name", "state", offersField], 0, "date_order desc");
    const offerName = new Map<number, string>(offerRows.map((r: any) => [r.id, String(r.display_name || "")]));
    for (const o of orders) for (const oid of (o[offersField] || []) as number[]) {
      const key = offerCampaign.get(oid); if (!key) continue;
      const t = taken.get(key) || { state: "devis" as const, orders: [], variants: [] };
      if (o.state === "sale" || o.state === "done") t.state = "pris";
      if (!t.orders.includes(o.name)) t.orders.push(o.name);
      const n = offerName.get(oid) || ""; const v = n.slice(n.lastIndexOf(" - ") + 3) || n;
      if (!t.variants.includes(v)) t.variants.push(v);
      taken.set(key, t);
    }
  }
  const { tracking, plans } = await clientPlans(session, client.id);

  // ── Modèles de devis des campagnes (produits mis en avant + kit) ──
  const { tLines, tlm, templates, pMap } = await loadTemplateCtx(session, active);
  const productIds = Array.from(pMap.keys());

  // ── Achats du client sur ces produits : N-1 (année complète) et N (à date) ──
  const [n1Map, nMap] = productIds.length ? await Promise.all([
    qtyByProduct(session, family, `${y - 1}-01-01`, `${y - 1}-12-31`, productIds),
    qtyByProduct(session, family, `${y}-01-01`, todayN, productIds),
  ]) : [new Map(), new Map()];

  const ctx: TemplateCtx = { tLines, tlm, pMap, templates };
  const prepCampaigns: PrepCampaign[] = active.map(c => {
    const t = taken.get(c.key);
    const base = campaignBase(ctx, c);
    const { chosen, reason, products: prods } = propose(base, n1Map, nMap, y);
    return {
      campaign: c, status: t?.state || "todo", orders: t?.orders || [], variantsTaken: t?.variants || [],
      plan: plans.get(planKey(c.key, client.id)) || null,
      variants: base.variants, chosen, reason, products: prods, kit: base.kit,
    };
  });

  // ── Plus grosses baisses (quantités à date N vs même période N-1) ──
  const [allN1, allN] = await Promise.all([
    qtyByProduct(session, family, `${y - 1}-01-01`, ymd(sameDayN1)),
    qtyByProduct(session, family, `${y}-01-01`, todayN),
  ]);
  const ids = new Set<number>([...Array.from(allN1.keys()), ...Array.from(allN.keys())]);
  const drops: ProductTrend[] = Array.from(ids).map(id => {
    const a = allN1.get(id), b = allN.get(id);
    const { code, name } = splitCode(a?.label || b?.label || "");
    return { product: { id }, code, name, n1: a?.qty || 0, n: b?.qty || 0, diff: (b?.qty || 0) - (a?.qty || 0), amountN1: a?.amount || 0, amountN: b?.amount || 0 };
  }).filter(d => d.diff < 0 && d.amountN1 > 0).sort((p, q) => (p.amountN - p.amountN1) - (q.amountN - q.amountN1)).slice(0, 15);

  return {
    ca: { n: caF.n ? Number(cRow?.[caF.n]) || 0 : null, n1: caF.n1 ? Number(cRow?.[caF.n1]) || 0 : null },
    discount: pricelistDiscount(pricelist), pricelist,
    campaigns: prepCampaigns.sort((a, b) => ({ todo: 0, devis: 1, pris: 2 }[a.status] - { todo: 0, devis: 1, pris: 2 }[b.status])),
    drops, tracking, family,
  };
}
