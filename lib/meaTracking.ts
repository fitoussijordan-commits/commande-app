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
export interface MeaCampaign {
  key: string; offers: MeaOffer[]; active: boolean;
  // Modèles de devis liés (contiennent un article 7… de la campagne), archivés
  // compris, avec leur « Date début ». Absent : ancien rapprochement par le nom.
  templateIds?: number[];
  templateStarts?: string[];
  // « Exclusif Institut » / « Exclusif Revendeur » (nom de l'offre, de la
  // campagne ou d'un modèle de devis lié) : réservée à ce type de client.
  exclusive?: ClientKind | null;
}

// ── Type de client : INSTITUT ou REVENDEUR ──────────────────────────────────
// Champ « Famille » (x_famille_id) : contient « Institut » ou « Esth » → INSTITUT,
// sinon REVENDEUR (champ vide compris).
export type ClientKind = "institut" | "revendeur";
export const FAMILLE_FIELD = "x_famille_id";
export function clientKind(client: any): ClientKind {
  const v = client?.[FAMILLE_FIELD];
  const label = Array.isArray(v) ? String(v[1] || "") : typeof v === "string" ? v : "";
  return /institut|esth/i.test(label) ? "institut" : "revendeur";
}
export function exclusiveOf(...names: string[]): ClientKind | null {
  const s = names.join(" ");
  if (/exclusi\w*\W+institut/i.test(s)) return "institut";
  if (/exclusi\w*\W+revendeur/i.test(s)) return "revendeur";
  return null;
}
// La MEA s'adresse-t-elle à ce client ? (sans exclusivité : à tous)
export const meaTargets = (c: MeaCampaign, client: any) => !c.exclusive || c.exclusive === clientKind(client);
// Le champ Famille existe-t-il sur res.partner ? (lu une fois)
let _famille: Promise<boolean> | null = null;
export function hasFamilleField(session: odoo.OdooSession): Promise<boolean> {
  if (!_famille) _famille = odoo.callMethod(session, "res.partner", "fields_get", [[FAMILLE_FIELD]], { attributes: ["type"] })
    .then((f: any) => !!f?.[FAMILLE_FIELD]).catch(e => { _famille = null; if (odoo.isNetworkError(e)) throw e; return false; });
  return _famille;
}
export interface Taken { state: "pris" | "devis"; orders: string[]; offers: string[]; date: string }
export interface Plan { id?: number; offerId: number | null; note: string; ineligible?: boolean }   // ineligible : client exclu du placement de cette MEA
export interface TrackingModel {
  model: string; partner: string; campaign?: string; offer?: string; note?: string; user?: string; ineligible?: string; eligibleIsPositive?: boolean;
}
export interface MeaData {
  campaigns: MeaCampaign[];
  clients: any[];
  taken: Map<string, Map<number, Taken>>;       // campagne → client → commande(s)
  plans: Map<string, Plan>;                      // `${campagne}|${client}` → prévision
  tracking: TrackingModel | null;                // null : modèle Studio pas encore créé
}

// Campagne = nom avant le PREMIER « - » (« MEA Noël 2026 - Essentiel - Exclusif
// retail » → « MEA Noël 2026 ») : toutes les variantes d'une MEA forment une
// seule campagne (avant : coupe au dernier « - », d'où plusieurs « MEA Noël »).
const campaignOf = (name: string) => {
  const n = name.trim();
  const i = n.indexOf(" - ");
  return i > 0 ? { key: n.slice(0, i).trim(), variant: n.slice(i + 3).trim() } : { key: n, variant: n };
};
export const planKey = (campaign: string, clientId: number) => `${campaign}|${clientId}`;

export async function findTrackingModel(session: odoo.OdooSession): Promise<TrackingModel | null> {
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
      else if (f.type === "boolean" && /[ée]ligib/i.test(label) && !out.ineligible) { out.ineligible = name; out.eligibleIsPositive = !/non|in[ée]ligib|pas/i.test(label); }
      else if ((f.type === "char" || f.type === "text") && /campagne|mea/i.test(label) && name !== "x_name" && !out.campaign) out.campaign = name;
      else if ((f.type === "text" || f.type === "html" || f.type === "char") && /note|commentaire|remarque/i.test(label) && !out.note) out.note = name;
    }
    return out.partner && out.campaign ? out : null;
  } catch { return null; }
}

