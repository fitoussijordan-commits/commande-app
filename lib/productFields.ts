// lib/productFields.ts
// Champs article optionnels selon la base Odoo. Un champ absent fait échouer
// TOUTE la requête search_read : on ne demande que ceux qui existent (fields_get,
// une fois par session ; dernière liste connue gardée pour le hors ligne).
//
//   • x_type_de_produit_id : regroupement « Type de produit » du catalogue.
//   • min_qty              : quantité minimum de vente (« min 2 ») — au-delà,
//                            n'importe quelle quantité (2, 3, 4…).
//   • x_offre_produit_id   : offre de l'article (MEA Cures 2026…) → reportée
//                            dans « Offres commandées » de la commande.
//   • PPC (Studio)         : prix public conseillé, affiché à titre indicatif.
import * as odoo from "@/lib/odoo";

const OPTIONAL = ["x_type_de_produit_id", "min_qty", "x_offre_produit_id"];
const LS_KEY = "wms_product_optional_fields";
let _extra: string[] | null = null;
// PPC (prix public conseillé) : champ Studio repéré à son libellé « PPC ».
let _ppc: string | null = null;
try { _ppc = JSON.parse(localStorage.getItem(LS_KEY) || "[]").find((f: string) => !OPTIONAL.includes(f)) || null; } catch {}

export async function optionalProductFields(session: odoo.OdooSession): Promise<string[]> {
  if (_extra) return _extra;
  try {
    const fields = await odoo.callMethod(session, "product.product", "fields_get", [], { attributes: ["string", "type"] });
    _extra = OPTIONAL.filter(f => f in (fields || {}));
    _ppc = Object.entries(fields || {}).find(([, f]: [string, any]) =>
      /^\s*(ppc|prix public conseill)/i.test(String(f.string || "")) && ["float", "monetary"].includes(f.type))?.[0] || null;
    if (_ppc) _extra.push(_ppc);
    try { localStorage.setItem(LS_KEY, JSON.stringify(_extra)); } catch {}
    return _extra;
  } catch (e) {
    if (!odoo.isNetworkError(e)) { _extra = []; return _extra; }
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
  }
}

// PPC de l'article (0 si inconnu).
export function ppcOf(product: any): number {
  return _ppc ? Number(product?.[_ppc]) || 0 : 0;
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
