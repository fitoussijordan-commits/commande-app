// lib/perimes.ts
// Retour de produits périmés : un seul BC contenant les produits repris en
// quantité NÉGATIVE (la « réduction ») et les produits d'échange en positif,
// plus un mouvement de stock vers un emplacement rebut au nom du commercial.
//
// Tout passe par JSON-RPC avec la session du commercial — aucune route dédiée,
// aucun compte technique. Si Odoo refuse la création d'emplacement ou de
// réception faute de droits stock, le BC est quand même créé : c'est la partie
// qui compte, le rangement physique peut être fait par l'entrepôt.

import * as odoo from "@/lib/odoo";

const MONTHS_FR = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

// D'où vient le prix affiché sur une ligne de reprise — l'UI doit le montrer,
// un prix estimé ne doit jamais passer pour un prix facturé.
export type PriceSource = "facture" | "catalogue" | "manuel";

export interface PerimeLine {
  product: any;
  qty: number;
  unitPrice: number;   // prix de reprise unitaire = prix payé × (1 − décote)
  basePrice: number;   // prix payé par le client, AVANT décote
  source: PriceSource;
  invoiceDate?: string;
  lot?: string;
}

// ── Barème de décote ─────────────────────────────────────────────────────────
// Taux par statut client (res.partner.x_statut_client_id). À remplacer par les
// valeurs réelles dès réception du barème — un seul endroit à modifier.
//
// Convention retenue : le taux est la FRACTION RETENUE sur le prix payé.
//   prix de reprise = prix payé × (1 − taux)
// Un taux de 0 signifie donc reprise à 100 % du prix payé.
export const DEFAULT_DECOTE = 0;

export const DECOTE_BY_STATUT: Record<string, number> = {
  // "ambassadeur": 0.2,
  // "compagnon": 0.3,
};

