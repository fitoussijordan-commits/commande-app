// lib/orderMessages.ts
// Messages en attente sur les commandes du commercial (chatter Odoo) : le
// service client écrit sur une commande, le commercial le voit dès l'accueil.
// Un fil est « en attente » tant que le dernier message n'est pas du
// commercial. Il disparaît quand il est traité : le commercial répond (depuis
// la fiche commande), ou le marque « Traité » (mémorisé sur l'appareil).
import * as odoo from "@/lib/odoo";

export interface PendingThread {
  order: { id: number; name: string; date_order?: string; state: string; amount_total?: number; partner_id?: any };
  last: { id: number; author: string; date: string; text: string; isEmail: boolean };
  count: number;   // messages des autres depuis la dernière réponse du commercial
  mentioned: boolean;   // le commercial est cité (@) dans un message en attente
}

const LS_DONE = "order_msgs_done";   // id du dernier message marqué traité, par commande
export function doneMap(): Record<number, number> { try { return JSON.parse(localStorage.getItem(LS_DONE) || "{}"); } catch { return {}; } }
export function markDone(orderId: number, msgId: number) {
  try { localStorage.setItem(LS_DONE, JSON.stringify({ ...doneMap(), [orderId]: msgId })); } catch {}
}

const text = (h: any) => String(h || "").replace(/<br\s*\/?>/gi, " ").replace(/<\/p>/gi, " ").replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

let _partner: number | null | undefined;
async function myPartner(session: odoo.OdooSession): Promise<number | null> {
  if (_partner !== undefined) return _partner;
  const u = await odoo.searchRead(session, "res.users", [["id", "=", session.uid]], ["partner_id"], 1).catch(() => []);
  const pid: number | null = Array.isArray(u[0]?.partner_id) ? Number(u[0].partner_id[0]) : null;
  _partner = pid;
  return pid;
}

export async function loadPendingThreads(session: odoo.OdooSession, days = 30): Promise<PendingThread[]> {
  const me = await myPartner(session);
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 19).replace("T", " ");
  // Commandes du commercial (vendeur de la commande ou du client), récentes.
  const orders: any[] = await odoo.searchRead(session, "sale.order",
    ["|", ["user_id", "=", session.uid], ["partner_id.commercial_partner_id.user_id", "=", session.uid],
     ["state", "!=", "cancel"], ["write_date", ">=", since]],
    ["id", "name", "date_order", "state", "amount_total", "partner_id"], 500, "write_date desc");
  // Messages où le commercial est cité (@), sur N'IMPORTE quelle commande.
  const mentions: any[] = me == null ? [] : await odoo.searchRead(session, "mail.message",
    [["model", "=", "sale.order"], ["partner_ids", "in", [me]], ["date", ">=", since]], ["res_id"], 300).catch(() => []);
  const extraIds = Array.from(new Set(mentions.map(m => m.res_id))).filter(id => !orders.some(o => o.id === id));
  if (extraIds.length) orders.push(...await odoo.searchRead(session, "sale.order", [["id", "in", extraIds]],
    ["id", "name", "date_order", "state", "amount_total", "partner_id"], extraIds.length).catch(() => []));
  if (!orders.length) return [];
  const byId = new Map<number, any>(orders.map(o => [o.id, o]));
  const msgs: any[] = await odoo.searchRead(session, "mail.message",
    [["model", "=", "sale.order"], ["res_id", "in", orders.map(o => o.id)], ["message_type", "in", ["comment", "email"]], ["date", ">=", since]],
    ["id", "res_id", "body", "author_id", "date", "message_type", "partner_ids"], 1000, "date desc, id desc");
  const cites = (m: any) => me != null && Array.isArray(m.partner_ids) && m.partner_ids.includes(me);
  const done = doneMap();
  const threads = new Map<number, PendingThread>();
  const closed = new Set<number>();   // fil dont le dernier message est du commercial
  for (const m of msgs) {             // du plus récent au plus ancien
    const oid = m.res_id; if (closed.has(oid)) continue;
    const t = text(m.body); if (!t) continue;
    const mine = me != null && Array.isArray(m.author_id) && m.author_id[0] === me;
    if (mine) { closed.add(oid); continue; }
    if ((done[oid] || 0) >= m.id) { closed.add(oid); continue; }
    const cur = threads.get(oid);
    if (cur) { cur.count++; if (cites(m)) cur.mentioned = true; continue; }
    threads.set(oid, {
      order: byId.get(oid),
      last: { id: m.id, author: Array.isArray(m.author_id) ? String(m.author_id[1]) : "Odoo", date: String(m.date), text: t, isEmail: m.message_type === "email" },
      count: 1, mentioned: cites(m),
    });
  }
  // Citations (@) en premier, puis les plus récents.
  return Array.from(threads.values()).filter(t => t.order)
    .sort((a, b) => Number(b.mentioned) - Number(a.mentioned) || b.last.date.localeCompare(a.last.date));
}
