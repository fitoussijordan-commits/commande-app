// lib/portalOrders.ts
// Commandes passées sur le portail (site WALA) en attente de validation du DC :
// même filtre que le favori Odoo « CDE Portail à VALIDER »
//   site web contient WALA · étiquettes ne contiennent pas « validé DC » ·
//   statut de livraison = non livré
// limité aux commandes dont le commercial connecté est le vendeur.
import * as odoo from "@/lib/odoo";
import { textToHtml } from "@/lib/text";
import { loadBlockingTags, clientBlockingTags } from "@/lib/clientFlags";

export interface PortalOrder { id: number; name: string; date_order: string; state: string; amount_total: number; amount_untaxed: number; partner_id: any; website?: string }

export async function loadPortalOrders(session: odoo.OdooSession): Promise<PortalOrder[]> {
  const base: any[] = [["user_id", "=", session.uid], ["tag_ids", "not ilike", "validé DC"], ["state", "!=", "cancel"]];
  const fields = ["id", "name", "date_order", "state", "amount_total", "amount_untaxed", "partner_id"];
  try {
    return await odoo.searchRead(session, "sale.order",
      [...base, ["website_id", "ilike", "WALA"], ["delivery_status", "=", "pending"]],
      [...fields, "website_id"], 100, "date_order desc");
  } catch (e) {
    if (odoo.isNetworkError(e)) throw e;
    // Champ « statut de livraison » absent (version d'Odoo) : sans ce critère.
    return await odoo.searchRead(session, "sale.order",
      [...base, ["website_id", "ilike", "WALA"]], [...fields, "website_id"], 100, "date_order desc");
  }
}

let _tag: number | null | undefined;
export async function validatedTagId(session: odoo.OdooSession): Promise<number | null> {
  if (_tag !== undefined) return _tag;
  const tags: any[] = await odoo.searchRead(session, "crm.tag", [["name", "ilike", "valid"]], ["id", "name"], 20);
  const norm = (s: string) => (s || "").trim().toLowerCase();
  const t = tags.find(x => norm(x.name) === "validé dc") || tags.find(x => /valid.*dc/i.test(x.name));
  _tag = t ? t.id : null;
  return _tag ?? null;
}

// Validation du DC : ajoute l'étiquette « Validé DC » (les autres sont conservées).
export async function validatePortalOrder(session: odoo.OdooSession, orderId: number, note?: string): Promise<void> {
  // Même règle que la prise de commande : client « Bloqué compta » ou en
  // redressement → PAS d'étiquette Validé DC, c'est le service client qui valide.
  const [o] = await odoo.searchRead(session, "sale.order", [["id", "=", orderId]], ["partner_id"], 1);
  const pid = Array.isArray(o?.partner_id) ? o.partner_id[0] : null;
  if (pid) {
    const [p] = await odoo.searchRead(session, "res.partner", [["id", "=", pid]], ["category_id", "commercial_partner_id"], 1);
    const cid = Array.isArray(p?.commercial_partner_id) ? p.commercial_partner_id[0] : null;
    const company = cid && cid !== pid ? (await odoo.searchRead(session, "res.partner", [["id", "=", cid]], ["category_id"], 1))[0] : null;
    const blocking = await loadBlockingTags(session);
    const hit = [...clientBlockingTags(p, blocking), ...(company ? clientBlockingTags(company, blocking) : [])];
    if (hit.length) throw new Error(`client « ${hit[0].name} » : la commande doit être validée par le service client`);
  }
  const tag = await validatedTagId(session);
  if (!tag) throw new Error("Étiquette « Validé DC » introuvable dans Odoo");
  await odoo.write(session, "sale.order", [orderId], { tag_ids: [[4, tag]] });
  if (note && note.trim()) {
    await odoo.callMethod(session, "sale.order", "message_post", [[orderId]],
      { body: textToHtml(note.trim()), message_type: "comment", subtype_xmlid: "mail.mt_note", body_is_html: true }).catch(() => {});
  }
}
