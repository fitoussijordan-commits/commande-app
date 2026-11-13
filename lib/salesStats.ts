// lib/salesStats.ts
// Chiffres du commercial (commandes confirmées de ses clients, CA HT) :
// année en cours depuis le 1er janvier vs même période N-1, par client et par
// mois. Une commande passée sur une adresse de livraison compte pour la société.
import * as odoo from "@/lib/odoo";
import * as sync from "@/lib/sync";

export interface ClientStat { client: any; cur: number; prev: number; delta: number; ordersCur: number }
export interface SalesStats {
  year: number;
  clients: ClientStat[];
  months: { cur: number[]; prev: number[]; prevFull: number[] };   // 12 mois ; prevFull = N-1 complet
  kpi: { cur: number; prev: number; ordersCur: number; ordersPrev: number; clientsCur: number; clientsPrev: number };
  caFromOdoo: boolean;   // CA lu dans les champs Odoo « CA à date N / N-1 »
}

// Champs Odoo « CA à date N » / « CA à date N-1 » de la fiche client, repérés
// par libellé. Le CA par client et le CA total du tableau de bord en viennent :
// mêmes chiffres que la fiche client. Le nombre de commandes et le graphique
// mensuel restent calculés sur les commandes confirmées.
let _caFields: Promise<{ n?: string; n1?: string }> | null = null;
export function caDateFields(session: odoo.OdooSession): Promise<{ n?: string; n1?: string }> {
  if (!_caFields) {
    _caFields = odoo.callMethod(session, "res.partner", "fields_get", [], { attributes: ["string", "type"] })
      .then((f: Record<string, any>) => {
        const out: { n?: string; n1?: string } = {};
        for (const [name, d] of Object.entries(f)) {
          const l = String(d.string || "").trim();
          if (!["monetary", "float"].includes(d.type) || !/^ca\s+[àa]\s+date/i.test(l)) continue;
          if (/n\s*-\s*1\s*$/i.test(l)) out.n1 = out.n1 || name;
          else if (/\bn\s*$/i.test(l)) out.n = out.n || name;
        }
        return out;
      })
      .catch(() => { _caFields = null; return {}; });
  }
  return _caFields;
}

const toOdoo = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
let _cache: { uid: number; at: number; data: SalesStats } | null = null;

export async function loadSalesStats(session: odoo.OdooSession): Promise<SalesStats> {
  if (_cache && _cache.uid === session.uid && Date.now() - _cache.at < 5 * 60_000) return _cache.data;
  const now = new Date();
  const y = now.getFullYear();
  const curFrom = new Date(y, 0, 1), prevFrom = new Date(y - 1, 0, 1);
  const prevTo = new Date(now); prevTo.setFullYear(y - 1);          // même jour l'an dernier
  const orders = await odoo.searchRead(session, "sale.order",
    [["state", "in", ["sale", "done"]], ["date_order", ">=", toOdoo(prevFrom)],
     ["partner_id.commercial_partner_id.user_id", "=", session.uid]],
    ["partner_id", "amount_untaxed", "date_order"], 0);
  const pids = Array.from(new Set(orders.map((o: any) => o.partner_id?.[0]).filter(Boolean)));
  const partners = pids.length
    ? await odoo.searchRead(session, "res.partner", [["id", "in", pids]], ["id", "commercial_partner_id"], 0) : [];
  const toCompany = new Map<number, number>(partners.map((p: any) => [p.id, p.commercial_partner_id?.[0] || p.id]));

  const sums = new Map<number, { cur: number; prev: number; ordersCur: number }>();
  const months = { cur: Array(12).fill(0), prev: Array(12).fill(0), prevFull: Array(12).fill(0) };
  const kpi = { cur: 0, prev: 0, ordersCur: 0, ordersPrev: 0, clientsCur: 0, clientsPrev: 0 };
  for (const o of orders) {
    const cid = toCompany.get(o.partner_id?.[0]) || o.partner_id?.[0];
    if (!cid) continue;
    const d = new Date(String(o.date_order).replace(" ", "T") + "Z");
    const amt = o.amount_untaxed || 0;
    const s = sums.get(cid) || { cur: 0, prev: 0, ordersCur: 0 };
    if (d >= curFrom) { s.cur += amt; s.ordersCur++; months.cur[d.getMonth()] += amt; kpi.cur += amt; kpi.ordersCur++; }
    else {
      months.prevFull[d.getMonth()] += amt;
      if (d <= prevTo) { s.prev += amt; months.prev[d.getMonth()] += amt; kpi.prev += amt; kpi.ordersPrev++; }
    }
    sums.set(cid, s);
  }
  // CA par client : champs Odoo quand ils existent (calcul de la fiche client).
  const ca = await caDateFields(session);
  let fromOdoo = false;
  if (ca.n && ca.n1) {
    try {
      const rows: any[] = await odoo.searchRead(session, "res.partner",
        [["user_id", "=", session.uid], "|", [ca.n, "!=", 0], [ca.n1, "!=", 0]],
        ["id", "commercial_partner_id", ca.n, ca.n1], 0);
      // Une seule fois par société (les adresses enfants peuvent porter le même chiffre).
      const companies = rows.filter(r => (r.commercial_partner_id?.[0] || r.id) === r.id);
      for (const s of Array.from(sums.values())) { s.cur = 0; s.prev = 0; }
      for (const r of companies) {
        const s = sums.get(r.id) || { cur: 0, prev: 0, ordersCur: 0 };
        s.cur = Number(r[ca.n]) || 0; s.prev = Number(r[ca.n1]) || 0;
        sums.set(r.id, s);
      }
      kpi.cur = companies.reduce((t, r) => t + (Number(r[ca.n!]) || 0), 0);
      kpi.prev = companies.reduce((t, r) => t + (Number(r[ca.n1!]) || 0), 0);
      fromOdoo = true;
    } catch (e) { if (odoo.isNetworkError(e)) throw e; /* champs illisibles : calcul sur commandes */ }
  }
  const ids = Array.from(sums.keys());
  const clientRows = ids.length ? await odoo.searchRead(session, "res.partner", [["id", "in", ids]], sync.CLIENT_FIELDS, 0) : [];
  const clients: ClientStat[] = clientRows.map((c: any) => {
    const s = sums.get(c.id)!;
    return { client: c, cur: s.cur, prev: s.prev, delta: s.cur - s.prev, ordersCur: s.ordersCur };
  });
  kpi.clientsCur = clients.filter(c => c.cur > 0).length;
  kpi.clientsPrev = clients.filter(c => c.prev > 0).length;
  const data = { year: y, clients, months, kpi, caFromOdoo: fromOdoo };
  _cache = { uid: session.uid, at: Date.now(), data };
  return data;
}
