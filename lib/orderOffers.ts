// lib/orderOffers.ts
// MEA et devis d'implantation sur sale.order.
//
// Dans cet Odoo, une MEA n'est PAS repérable par le modèle de devis (souvent
// vide) : elle est portée par le champ Studio « Offres commandées » (étiquettes,
// ex. « MEA Noël - Personnalisable »). Les devis d'implantation se distinguent
// par le champ « Type de commande ».
//
// Offres commandées = x_offres_commandees_id (many2many → x_offre_produit).
// « Type de commande » est retrouvé par son LIBELLÉ via fields_get, une fois
// par session (nom technique non relevé).
import * as odoo from "@/lib/odoo";

export interface OrderMeta {
  offersField?: string;                 // many2many « Offres commandées »
  offersRelation?: string;
  typeField?: string;                   // « Type de commande »
  typeKind?: "selection" | "many2one";
  implantValues: (string | number)[];   // valeurs du type correspondant à une implantation
}

let _meta: OrderMeta | null = null;

export async function orderMeta(session: odoo.OdooSession): Promise<OrderMeta> {
  if (_meta) return _meta;
  const meta: OrderMeta = { implantValues: [] };
  const fields: Record<string, any> = await odoo.callMethod(session, "sale.order", "fields_get", [],
    { attributes: ["string", "type", "relation", "selection"] });

  // Champ connu de cette instance (vérifié dans Odoo) ; la recherche par libellé
  // ci-dessous ne sert que si on le renomme un jour.
  if (fields.x_offres_commandees_id) {
    meta.offersField = "x_offres_commandees_id";
    meta.offersRelation = fields.x_offres_commandees_id.relation || "x_offre_produit";
  }
  for (const [name, f] of Object.entries(fields)) {
    const label = String(f.string || "");
    if (!meta.offersField && /offres?\s+command/i.test(label) && (f.type === "many2many" || f.type === "one2many")) {
      meta.offersField = name; meta.offersRelation = f.relation;
    }
    if (!meta.typeField && /^type\s+de\s+commande/i.test(label) && (f.type === "selection" || f.type === "many2one")) {
      meta.typeField = name; meta.typeKind = f.type;
      if (f.type === "selection") {
        meta.implantValues = (f.selection || [])
          .filter(([, l]: [string, string]) => /implant/i.test(String(l)))
          .map(([v]: [string, string]) => v);
      } else if (f.relation) {
        try {
          const rows = await odoo.searchRead(session, f.relation, [["name", "ilike", "implant"]], ["id"], 20);
          meta.implantValues = rows.map((r: any) => r.id);
        } catch { /* sans valeur : aucune implantation repérable par le type */ }
      }
    }
  }
  _meta = meta;
  return meta;
}

// Commande d'implantation : type de commande « Implantation… », ou à défaut un
// modèle de devis dont le nom parle d'implantation.
export function isImplantation(o: any, meta: OrderMeta): boolean {
  if (meta.typeField && meta.implantValues.length) {
    const v = o[meta.typeField];
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== false && val != null && meta.implantValues.includes(val)) return true;
  }
  return /implant/i.test(String(o.sale_order_template_id?.[1] || ""));
}

// Commande MEA : au moins une « offre commandée », ou un modèle de devis.
export function isMea(o: any, meta: OrderMeta): boolean {
  const offers = meta.offersField ? o[meta.offersField] : null;
  if (Array.isArray(offers) && offers.length) return true;
  return Array.isArray(o.sale_order_template_id) && !!o.sale_order_template_id[0];
}

// Libellés des offres de chaque commande (le many2many ne renvoie que des ids).
export async function offerNames(session: odoo.OdooSession, orders: any[], meta: OrderMeta): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!meta.offersField || !meta.offersRelation) return out;
  const ids = Array.from(new Set(orders.flatMap(o => (o[meta.offersField!] || []) as number[])));
  if (!ids.length) return out;
  try {
    const rows = await odoo.searchRead(session, meta.offersRelation, [["id", "in", ids]], ["display_name"], 0);
    rows.forEach((r: any) => out.set(r.id, String(r.display_name || "")));
  } catch { /* libellés indisponibles : on retombera sur le modèle de devis */ }
  return out;
}
