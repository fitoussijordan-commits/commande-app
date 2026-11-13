// lib/orderDetail.ts
// Détail complet d'une commande pour l'historique client : adresse de
// livraison, lignes (commandé / livré, remises), bons de livraison avec
// transporteur, numéro et lien de suivi, lots livrés.
//
// Les champs dépendent des modules installés (delivery, product_expiry…) et de
// la version d'Odoo (quantity en 17 / qty_done en 16). Demander un champ
// inexistant fait échouer TOUTE la requête : on ne lit que ceux qui existent
// (fields_get, mis en cache par modèle).
import * as odoo from "@/lib/odoo";

const fieldCache = new Map<string, Promise<Record<string, any>>>();
function fieldsOf(session: odoo.OdooSession, model: string): Promise<Record<string, any>> {
  let p = fieldCache.get(model);
  if (!p) {
    p = odoo.callMethod(session, model, "fields_get", [], { attributes: ["type", "relation"] })
      .then((f: any) => f || {})
      .catch((e: any) => { fieldCache.delete(model); if (odoo.isNetworkError(e)) throw e; return {}; });
    fieldCache.set(model, p);
  }
  return p;
}
const only = (fields: Record<string, any>, wanted: string[]) => wanted.filter(f => f === "id" || f in fields);

export interface DetailLine {
  id: number;
  productId: number | null;
  name: string;
  code: string;
  section: "line_section" | "line_note" | null;
  qty: number;
  delivered: number | null;        // null : champ indisponible
  invoiced: number | null;
  priceUnit: number;
  listPrice: number | null;        // prix catalogue (avant tarif client)
  discount: number;                // % de remise sur la ligne
  subtotal: number;                // HT
  free: boolean;                   // gratuité (remise 100 % ou prix 0)
  lots: { name: string; qty: number; expiry?: string }[];
}
export interface DetailPicking {
  id: number;
  name: string;
  state: string;
  isReturn: boolean;
  date: string | null;             // livré le (date_done) ou prévu le (scheduled_date)
  done: boolean;
  carrier: string | null;
  trackingRef: string | null;
  trackingUrl: string | null;
}
export interface OrderDetail {
  ref: string | null;              // référence client
  shipping: { name: string; lines: string[] } | null;
  invoiceSameAsShipping: boolean;
  carrier: string | null;
  pricelist: string | null;
  untaxed: number; tax: number; total: number;
  lines: DetailLine[];
  pickings: DetailPicking[];
  grossCatalog: number | null;     // somme qté × prix catalogue (lignes vendues)
}

// Lien de suivi quand Odoo n'en fournit pas (transporteur sans connecteur).
function guessTrackingUrl(carrier: string | null, ref: string): string | null {
  const c = (carrier || "").toLowerCase();
  const r = encodeURIComponent(ref.trim());
  if (/colissimo|la ?poste|coliposte/.test(c)) return `https://www.laposte.fr/outils/suivre-vos-envois?code=${r}`;
  if (/chronopost/.test(c)) return `https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=${r}`;
  if (/dpd/.test(c)) return `https://trace.dpd.fr/fr/trace/${r}`;
  if (/gls/.test(c)) return `https://gls-group.com/FR/fr/suivi-colis?match=${r}`;
  if (/\bups\b/.test(c)) return `https://www.ups.com/track?tracknum=${r}`;
  if (/dhl/.test(c)) return `https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=${r}`;
  // TNT : bon de transport de 16 chiffres en France (tnt.fr), 9 à l'international (tnt.com).
  if (/\btnt\b/.test(c)) return /^\d{9}$/.test(ref.trim())
    ? `https://www.tnt.com/express/fr_fr/site/outils-expedition/suivi.html?searchType=con&cons=${r}`
    : `https://www.tnt.fr/public/suivi_colis/recherche/visubontransport.do?bonTransport=${r}`;
  if (/fedex/.test(c)) return `https://www.fedex.com/fedextrack/?trknbr=${r}`;
  if (/geodis/.test(c)) return `https://geodis.com/fr/suivi?tracking=${r}`;
  if (/schenker/.test(c)) return `https://www.dbschenker.com/app/tracking-public/?refNumber=${r}`;
  return null;
}

const m2oName = (v: any): string | null => (Array.isArray(v) ? String(v[1]) : null);
const m2oId = (v: any): number | null => (Array.isArray(v) ? Number(v[0]) : null);
// « [1011059] Coffret Noël » → code + nom
function splitCode(label: string): { code: string; name: string } {
  const m = /^\s*\[([^\]]+)\]\s*(.*)$/.exec(label);
  return m ? { code: m[1], name: m[2] } : { code: "", name: label };
}