// mine : clients dont l'utilisateur est le Vendeur (sinon tous les clients,
// limités aux 2 000 plus gros CA N-1).
// Campagnes MEA (offres regroupées par début de nom), chacune marquée active ou non.
export interface CampaignSet { campaigns: MeaCampaign[]; offersField: string; offerRows: any[]; offerCampaign: Map<number, string> }
// SOURCE DES MEA : les articles dont la référence commence par 7 (archivés
// compris) ; chacun porte son offre (x_offre_produit_id). Une offre = une variante,
// regroupées en campagne par leur nom (« MEA Noël 2026 - Standard » → « MEA Noël
// 2026 »). Modèle de devis lié = modèle qui contient un de ces articles 7… ; la
// MEA est ACTIVE si un modèle lié est actif. Base sans ces données : ancien calcul
// (offres + noms des modèles), plus bas.
export const TEMPLATE_START_FIELD = "x_studio_date_debut_1";
export async function loadCampaigns(session: odoo.OdooSession): Promise<CampaignSet> {
  const meta = await orderMeta(session);
  const offersField = meta.offersField;
  if (!meta.offersRelation || !offersField) throw new Error("Champ « Offres commandées » introuvable sur les commandes");
  let sevens: any[] = [];
  try {
    sevens = await odoo.searchRead(session, "product.product",
      [["default_code", "=like", "7%"], ["active", "in", [true, false]], ["x_offre_produit_id", "!=", false]],
      ["id", "x_offre_produit_id"], 0);
  } catch (e) { if (odoo.isNetworkError(e)) throw e; }
  if (!sevens.length) return loadCampaignsByName(session);

  // Lignes de modèles de devis portant ces articles → modèles liés (archivés compris).
  const sevenIds = sevens.map(p => p.id);
  const tLines: any[] = await odoo.searchRead(session, "sale.order.template.line",
    [["product_id", "in", sevenIds]], ["product_id", "sale_order_template_id"], 0).catch(e => { if (odoo.isNetworkError(e)) throw e; return []; });
  const tplIds = Array.from(new Set(tLines.map(l => l.sale_order_template_id?.[0]).filter(Boolean))) as number[];
  let tpls: any[] = [];
  if (tplIds.length) {
    const dom = [["id", "in", tplIds], ["active", "in", [true, false]]];
    try { tpls = await odoo.searchRead(session, "sale.order.template", dom, ["id", "name", "active", TEMPLATE_START_FIELD], 0); }
    catch (e) {
      if (odoo.isNetworkError(e)) throw e;
      tpls = await odoo.searchRead(session, "sale.order.template", dom, ["id", "name", "active"], 0);   // sans « Date début »
    }
  }
  // Les modèles d'implantation ne définissent pas une MEA.
  const tplById = new Map<number, any>(tpls.filter(x => !/implantation/i.test(String(x.name || ""))).map(x => [x.id, x]));
  const tplsOfProduct = new Map<number, number[]>();
  for (const l of tLines) {
    const pid = l.product_id?.[0], tid = l.sale_order_template_id?.[0];
    if (!pid || !tid || !tplById.has(tid)) continue;
    tplsOfProduct.set(pid, [...(tplsOfProduct.get(pid) || []), tid]);
  }

  // Offres (variantes) → campagnes.
  const offerName = new Map<number, string>();
  const tplsOfOffer = new Map<number, Set<number>>();
  for (const p of sevens) {
    const [oid, oname] = p.x_offre_produit_id;
    offerName.set(oid, String(oname || ""));
    const s = tplsOfOffer.get(oid) || new Set<number>();
    (tplsOfProduct.get(p.id) || []).forEach(id => s.add(id));
    tplsOfOffer.set(oid, s);
  }
  const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const byKey = new Map<string, MeaCampaign>();
  const offerIds = Array.from(offerName.keys()).sort((a, b) => b - a);   // plus récentes d'abord
  for (const oid of offerIds) {
    const name = offerName.get(oid)!;
    const { key, variant } = campaignOf(name);
    if (!fold(key)) continue;
    const c = byKey.get(key) || { key, offers: [], active: false, templateIds: [], templateStarts: [] };
    c.offers.push({ id: oid, name, variant });
    for (const tid of Array.from(tplsOfOffer.get(oid) || [])) {
      if (c.templateIds!.includes(tid)) continue;
      const tpl = tplById.get(tid);
      c.templateIds!.push(tid);
      if (tpl?.active) c.active = true;
      if (tpl?.[TEMPLATE_START_FIELD]) c.templateStarts!.push(String(tpl[TEMPLATE_START_FIELD]).slice(0, 10));
    }
    byKey.set(key, c);
  }
  const all = Array.from(byKey.values());
  all.forEach(c => { c.exclusive = exclusiveOf(c.key, ...c.offers.map(o => o.name), ...(c.templateIds || []).map(id => String(tplById.get(id)?.name || ""))); });
  const campaigns = [...all.filter(c => c.active), ...all.filter(c => !c.active)];
  const offerCampaign = new Map<number, string>();
  campaigns.forEach(c => c.offers.forEach(o => offerCampaign.set(o.id, c.key)));
  const offerRows = offerIds.map(id => ({ id, display_name: offerName.get(id) }));
  return { campaigns, offersField, offerRows, offerCampaign };
}

