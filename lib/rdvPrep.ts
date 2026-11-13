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
  const tlm = await templateLineMeta(session);
  const templates: any[] = await odoo.searchRead(session, "sale.order.template", [], ["id", "name", "sale_order_template_line_ids"], 0).catch(() => []);
  const tplOf = (c: MeaCampaign) => templates.filter(t => fold(String(t.name || "")).startsWith(fold(c.key)) && !/implantation/i.test(String(t.name)));
  const usedTpl = active.flatMap(tplOf);
  const lineIds = usedTpl.flatMap(t => t.sale_order_template_line_ids || []);
  const tLines: any[] = lineIds.length ? await odoo.searchRead(session, "sale.order.template.line", [["id", "in", lineIds]],
    ["id", "product_id", "product_uom_qty", "display_type", "sequence", ...(tlm.discount ? [tlm.discount] : []), ...(tlm.freeType ? [tlm.freeType] : [])], 0, "sequence, id") : [];
  const productIds = Array.from(new Set(tLines.map(l => m2oId(l.product_id)).filter(Boolean))) as number[];
  const products: any[] = productIds.length ? await odoo.searchRead(session, "product.product", [["id", "in", productIds]],
    ["id", "name", "default_code", "barcode", "lst_price", "product_tmpl_id", ...await optionalProductFields(session)], 0) : [];
  const pMap = new Map<number, any>(products.map(p => [p.id, p]));

  // ── Achats du client sur ces produits : N-1 (année complète) et N (à date) ──
  const [n1Map, nMap] = productIds.length ? await Promise.all([
    qtyByProduct(session, family, `${y - 1}-01-01`, `${y - 1}-12-31`, productIds),
    qtyByProduct(session, family, `${y}-01-01`, todayN, productIds),
  ]) : [new Map(), new Map()];

  const prepCampaigns: PrepCampaign[] = active.map(c => {
    const t = taken.get(c.key);
    const tpls = tplOf(c);
    const linesOf = (tpl: any) => tLines.filter(l => (tpl.sale_order_template_line_ids || []).includes(l.id) && l.product_id && !l.display_type);
    const isKit = (l: any) => (tlm.discount ? Number(l[tlm.discount]) || 0 : 0) >= 99.99 || !!(tlm.freeType && l[tlm.freeType]);
    const variants: PrepVariant[] = tpls.map(tpl => ({
      id: tpl.id, name: String(tpl.name),
      total: linesOf(tpl).filter(l => !isKit(l)).reduce((s, l) => s + (Number(l.product_uom_qty) || 0), 0),
    })).sort((a, b) => a.total - b.total);

    // Produits mis en avant (union des variantes, ordre du modèle) et kit offert.
    const seen = new Set<number>(); const kitSeen = new Set<number>();
    const prodLines: any[] = []; const kit: { code: string; name: string }[] = [];
    for (const tpl of tpls) for (const l of linesOf(tpl)) {
      const pid = m2oId(l.product_id)!; const p = pMap.get(pid); if (!p) continue;
      if (isKit(l)) { if (!kitSeen.has(pid)) { kitSeen.add(pid); kit.push({ code: String(p.default_code || ""), name: String(p.name) }); } continue; }
      if (!seen.has(pid)) { seen.add(pid); prodLines.push(p); }
    }
    const n1Total = prodLines.reduce((s, p) => s + (n1Map.get(p.id)?.qty || 0), 0);

    // Variante conseillée : la plus grande que les achats N-1 du client atteignent ;
    // sans historique, la plus petite.
    const withTotal = variants.filter(v => v.total > 0);
    const reach = withTotal.filter(v => v.total <= n1Total);
    const chosen = reach.length ? reach[reach.length - 1] : withTotal[0] || null;
    const chosenTpl = chosen ? tpls.find(tp => tp.id === chosen.id) : null;
    const tplQty = (pid: number) => chosenTpl ? linesOf(chosenTpl).filter(l => m2oId(l.product_id) === pid && !isKit(l)).reduce((s, l) => s + (Number(l.product_uom_qty) || 0), 0) : 0;

    let reason: string;
    const prods: PrepProduct[] = prodLines.map(p => {
      const { code, name } = splitCode(String(p.name || ""));
      return {
        product: p, code: String(p.default_code || code), name: name.replace(/​/g, ""), ean: String(p.barcode || ""),
        price: Number(p.lst_price) || 0, ppc: ppcOf(p), templateQty: tplQty(p.id),
        n1: n1Map.get(p.id)?.qty || 0, n: nMap.get(p.id)?.qty || 0, proposal: 0,
      };
    });
    if (chosen && n1Total > 0) {
      // Palier de la variante réparti selon ce que le client achète (son mix N-1).
      prods.forEach(x => { x.proposal = snap(x.product, (chosen.total * x.n1) / n1Total); });
      let diff = chosen.total - prods.reduce((s, x) => s + x.proposal, 0);
      const byN1 = [...prods].sort((a, b) => b.n1 - a.n1);
      for (let i = 0; diff > 0 && i < 200; i++) { const x = byN1[i % byN1.length]; const st = saleStep(x.product); x.proposal += st; diff -= st; }
      reason = `Variante « ${chosen.name.slice(chosen.name.lastIndexOf(" - ") + 3) || chosen.name} » (${chosen.total} u.) : le client a acheté ${Math.round(n1Total)} u. de ces produits en ${y - 1}, réparties selon ses achats.`;
    } else if (chosen) {
      prods.forEach(x => { x.proposal = x.templateQty; });
      reason = `Pas d'achat de ces produits en ${y - 1} : quantités du palier d'entrée (${chosen.total} u.).`;
    } else {
      prods.forEach(x => { x.proposal = snap(x.product, x.n1); });
      reason = n1Total > 0 ? `Quantités achetées en ${y - 1} (pas de palier dans le modèle).` : `Pas d'historique ni de palier : à compléter.`;
    }
    return {
      campaign: c, status: t?.state || "todo", orders: t?.orders || [], variantsTaken: t?.variants || [],
      plan: plans.get(planKey(c.key, client.id)) || null,
      variants, chosen, reason, products: prods, kit,
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
