// lib/sync.ts
// Orchestration du mode hors ligne :
//  1. Préchargement (online) du catalogue produits + clients + règles de prix
//     vers IndexedDB, pour consultation sans réseau.
//  2. Lecture cache-first : renvoie les données locales quand on est hors ligne.
//  3. Rejeu de la file de commandes créées hors ligne vers Odoo au retour réseau.

import * as odoo from "@/lib/odoo";
import * as db from "@/lib/localdb";

// Champs produits — identiques à ceux consommés dans OrderScreen (favoris, MEA, recherche).
export const PRODUCT_FIELDS = [
  "id", "name", "default_code", "barcode", "lst_price",
  "product_tmpl_id", "virtual_available",
];

// Champs clients — alignés sur CLIENT_FIELDS d'OrderScreen (+ géoloc pour la carte).
export const CLIENT_FIELDS = [
  "id", "name", "ref", "city", "country_id",
  "property_product_pricelist", "email", "phone",
  "partner_latitude", "partner_longitude",
];

const KEY = "all";

export interface SyncProgress {
  step: string;
  done: number;
  total: number;
}

// ---- Préchargement (à lancer quand online, ex: bouton "Préparer le hors-ligne") ----

export async function preloadCatalog(
  session: odoo.OdooSession,
  onProgress?: (p: SyncProgress) => void
): Promise<{ products: number; clients: number; pricelistItems: number }> {
  const steps = 4;

  // 1. Produits vendables
  onProgress?.({ step: "Catalogue produits", done: 0, total: steps });
  const products = await odoo.searchRead(
    session, "product.product",
    [["sale_ok", "=", true]],
    PRODUCT_FIELDS,
    0, "name"
  );
  await db.kvSet(db.STORES.products, KEY, products);

  // 2. Clients (res.partner de type contact/société ; on garde large et on filtre côté UI)
  onProgress?.({ step: "Clients", done: 1, total: steps });
  const clients = await odoo.searchRead(
    session, "res.partner",
    [["active", "=", true], ["customer_rank", ">", 0]],
    CLIENT_FIELDS,
    0, "name"
  );
  await db.kvSet(db.STORES.clients, KEY, clients);

  // Marque la synchro dès que le cache essentiel (produits + clients) est en place,
  // pour que « dernière synchro » reflète la réalité même si la suite échoue.
  await db.kvSet(db.STORES.meta, "lastSync", Date.now());

  // 3. Règles de prix (toutes pricelists actives, pour appliquer les tarifs hors ligne)
  onProgress?.({ step: "Grilles tarifaires", done: 2, total: steps });
  const pricelistItems = await odoo.searchRead(
    session, "product.pricelist.item",
    [["active", "=", true]],
    ["pricelist_id", "applied_on", "compute_price", "product_id", "product_tmpl_id",
     "categ_id", "fixed_price", "percent_price", "price_discount", "price_surcharge",
     "min_quantity"],
    0, "sequence asc"
  );
  await db.kvSet(db.STORES.pricelist, KEY, pricelistItems);

  // 4. MEA (modèles d'offre) — partagés, légers, préchargés une fois pour tous.
  onProgress?.({ step: "Offres (MEA)", done: 3, total: steps });
  try {
    const templates = await odoo.searchRead(
      session, "sale.order.template",
      [["active", "=", true]],
      ["id", "name", "sale_order_template_line_ids"],
      200, "name"
    );
    await db.kvSet(db.STORES.mea, KEY, templates);
  } catch { /* MEA optionnel — ne bloque pas le préchargement */ }

  await db.kvSet(db.STORES.meta, "lastSync", Date.now());
  onProgress?.({ step: "Terminé", done: steps, total: steps });

  return {
    products: products.length,
    clients: clients.length,
    pricelistItems: pricelistItems.length,
  };
}

export async function getCachedMea(): Promise<any[]> {
  return (await db.kvGet<any[]>(db.STORES.mea, KEY)) || [];
}

export async function cacheMea(templates: any[]): Promise<void> {
  return db.kvSet(db.STORES.mea, KEY, templates);
}

