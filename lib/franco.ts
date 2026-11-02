// lib/franco.ts
// Franco de port : sous 250 € HT (total net, après remises) on ajoute 10 € HT
// de frais de livraison. L'article est cherché par son nom dans Odoo (service
// « Frais de port » / « … livraison ») et gardé sur l'appareil pour le hors ligne.
import * as odoo from "@/lib/odoo";

export const FRANCO_HT = 250;
export const SHIPPING_FEE_HT = 10;

export const needsShippingFee = (netHt: number) => netHt > 0 && netHt < FRANCO_HT - 0.005;

const LS_KEY = "wms_shipping_product";
let _product: { id: number; name: string } | null | undefined;

export async function shippingProduct(session: odoo.OdooSession): Promise<{ id: number; name: string } | null> {
  if (_product !== undefined) return _product;
  try {
    const rows = await odoo.searchRead(session, "product.product",
      [["type", "=", "service"], "|", ["name", "ilike", "frais de port"], ["name", "ilike", "livraison"]],
      ["id", "name"], 20, "id");
    // « Frais de port » avant « … livraison » ; jamais un article de reprise / remise.
    const ok = rows.filter((r: any) => !/reprise|remise|gratuit/i.test(r.name));
    const best = ok.find((r: any) => /frais\s+de\s+port/i.test(r.name))
      || ok.find((r: any) => /frais.*livraison/i.test(r.name)) || ok[0];
    _product = best ? { id: best.id, name: String(best.name) } : null;
    try { localStorage.setItem(LS_KEY, JSON.stringify(_product)); } catch {}
    return _product;
  } catch (e) {
    if (!odoo.isNetworkError(e)) { _product = null; return null; }
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; }
  }
}
