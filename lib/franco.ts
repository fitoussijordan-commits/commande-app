// lib/franco.ts
// Franco de port : sous 250 € HT (total net, après remises) on ajoute 10 € HT
// de frais de livraison, TOUJOURS avec l'article [982040] « Frais de port -
// Transporteurs » (cherché par sa référence), gardé sur l'appareil pour le hors ligne.
import * as odoo from "@/lib/odoo";

export const FRANCO_HT = 250;
export const SHIPPING_FEE_HT = 10;
export const SHIPPING_PRODUCT_CODE = "982040";

export const needsShippingFee = (netHt: number) => netHt > 0 && netHt < FRANCO_HT - 0.005;

// v2 : l'ancienne clé pouvait contenir un autre article (recherche par nom).
const LS_KEY = "wms_shipping_product_v2";
let _product: { id: number; name: string } | null | undefined;

export async function shippingProduct(session: odoo.OdooSession): Promise<{ id: number; name: string } | null> {
  if (_product !== undefined) return _product;
  try {
    const rows = await odoo.searchRead(session, "product.product",
      [["default_code", "=", SHIPPING_PRODUCT_CODE]], ["id", "name"], 1, "id");
    _product = rows[0] ? { id: rows[0].id, name: String(rows[0].name) } : null;
    try { localStorage.setItem(LS_KEY, JSON.stringify(_product)); } catch {}
    return _product;
  } catch (e) {
    if (!odoo.isNetworkError(e)) { _product = null; return null; }
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; }
  }
}
