// lib/productFields.ts
// Champs article optionnels selon la base Odoo. Un champ absent fait échouer
// TOUTE la requête search_read : on ne demande que ceux qui existent (fields_get,
// une fois par session ; dernière liste connue gardée pour le hors ligne).
//
//   • x_type_de_produit_id : regroupement « Type de produit » du catalogue.
//   • min_qty              : quantité minimum de vente (« par 2 ») — la quantité
//                            commandée est toujours un multiple de cette valeur.
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

// Pas de vente de l'article : 1, ou sa quantité minimum (2 → 2, 4, 6…).
export function saleStep(product: any): number {
  const n = Math.round(Number(product?.min_qty) || 0);
  return n > 1 ? n : 1;
}

// Quantité ramenée sur un multiple du pas : vers le haut quand on augmente,
// vers le bas quand on diminue (4 → « − » → 2, jamais coincé à 3).
export function snapQty(product: any, qty: number, previous: number): number {
  const step = saleStep(product);
  if (step === 1 || qty <= 0) return qty;
  return qty >= previous ? Math.ceil(qty / step) * step : Math.floor(qty / step) * step;
}
