// lib/productFields.ts
// Champs article optionnels selon la base Odoo. Un champ absent fait échouer
// TOUTE la requête search_read : on ne demande que ceux qui existent (fields_get,
// une fois par session ; dernière liste connue gardée pour le hors ligne).
//
//   • x_type_de_produit_id : regroupement « Type de produit » du catalogue.
//   • min_qty              : quantité minimum de vente (« min 2 ») — au-delà,
//                            n'importe quelle quantité (2, 3, 4…).
import * as odoo from "@/lib/odoo";

const OPTIONAL = ["x_type_de_produit_id", "min_qty"];
const LS_KEY = "wms_product_optional_fields";
let _extra: string[] | null = null;

export async function optionalProductFields(session: odoo.OdooSession): Promise<string[]> {
  if (_extra) return _extra;
  try {
    const fields = await odoo.callMethod(session, "product.product", "fields_get", [OPTIONAL], { attributes: ["type"] });
    _extra = OPTIONAL.filter(f => f in (fields || {}));
    try { localStorage.setItem(LS_KEY, JSON.stringify(_extra)); } catch {}
    return _extra;
  } catch (e) {
    if (!odoo.isNetworkError(e)) { _extra = []; return _extra; }
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
  }
}

// Quantité minimum de vente de l'article : 1, ou sa min_qty (2 → 2, 3, 4…).
export function saleStep(product: any): number {
  const n = Math.round(Number(product?.min_qty) || 0);
  return n > 1 ? n : 1;
}

// Quantité ramenée au minimum de vente : sous le minimum, on monte au minimum,
// sauf en retirant une unité (« − » depuis le minimum → 0, jamais coincé à 1).
export function snapQty(product: any, qty: number, previous: number): number {
  const min = saleStep(product);
  if (min === 1 || qty <= 0 || qty >= min) return qty;
  return previous - qty === 1 ? 0 : min;
}