// Ancien calcul (base sans articles 7… reliés à une offre) : offres + noms des modèles.
async function loadCampaignsByName(session: odoo.OdooSession): Promise<CampaignSet> {
  const meta = await orderMeta(session);
  const rel = meta.offersRelation, offersField = meta.offersField;
  if (!rel || !offersField) throw new Error("Champ « Offres commandées » introuvable sur les commandes");

  // Toutes les offres récentes (archivées comprises), regroupées par campagne,
  // chacune marquée active ou non. L'écran filtre « Actives / Toutes ».
  const ofields: Record<string, any> = await odoo.callMethod(session, rel, "fields_get", [], { attributes: ["type", "string"] });
  const activeField = ["x_active", "active"].find(f => ofields[f]?.type === "boolean");
  // Dates de validité de l'offre, si le modèle en a (repérées par libellé).
  const dateField = (re: RegExp) => Object.entries(ofields).find(([, f]: [string, any]) => ["date", "datetime"].includes(f.type) && re.test(String(f.string || "")))?.[0];
  const endField = dateField(/\b(fin|end|jusqu|expir)/i);
  const startField = dateField(/\b(d[ée]but|start|depuis)/i);
  const offerRows: any[] = await odoo.searchRead(session, rel,
    activeField ? [[activeField, "in", [true, false]]] : [],
    ["display_name", ...(activeField ? [activeField] : []), ...(endField ? [endField] : []), ...(startField ? [startField] : [])], 0, "id desc");
  const today = new Date().toISOString().slice(0, 10);
  const offerOk = (r: any) => (!activeField || r[activeField] !== false)
    && (!endField || !r[endField] || String(r[endField]).slice(0, 10) >= today)
    && (!startField || !r[startField] || String(r[startField]).slice(0, 10) <= today);

  // Encore proposée = un modèle de devis actif porte le nom de la campagne (c'est
  // ce que le commercial applique dans le catalogue). À défaut de modèle
  // reconnu : au moins un article de l'offre actif et en stock.
  const fold = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  let templateNames: string[] = [];
  try {
    templateNames = (await odoo.searchRead(session, "sale.order.template", [], ["name"], 0)).map((t: any) => fold(String(t.name || "")));
  } catch (e) { if (odoo.isNetworkError(e)) throw e; }
  let liveStock = new Set<number>();
  try {
    const prods = await odoo.searchRead(session, "product.product",
      [["x_offre_produit_id", "!=", false], ["active", "=", true], ["virtual_available", ">", 0]], ["x_offre_produit_id"], 0);
    liveStock = new Set(prods.map((p: any) => p.x_offre_produit_id?.[0]).filter(Boolean));
  } catch (e) { if (odoo.isNetworkError(e)) throw e; }

  const byKey = new Map<string, MeaCampaign>();
  for (const r of offerRows) {
    const name = String(r.display_name || "");
    const { key, variant } = campaignOf(name);
    if (!fold(key)) continue;   // offre sans nom de campagne (« - … ») : ignorée
    if (!byKey.has(key)) byKey.set(key, { key, offers: [], active: false });
    byKey.get(key)!.offers.push({ id: r.id, name, variant });
  }
  const all = Array.from(byKey.values());
  const okOffers = (c: MeaCampaign) => c.offers.filter(o => offerOk(offerRows.find(r => r.id === o.id)));
  const byTemplate = (c: MeaCampaign) => templateNames.some(t => t.startsWith(fold(c.key)));
  const byStock = (c: MeaCampaign) => c.offers.some(o => liveStock.has(o.id));
  all.forEach(c => { c.active = okOffers(c).length > 0 && byTemplate(c); });
  // Aucun modèle ne correspond aux noms d'offres : on garde l'ancien critère (stock).
  if (!all.some(c => c.active)) all.forEach(c => { c.active = okOffers(c).length > 0 && (byStock(c) || liveStock.size === 0); });
  // Actives d'abord, puis les plus récentes.
  const campaigns = [...all.filter(c => c.active), ...all.filter(c => !c.active)];
  const offerCampaign = new Map<number, string>();
  campaigns.forEach(c => c.offers.forEach(o => offerCampaign.set(o.id, c.key)));

  return { campaigns, offersField, offerRows, offerCampaign };
}

