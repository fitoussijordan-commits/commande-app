// lib/localdb.ts
// Couche de stockage local basée sur IndexedDB, sans dépendance externe.
// Sert de socle au mode hors ligne : cache du catalogue / clients / prix
// et file de synchro des commandes créées sans réseau.
//
// Fonctionne à l'identique en PWA (Safari) et dans un wrap Capacitor iOS,
// car IndexedDB est disponible dans les deux environnements (WKWebView inclus).

const DB_NAME = "commande_offline";

// Object stores. `keyPath` par store :
//  - products / clients / pricelistItems : cache clé/valeur (keyPath "key")
//  - syncQueue : file de commandes hors ligne (keyPath "id" auto-incrémenté)
//  - meta : petites infos (dernière synchro, etc.)
export const STORES = {
  products: "products",
  clients: "clients",
  pricelist: "pricelist",
  images: "images",
  mea: "mea",
  favorites: "favorites",
  syncQueue: "syncQueue",
  meta: "meta",
} as const;

// Bump de version pour créer les nouveaux stores (images, mea, favorites).
const DB_VERSION_WITH_IMAGES = 3;

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB indisponible dans cet environnement"));
  }
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION_WITH_IMAGES);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.products)) db.createObjectStore(STORES.products, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORES.clients)) db.createObjectStore(STORES.clients, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORES.pricelist)) db.createObjectStore(STORES.pricelist, { keyPath: "key" });
      // Store images : clé = product id, valeur = data URL base64.
      if (!db.objectStoreNames.contains(STORES.images)) db.createObjectStore(STORES.images, { keyPath: "key" });
      // MEA (modèles d'offre) : clé "all", valeur = liste de templates enrichis.
      if (!db.objectStoreNames.contains(STORES.mea)) db.createObjectStore(STORES.mea, { keyPath: "key" });
      // Données par client : clé = "fav-<id>", "ca-<id>", "hist-<id>".
      if (!db.objectStoreNames.contains(STORES.favorites)) db.createObjectStore(STORES.favorites, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORES.syncQueue)) {
        const q = db.createObjectStore(STORES.syncQueue, { keyPath: "id", autoIncrement: true });
        q.createIndex("status", "status", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Ouverture IndexedDB échouée"));
  });
  return _dbPromise;
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- Cache clé/valeur générique (products, clients, pricelist, meta) ----

export async function kvGet<T = any>(store: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  const rec = await reqToPromise(tx(db, store, "readonly").get(key));
  return rec ? (rec as any).value : undefined;
}

export async function kvSet(store: string, key: string, value: any): Promise<void> {
  const db = await openDB();
  await reqToPromise(tx(db, store, "readwrite").put({ key, value, updatedAt: Date.now() }));
}

export async function kvGetUpdatedAt(store: string, key: string): Promise<number | undefined> {
  const db = await openDB();
  const rec = await reqToPromise(tx(db, store, "readonly").get(key));
  return rec ? (rec as any).updatedAt : undefined;
}

// ---- File de synchro des commandes hors ligne ----

export type QueuedOrderStatus = "pending" | "syncing" | "synced" | "error";

// Type d'élément en file : commande, note client, ou RDV.
export type QueuedKind = "order" | "note" | "appointment";

// Une action Odoo à rejouer : soit un create, soit un appel de méthode.
export interface QueuedAction {
  op: "create" | "callMethod";
  model: string;
  // create : values ; callMethod : method + args + kwargs
  values?: any;
  method?: string;
  args?: any[];
  kwargs?: any;
}

export interface QueuedOrder {
  id?: number;                 // auto-incrémenté par IndexedDB
  localRef: string;            // référence locale unique (anti-doublon)
  createdAt: number;
  status: QueuedOrderStatus;
  attempts: number;
  lastError?: string;
  odooId?: number;             // id après synchro réussie
  kind?: QueuedKind;           // défaut "order" (rétro-compat)
  label: string;               // libellé affiché dans l'UI (ex: "Commande — Client X")
  clientName?: string;         // conservé pour rétro-compat
  total?: number;              // conservé pour rétro-compat
  // Ancien format commandes : liste de sale.order à créer.
  payloads?: any[];
  // Nouveau format générique : liste d'actions Odoo à rejouer en séquence.
  actions?: QueuedAction[];
}

export async function enqueueOrder(order: Omit<QueuedOrder, "id" | "status" | "attempts" | "createdAt">): Promise<number> {
  const db = await openDB();
  const rec: QueuedOrder = { kind: "order", ...order, status: "pending", attempts: 0, createdAt: Date.now() };
  const id = await reqToPromise(tx(db, STORES.syncQueue, "readwrite").add(rec));
  return id as number;
}

// Enfile une action générique (note, RDV, ...).
export async function enqueueAction(item: {
  kind: QueuedKind; label: string; actions: QueuedAction[];
}): Promise<number> {
  const db = await openDB();
  const localRef = `LOCAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rec: QueuedOrder = { localRef, ...item, status: "pending", attempts: 0, createdAt: Date.now() };
  const id = await reqToPromise(tx(db, STORES.syncQueue, "readwrite").add(rec));
  return id as number;
}

export async function getQueuedOrders(): Promise<QueuedOrder[]> {
  const db = await openDB();
  const all = await reqToPromise(tx(db, STORES.syncQueue, "readonly").getAll());
  return (all as QueuedOrder[]).sort((a, b) => a.createdAt - b.createdAt);
}

export async function getPendingCount(): Promise<number> {
  const orders = await getQueuedOrders();
  return orders.filter(o => o.status === "pending" || o.status === "error").length;
}

export async function updateQueuedOrder(id: number, patch: Partial<QueuedOrder>): Promise<void> {
  const db = await openDB();
  const store = tx(db, STORES.syncQueue, "readwrite");
  const existing = await reqToPromise(store.get(id));
  if (!existing) return;
  await reqToPromise(store.put({ ...(existing as QueuedOrder), ...patch, id }));
}

export async function deleteQueuedOrder(id: number): Promise<void> {
  const db = await openDB();
  await reqToPromise(tx(db, STORES.syncQueue, "readwrite").delete(id));
}

// ---- Cache des images produit (base64 data URL, clé = product id) ----

export async function getImage(productId: number): Promise<string | undefined> {
  return kvGet<string>(STORES.images, String(productId));
}

export async function setImage(productId: number, dataUrl: string): Promise<void> {
  return kvSet(STORES.images, String(productId), dataUrl);
}

export async function hasImage(productId: number): Promise<boolean> {
  const db = await openDB();
  const key = await reqToPromise(tx(db, STORES.images, "readonly").getKey(String(productId)));
  return key !== undefined;
}

export async function countImages(): Promise<number> {
  const db = await openDB();
  return reqToPromise(tx(db, STORES.images, "readonly").count());
}
