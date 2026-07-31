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
  orderName?: string;   // commande d'origine, pour vérifier un prix douteux
  suspicious?: boolean; // prix retrouvé incohérent avec le catalogue
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
  // Arrondi au centime : ce prix part tel quel dans price_unit d'une ligne de
  // vente. Un 12,11136 € non arrondi produit des écarts de centimes à la facture
  // et s'affiche mal partout.
  return Math.max(0, Math.round(paid * b.taux * 100) / 100);
}

// ── Prix réellement payé par le client, retrouvé par le numéro de lot ────────
// Le lot vit sur stock.move.line, le prix négocié sur sale.order.line. Le pont
// entre les deux est stock.move.sale_line_id.
//
// Renvoie null si ce lot n'a jamais été livré à ce client : l'appelant bascule
// alors sur le prix catalogue, en le signalant.
export async function findPaidPriceByLot(
  session: odoo.OdooSession,
  clientIds: number | number[],
  productId: number,
  lot: string,
): Promise<{ netUnit: number; date: string; orderName: string } | null> {
  const wanted = normalizeLot(lot);
  if (!wanted) return null;

  const family = Array.isArray(clientIds) ? clientIds : [clientIds];
  const mls = await odoo.searchRead(session, "stock.move.line",
    [["picking_id.partner_id", "child_of", family],
     ["product_id", "=", productId],
     ["state", "=", "done"],
     ["lot_id", "!=", false]],
    ["product_id", "lot_id", "move_id", "date"], 200, "date desc");

  // Comparaison normalisée côté JS : le `ilike` d'Odoo ne sait pas ignorer les
  // espaces internes, « AB 123 » doit pourtant retrouver « AB123 ».
  const hits = mls.filter((m: any) => normalizeLot(m.lot_id?.[1] || "") === wanted);
  if (!hits.length) return null;

  const prices = await resolveNetPrices(session, hits.map((h: any) => h.move_id?.[0]));
  for (const h of hits) {          // déjà triés du plus récent au plus ancien
    const p = prices.get(h.move_id?.[0]);
    if (p) return { netUnit: p.netUnit, date: String(h.date || "").slice(0, 10), orderName: p.orderName };
  }
  return null;
}

// Prix unitaire net (remise déduite) de la ligne de vente à l'origine de chaque
// mouvement. Le pont stock → vente est stock.move.sale_line_id.
export interface PaidLine { netUnit: number; gross: number; discount: number; orderName: string }

async function resolveNetPrices(
  session: odoo.OdooSession,
  moveIds: (number | undefined)[],
): Promise<Map<number, PaidLine>> {
  const out = new Map<number, PaidLine>();
  const ids = Array.from(new Set(moveIds.filter((v): v is number => !!v)));
  if (!ids.length) return out;

  const moves = await odoo.searchRead(session, "stock.move",
    [["id", "in", ids]], ["id", "sale_line_id"], ids.length);
  const saleLineIds = Array.from(new Set(
    moves.map((m: any) => m.sale_line_id?.[0]).filter(Boolean)));
  if (!saleLineIds.length) return out;

  // order_id : le n° de commande est indispensable pour vérifier un prix suspect
  // (un testeur « payé 234,62 € » doit pouvoir être retracé en un clic).
  const sols = await odoo.searchRead(session, "sale.order.line",
    [["id", "in", saleLineIds]],
    ["id", "price_unit", "discount", "price_subtotal", "product_uom_qty", "order_id"],
    saleLineIds.length);
  const bySol = new Map<number, any>(sols.map((s: any) => [s.id, s]));

  for (const m of moves) {
    const sol = m.sale_line_id?.[0] ? bySol.get(m.sale_line_id[0]) : null;
    if (!sol) continue;

    // price_subtotal / quantité = prix UNITAIRE réellement payé, remise comprise.
    //
    // On n'utilise plus price_unit directement : selon la façon dont la commande a
    // été saisie, il peut porter le total de la ligne et non le prix à l'unité —
    // d'où un testeur ressorti à 234,62 € au lieu de quelques euros. Le sous-total
    // divisé par la quantité est juste dans les deux cas, et intègre déjà la remise.
    const qty = Number(sol.product_uom_qty) || 0;
    const subtotal = Number(sol.price_subtotal) || 0;
    const gross = Number(sol.price_unit) || 0;
    const discount = Number(sol.discount) || 0;

    const netUnit = qty > 0
      ? subtotal / qty
      : gross * (1 - discount / 100);   // repli : ligne sans quantité exploitable

    out.set(m.id, {
      netUnit: Math.round(netUnit * 100) / 100,
      gross, discount,
      orderName: String(sol.order_id?.[1] || ""),
    });
  }
  return out;
}

