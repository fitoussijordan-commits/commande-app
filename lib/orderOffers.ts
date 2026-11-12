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
  typeOptions: { value: string | number; label: string }[];   // choix proposés à la saisie
  joinedField?: string;                 // many2many « Commandes jointes » (vers sale.order)
  internalNoteField?: string;           // « Note interne » de la commande (sinon : note dans le chatter)
}

let _meta: OrderMeta | null = null;

export async function orderMeta(session: odoo.OdooSession): Promise<OrderMeta> {
  if (_meta) return _meta;
  const meta: OrderMeta = { implantValues: [], typeOptions: [] };
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
    if (!meta.joinedField && /commandes?\s+jointes?/i.test(label) && f.type === "many2many" && f.relation === "sale.order") {
      meta.joinedField = name;
    }
    if (!meta.internalNoteField && /note\s+interne/i.test(label) && ["text", "html", "char"].includes(f.type)) {
      meta.internalNoteField = name;
    }
    if (!meta.typeField && /^type\s+de\s+commande/i.test(label) && (f.type === "selection" || f.type === "many2one")) {
      meta.typeField = name; meta.typeKind = f.type;
      if (f.type === "selection") {
        meta.typeOptions = (f.selection || []).map(([v, l]: [string, string]) => ({ value: v, label: String(l) }));
        meta.implantValues = (f.selection || [])
          .filter(([, l]: [string, string]) => /implant/i.test(String(l)))
          .map(([v]: [string, string]) => v);
      } else if (f.relation) {
        try {
          const rows = await odoo.searchRead(session, f.relation, [], ["id", "display_name"], 100);
          meta.typeOptions = rows.map((r: any) => ({ value: r.id, label: String(r.display_name || "") }));
          meta.implantValues = meta.typeOptions.filter(o => /implant/i.test(o.label)).map(o => o.value);
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

// Offres que l'on peut cocher sur une commande (champ « Offres commandées »).
export async function offerOptions(session: odoo.OdooSession, meta: OrderMeta): Promise<{ id: number; name: string }[]> {
  if (!meta.offersRelation) return [];
  try {
    const rows = await odoo.searchRead(session, meta.offersRelation, [], ["display_name"], 500, "id desc");
    return rows.map((r: any) => ({ id: r.id, name: String(r.display_name || "") }));
  } catch { return []; }
}

// Champs Studio des MODÈLES de devis (MEA / implantation), repérés par libellé :
//   « Note interne »          → recopiée sur la commande (suivi des campagnes, ex. SERUM26)
//   « Date d'expédition… »    → date d'expédition prévue de la commande
export interface TemplateMeta { noteField?: string; shipField?: string }
let _tmeta: TemplateMeta | null = null;
export async function templateMeta(session: odoo.OdooSession): Promise<TemplateMeta> {
  if (_tmeta) return _tmeta;
  const out: TemplateMeta = {};
  try {
    const fields: Record<string, any> = await odoo.callMethod(session, "sale.order.template", "fields_get", [],
      { attributes: ["string", "type"] });
    for (const [name, f] of Object.entries(fields)) {
      const label = String(f.string || "");
      if (!out.noteField && /note\s+interne/i.test(label) && ["text", "html", "char"].includes(f.type)) out.noteField = name;
      if (!out.shipField && /exp[ée]dition/i.test(label) && (f.type === "date" || f.type === "datetime")) out.shipField = name;
    }
  } catch (e) {
    if (odoo.isNetworkError(e)) return out;   // hors ligne : on réessaiera
  }
  _tmeta = out;
  return out;
}

// Lignes de MODÈLE de devis : remise (%) et « Type de gratuité », si l'instance
// les a. Une ligne remisée à 100 % est une gratuité (ex. coffrets offerts des
// MEA de Noël) : elle doit partir en ligne offerte, pas s'ajouter à la quantité payante.
export interface TemplateLineMeta { discount?: string; freeType?: string }
let _tlmeta: TemplateLineMeta | null = null;
export async function templateLineMeta(session: odoo.OdooSession): Promise<TemplateLineMeta> {
  if (_tlmeta) return _tlmeta;
  const out: TemplateLineMeta = {};
  try {
    const fields: Record<string, any> = await odoo.callMethod(session, "sale.order.template.line", "fields_get", [],
      { attributes: ["string", "type"] });
    if (fields.discount && fields.discount.type === "float") out.discount = "discount";
    for (const [name, f] of Object.entries(fields)) {
      if (!out.freeType && /gratuit/i.test(String(f.string || "")) && ["selection", "char", "many2one"].includes(f.type)) out.freeType = name;
    }
  } catch (e) {
    if (odoo.isNetworkError(e)) return out;
  }
  _tlmeta = out;
  return out;
}
