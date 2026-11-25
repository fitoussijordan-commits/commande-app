// lib/loyalty.ts
// Promos Odoo (module « Réductions & fidélité », loyalty.program — Odoo 17+)
// applicables au panier, et application au devis à la validation.
//
// - Programmes : automatiques (trigger « auto ») ET promos liées aux MEA (nom
//   commençant par le code de l'article MEA, 7xxxxxx), dans leur période de validité.
// - Éligibilité (règles Odoo) : au moins une règle satisfaite — quantité mini et
//   montant mini (TTC ou HT selon la règle) sur les articles de la règle (produits,
//   catégorie, étiquette ; aucun = tous), liste de prix autorisée s'il y en a une.
//   Promo de MEA : il faut EN PLUS l'article MEA (code 7) dans la commande (OrderScreen).
// - Récompenses : remise en % (commande, moins cher, produits / catégorie /
//   étiquette) — ADDITIONNÉE à la remise du tarif client (règle maison, cf.
//   linePricing dans OrderScreen) ; produit offert, autant de fois que les points
//   gagnés le permettent. Livraison gratuite : non gérée.
import * as odoo from "@/lib/odoo";

export interface LoyaltyReward {
  id: number;
  reward_type: "discount" | "product" | "shipping" | string;
  discount: number; // %
  discount_mode?: string;                 // "percent" (seul géré pour les remises)
  discount_applicability: "order" | "cheapest" | "specific" | string;
  discount_product_ids: number[];         // produits, catégorie et étiquette résolus
  reward_product_id: number | null;
  reward_product_qty: number;
  required_points?: number;               // points nécessaires pour 1 récompense
}

export interface LoyaltyRule {
  id: number;
  product_ids: number[];                  // vide = tous les articles ; catégorie / étiquette résolues
  minimum_qty: number;
  minimum_amount: number;
  minimum_amount_tax_mode?: string;       // "incl" (TTC) ou "excl" (HT)
  reward_point_amount?: number;
  reward_point_mode?: string;             // "order" | "unit" | "money"
}

export interface LoyaltyProgram {
  id: number;
  name: string;
  rules: LoyaltyRule[];
  rewards: LoyaltyReward[];
  // Promo liée à une MEA : son nom commence par le code de l'article MEA (7…),
  // ex. « 7131492 MEA Laits et les Huiles de Soin 2026 - Standard (…) ».
  meaCode?: string;
  pricelistIds?: number[];                // restriction de liste de prix (si l'instance l'a)
}

