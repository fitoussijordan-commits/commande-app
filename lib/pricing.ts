// lib/pricing.ts
// Calcul du prix client à partir des règles de la grille tarifaire Odoo.
//
// Extrait d'OrderScreen pour être réutilisable ailleurs (module périmés), sans
// créer de dépendance circulaire entre composants.

export interface PriceItem {
  applied_on: string;          // '0_product_variant' | '1_product' | '2_product_category' | '3_global'
  compute_price: string;       // 'fixed' | 'discount' | 'formula'
  product_id: any;             // [id, name] ou false
  product_tmpl_id: any;
  categ_id: any;
  fixed_price: number;
  percent_price: number;       // % de remise pour compute_price='discount'
  price_discount: number;      // % de remise pour compute_price='formula'
  price_surcharge: number;
  min_quantity: number;
  date_start?: string | false; // dates de validité (absentes sur certaines instances)
  date_end?: string | false;
}

// Tri par spécificité : variante > produit > catégorie > global, puis palier de
// quantité décroissant (la meilleure règle applicable gagne). Sans ce tri, l'ordre
// arbitraire renvoyé par Odoo (non triable par "sequence" ici) pouvait faire gagner
// une règle globale sur une règle propre au produit → prix client faux.
const APPLIED_ON_RANK: Record<string, number> = {
  "0_product_variant": 0, "1_product": 1, "2_product_category": 2, "3_global": 3,
};

export function sortPriceItems(items: PriceItem[]): PriceItem[] {
  return [...items].sort((a, b) =>
    (APPLIED_ON_RANK[a.applied_on] ?? 9) - (APPLIED_ON_RANK[b.applied_on] ?? 9)
    || (b.min_quantity || 0) - (a.min_quantity || 0)
  );
}

export function applyPricelist(
  lstPrice: number,
  productId: number,
  productTmplId: number,
  items: PriceItem[],
  qty = 1,
): number {
  // Priorité : product_variant > product_template > global (items pré-triés).
  const today = new Date().toISOString().slice(0, 10);

  for (const item of items) {
    if (item.min_quantity > qty) continue;
    // Règle datée : ignorée hors de sa période de validité (promo expirée / à venir).
    if (item.date_start && String(item.date_start).slice(0, 10) > today) continue;
    if (item.date_end && String(item.date_end).slice(0, 10) < today) continue;

    const appliesToProduct =
      (item.applied_on === "0_product_variant" && item.product_id && item.product_id[0] === productId) ||
      (item.applied_on === "1_product" && item.product_tmpl_id && item.product_tmpl_id[0] === productTmplId) ||
      (item.applied_on === "3_global");

    if (!appliesToProduct) continue;

    if (item.compute_price === "fixed")    return item.fixed_price;
    if (item.compute_price === "discount") return lstPrice * (1 - item.percent_price / 100);
    if (item.compute_price === "formula")  return Math.max(0, lstPrice * (1 - item.price_discount / 100) + item.price_surcharge);
  }
  return lstPrice; // aucune règle → prix catalogue
}