export async function loadMeaData(session: odoo.OdooSession, mine = true): Promise<MeaData> {
  const { campaigns, offersField, offerRows, offerCampaign } = await loadCampaigns(session);

  // Clients du commercial (sociétés), hors fournisseurs.
  const clients = await odoo.searchRead(session, "res.partner",
    [...mineDomain(session.uid, mine), ["customer_rank", ">", 0], ["parent_id", "=", false], ["active", "=", true], NOT_SUPPLIER],
    ["id", "name", "ref", "city", "x_ca_n_1", "phone", "street", "zip", "property_product_pricelist", "category_id", "is_company", "type", "customer_rank", "user_id",
     ...(await hasFamilleField(session) ? [FAMILLE_FIELD] : [])], mine ? 0 : 2000, "x_ca_n_1 desc");
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
    const fields = ["id", tracking.partner, tracking.campaign!, tracking.offer, tracking.note, tracking.ineligible].filter(Boolean) as string[];
    const rows = await odoo.searchRead(session, tracking.model, [[tracking.partner, "in", Array.from(clientIds)]], fields, 0).catch(() => []);
    for (const r of rows) {
      const cid = r[tracking.partner]?.[0];
      if (!cid) continue;
      plans.set(planKey(String(r[tracking.campaign!] || ""), cid), {
        id: r.id, offerId: tracking.offer ? (r[tracking.offer]?.[0] || null) : null, note: tracking.note ? String(r[tracking.note] || "") : "",
        ineligible: tracking.ineligible ? eligibleFlag(tracking, r[tracking.ineligible]) : false,
      });
    }
  }
  // Sans modèle Studio : prévisions et « non éligible » gardés sur l'appareil.
  if (!tracking) Object.entries(localPlans()).forEach(([k, p]) => plans.set(k, p));
  return { campaigns, clients, taken, plans, tracking };
}

// Clients éligibles d'une MEA (base du % de placement) : tous, moins ceux
// cochés « Non éligible » qui ne l'ont pas prise.
export function eligibleCount(d: MeaData, key: string): number {
  const tk = d.taken.get(key);
  const camp = d.campaigns.find(c => c.key === key);
  return d.clients.filter(c => tk?.has(c.id) || (!d.plans.get(planKey(key, c.id))?.ineligible && (!camp || meaTargets(camp, c)))).length;
}

// Case « Non éligible » : le champ Studio peut s'appeler « Non éligible » ou « Éligible ».
const eligibleFlag = (t: TrackingModel, v: any) => t.eligibleIsPositive ? v === false : !!v;

// Enregistre (ou met à jour) la prévision d'un client pour une campagne.
export async function savePlan(session: odoo.OdooSession, t: TrackingModel, campaign: string, clientId: number, plan: Plan): Promise<number> {
  const vals: any = { [t.partner]: clientId, [t.campaign!]: campaign };
  if (t.offer) vals[t.offer] = plan.offerId || false;
  if (t.note) vals[t.note] = plan.note || false;
  if (t.ineligible) vals[t.ineligible] = t.eligibleIsPositive ? !plan.ineligible : !!plan.ineligible;
  if (t.user) vals[t.user] = session.uid;
  if (plan.id) { await odoo.write(session, t.model, [plan.id], vals); return plan.id; }
  return await odoo.create(session, t.model, vals);
}

// Sans le modèle Studio « Suivi MEA », les prévisions (offre prévue + note) sont
// gardées sur l'appareil : utilisables tout de suite, ni partagées ni dans Odoo.
const LS_PLANS = "mea_plans_local";
export function localPlans(): Record<string, Plan> { try { return JSON.parse(localStorage.getItem(LS_PLANS) || "{}"); } catch { return {}; } }
export function saveLocalPlan(k: string, p: Plan) { try { localStorage.setItem(LS_PLANS, JSON.stringify({ ...localPlans(), [k]: p })); } catch {} }

// Prévisions d'UN client (toutes campagnes) : modèle Studio, sinon appareil.
export async function clientPlans(session: odoo.OdooSession, clientId: number): Promise<{ tracking: TrackingModel | null; plans: Map<string, Plan> }> {
  const tracking = await findTrackingModel(session);
  const plans = new Map<string, Plan>();
  if (tracking) {
    const fields = ["id", tracking.partner, tracking.campaign!, tracking.offer, tracking.note, tracking.ineligible].filter(Boolean) as string[];
    const rows = await odoo.searchRead(session, tracking.model, [[tracking.partner, "=", clientId]], fields, 0).catch(() => []);
    for (const r of rows) plans.set(planKey(String(r[tracking.campaign!] || ""), clientId), {
      id: r.id, offerId: tracking.offer ? (r[tracking.offer]?.[0] || null) : null, note: tracking.note ? String(r[tracking.note] || "") : "",
      ineligible: tracking.ineligible ? eligibleFlag(tracking, r[tracking.ineligible]) : false,
    });
  } else {
    for (const [k, v] of Object.entries(localPlans())) if (k.endsWith(`|${clientId}`)) plans.set(k, v);
  }
  return { tracking, plans };
}
