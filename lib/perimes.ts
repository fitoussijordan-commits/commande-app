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

// ── Barème par statut client ─────────────────────────────────────────────────
// Indexé sur res.partner.x_statut_client_id.
//
// ATTENTION au sens de la colonne « décote » : c'est un COEFFICIENT DE
// RESTITUTION, pas une remise. 0,8 = 80 % du prix payé rendu en valeur de reprise.
// Le tableau le prouve de lui-même : Partenaire vaut 0 avec le RSF le plus bas
// (5 %), Rose vaut 0,8 avec le plus haut (32,5 %) — la colonne monte avec le
// statut. Interprétée comme une remise, Partenaire deviendrait le statut le plus
// généreux, ce qui contredit tout le reste de la grille.
//
//   valeur de reprise = prix payé × taux
//   taux 0  →  aucune reprise (Partenaire)
export interface Bareme { taux: number; rsf: number }

export const BAREME_BY_STATUT: Record<string, Bareme> = {
  partenaire:         { taux: 0,   rsf: 0.05 },
  ambassadeur:        { taux: 0.8, rsf: 0.17 },
  compagnon:          { taux: 0.7, rsf: 0.13 },
  challenger:         { taux: 0.5, rsf: 0.08 },
  naturaliafranchise: { taux: 0.5, rsf: 0.15 },
  lvcfranchise:       { taux: 0.5, rsf: 0.15 },
  biocbon:            { taux: 0.5, rsf: 0.15 },
  sobio:              { taux: 0.5, rsf: 0.15 },
  leauvive:           { taux: 0.5, rsf: 0.15 },
  lcb:                { taux: 0.5, rsf: 0.15 },
  marcelfils:         { taux: 0.5, rsf: 0.15 },
  mybioshop:          { taux: 0.5, rsf: 0.15 },
  elsieambassadeur:   { taux: 0.8, rsf: 0.17 },
  elsiecompagnon:     { taux: 0.8, rsf: 0.13 },
  bourrache:          { taux: 0.5, rsf: 0.225 },
  calendula:          { taux: 0.5, rsf: 0.245 },
  anthyllide:         { taux: 0.7, rsf: 0.275 },
  prunelier:          { taux: 0.7, rsf: 0.295 },
  rose:               { taux: 0.8, rsf: 0.325 },
};

// Statut inconnu → aucune reprise plutôt qu'un taux par défaut inventé. Une
// valeur de reprise fausse partirait en avoir sans que personne ne la remarque.
export const BAREME_INCONNU: Bareme = { taux: 0, rsf: 0 };

// Clé réduite aux lettres et chiffres : absorbe accents, casse, espaces,
// apostrophes droites ou typographiques et esperluettes.
// « Bio C'Bon », « bio c’bon », « BIO C BON » → « biocbon ».
export function statutKey(client: any): string {
  const v = client?.x_statut_client_id;
  const label = Array.isArray(v) ? String(v[1] || "") : "";
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function statutLabel(client: any): string {
  const v = client?.x_statut_client_id;
  return Array.isArray(v) ? String(v[1] || "") : "";
}

export function baremeFor(client: any): Bareme {
  return BAREME_BY_STATUT[statutKey(client)] || BAREME_INCONNU;
}

// Valeur de reprise unitaire.
//
// `source` compte : quand le prix vient d'une facture, il est DÉJÀ net de la
// remise réellement consentie — réappliquer le RSF le décompterait deux fois.
// Le RSF ne sert que de repli, pour estimer ce que le client a payé quand on
// n'a pas retrouvé le lot et qu'on part du prix catalogue.
export function reprisePrice(basePrice: number, b: Bareme, source: PriceSource): number {
  const paid = source === "facture" ? basePrice : basePrice * (1 - b.rsf);
  return Math.max(0, paid * b.taux);
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