// Un prix retrouvé très supérieur au prix catalogue du produit est douteux :
// ligne de vente mal rattachée au mouvement, ou prix exprimé pour un carton.
// On ne l'applique pas en silence.
export function isPaidPriceSuspicious(netUnit: number, lstPrice: number): boolean {
  if (!lstPrice || lstPrice <= 0) return false;
  return netUnit > lstPrice * 2.5;
}

// ── Périmètre client ─────────────────────────────────────────────────────────
// Un même client existe souvent sous PLUSIEURS fiches res.partner : la société,
// ses adresses de livraison, et parfois de vrais doublons créés par import (deux
// fiches sœurs portant le même code). `child_of` seul ne couvre que la première
// famille — une livraison partie sur la fiche jumelle reste invisible.
//
// On élargit donc au CODE CLIENT (`ref`), qui est la clé métier commune aux
// doublons, puis on applique child_of sur toute la famille obtenue.
export async function resolveClientFamily(
  session: odoo.OdooSession,
  client: any,
): Promise<number[]> {
  const ids = new Set<number>([client.id]);
  if (client.parent_id?.[0]) ids.add(client.parent_id[0]);
  const ref = String(client.ref || "").trim();
  if (ref) {
    try {
      const twins = await odoo.searchRead(session, "res.partner",
        [["ref", "=", ref], ["active", "=", true]], ["id"], 20);
      for (const t of twins) ids.add(t.id);
    } catch { /* on garde au moins la fiche courante */ }
  }
  return Array.from(ids);
}

// ── Recherche PAR NUMÉRO DE LOT ──────────────────────────────────────────────
// Le geste terrain : le commercial lit le lot sur le pot périmé et le tape. On
// remonte le produit ET le prix payé en une fois, sans qu'il ait à identifier la
// référence lui-même.
//
// Bornée aux lots réellement livrés À CE CLIENT : un lot vendu ailleurs n'a pas
// à apparaître, et ça garde la requête légère.
export interface LotHit {
  product: any;
  lot: string;
  netUnit: number | null;   // null = ligne de vente introuvable
  date: string;
  orderName: string;
}

export async function searchDeliveredLots(
  session: odoo.OdooSession,
  clientIds: number | number[],
  query: string,
  limit = 20,
): Promise<LotHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  // child_of sur TOUTE la famille de fiches (société, adresses de livraison et
  // doublons partageant le même code) — voir resolveClientFamily.
  const family = Array.isArray(clientIds) ? clientIds : [clientIds];
  const mls = await odoo.searchRead(session, "stock.move.line",
    [["picking_id.partner_id", "child_of", family],
     ["state", "=", "done"],
     ["lot_id", "!=", false],
     ["lot_id.name", "ilike", q]],
    ["product_id", "lot_id", "move_id", "date"], 200, "date desc");
  if (!mls.length) return [];
  return buildLotHits(session, mls, limit);
}

// Où ce lot a-t-il été livré, tous clients confondus ? Sert au diagnostic quand
// la recherche bornée au client ne donne rien : soit il est parti ailleurs, soit
// il est chez une fiche voisine (autre adresse, autre société du groupe).
export interface LotRecipient { id: number; name: string; ref: string }

export interface LotDiagnosis {
  // Fiches PORTANT LE NOM DU CLIENT qui ont reçu ce lot — la seule chose utile :
  // « est-ce une autre fiche de mon client ? »
  sameName: LotRecipient[];
  // Le lot figure sur une livraison NON validée pour ce client.
  pendingStates: string[];
  // Nombre total de livraisons validées de ce lot, tous clients confondus.
  totalDeliveries: number;
}