// ---- Données par client (favoris, CA, historique) ----
// Mises en cache paresseusement : quand le commercial ouvre une fiche client
// en ligne, on stocke ses données pour qu'elles soient dispo hors ligne ensuite.

export async function cacheClientData(clientId: number, data: {
  favorites?: any[];
  stats?: { ca: number; count: number; lastDate: string | null };
  history?: any[];
}): Promise<void> {
  if (data.favorites !== undefined) await db.kvSet(db.STORES.favorites, `fav-${clientId}`, data.favorites);
  if (data.stats !== undefined)     await db.kvSet(db.STORES.favorites, `ca-${clientId}`, data.stats);
  if (data.history !== undefined)   await db.kvSet(db.STORES.favorites, `hist-${clientId}`, data.history);
}

export async function getCachedFavorites(clientId: number): Promise<any[] | undefined> {
  return db.kvGet<any[]>(db.STORES.favorites, `fav-${clientId}`);
}
export async function getCachedStats(clientId: number): Promise<{ ca: number; count: number; lastDate: string | null } | undefined> {
  return db.kvGet(db.STORES.favorites, `ca-${clientId}`);
}
export async function getCachedHistory(clientId: number): Promise<any[] | undefined> {
  return db.kvGet<any[]>(db.STORES.favorites, `hist-${clientId}`);
}

export async function getLastSync(): Promise<number | undefined> {
  return db.kvGet<number>(db.STORES.meta, "lastSync");
}

// ---- Préchargement des images produit (offline) ----

import { apiUrl } from "@/lib/apiBase";

// Télécharge une image via le proxy et la convertit en data URL base64.
async function fetchImageAsDataUrl(session: odoo.OdooSession, productId: number): Promise<string | null> {
  const url = apiUrl(
    `/api/odoo/image?odooUrl=${encodeURIComponent(session.config.url)}&id=${productId}&s=${session.sessionId}`
  );
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.size) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Précharge les images de tous les produits en cache. Par lots pour ne pas
// saturer le réseau, en sautant celles déjà stockées (reprise possible).
export async function preloadImages(
  session: odoo.OdooSession,
  onProgress?: (p: SyncProgress) => void,
  batchSize = 8
): Promise<{ downloaded: number; total: number }> {
  const products = await getCachedProducts();
  const total = products.length;
  let done = 0, downloaded = 0;

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (p: any) => {
        const id = p.id;
        if (!(await db.hasImage(id))) {
          const dataUrl = await fetchImageAsDataUrl(session, id);
          if (dataUrl) { await db.setImage(id, dataUrl); downloaded++; }
        }
        done++;
      })
    );
    onProgress?.({ step: "Images produit", done, total });
  }

  await db.kvSet(db.STORES.meta, "lastImageSync", Date.now());
  return { downloaded, total };
}

export async function getCachedImage(productId: number): Promise<string | undefined> {
  return db.getImage(productId);
}

export async function countCachedImages(): Promise<number> {
  return db.countImages();
}

export async function hasCache(): Promise<boolean> {
  const p = await db.kvGet(db.STORES.products, KEY);
  return Array.isArray(p) && p.length > 0;
}

// ---- Lecture depuis le cache (mode hors ligne) ----

export async function getCachedProducts(): Promise<any[]> {
  return (await db.kvGet<any[]>(db.STORES.products, KEY)) || [];
}

export async function getCachedClients(): Promise<any[]> {
  return (await db.kvGet<any[]>(db.STORES.clients, KEY)) || [];
}

export async function getCachedPricelistItems(pricelistId?: number): Promise<any[]> {
  const all = (await db.kvGet<any[]>(db.STORES.pricelist, KEY)) || [];
  if (!pricelistId) return all;
  return all.filter(it => Array.isArray(it.pricelist_id) && it.pricelist_id[0] === pricelistId);
}

