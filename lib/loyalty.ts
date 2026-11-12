// lib/loyalty.ts
// Détection des remises additionnelles Odoo (module "Réductions & fidélité", loyalty.program —
// Odoo 17+) applicables au panier en cours, et application au devis à la validation.
//
// Portée volontairement limitée pour rester fiable sur un sujet qui touche à l'argent facturé :
// - Programmes pris en compte : trigger="auto" (pas de code promo à saisir), applies_on="current"
// - Conditions supportées : quantité mini et/ou montant mini, sur des produits précis (product_ids)
//   ou sans restriction (s'applique à tout le panier). Les conditions par catégorie/étiquette
//   produit ne sont pas évaluées (trop de risque de mal interpréter la configuration Odoo) —
//   ces règles sont simplement ignorées plutôt que mal appliquées.
// - Récompenses supportées : remise en % (sur tout le panier, ou sur les produits concernés) et
//   produit offert. Les récompenses "livraison gratuite" ne sont pas gérées ici (hors contexte).
import * as odoo from "@/lib/odoo";

export interface LoyaltyReward {
  id: number;
  reward_type: "discount" | "product" | "shipping" | string;
  discount: number; // %
  discount_applicability: "order" | "cheapest" | "specific" | string;
  discount_product_ids: number[];
  reward_product_id: number | null;
  reward_product_qty: number;
}

export interface LoyaltyRule {
  id: number;
  product_ids: number[];
  minimum_qty: number;
  minimum_amount: number;
}

export interface LoyaltyProgram {
  id: number;
  name: string;
  rules: LoyaltyRule[];
  rewards: LoyaltyReward[];
}

export async function fetchActiveLoyaltyPrograms(session: odoo.OdooSession): Promise<LoyaltyProgram[]> {
  try {
    const programs = await odoo.searchRead(session, "loyalty.program",
      [["active", "=", true], ["trigger", "=", "auto"], ["applies_on", "=", "current"],
       ["program_type", "in", ["promotion", "buy_x_get_y"]]],
      ["id", "name", "rule_ids", "reward_ids"], 100);
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
      readOr("loyalty.rule", ruleIds, ["id", "program_id", "product_ids", "minimum_qty", "minimum_amount"], ["product_category_id", "product_tag_id"]),
      readOr("loyalty.reward", rewardIds, ["id", "program_id", "reward_type", "discount", "discount_applicability", "discount_product_ids", "reward_product_id", "reward_product_qty"], ["reward_product_ids"]),
    ]);
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
      rules: rules
        .filter((r: any) => (Array.isArray(r.program_id) ? r.program_id[0] : r.program_id) === p.id)
        .map((r: any) => ({
          id: r.id,
          product_ids: r.product_ids || [],
          minimum_qty: r.minimum_qty || 0,
          minimum_amount: r.minimum_amount || 0,
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

// Un programme est "déclenché" si AU MOINS UNE de ses règles est satisfaite par le panier.
export function isProgramTriggered(program: LoyaltyProgram, cart: CartLike): boolean {
  return program.rules.some(rule => {
    const items = Object.values(cart).filter(i =>
      rule.product_ids.length === 0 || rule.product_ids.includes(i.product.id)
    );
    const qty = items.reduce((s, i) => s + i.qty, 0);
    const amount = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
    const qtyOk = rule.minimum_qty > 0 ? qty >= rule.minimum_qty : true;
    const amountOk = rule.minimum_amount > 0 ? amount >= rule.minimum_amount : true;
    // Au moins une des deux conditions doit être définie et respectée
    if (rule.minimum_qty <= 0 && rule.minimum_amount <= 0) return false;
    return qtyOk && amountOk;
  });
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