// Diagnostic ciblé. Lister les destinataires d'un lot de production n'apprend
// rien : il part chez des centaines de clients, et un échantillon arbitraire de
// six noms (les premiers par ordre alphabétique) induit en erreur.
export async function diagnoseLot(
  session: odoo.OdooSession,
  query: string,
  clientName: string,
  family: number[],
): Promise<LotDiagnosis> {
  const q = query.trim();
  const out: LotDiagnosis = { sameName: [], pendingStates: [], totalDeliveries: 0 };

  // 1. Des fiches portant le même nom que le client ont-elles reçu ce lot ?
  try {
    const rows = await odoo.searchRead(session, "stock.move.line",
      [["state", "=", "done"], ["lot_id.name", "ilike", q],
       ["picking_id.partner_id.name", "ilike", clientName]],
      ["picking_id"], 100, "date desc");
    const pids = Array.from(new Set(rows.map((r: any) => r.picking_id?.[0]).filter(Boolean)));
    if (pids.length) {
      const pickings = await odoo.searchRead(session, "stock.picking",
        [["id", "in", pids]], ["partner_id"], pids.length);
      const partnerIds = Array.from(new Set(
        pickings.map((p: any) => p.partner_id?.[0]).filter(Boolean)));
      if (partnerIds.length) {
        const partners = await odoo.searchRead(session, "res.partner",
          [["id", "in", partnerIds]], ["id", "name", "ref"], partnerIds.length);
        out.sameName = partners.map((p: any) => ({
          id: p.id, name: String(p.name || ""), ref: String(p.ref || ""),
        }));
      }
    }
  } catch { /* diagnostic best effort */ }

  // 2. Le lot est-il sur une livraison de CE client encore non validée ? C'est le
  //    cas le plus fréquent quand le commercial « le voit dans une commande ».
  try {
    const pending = await odoo.searchRead(session, "stock.move.line",
      [["state", "!=", "done"], ["lot_id.name", "ilike", q],
       ["picking_id.partner_id", "child_of", family]],
      ["state"], 20);
    out.pendingStates = Array.from(new Set(pending.map((p: any) => String(p.state))));
  } catch { /* idem */ }

  // 3. Volume total, pour dire si le lot est largement diffusé.
  try {
    const all = await odoo.searchRead(session, "stock.move.line",
      [["state", "=", "done"], ["lot_id.name", "ilike", q]], ["id"], 500);
    out.totalDeliveries = all.length;
  } catch { /* idem */ }

  return out;
}

// Le lot existe-t-il dans Odoo, indépendamment du client ? Sert uniquement à
// écrire un message utile : « inconnu dans Odoo » et « jamais livré à ce
// client » appellent des réactions très différentes du commercial.
export async function lotExistsAnywhere(
  session: odoo.OdooSession,
  query: string,
): Promise<boolean> {
  // Le modèle a été renommé stock.production.lot → stock.lot en Odoo 17.
  for (const model of ["stock.lot", "stock.production.lot"]) {
    try {
      const r = await odoo.searchRead(session, model, [["name", "ilike", query.trim()]], ["id"], 1);
      return r.length > 0;
    } catch (e) {
      if (odoo.isNetworkError(e)) throw e;
      // Modèle inexistant sur cette version → on tente l'autre nom.
    }
  }
  return false;
}

