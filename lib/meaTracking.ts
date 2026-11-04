// lib/meaTracking.ts
// Suivi des MEA : pour chaque campagne active, quels clients du commercial ont
// pris (commande avec l'offre dans « Offres commandées ») et lesquels non, plus
// la prévision du commercial (offre envisagée + note) par client.
//
// Campagne = offres (x_offre_produit) partageant le même début de nom :
// « MEA Cures 2026 - Essentiel » et « MEA Cures 2026 - Premium » forment la
// campagne « MEA Cures 2026 » (variantes Essentiel / Premium).
//
// Prévisions : modèle Studio « Suivi MEA » (x_suivi_mea…), repéré par son nom ;
// ses champs sont repérés par type / relation / libellé :
//   Client (many2one res.partner) · Campagne (texte) · Offre prévue (many2one
//   Offre produit) · Note (texte) · Commercial (many2one res.users, facultatif).
import * as odoo from "@/lib/odoo";
import { orderMeta } from "@/lib/orderOffers";
import { NOT_SUPPLIER, mineDomain } from "@/lib/clients";

export interface MeaOffer { id: number; name: string; variant: string }
export interface MeaCampaign { key: string; offers: MeaOffer[] }
export interface Taken { state: "pris" | "devis"; orders: string[]; offers: string[]; date: string }
export interface Plan { id?: number; offerId: number | null; note: string }
export interface TrackingModel {
  model: string; partner: string; campaign?: string; offer?: string; note?: string; user?: string;
}
export interface MeaData {
  campaigns: MeaCampaign[];
  clients: any[];
  taken: Map<string, Map<number, Taken>>;       // campagne → client → commande(s)
  plans: Map<string, Plan>;                      // `${campagne}|${client}` → prévision
  tracking: TrackingModel | null;                // null : modèle Studio pas encore créé
}

const campaignOf = (name: string) => {
  const i = name.lastIndexOf(" - ");
  return i > 0 ? { key: name.slice(0, i).trim(), variant: name.slice(i + 3).trim() } : { key: name.trim(), variant: name.trim() };
};
export const planKey = (campaign: string, clientId: number) => `${campaign}|${clientId}`;

async function findTrackingModel(session: odoo.OdooSession): Promise<TrackingModel | null> {
  try {
    const models = await odoo.searchRead(session, "ir.model", [["model", "=like", "x_%"], ["name", "ilike", "suivi"]], ["model", "name"], 20);
    const m = models.find((r: any) => /mea/i.test(`${r.name} ${r.model}`));
    if (!m) return null;
    const fields: Record<string, any> = await odoo.callMethod(session, m.model, "fields_get", [], { attributes: ["string", "type", "relation"] });
    const out: TrackingModel = { model: m.model, partner: "" };
    for (const [name, f] of Object.entries(fields)) {
      const label = String(f.string || "");
      if (f.type === "many2one" && f.relation === "res.partner" && !out.partner) out.partner = name;
      else if (f.type === "many2one" && f.relation === "res.users" && !/create|write/.test(name) && !out.user) out.user = name;
      else if (f.type === "many2one" && /offre/i.test(`${f.relation} ${label}`) && !out.offer) out.offer = name;
      else if ((f.type === "char" || f.type === "text") && /campagne|mea/i.test(label) && name !== "x_name" && !out.campaign) out.campaign = name;
      else if ((f.type === "text" || f.type === "html" || f.type === "char") && /note|commentaire|remarque/i.test(label) && !out.note) out.note = name;
    }
    return out.partner && out.campaign ? out : null;
  } catch { return null; }
}