export async function loadOrderDetail(session: odoo.OdooSession, orderId: number): Promise<OrderDetail> {
  const [soF, solF, pickF, mlF] = await Promise.all([
    fieldsOf(session, "sale.order"), fieldsOf(session, "sale.order.line"),
    fieldsOf(session, "stock.picking"), fieldsOf(session, "stock.move.line"),
  ]);

  const [so] = await odoo.searchRead(session, "sale.order", [["id", "=", orderId]],
    only(soF, ["id", "client_order_ref", "partner_id", "partner_shipping_id", "partner_invoice_id", "carrier_id", "pricelist_id",
      "amount_untaxed", "amount_tax", "amount_total"]), 1);
  if (!so) throw new Error("Commande introuvable");

  const rawLines: any[] = await odoo.searchRead(session, "sale.order.line", [["order_id", "=", orderId]],
    only(solF, ["id", "sequence", "display_type", "product_id", "name", "product_uom_qty", "qty_delivered", "qty_invoiced",
      "price_unit", "price_subtotal", "discount"]), 500, "sequence, id");

  // Pickings de la commande (livraisons et retours).
  const pickings: any[] = "sale_id" in pickF
    ? await odoo.searchRead(session, "stock.picking", [["sale_id", "=", orderId], ["state", "!=", "cancel"]],
        only(pickF, ["id", "name", "state", "date_done", "scheduled_date", "carrier_id", "carrier_tracking_ref", "carrier_tracking_url", "picking_type_code"]),
        50, "id")
    : [];

  // Lots livrés (lignes de mouvement terminées des livraisons sortantes).
  const qtyField = "quantity" in mlF ? "quantity" : "qty_done" in mlF ? "qty_done" : null;
  const outIds = pickings.filter(p => p.picking_type_code !== "incoming").map(p => p.id);
  // Clé de regroupement : la ligne de commande (stock.move.sale_line_id) quand
  // on la connaît — un même article vendu ET offert a deux lignes — sinon l'article.
  const lotsByKey = new Map<string, Map<string, { name: string; qty: number; lotId: number | null }>>();
  if (outIds.length && qtyField && "lot_id" in mlF) {
    const mls: any[] = await odoo.searchRead(session, "stock.move.line",
      [["picking_id", "in", outIds], ["state", "=", "done"], ["lot_id", "!=", false]],
      ["product_id", "lot_id", "move_id", qtyField], 1000).catch((e: any) => { if (odoo.isNetworkError(e)) throw e; return []; });
    const lineOfMove = new Map<number, number>();
    const moveIds = Array.from(new Set(mls.map(ml => m2oId(ml.move_id)).filter(Boolean))) as number[];
    if (moveIds.length) {
      const moves: any[] = await odoo.searchRead(session, "stock.move", [["id", "in", moveIds]], ["id", "sale_line_id"], 0)
        .catch((e: any) => { if (odoo.isNetworkError(e)) throw e; return []; });
      for (const m of moves) { const sl = m2oId(m.sale_line_id); if (sl) lineOfMove.set(m.id, sl); }
    }
    for (const ml of mls) {
      const pid = m2oId(ml.product_id); const lot = m2oName(ml.lot_id);
      if (!pid || !lot) continue;
      const sl = lineOfMove.get(m2oId(ml.move_id) || 0);
      const key = sl ? `l${sl}` : `p${pid}`;
      const byLot = lotsByKey.get(key) || new Map();
      const cur = byLot.get(lot) || { name: lot, qty: 0, lotId: m2oId(ml.lot_id) };
      cur.qty += Number(ml[qtyField]) || 0;
      byLot.set(lot, cur);
      lotsByKey.set(key, byLot);
    }
  }
  // Dates de péremption des lots (module product_expiry), si disponibles.
  const expiry = new Map<number, string>();
  const lotModel = mlF.lot_id?.relation as string | undefined;
  const lotIds = Array.from(lotsByKey.values()).flatMap(m => Array.from(m.values()).map(l => l.lotId)).filter(Boolean) as number[];
  if (lotModel && lotIds.length) {
    const lotF = await fieldsOf(session, lotModel).catch(() => ({} as Record<string, any>));
    const expField = ["expiration_date", "use_date", "life_date"].find(f => f in lotF);
    if (expField) {
      const lots: any[] = await odoo.searchRead(session, lotModel, [["id", "in", lotIds]], ["id", expField], 0).catch(() => []);
      for (const l of lots) if (l[expField]) expiry.set(l.id, String(l[expField]).slice(0, 10));
    }
  }

  // Prix catalogue des articles (pour chiffrer la remise du tarif client).
  const productIds = Array.from(new Set(rawLines.map(l => m2oId(l.product_id)).filter(Boolean))) as number[];
  const listPrice = new Map<number, number>();
  if (productIds.length) {
    const prods: any[] = await odoo.searchRead(session, "product.product", [["id", "in", productIds]], ["id", "lst_price"], 0)
      .catch((e: any) => { if (odoo.isNetworkError(e)) throw e; return []; });
    for (const p of prods) listPrice.set(p.id, Number(p.lst_price) || 0);
  }

  const lines: DetailLine[] = rawLines.map(l => {
    const pid = m2oId(l.product_id);
    const label = m2oName(l.product_id) || String(l.name || "");
    const { code, name } = splitCode(label);
    const section = l.display_type === "line_section" || l.display_type === "line_note" ? l.display_type : null;
    const priceUnit = Number(l.price_unit) || 0;
    const discount = Number(l.discount) || 0;
    const lots = pid ? Array.from((lotsByKey.get(`l${l.id}`) || lotsByKey.get(`p${pid}`))?.values() || []).map(x => ({ name: x.name, qty: x.qty, expiry: x.lotId ? expiry.get(x.lotId) : undefined })) : [];
    return {
      id: l.id, productId: pid, name: section ? String(l.name || "") : name, code, section,
      qty: Number(l.product_uom_qty) || 0,
      delivered: "qty_delivered" in l ? Number(l.qty_delivered) || 0 : null,
      invoiced: "qty_invoiced" in l ? Number(l.qty_invoiced) || 0 : null,
      priceUnit, listPrice: pid ? listPrice.get(pid) ?? null : null, discount,
      subtotal: Number(l.price_subtotal) || 0,
      // Gratuité : remise 100 %, ou prix 0 sur un article qui a un prix catalogue
      // (une MEA « contenant » à 0 € n'est pas un cadeau).
      free: !section && (discount >= 99.99 || (priceUnit === 0 && !!pid && (listPrice.get(pid) || 0) > 0)),
      lots,
    };
  });

  // Adresse de livraison.
  let shipping: OrderDetail["shipping"] = null;
  const shipId = m2oId(so.partner_shipping_id) || m2oId(so.partner_id);
  if (shipId) {
    const [p] = await odoo.searchRead(session, "res.partner", [["id", "=", shipId]],
      ["name", "parent_name", "street", "street2", "zip", "city", "country_id", "phone"], 1).catch(() => []);
    if (p) {
      const title = [p.parent_name, p.name].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" — ");
      shipping = {
        name: title,
        lines: [p.street, p.street2, [p.zip, p.city].filter(Boolean).join(" "),
          p.country_id && !/france/i.test(p.country_id[1]) ? p.country_id[1] : "", p.phone ? `Tél. ${p.phone}` : ""]
          .filter(Boolean).map(String),
      };
    }
  }

  const soCarrier = m2oName(so.carrier_id);
  const sold = lines.filter(l => !l.section && l.productId);
  const grossCatalog = sold.every(l => l.listPrice != null)
    ? sold.reduce((s, l) => s + l.qty * Math.max(l.listPrice || 0, l.priceUnit), 0) : null;

  return {
    ref: so.client_order_ref || null,
    shipping,
    invoiceSameAsShipping: m2oId(so.partner_invoice_id) === shipId,
    carrier: soCarrier,
    pricelist: m2oName(so.pricelist_id),
    untaxed: Number(so.amount_untaxed) || 0, tax: Number(so.amount_tax) || 0, total: Number(so.amount_total) || 0,
    lines,
    grossCatalog,
    pickings: pickings.map(p => {
      const carrier = m2oName(p.carrier_id) || soCarrier;
      const ref = p.carrier_tracking_ref ? String(p.carrier_tracking_ref) : null;
      return {
        id: p.id, name: String(p.name), state: String(p.state),
        isReturn: p.picking_type_code === "incoming",
        done: p.state === "done",
        date: p.state === "done" ? (p.date_done || null) : (p.scheduled_date || null),
        carrier, trackingRef: ref,
        // TNT : le lien fourni par Odoo ne mène pas au suivi, on construit le nôtre.
        trackingUrl: ref && /\btnt\b/i.test(carrier || "") ? guessTrackingUrl(carrier, ref)
          : (p.carrier_tracking_url ? String(p.carrier_tracking_url) : null) || (ref ? guessTrackingUrl(carrier, ref) : null),
      };
    }),
  };
}