// Code de l'article MEA (7 + 6 chiffres) en tête du nom d'une promo.
export function meaCodeOf(name: string): string | undefined {
  const m = /^\s*\[?(7\d{6})\b/.exec(String(name || ""));
  return m ? m[1] : undefined;
}

export async function fetchActiveLoyaltyPrograms(session: odoo.OdooSession): Promise<LoyaltyProgram[]> {
  try {
    // Promos automatiques + promos liées aux MEA (nom commençant par un code 7…,
    // quel que soit leur déclencheur : elles ne s'appliquent qu'avec l'article MEA).
    const domain = [["active", "=", true], ["applies_on", "=", "current"],
      "|", "&", ["trigger", "=", "auto"], ["program_type", "in", ["promotion", "buy_x_get_y"]], ["name", "=like", "7%"]];
    let programs: any[];
    try {
      programs = await odoo.searchRead(session, "loyalty.program", domain,
        ["id", "name", "rule_ids", "reward_ids", "date_from", "date_to", "pricelist_ids"], 300);
    } catch (e) {
      if (odoo.isNetworkError(e)) throw e;
      programs = await odoo.searchRead(session, "loyalty.program", domain, ["id", "name", "rule_ids", "reward_ids"], 300);
    }
    // Période de validité de la promo.
    const today = new Date().toISOString().slice(0, 10);
    programs = programs.filter((p: any) => (!p.date_from || String(p.date_from).slice(0, 10) <= today)
      && (!p.date_to || String(p.date_to).slice(0, 10) >= today));
    if (!programs.length) return [];

    const ruleIds = programs.flatMap((p: any) => p.rule_ids || []);
    const rewardIds = programs.flatMap((p: any) => p.reward_ids || []);

    // Champs « étendus » (catégorie / étiquette produit, produits offerts via une
    // étiquette) lus si l'instance les a ; sinon repli sur les champs de base.
    const readOr = async (model: string, ids: number[], base: string[], extra: string[]) => {
      if (!ids.length) return [];
      try { return await odoo.searchRead(session, model, [["id", "in", ids]], [...base, ...extra], ids.length); }
      catch (e) { if (odoo.isNetworkError(e)) throw e; return await odoo.searchRead(session, model, [["id", "in", ids]], base, ids.length); }
    };
    const [rules, rewards] = await Promise.all([
      readOr("loyalty.rule", ruleIds, ["id", "program_id", "product_ids", "minimum_qty", "minimum_amount"],
        ["product_category_id", "product_tag_id", "minimum_amount_tax_mode", "reward_point_amount", "reward_point_mode"]),
      readOr("loyalty.reward", rewardIds, ["id", "program_id", "reward_type", "discount", "discount_applicability", "discount_product_ids", "reward_product_id", "reward_product_qty"],
        ["reward_product_ids", "required_points", "discount_mode", "discount_product_category_id", "discount_product_tag_id"]),
    ]);
    // Remise sur une catégorie / étiquette de produits : ramenée à sa liste de produits.
    for (const rw of rewards) {
      if (rw.discount_applicability !== "specific") continue;
      const extra: number[] = [];
      for (const dom of [
        Array.isArray(rw.discount_product_category_id) ? [["categ_id", "child_of", rw.discount_product_category_id[0]]] : null,
        Array.isArray(rw.discount_product_tag_id) ? [["all_product_tag_ids", "in", [rw.discount_product_tag_id[0]]]] : null,
      ]) {
        if (!dom) continue;
        try { extra.push(...(await odoo.searchRead(session, "product.product", dom, ["id"], 0)).map((x: any) => x.id)); }
        catch (e) { if (odoo.isNetworkError(e)) throw e; }
      }
      if (extra.length) rw.discount_product_ids = Array.from(new Set([...(rw.discount_product_ids || []), ...extra]));
    }
    // Règle sur une catégorie ou une étiquette produit : on la ramène à sa liste
    // de produits (avant, elle était lue comme « tout le panier »).
    for (const r of rules) {
      if ((r.product_ids || []).length) continue;
      const dom = Array.isArray(r.product_category_id) ? [["categ_id", "child_of", r.product_category_id[0]]]
        : Array.isArray(r.product_tag_id) ? [["all_product_tag_ids", "in", [r.product_tag_id[0]]]] : null;
      if (!dom) continue;
      try { r.product_ids = (await odoo.searchRead(session, "product.product", dom, ["id"], 0)).map((x: any) => x.id); }
      catch (e) { if (odoo.isNetworkError(e)) throw e; r.product_ids = [-1]; }   // illisible : la règle ne se déclenche pas
      if (!r.product_ids.length) r.product_ids = [-1];
    }

    return programs.map((p: any) => ({
      id: p.id,
      name: p.name,
      meaCode: meaCodeOf(p.name),
      pricelistIds: Array.isArray(p.pricelist_ids) ? p.pricelist_ids : [],
      rules: rules
        .filter((r: any) => (Array.isArray(r.program_id) ? r.program_id[0] : r.program_id) === p.id)
        .map((r: any) => ({
          id: r.id,
          product_ids: r.product_ids || [],
          minimum_qty: r.minimum_qty || 0,
          minimum_amount: r.minimum_amount || 0,
          minimum_amount_tax_mode: r.minimum_amount_tax_mode || "incl",
          reward_point_amount: r.reward_point_amount ?? 1,
          reward_point_mode: r.reward_point_mode || "order",
        })),
      rewards: rewards
        .filter((rw: any) => (Array.isArray(rw.program_id) ? rw.program_id[0] : rw.program_id) === p.id)
        .map((rw: any) => ({
          id: rw.id,
          reward_type: rw.reward_type,
          discount: rw.discount || 0,
          discount_applicability: rw.discount_applicability,
          discount_product_ids: rw.discount_product_ids || [],
          // Produit offert : direct, ou le 1er des produits de l'étiquette offerte.
          reward_product_id: Array.isArray(rw.reward_product_id) ? rw.reward_product_id[0] : (rw.reward_product_ids || [])[0] ?? null,
          reward_product_qty: rw.reward_product_qty || 1,
          required_points: rw.required_points || 1,
          discount_mode: rw.discount_mode || "percent",
        })),
    })).filter((p: LoyaltyProgram) => p.rules.length > 0 && p.rewards.length > 0);
  } catch (e) {
    // Hors ligne : on laisse remonter pour que l'appelant lise le cache local
    // (préchargé par « Télécharger les données »).
    if (odoo.isNetworkError(e)) throw e;
    return []; // module non installé ou inaccessible → aucune remise détectée, pas de crash
  }
}

interface CartLike { [productId: number]: { product: any; qty: number; unitPrice: number } }

export async function fetchProductBasics(session: odoo.OdooSession, productId: number): Promise<{ id: number; name: string; default_code: string } | null> {
  try {
    const rows = await odoo.searchRead(session, "product.product", [["id", "=", productId]], ["id", "name", "default_code"], 1);
    return rows[0] || null;
  } catch {
    return null;
  }
}

// TVA des produits de la gamme : sert seulement à comparer un « achat minimum
// taxes incluses » (le panier de l'app est en HT).
const VAT = 0.2;

function ruleItems(rule: LoyaltyRule, cart: CartLike) {
  return Object.values(cart).filter(i => i.qty > 0 && (rule.product_ids.length === 0 || rule.product_ids.includes(i.product.id)));
}
function ruleOk(rule: LoyaltyRule, cart: CartLike): boolean {
  // Au moins une condition (quantité ou montant) doit être définie : une règle
  // vide n'est jamais déclenchée (prudence sur ce qui touche au prix facturé).
  if (rule.minimum_qty <= 0 && rule.minimum_amount <= 0) return false;
  const items = ruleItems(rule, cart);
  const qty = items.reduce((s, i) => s + i.qty, 0);
  const ht = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const amount = rule.minimum_amount_tax_mode === "excl" ? ht : ht * (1 + VAT);
  return (rule.minimum_qty <= 0 || qty >= rule.minimum_qty) && (rule.minimum_amount <= 0 || amount >= rule.minimum_amount - 0.005);
}

// Programme éligible selon les règles d'Odoo : au moins une règle satisfaite
// (quantité mini ET montant mini sur les articles de la règle), dans la liste de
// prix autorisée s'il y en a une.
export function isProgramTriggered(program: LoyaltyProgram, cart: CartLike, pricelistId?: number | null): boolean {
  if (program.pricelistIds?.length && pricelistId && !program.pricelistIds.includes(pricelistId)) return false;
  return program.rules.some(rule => ruleOk(rule, cart));
}

// Seuil d'un programme (pour classer les paliers d'une même MEA) : quantité mini
// la plus haute de ses règles, puis montant mini.
export function programThreshold(program: LoyaltyProgram): number {
  return Math.max(0, ...program.rules.map(r => r.minimum_qty * 1e6 + r.minimum_amount));
}

// Nombre de fois qu'une récompense « produit offert » est accordée (règle Odoo :
// points gagnés par les règles satisfaites ÷ points nécessaires, arrondi en dessous).
export function rewardTimes(program: LoyaltyProgram, reward: LoyaltyReward, cart: CartLike): number {
  let points = 0;
  for (const rule of program.rules) {
    if (!ruleOk(rule, cart)) continue;
    const items = ruleItems(rule, cart);
    const amount = rule.reward_point_amount ?? 1;
    if (rule.reward_point_mode === "unit") points += amount * items.reduce((s, i) => s + i.qty, 0);
    else if (rule.reward_point_mode === "money") points += amount * items.reduce((s, i) => s + i.qty * i.unitPrice, 0) * (1 + VAT);
    else points += amount;
  }
  const need = reward.required_points || 1;
  return Math.max(0, Math.floor(points / need + 1e-9));
}

export interface AppliedDiscountPromo { type: "discount"; program: LoyaltyProgram; reward: LoyaltyReward; }
export interface AppliedFreePromo { type: "product"; program: LoyaltyProgram; reward: LoyaltyReward; productName: string; }
export type AppliedPromo = AppliedDiscountPromo | AppliedFreePromo;

// Calcule, pour chaque produit du panier, le % de remise à appliquer (le plus avantageux des
// remises appliquées si plusieurs se recoupent sur le même produit — jamais cumulées, pour éviter
// tout dépassement ou double-remise imprévu).
export function computeLineDiscounts(applied: Record<number, AppliedPromo>, cart: CartLike): Record<number, number> {
  const items = Object.values(cart);
  const cheapestId = items.length
    ? items.reduce((min, i) => (i.unitPrice < min.unitPrice ? i : min), items[0]).product.id
    : null;

  const out: Record<number, number> = {};
  for (const promo of Object.values(applied)) {
    if (promo.type !== "discount") continue;
    const { reward } = promo;
    let targetIds: number[];
    if (reward.discount_applicability === "cheapest" && cheapestId != null) targetIds = [cheapestId];
    else if (reward.discount_applicability === "specific") targetIds = reward.discount_product_ids;
    else targetIds = items.map(i => i.product.id); // "order" ou valeur inconnue → tout le panier

    for (const pid of targetIds) {
      out[pid] = Math.max(out[pid] || 0, reward.discount);
    }
  }
  return out;
}

// Remises réellement retenues : pour chaque produit, seule la plus forte compte
// (computeLineDiscounts). Les paliers inférieurs dominés ne sont pas affichés.
export function effectivePromoIds(applied: Record<number, AppliedPromo>, cart: CartLike): Set<number> {
  const items = Object.values(cart);
  const cheapestId = items.length
    ? items.reduce((min, i) => (i.unitPrice < min.unitPrice ? i : min), items[0]).product.id
    : null;
  const best: Record<number, { pct: number; id: number }> = {};
  const out = new Set<number>();
  for (const promo of Object.values(applied)) {
    if (promo.type !== "discount") { out.add(promo.program.id); continue; }
    const { reward } = promo;
    const targets = reward.discount_applicability === "cheapest" && cheapestId != null ? [cheapestId]
      : reward.discount_applicability === "specific" ? reward.discount_product_ids
      : items.map(i => i.product.id);
    for (const pid of targets) {
      if (!items.some(i => i.product.id === pid)) continue;
      if (!best[pid] || reward.discount > best[pid].pct) best[pid] = { pct: reward.discount, id: promo.program.id };
    }
  }
  Object.values(best).forEach(b => out.add(b.id));
  return out;
}