// mine : clients dont l'utilisateur est le Vendeur (sinon tous les clients,
// limités aux 2 000 plus gros CA N-1).
export async function loadMeaData(session: odoo.OdooSession, mine = true): Promise<MeaData> {
  const meta = await orderMeta(session);
  const rel = meta.offersRelation, offersField = meta.offersField;
  if (!rel || !offersField) throw new Error("Champ « Offres commandées » introuvable sur les commandes");

  // Offres actives, regroupées par campagne.
  const ofields: Record<string, any> = await odoo.callMethod(session, rel, "fields_get", [], { attributes: ["type"] });
  const activeField = ["x_active", "active"].find(f => ofields[f]?.type === "boolean");
  let offerRows = await odoo.searchRead(session, rel, activeField ? [[activeField, "=", true]] : [], ["display_name"], 500, "id desc");
  // MEA active = offre dont au moins un article (champ « Offre produit ») est
  // actif et encore en stock. Sans ce champ article : toutes les offres.
  try {
    const prods = await odoo.searchRead(session, "product.product",
      [["x_offre_produit_id", "!=", false], ["active", "=", true], ["virtual_available", ">", 0]], ["x_offre_produit_id"], 0);
    const live = new Set(prods.map((p: any) => p.x_offre_produit_id?.[0]).filter(Boolean));
    offerRows = offerRows.filter((r: any) => live.has(r.id));
  } catch (e) { if (odoo.isNetworkError(e)) throw e; }
  const byKey = new Map<string, MeaCampaign>();
  for (const r of offerRows) {
    const name = String(r.display_name || "");
    const { key, variant } = campaignOf(name);
    if (!byKey.has(key)) byKey.set(key, { key, offers: [] });
    byKey.get(key)!.offers.push({ id: r.id, name, variant });
  }
  const campaigns = Array.from(byKey.values());   // ordre : offres les plus récentes d'abord
  const offerCampaign = new Map<number, string>();
  campaigns.forEach(c => c.offers.forEach(o => offerCampaign.set(o.id, c.key)));

  // Clients du commercial (sociétés), hors fournisseurs.
  const clients = await odoo.searchRead(session, "res.partner",
    [...mineDomain(session.uid, mine), ["customer_rank", ">", 0], ["parent_id", "=", false], ["active", "=", true], NOT_SUPPLIER],
    ["id", "name", "ref", "city", "x_ca_n_1", "phone", "street", "zip", "property_product_pricelist", "category_id", "is_company", "type", "customer_rank", "user_id"], mine ? 0 : 2000, "x_ca_n_1 desc");
  const clientIds = new Set(clients.map((c: any) => c.id));

  // Commandes portant une offre de ces campagnes (devis compris).
  const taken = new Map<string, Map<number, Taken>>();
  const offerIds = Array.from(offerCampaign.keys());
  if (offerIds.length) {
    const orders = await odoo.searchRead(session, "sale.order",
      [[offersField, "in", offerIds], ["state", "in", ["draft", "sent", "sale", "done"]],
       ...(mine ? [["partner_id.commercial_partner_id.user_id", "=", session.uid]] : [])],
      ["name", "partner_id", offersField, "state", "date_order"], 0, "date_order desc");
    const pids = Array.from(new Set(orders.map((o: any) => o.partner_id?.[0]).filter(Boolean)));
    const partners = pids.length ? await odoo.searchRead(session, "res.partner", [["id", "in", pids]], ["commercial_partner_id"], 0) : [];
    const toCompany = new Map<number, number>(partners.map((p: any) => [p.id, p.commercial_partner_id?.[0] || p.id]));
    const offerName = new Map<number, string>(offerRows.map((r: any) => [r.id, String(r.display_name || "")]));
    for (const o of orders) {
      const cid = toCompany.get(o.partner_id?.[0]) || o.partner_id?.[0];
      if (!clientIds.has(cid)) continue;
      const confirmed = o.state === "sale" || o.state === "done";
      for (const oid of (o[offersField] || []) as number[]) {
        const key = offerCampaign.get(oid);
        if (!key) continue;
        if (!taken.has(key)) taken.set(key, new Map());
        const m = taken.get(key)!;
        const t = m.get(cid) || { state: "devis" as const, orders: [], offers: [], date: String(o.date_order).slice(0, 10) };
        if (confirmed) t.state = "pris";
        if (!t.orders.includes(o.name)) t.orders.push(o.name);
        const v = campaignOf(offerName.get(oid) || "").variant;
        if (!t.offers.includes(v)) t.offers.push(v);
        m.set(cid, t);
      }
    }
  }

  // Prévisions enregistrées.
  const tracking = await findTrackingModel(session);
  const plans = new Map<string, Plan>();
  if (tracking && clients.length) {
    const fields = ["id", tracking.partner, tracking.campaign!, tracking.offer, tracking.note].filter(Boolean) as string[];
    const rows = await odoo.searchRead(session, tracking.model, [[tracking.partner, "in", Array.from(clientIds)]], fields, 0).catch(() => []);
    for (const r of rows) {
      const cid = r[tracking.partner]?.[0];
      if (!cid) continue;
      plans.set(planKey(String(r[tracking.campaign!] || ""), cid), {
        id: r.id, offerId: tracking.offer ? (r[tracking.offer]?.[0] || null) : null, note: tracking.note ? String(r[tracking.note] || "") : "",
      });
    }
  }
  return { campaigns, clients, taken, plans, tracking };
}

// Enregistre (ou met à jour) la prévision d'un client pour une campagne.
export async function savePlan(session: odoo.OdooSession, t: TrackingModel, campaign: string, clientId: number, plan: Plan): Promise<number> {
  const vals: any = { [t.partner]: clientId, [t.campaign!]: campaign };
  if (t.offer) vals[t.offer] = plan.offerId || false;
  if (t.note) vals[t.note] = plan.note || false;
  if (t.user) vals[t.user] = session.uid;
  if (plan.id) { await odoo.write(session, t.model, [plan.id], vals); return plan.id; }
  return await odoo.create(session, t.model, vals);
}
