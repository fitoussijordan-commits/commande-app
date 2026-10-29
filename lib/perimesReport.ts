// lib/perimesReport.ts
// Rapport des reprises de périmés, tous clients : utilisé par l'écran « Périmés »
// de l'app ET par l'export Excel côté serveur. Une seule lecture des données pour
// que l'écran et le fichier affichent exactement les mêmes chiffres.
//
// Source : les BC de reprise, repérés par l'étiquette « Reprise périmé » — ou,
// pour ceux créés avant l'étiquette, par leur référence client PERIM-.
// Pas l'emplacement de rebut : il est par commercial et par mois, tous clients mêlés.
//
// Aucune dépendance au client Odoo de l'app : l'appelant fournit `searchRead`
// (proxy côté app, appel direct avec la session côté serveur).

export type SearchRead = (
  model: string, domain: any[], fields: string[], limit?: number, order?: string,
) => Promise<any[]>;

export type LineType = "Repris" | "Échange" | "Ajustement";

export interface ReportLine {
  orderId: number; orderName: string; date: string;
  clientId: number; client: string; clientRef: string; city: string;
  commercial: string; state: string;
  type: LineType; ref: string; product: string; lot: string;
  qty: number; unit: number; amount: number;
}

export interface ReportOrder {
  id: number; name: string; date: string; state: string;
  clientId: number; client: string; clientRef: string; city: string; commercial: string;
  repris: number;      // valeur reprise (positive)
  echange: number;     // produits d'échange
  ajustement: number;  // ligne ramenant le BC à 0
}

export interface ReportClient {
  clientId: number; client: string; clientRef: string; city: string;
  count: number; repris: number; echange: number; ajustement: number; last: string;
}

export interface PerimesReport {
  orders: ReportOrder[];
  lines: ReportLine[];
  clients: ReportClient[];
  totals: { repris: number; echange: number; count: number; clients: number };
}

export interface ReportFilter {
  from?: string;   // AAAA-MM-JJ inclus
  to?: string;     // AAAA-MM-JJ inclus
}

const STATE_LABEL: Record<string, string> = {
  draft: "Devis", sent: "Devis envoyé", sale: "Confirmé", done: "Verrouillé", cancel: "Annulé",
};

// « Reprise périmé — Coffret X — lot FA123 [1011057] » → produit, lot, réf.
function parseRepriseName(name: string): { product: string; lot: string; ref: string } {
  const ref = (name.match(/\[([^\]]+)\]\s*$/) || [])[1] || "";
  const lot = (name.match(/—\s*lot\s+(.+?)(?:\s*\[[^\]]*\])?\s*$/i) || [])[1] || "";
  const product = name
    .replace(/^Reprise p[ée]rim[ée]\s*—\s*/i, "")
    .replace(/\s*—\s*lot\s+.*$/i, "")
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .trim();
  return { product, lot: lot.trim(), ref };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function loadPerimesReport(sr: SearchRead, f: ReportFilter = {}): Promise<PerimesReport> {
  const domain: any[] = [
    ["state", "!=", "cancel"],
    "|", ["tag_ids.name", "ilike", "reprise p"], ["client_order_ref", "like", "PERIM-"],
  ];
  if (f.from) domain.push(["date_order", ">=", `${f.from} 00:00:00`]);
  if (f.to) domain.push(["date_order", "<=", `${f.to} 23:59:59`]);

  const so = await sr("sale.order", domain,
    ["id", "name", "date_order", "state", "partner_id", "user_id"], 0, "date_order desc");
  if (!so.length) return { orders: [], lines: [], clients: [], totals: { repris: 0, echange: 0, count: 0, clients: 0 } };

  const partnerIds = Array.from(new Set(so.map((o: any) => o.partner_id?.[0]).filter(Boolean)));
  const [sol, partners] = await Promise.all([
    sr("sale.order.line", [["order_id", "in", so.map((o: any) => o.id)], ["display_type", "=", false]],
      ["order_id", "name", "product_id", "product_uom_qty", "price_unit", "price_subtotal"], 0, "order_id, sequence, id"),
    sr("res.partner", [["id", "in", partnerIds]], ["id", "name", "ref", "city"], 0),
  ]);
  const pById = new Map<number, any>(partners.map((p: any) => [p.id, p]));

  const orders: ReportOrder[] = so.map((o: any) => {
    const p = pById.get(o.partner_id?.[0]) || {};
    return {
      id: o.id, name: String(o.name), date: String(o.date_order || "").slice(0, 10),
      state: STATE_LABEL[o.state] || o.state,
      clientId: o.partner_id?.[0] || 0,
      client: String(p.name || o.partner_id?.[1] || ""),
      clientRef: p.ref || "", city: p.city || "",
      commercial: String(o.user_id?.[1] || ""),
      repris: 0, echange: 0, ajustement: 0,
    };
  });
  const oById = new Map<number, ReportOrder>(orders.map(o => [o.id, o]));

  const lines: ReportLine[] = [];
  for (const l of sol) {
    const o = oById.get(l.order_id?.[0]);
    if (!o) continue;
    const name = String(l.name || "");
    const amount = r2(Number(l.price_subtotal) || 0);
    const qty = Number(l.product_uom_qty) || 0;
    let type: LineType;
    let product = String(l.product_id?.[1] || name).replace(/^\[[^\]]*\]\s*/, "");
    let ref = (String(l.product_id?.[1] || "").match(/^\[([^\]]+)\]/) || [])[1] || "";
    let lot = "";
    if (/^Ajustement reprise/i.test(name)) {
      type = "Ajustement"; product = name; ref = "";
      o.ajustement = r2(o.ajustement + amount);
    } else if (qty < 0 || amount < 0) {
      type = "Repris";
      const parsed = parseRepriseName(name);
      product = parsed.product || product; lot = parsed.lot; ref = parsed.ref || ref;
      o.repris = r2(o.repris - amount);
    } else {
      type = "Échange";
      o.echange = r2(o.echange + amount);
    }
    lines.push({
      orderId: o.id, orderName: o.name, date: o.date,
      clientId: o.clientId, client: o.client, clientRef: o.clientRef, city: o.city,
      commercial: o.commercial, state: o.state,
      type, ref, product, lot, qty: Math.abs(qty), unit: r2(Number(l.price_unit) || 0), amount,
    });
  }

  const cById = new Map<number, ReportClient>();
  for (const o of orders) {
    const c = cById.get(o.clientId) || {
      clientId: o.clientId, client: o.client, clientRef: o.clientRef, city: o.city,
      count: 0, repris: 0, echange: 0, ajustement: 0, last: "",
    };
    c.count++; c.repris = r2(c.repris + o.repris); c.echange = r2(c.echange + o.echange);
    c.ajustement = r2(c.ajustement + o.ajustement);
    if (o.date > c.last) c.last = o.date;
    cById.set(o.clientId, c);
  }
  const clients = Array.from(cById.values()).sort((a, b) => b.repris - a.repris);

  return {
    orders, lines, clients,
    totals: {
      repris: r2(orders.reduce((s, o) => s + o.repris, 0)),
      echange: r2(orders.reduce((s, o) => s + o.echange, 0)),
      count: orders.length, clients: clients.length,
    },
  };
}