export function statutKey(client: any): string {
  const v = client?.x_statut_client_id;
  const label = Array.isArray(v) ? String(v[1] || "") : "";
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function decoteFor(client: any): number {
  const k = statutKey(client);
  return k && k in DECOTE_BY_STATUT ? DECOTE_BY_STATUT[k] : DEFAULT_DECOTE;
}

export function reprisePrice(basePrice: number, decote: number): number {
  return Math.max(0, basePrice * (1 - decote));
}

// ── Prix réellement payé par le client, retrouvé par le numéro de lot ────────
// Le lot vit sur stock.move.line, le prix négocié sur sale.order.line. Le pont
// entre les deux est stock.move.sale_line_id.
//
// Renvoie null si ce lot n'a jamais été livré à ce client : l'appelant bascule
// alors sur le prix catalogue, en le signalant.
export async function findPaidPriceByLot(
  session: odoo.OdooSession,
  clientId: number,
  productId: number,
  lot: string,
): Promise<{ netUnit: number; date: string } | null> {
  const wanted = normalizeLot(lot);
  if (!wanted) return null;

  // 1. Mouvements sortants livrés de ce produit vers ce client, portant un lot.
  const mls = await odoo.searchRead(session, "stock.move.line",
    [["picking_id.partner_id", "=", clientId],
     ["product_id", "=", productId],
     ["state", "=", "done"],
     ["lot_id", "!=", false]],
    ["lot_id", "move_id", "date"], 200, "date desc");

  const hits = mls.filter((m: any) => normalizeLot(m.lot_id?.[1] || "") === wanted);
  if (!hits.length) return null;

  // 2. Ligne de vente d'origine → prix unitaire net de remise.
  const moveIds = hits.map((m: any) => m.move_id?.[0]).filter(Boolean);
  if (!moveIds.length) return null;

  const moves = await odoo.searchRead(session, "stock.move",
    [["id", "in", moveIds]], ["id", "sale_line_id"], moveIds.length);
  const saleLineIds = moves.map((m: any) => m.sale_line_id?.[0]).filter(Boolean);
  if (!saleLineIds.length) return null;

  const sols = await odoo.searchRead(session, "sale.order.line",
    [["id", "in", saleLineIds]], ["id", "price_unit", "discount"], saleLineIds.length);
  if (!sols.length) return null;

  // Plusieurs livraisons du même lot → on prend la plus récente.
  const byMove = new Map<number, any>(moves.map((m: any) => [m.id, m]));
  const bySol = new Map<number, any>(sols.map((s: any) => [s.id, s]));
  for (const h of hits) {
    const mv = byMove.get(h.move_id?.[0]);
    const sol = mv?.sale_line_id?.[0] ? bySol.get(mv.sale_line_id[0]) : null;
    if (!sol) continue;
    const net = (sol.price_unit || 0) * (1 - (sol.discount || 0) / 100);
    return { netUnit: net, date: String(h.date || "").slice(0, 10) };
  }
  return null;
}

// Un lot saisi « ab-123 » doit retrouver « AB-123 ».
export function normalizeLot(s: string): string {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
}

export interface ExchangeLine {
  product: any;
  qty: number;
  unitPrice: number;
}

// Nom de l'emplacement : « Rebut Caroline 2026 Mars ».
export function rebutLocationName(repName: string, d = new Date()): string {
  const clean = (repName || "Commercial").trim().replace(/\s+/g, " ");
  return `Rebut ${clean} ${d.getFullYear()} ${MONTHS_FR[d.getMonth()]}`;
}

// Cherche l'emplacement du mois, le crée s'il manque. Renvoie null si le
// commercial n'a pas les droits stock (AccessError) — le flux continue sans.
export async function resolveRebutLocation(
  session: odoo.OdooSession,
  repName: string,
): Promise<number | null> {
  const name = rebutLocationName(repName);
  try {
    const found = await odoo.searchRead(session, "stock.location",
      [["name", "=", name], ["usage", "=", "internal"]], ["id"], 1);
    if (found.length) return found[0].id;

    // Parent : la branche « Rebut » si elle existe, sinon l'emplacement de stock
    // interne par défaut. On ne crée pas la racine à la volée.
    let parentId: number | null = null;
    const rebut = await odoo.searchRead(session, "stock.location",
      [["name", "=", "Rebut"], ["usage", "=", "internal"]], ["id"], 1);
    if (rebut.length) parentId = rebut[0].id;

    return await odoo.create(session, "stock.location", {
      name,
      usage: "internal",
      ...(parentId ? { location_id: parentId } : {}),
    });
  } catch {
    return null;
  }
}

// Réception des produits repris vers l'emplacement rebut.
// `localRef` sert de clé anti-doublon : on ne crée rien si un picking porte déjà
// cette origine (rejeu de la file de synchro après coupure réseau).
export async function createRebutPicking(
  session: odoo.OdooSession,
  opts: {
    clientId: number; clientName: string; repName: string;
    locationId: number; lines: PerimeLine[]; localRef: string;
  },
): Promise<number | null> {
  try {
    const existing = await odoo.searchRead(session, "stock.picking",
      [["origin", "=", opts.localRef]], ["id"], 1);
    if (existing.length) return existing[0].id;

    const types = await odoo.searchRead(session, "stock.picking.type",
      [["code", "=", "incoming"]], ["id", "default_location_src_id"], 1);
    if (!types.length) return null;

    const pickingId = await odoo.create(session, "stock.picking", {
      partner_id: opts.clientId,
      picking_type_id: types[0].id,
      location_dest_id: opts.locationId,
      origin: opts.localRef,
      note: `Retour périmés — ${opts.clientName} — ${opts.repName}`,
    });

    // Mouvements créés séparément avec picking_id : évite le champ one2many du
    // picking, renommé move_lines → move_ids entre Odoo 16 et 17.
    for (const l of opts.lines) {
      await odoo.create(session, "stock.move", {
        name: l.lot ? `${l.product.name} — lot ${l.lot}` : l.product.name,
        product_id: l.product.id,
        product_uom_qty: l.qty,
        picking_id: pickingId,
        location_dest_id: opts.locationId,
      });
    }
    return pickingId;
  } catch {
    return null;
  }
}

// Le BC unique : repris en négatif + échange en positif.
export function buildExchangeOrderPayload(opts: {
  clientId: number; pricelistId: number | false;
  returns: PerimeLine[]; exchanges: ExchangeLine[];
  repName: string; localRef: string; freeType?: string;
}): any {
  const noteLines = opts.returns.map(
    r => `• ${r.product.name}${r.lot ? ` (lot ${r.lot})` : ""} × ${r.qty}`);
  return {
    partner_id: opts.clientId,
    state: "draft",
    ...(opts.pricelistId ? { pricelist_id: opts.pricelistId } : {}),
    client_order_ref: opts.localRef,
    note: [`Retour périmés — ${opts.repName}`, ...noteLines].join("\n"),
    order_line: [
      // Repris : quantité négative → la valeur se déduit du BC.
      ...opts.returns.map(r => [0, 0, {
        product_id: r.product.id,
        product_uom_qty: -Math.abs(r.qty),
        price_unit: r.unitPrice,
        name: r.lot ? `${r.product.name} — RETOUR PÉRIMÉ lot ${r.lot}` : `${r.product.name} — RETOUR PÉRIMÉ`,
      }]),
      // Échange : produits neufs au tarif de l'année en cours.
      ...opts.exchanges.map(e => [0, 0, {
        product_id: e.product.id,
        product_uom_qty: e.qty,
        price_unit: e.unitPrice,
        ...(opts.freeType ? { type_gratuit: opts.freeType } : {}),
      }]),
    ],
  };
}

// Valeur totale des produits repris (positive).
export function returnsValue(lines: PerimeLine[]): number {
  return lines.reduce((s, l) => s + Math.abs(l.qty) * l.unitPrice, 0);
}

export function exchangesValue(lines: ExchangeLine[]): number {
  return lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
}

export function newLocalRef(): string {
  return `PERIM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