async function buildLotHits(
  session: odoo.OdooSession,
  mls: any[],
  limit: number,
): Promise<LotHit[]> {

  // Un même lot a pu partir en plusieurs livraisons : on garde la plus récente,
  // c'est elle qui porte le prix le plus représentatif.
  const seen = new Map<string, any>();
  for (const m of mls) {
    const pid = m.product_id?.[0];
    const lot = String(m.lot_id?.[1] || "");
    if (!pid || !lot) continue;
    const key = `${pid}|${normalizeLot(lot)}`;
    if (!seen.has(key)) seen.set(key, m);
    if (seen.size >= limit) break;
  }
  const rows = Array.from(seen.values());

  const [prices, products] = await Promise.all([
    resolveNetPrices(session, rows.map(r => r.move_id?.[0])),
    odoo.searchRead(session, "product.product",
      [["id", "in", Array.from(new Set(rows.map(r => r.product_id[0])))]],
      ["id", "name", "default_code", "lst_price", "product_tmpl_id"], 0),
  ]);
  const byProduct = new Map<number, any>(products.map((p: any) => [p.id, p]));

  return rows
    .map(r => {
      const product = byProduct.get(r.product_id[0]);
      if (!product) return null;
      const p = prices.get(r.move_id?.[0]);
      return {
        product,
        lot: String(r.lot_id[1]),
        netUnit: p ? p.netUnit : null,
        date: String(r.date || "").slice(0, 10),
        orderName: p?.orderName || "",
      } as LotHit;
    })
    .filter((x): x is LotHit => x !== null);
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
// Renvoie l'id, ou une erreur EXPLICITE. Ne jamais renvoyer null muet : attribuer
// à tort un échec aux « droits manquants » envoie sur une fausse piste.
// Type de l'emplacement rebut. NE PAS mettre "internal" :
//
//   internal  → compte dans le stock disponible ET dans la valorisation au bilan.
//               Les périmés deviendraient du stock vendable, réservables sur une
//               commande, et gonfleraient l'inventaire comptable.
//   inventory → « perte d'inventaire ». Emplacement virtuel : sort de la
//               valorisation et du stock disponible, tout en gardant la traçabilité
//               complète (produit, lot, date, client d'origine, commercial).
//
// C'est la sémantique correcte d'une mise au rebut. Si la comptabilité préfère
// tenir physiquement les périmés avant destruction, repasser à "internal" et
// prévoir un stock.scrap derrière — mais c'est un arbitrage à valider avec eux.
const REBUT_USAGE = "inventory";

export async function resolveRebutLocation(
  session: odoo.OdooSession,
  repName: string,
): Promise<{ id: number } | { error: string }> {
  const name = rebutLocationName(repName);
  try {
    // Sans filtre sur usage : si l'emplacement a été créé en "internal" par une
    // version précédente, on le retrouve quand même pour ne pas en faire un second.
    const found = await odoo.searchRead(session, "stock.location",
      [["name", "=", name]], ["id", "usage", "scrap_location"], 1);

    if (found.length) {
      const loc = found[0];
      // AUTO-RÉPARATION. Un emplacement rebut resté en "internal" fait compter les
      // périmés dans le stock disponible et dans la valorisation. Le corriger ici
      // évite d'avoir à le refaire à la main pour chaque commercial, chaque mois.
      if (loc.usage !== REBUT_USAGE || !loc.scrap_location) {
        try {
          await odoo.write(session, "stock.location", [loc.id],
            { usage: REBUT_USAGE, scrap_location: true });
        } catch (e: any) {
          // Odoo refuse de changer le type d'un emplacement qui contient encore
          // du stock. Il faut le vider avant — on le dit explicitement.
          return { error: `l'emplacement « ${name} » est encore en « interne » et Odoo refuse de le convertir `
            + `(${e?.message || "erreur inconnue"}). Vide-le dans Odoo — Stock → Ajustements d'inventaire, `
            + `mets les quantités à 0 pour cet emplacement — puis relance.` };
        }
      }
      return { id: loc.id };
    }

    // Parent : la branche « Rebut » si elle existe, sinon on crée à la racine.
    let parentId: number | null = null;
    const rebut = await odoo.searchRead(session, "stock.location",
      [["name", "=", "Rebut"]], ["id"], 1);
    if (rebut.length) parentId = rebut[0].id;

    const base = {
      name,
      usage: REBUT_USAGE,
      ...(parentId ? { location_id: parentId } : {}),
    };
    // scrap_location : la case « Est un emplacement de rebut ? » d'Odoo. Elle
    // marque l'emplacement comme destination de mise au rebut, ce qui le sort des
    // flux de réapprovisionnement et le rend explicite en inventaire.
    let id: number;
    try {
      id = await odoo.create(session, "stock.location", { ...base, scrap_location: true });
    } catch (e) {
      if (odoo.isNetworkError(e)) throw e;
      // Champ absent sur cette version : l'emplacement reste valable sans.
      id = await odoo.create(session, "stock.location", base);
    }
    return { id };
  } catch (e: any) {
    return { error: `emplacement « ${name} » : ${e?.message || "erreur inconnue"}` };
  }
}

// Réception des produits repris vers l'emplacement rebut.
// `localRef` sert de clé anti-doublon : on ne crée rien si un picking porte déjà
// cette origine (rejeu de la file de synchro après coupure réseau).
export async function createRebutPicking(
  session: odoo.OdooSession,
  opts: {
    clientId: number; clientName: string; clientRef?: string; repName: string;
    locationId: number; lines: PerimeLine[]; localRef: string;
    orderName?: string;   // n° du BC d'échange, pour le lien croisé
  },
): Promise<{ id: number; name: string; warning?: string } | { error: string }> {
  try {
    // `ilike` et non `=` : origin contient aussi le n° de BC, mais la clé
    // d'idempotence doit rester retrouvable dedans.
    const existing = await odoo.searchRead(session, "stock.picking",
      [["origin", "ilike", opts.localRef]], ["id", "name"], 1);
    if (existing.length) return { id: existing[0].id, name: existing[0].name };

    const types = await odoo.searchRead(session, "stock.picking.type",
      [["code", "=", "incoming"]], ["id", "default_location_src_id"], 1);
    if (!types.length) return { error: "aucun type d'opération « réception » trouvé dans Odoo" };

    // Emplacement SOURCE. Obligatoire sur stock.move : sans lui, Odoo refuse la
    // création (« un champ obligatoire n'est pas défini — Source Location »).
    // Pour une reprise, la marchandise vient de chez le client.
    const srcId = await resolveCustomerLocation(session, opts.clientId, types[0].default_location_src_id?.[0]);
    if (!srcId) return { error: "emplacement source (client) introuvable" };

    // product_uom est lui aussi requis : un create brut ne déclenche pas les
    // onchange qui le rempliraient depuis le produit.
    const uoms = await odoo.searchRead(session, "product.product",
      [["id", "in", Array.from(new Set(opts.lines.map(l => l.product.id)))]],
      ["id", "uom_id"], 0);
    const uomByProduct = new Map<number, number>(
      uoms.map((p: any) => [p.id, p.uom_id?.[0]]).filter((e: any) => e[1]));

    const dateStr = new Date().toLocaleDateString("fr-FR");

    // origin = « Document d'origine » d'Odoo : c'est LE champ qu'un gestionnaire
    // regarde et qui est indexé dans la recherche. On y met le n° de BC, et la
    // clé locale derrière pour l'anti-doublon.
    const origin = [opts.orderName, `Retour périmés`, opts.localRef]
      .filter(Boolean).join(" · ");

    const note = [
      `RETOUR PÉRIMÉS`,
      `Client : ${opts.clientName}${opts.clientRef ? ` (${opts.clientRef})` : ""}`,
      `Commercial : ${opts.repName}`,
      `Date de reprise : ${dateStr}`,
      opts.orderName ? `Échange : BC ${opts.orderName}` : `Échange : BC en attente`,
      ``,
      `Produits repris :`,
      ...opts.lines.map(l =>
        `• ${l.product.name}${l.lot ? ` — lot ${l.lot}` : ""} × ${l.qty}`
        + ` — ${l.source === "facture" ? "payé" : "estimé"} ${l.basePrice.toFixed(2)} €`
        + ` → reprise ${l.unitPrice.toFixed(2)} €`),
    ].join("\n");

    const pickingId = await odoo.create(session, "stock.picking", {
      partner_id: opts.clientId,
      picking_type_id: types[0].id,
      location_id: srcId,
      location_dest_id: opts.locationId,
      origin,
      note,
    });

    // Mouvements créés séparément avec picking_id : évite le champ one2many du
    // picking, renommé move_lines → move_ids entre Odoo 16 et 17.
    // Le libellé de ligne porte lot + BC + date : dans l'entrepôt, on lit la
    // ligne du mouvement, pas la note du transfert.
    // Un stock.move par ligne de reprise → correspondance 1:1 avec son lot.
    const lineByMove = new Map<number, PerimeLine>();
    for (const l of opts.lines) {
      const parts = [l.product.name];
      if (l.lot) parts.push(`lot ${l.lot}`);
      parts.push(`retour périmé ${opts.clientName}`);
      if (opts.orderName) parts.push(`éch. ${opts.orderName}`);
      parts.push(dateStr);
      const uom = uomByProduct.get(l.product.id);
      const moveId = await odoo.create(session, "stock.move", {
        name: parts.join(" — "),
        product_id: l.product.id,
        product_uom_qty: l.qty,
        ...(uom ? { product_uom: uom } : {}),
        picking_id: pickingId,
        location_id: srcId,
        location_dest_id: opts.locationId,
      });
      lineByMove.set(moveId, l);
    }

    const created = await odoo.searchRead(session, "stock.picking",
      [["id", "=", pickingId]], ["name"], 1);
    const name = created[0]?.name || String(pickingId);

    // Sans cette séquence, le transfert reste en BROUILLON et rien n'arrive dans
    // l'emplacement rebut. Et sans lot_name, Odoo refuse la validation d'un
    // produit tracé (« Vous devez fournir un lot/numéro de série »).
    const done = await confirmAndValidate(session, pickingId, lineByMove);
    if (done) return { id: pickingId, name, warning: done };
    return { id: pickingId, name };
  } catch (e: any) {
    return { error: `transfert : ${e?.message || "erreur inconnue"}` };
  }
}

// Reprises déjà créées, retrouvées par la référence PERIM- portée par le BC.
// Répond à « où est passé mon BC ? » sans avoir à fouiller Odoo.
export async function recentReprises(
  session: odoo.OdooSession,
  clientId?: number,
  limit = 10,
): Promise<any[]> {
  const domain: any[] = [["client_order_ref", "like", "PERIM-"]];
  if (clientId) domain.push(["partner_id", "child_of", clientId]);
  return odoo.searchRead(session, "sale.order", domain,
    ["id", "name", "date_order", "amount_total", "state", "partner_id", "client_order_ref"],
    limit, "id desc");
}

// Confirme le transfert, renseigne les lots, puis valide. Renvoie "" si tout
// s'est bien passé, sinon un avertissement lisible — le transfert existe alors
// mais reste à finir à la main dans Odoo.
async function confirmAndValidate(
  session: odoo.OdooSession,
  pickingId: number,
  lineByMove: Map<number, PerimeLine>,
): Promise<string> {
  try {
    await odoo.callMethod(session, "stock.picking", "action_confirm", [[pickingId]]);
    try { await odoo.callMethod(session, "stock.picking", "action_assign", [[pickingId]]); } catch {}

    let mls = await odoo.searchRead(session, "stock.move.line",
      [["picking_id", "=", pickingId]], ["id", "move_id", "product_id"], 0);

    // Selon la configuration, la confirmation ne crée pas toujours les lignes
    // d'opération : on les crée alors nous-mêmes.
    if (!mls.length) {
      for (const [moveId, l] of Array.from(lineByMove.entries())) {
        await odoo.create(session, "stock.move.line", {
          move_id: moveId, picking_id: pickingId,
          product_id: l.product.id,
          ...(l.lot ? { lot_name: l.lot } : {}),
        });
      }
      mls = await odoo.searchRead(session, "stock.move.line",
        [["picking_id", "=", pickingId]], ["id", "move_id", "product_id"], 0);
    }

    for (const ml of mls) {
      const l = lineByMove.get(ml.move_id?.[0]);
      if (!l) continue;
      // lot_name (et non lot_id) : le lot vient de chez le client, il peut ne
      // pas exister côté entrepôt — Odoo le crée à la volée.
      const vals: any = { ...(l.lot ? { lot_name: l.lot } : {}) };
      // Odoo 17 : `quantity`. Odoo 16 : `qty_done`. On tente, puis on replie.
      try {
        await odoo.write(session, "stock.move.line", [ml.id], { ...vals, quantity: l.qty });
      } catch {
        await odoo.write(session, "stock.move.line", [ml.id], { ...vals, qty_done: l.qty });
      }
    }

    const res: any = await odoo.callMethod(session, "stock.picking", "button_validate", [[pickingId]]);
    // Un retour de type dict avec res_model = assistant (backorder, lots…) :
    // Odoo n'a PAS validé, il attend une réponse humaine.
    if (res && typeof res === "object" && res.res_model) {
      return `transfert créé mais non validé — Odoo demande une confirmation (${res.res_model})`;
    }
    return "";
  } catch (e: any) {
    return `transfert créé mais non validé : ${e?.message || "erreur inconnue"}`;
  }
}

// Emplacement d'où vient la marchandise reprise : l'emplacement client propre à
// la fiche s'il est défini, sinon l'emplacement « client » générique d'Odoo,
// sinon celui par défaut du type d'opération.
async function resolveCustomerLocation(
  session: odoo.OdooSession,
  clientId: number,
  fallbackId?: number,
): Promise<number | null> {
  try {
    const rows = await odoo.searchRead(session, "res.partner",
      [["id", "=", clientId]], ["property_stock_customer"], 1);
    const id = rows[0]?.property_stock_customer?.[0];
    if (id) return id;
  } catch { /* champ absent ou illisible : on continue */ }
  try {
    const locs = await odoo.searchRead(session, "stock.location",
      [["usage", "=", "customer"]], ["id"], 1);
    if (locs.length) return locs[0].id;
  } catch { /* idem */ }
  return fallbackId || null;
}

// Le BC unique : repris en négatif + échange en positif.
export function buildExchangeOrderPayload(opts: {
  clientId: number; pricelistId: number | false;
  returns: PerimeLine[]; exchanges: ExchangeLine[];
  repName: string; localRef: string; freeType?: string; tagIds?: number[];
}): any {
  const noteLines = opts.returns.map(
    r => `• ${r.product.name}${r.lot ? ` (lot ${r.lot})` : ""} × ${r.qty}`);
  return {
    partner_id: opts.clientId,
    state: "draft",
    ...(opts.pricelistId ? { pricelist_id: opts.pricelistId } : {}),
    client_order_ref: opts.localRef,
    ...(opts.tagIds && opts.tagIds.length ? { tag_ids: [[6, 0, opts.tagIds]] } : {}),
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

// ── Étiquettes du BC de reprise ──────────────────────────────────────────────
// « Geste co périmé » + « Validé DC ». Recherchées par libellé et non par id :
// les ids de crm.tag diffèrent d'une base à l'autre, et un id codé en dur
// étiquetterait silencieusement la mauvaise chose.
const TAG_PATTERNS: { label: string; match: RegExp }[] = [
  { label: "Geste co périmé", match: /geste\s*co.*p[ée]rim/i },
  { label: "Validé DC",       match: /^valid[ée]\s*dc$/i },
];

let _perimeTagCache: { ids: number[]; missing: string[] } | undefined;

export async function getPerimeTagIds(
  session: odoo.OdooSession,
): Promise<{ ids: number[]; missing: string[] }> {
  if (_perimeTagCache) return _perimeTagCache;
  try {
    // On ratisse large côté Odoo puis on filtre en JS : les libellés réels
    // peuvent varier en casse, accents ou espaces.
    const tags = await odoo.searchRead(session, "crm.tag", [], ["id", "name"], 0);
    const ids: number[] = [];
    const missing: string[] = [];
    for (const p of TAG_PATTERNS) {
      const hit = tags.find((t: any) => p.match.test(String(t.name || "").trim()));
      if (hit) ids.push(hit.id); else missing.push(p.label);
    }
    _perimeTagCache = { ids, missing };
    return _perimeTagCache;
  } catch {
    // On ne fige PAS le cache sur un échec réseau : sinon plus aucun BC ne
    // serait étiqueté du reste de la session, même une fois le réseau revenu.
    return { ids: [], missing: TAG_PATTERNS.map(p => p.label) };
  }
}