// Recherche locale simple sur nom / code / code-barres.
export async function searchCachedProducts(query: string, limit = 50): Promise<any[]> {
  const q = query.trim().toLowerCase();
  const all = await getCachedProducts();
  if (!q) return all.slice(0, limit);
  const out = all.filter(p =>
    (p.name || "").toLowerCase().includes(q) ||
    (p.default_code || "").toLowerCase().includes(q) ||
    (p.barcode || "").toLowerCase().includes(q)
  );
  return out.slice(0, limit);
}

export async function searchCachedClients(query: string, limit = 30): Promise<any[]> {
  const q = query.trim().toLowerCase();
  const all = await getCachedClients();
  if (!q) return all.slice(0, limit);
  const out = all.filter(c =>
    (c.name || "").toLowerCase().includes(q) ||
    (c.ref || "").toLowerCase().includes(q) ||
    (c.city || "").toLowerCase().includes(q)
  );
  return out.slice(0, limit);
}

// ---- File de synchro des commandes hors ligne ----

// Enfile une commande (un ou plusieurs payloads sale.order) pour synchro ultérieure.
export async function queueOrder(
  clientName: string,
  total: number,
  payloads: any[]
): Promise<{ localRef: string; id: number }> {
  const localRef = `LOCAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const id = await db.enqueueOrder({ localRef, label: `Commande — ${clientName}`, clientName, total, payloads });
  return { localRef, id };
}

// Enfile une note client (message_post sur res.partner).
export async function queueNote(clientId: number, clientName: string, body: string): Promise<number> {
  return db.enqueueAction({
    kind: "note",
    label: `Note — ${clientName}`,
    actions: [{
      op: "callMethod",
      model: "res.partner",
      method: "message_post",
      args: [[clientId]],
      kwargs: { body, message_type: "comment", subtype_xmlid: "mail.mt_note" },
    }],
  });
}

// Enfile un RDV (create calendar.event).
export async function queueAppointment(clientName: string, values: any): Promise<number> {
  return db.enqueueAction({
    kind: "appointment",
    label: `RDV — ${clientName}`,
    actions: [{ op: "create", model: "calendar.event", values }],
  });
}

let _flushing = false;

// Rejoue toutes les commandes en attente vers Odoo. Idempotent : ne tourne
// qu'une fois à la fois, et ignore les commandes déjà synchronisées.
export async function flushQueue(
  session: odoo.OdooSession,
  onOrderSynced?: (order: db.QueuedOrder) => void
): Promise<{ synced: number; failed: number }> {
  if (_flushing) return { synced: 0, failed: 0 };
  _flushing = true;
  let synced = 0, failed = 0;

  try {
    const orders = await db.getQueuedOrders();
    for (const order of orders) {
      if (order.status === "synced" || order.status === "syncing") continue;
      if (order.id == null) continue;

      await db.updateQueuedOrder(order.id, { status: "syncing" });
      try {
        const resultIds: number[] = [];
        // Nouveau format générique : liste d'actions Odoo.
        if (order.actions && order.actions.length) {
          for (const a of order.actions) {
            if (a.op === "create") {
              const rid = await odoo.create(session, a.model, a.values);
              resultIds.push(rid);
            } else if (a.op === "callMethod") {
              await odoo.callMethod(session, a.model, a.method!, a.args || [], a.kwargs || {});
            }
          }
        }
        // Ancien format commandes : liste de sale.order.
        if (order.payloads && order.payloads.length) {
          for (const payload of order.payloads) {
            const oid = await odoo.create(session, "sale.order", payload);
            resultIds.push(oid);
          }
        }
        await db.updateQueuedOrder(order.id, {
          status: "synced",
          odooId: resultIds[0],
          attempts: (order.attempts || 0) + 1,
          lastError: undefined,
        });
        synced++;
        onOrderSynced?.({ ...order, status: "synced", odooId: resultIds[0] });
      } catch (e: any) {
        await db.updateQueuedOrder(order.id, {
          status: "error",
          attempts: (order.attempts || 0) + 1,
          lastError: e?.message || String(e),
        });
        failed++;
      }
    }
  } finally {
    _flushing = false;
  }

  return { synced, failed };
}
