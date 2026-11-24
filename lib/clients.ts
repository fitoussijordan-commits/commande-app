// lib/clients.ts
import * as odoo from "@/lib/odoo";
// Départage des fiches res.partner partageant un même code client (ref).

export interface PickResult {
  row: any | null;
  /** true = le choix a dû être arbitraire (vrais doublons), à signaler. */
  ambiguous: boolean;
}

/**
 * Choisit LA fiche à ouvrir parmi plusieurs partageant le même ref.
 *
 * Plusieurs fiches au même code, c'est le cas NORMAL dans Odoo : une société
 * porte le ref, et ses adresses de livraison / facturation sont des res.partner
 * enfants qui héritent du même ref et souvent du même nom. S'y ajoutent parfois
 * de vrais doublons de saisie.
 *
 * Avant, l'app abandonnait dès que le lot restait ambigu (« 5 fiches ont le code
 * … — ouvre-le via la recherche »), ce qui rendait le bouton « Ouvrir la fiche
 * client » inutilisable sur les clients les plus courants. On tranche désormais
 * toujours, par critères décroissants de fiabilité — chaque étape ne s'applique
 * QUE si elle réduit le lot sans le vider :
 *
 *  1. nom identique à celui écrit sur le RDV ;
 *  2. type « contact » → écarte les adresses de livraison / facturation ;
 *  3. sans parent_id → la fiche mère plutôt qu'un contact rattaché ;
 *  4. is_company → la société plutôt qu'une personne ;
 *  5. customer_rank le plus haut → la fiche qui reçoit réellement les commandes ;
 *  6. id le plus petit → la plus ancienne, donc l'originale d'un doublon.
 *
 * Les étapes 1 à 5 couvrent la structure société / adresses. La 6 n'intervient
 * que sur des fiches réellement indiscernables : le choix est alors arbitraire
 * mais STABLE (la même fiche à chaque appel), et `ambiguous` le signale pour
 * qu'on le dise à l'utilisateur.
 *
 * @param rows  fiches candidates (déjà filtrées sur le ref ou le nom)
 * @param name  nom lu sur le RDV, s'il y en a un
 */
export function pickClientAmong(rows: any[], name?: string): PickResult {
  if (!rows || !rows.length) return { row: null, ambiguous: false };
  if (rows.length === 1) return { row: rows[0], ambiguous: false };

  // Réduit le lot si le critère isole au moins une fiche, sinon le laisse tel quel.
  const narrow = (list: any[], pred: (r: any) => boolean) => {
    const kept = list.filter(pred);
    return kept.length ? kept : list;
  };

  let lot = rows;
  if (name) {
    const wanted = name.trim().toLowerCase();
    lot = narrow(lot, r => (r.name || "").trim().toLowerCase() === wanted);
  }
  if (lot.length > 1) lot = narrow(lot, r => !r.type || r.type === "contact");
  if (lot.length > 1) lot = narrow(lot, r => !r.parent_id);
  if (lot.length > 1) lot = narrow(lot, r => Boolean(r.is_company));
  if (lot.length > 1) {
    const best = Math.max(...lot.map(r => Number(r.customer_rank) || 0));
    lot = narrow(lot, r => (Number(r.customer_rank) || 0) === best);
  }
  if (lot.length === 1) return { row: lot[0], ambiguous: false };

  // Fiches réellement identiques : la plus ancienne, et on le signale.
  const oldest = lot.reduce((a, b) => (Number(a.id) <= Number(b.id) ? a : b));
  return { row: oldest, ambiguous: true };
}

// Recherche client : écarte les adresses enfants et les doublons (code, nom).
// Partagé par l'écran client et la prise de RDV.
const ADDRESS_TYPES = new Set(["delivery", "invoice", "other", "private"]);

// Score de « fiche la plus légitime » quand deux enregistrements se disputent le
// même code client : société > fiche racine > fiche renseignée.
function clientScore(c: any): number {
  return (c.is_company ? 4 : 0) + (c.parent_id ? 0 : 2) + (c.phone ? 1 : 0);
}

// Dédoublonne les résultats de recherche client.
//
// Odoo peut renvoyer DEUX enregistrements res.partner pour ce qui est, côté
// utilisateur, un seul client : la société mère et une de ses adresses enfants
// (livraison/facturation) portant le même nom et le même code. L'adresse enfant
// n'apparaît pas comme une ligne séparée dans la liste Contacts d'Odoo — elle vit
// dans l'onglet « Contacts & Adresses » — mais si elle a customer_rank > 0 elle
// remonte quand même dans un search_read, d'où le doublon à l'écran.
//
// Deux passes : on écarte les adresses enfants, puis, en filet de sécurité, on ne
// garde qu'une fiche par couple (code, nom).
// Codes « XX-… » : jamais proposés comme clients (fournisseurs, prospects) — sauf
// dans le mode « Mes prospects » de l'accueil (voir scopeDomain).
export const NOT_SUPPLIER: any[] = ["ref", "not =ilike", "XX-%"];
export const isSupplier = (c: any) => /^xx-/i.test(String(c?.ref || "").trim());

// `keepXX` : mode « Mes prospects », où les fiches XX-… sont justement celles cherchées.
export function dedupeClients(rows: any[], keepXX = false): any[] {
  if (!keepXX) rows = rows.filter(c => !isSupplier(c));
  // Passe 1 — adresses enfants. Repli sur la liste brute si le filtre vide tout
  // (instance Odoo sans champ `type`, ou cache préchargé avant cette version).
  const roots = rows.filter(c => !(c.parent_id && ADDRESS_TYPES.has(c.type)));
  const base = roots.length ? roots : rows;

  // Passe 2 — doublons réels sur (code, nom). Sans code, on ne touche à rien :
  // deux clients distincts peuvent légitimement porter le même nom.
  const bestByKey = new Map<string, number>();
  const out: any[] = [];
  for (const c of base) {
    const ref = (c.ref || "").trim().toLowerCase();
    if (!ref) { out.push(c); continue; }
    const key = `${ref}|${(c.name || "").trim().toLowerCase()}`;
    const at = bestByKey.get(key);
    if (at === undefined) { bestByKey.set(key, out.push(c) - 1); continue; }
    if (clientScore(c) > clientScore(out[at])) out[at] = c;
  }
  return out;
}

// « Mes clients » : par défaut, la recherche ne montre que les clients dont
// l'utilisateur est le vendeur (res.partner.user_id). Désactivable, choix mémorisé.
const MINE_KEY = "wms_clients_mine";
export function getMineOnly(): boolean { try { return localStorage.getItem(MINE_KEY) !== "0"; } catch { return true; } }
export function setMineOnly(v: boolean) { try { localStorage.setItem(MINE_KEY, v ? "1" : "0"); } catch {} }
export const mineDomain = (uid: number, mine: boolean): any[] => mine ? [["user_id", "=", uid]] : [];
// Filtre local (cache hors ligne) : une fiche sans vendeur connu est gardée.
export const isMine = (c: any, uid: number) => !Array.isArray(c?.user_id) || c.user_id[0] === uid;

// ── Écran d'accueil : « Mes clients » / « Mes prospects » / « Tous » ─────────
// Commerciaux (droits Ventes « Utilisateur : mes documents seulement ») : deux
// modes, Mes clients (Type de compte = Client, vendeur = moi) et Mes prospects
// (Type de compte = Prospect, référence XX-…, vendeur = moi). Autres utilisateurs : un seul mode,
// Tous (tous les clients, comme avant).
export type ClientScope = "clients" | "prospects" | "all";
const OWN_DOCS_KEY = "wms_sales_own_docs_only";
const SCOPE_KEY = "wms_clients_scope";

// Dernière valeur connue (hors ligne / affichage immédiat) ; null = jamais lue.
export function cachedOwnDocsOnly(): boolean | null {
  try { const v = localStorage.getItem(OWN_DOCS_KEY); return v === null ? null : v === "1"; } catch { return null; }
}
// « Mes documents seulement » = groupe Ventes utilisateur SANS « tous les documents ».
export async function fetchOwnDocsOnly(session: odoo.OdooSession): Promise<boolean> {
  const has = async (g: string) => Boolean(await odoo.callMethod(session, "res.users", "has_group", [[session.uid], g]));
  const own = (await has("sales_team.group_sale_salesman")) && !(await has("sales_team.group_sale_salesman_all_leads"));
  try { localStorage.setItem(OWN_DOCS_KEY, own ? "1" : "0"); } catch {}
  return own;
}
export function getScopeChoice(): "clients" | "prospects" {
  try { return localStorage.getItem(SCOPE_KEY) === "prospects" ? "prospects" : "clients"; } catch { return "clients"; }
}
export function setScopeChoice(v: "clients" | "prospects") { try { localStorage.setItem(SCOPE_KEY, v); } catch {} }

export const PROSPECT_REF_PREFIX = "XX-";
// Domaine Odoo du mode (remplace customer_rank / vendeur dans les recherches).
export function scopeDomain(uid: number, scope: ClientScope): any[] {
  if (scope !== "prospects") return [NOT_SUPPLIER, ...scopeBase(uid, scope)];
  return scopeBase(uid, scope);
}
function scopeBase(uid: number, scope: ClientScope): any[] {
  if (scope === "clients") return [["customer_rank", ">", 0], ["user_id", "=", uid], ["x_type_de_compte_id", "=", "Client"]];
  // Pas de NOT_SUPPLIER ici : il exclut justement les références XX-.
  if (scope === "prospects") return [["user_id", "=", uid], ["x_type_de_compte_id", "=", "Prospect"], ["ref", "=like", PROSPECT_REF_PREFIX + "%"]];
  return [["customer_rank", ">", 0]];
}
// Même filtre en local (cache hors ligne). Type de compte absent du cache (préchargé
// avant cette version) → on n'exclut pas sur ce critère.
export function matchesScope(c: any, uid: number, scope: ClientScope): boolean {
  const t = Array.isArray(c?.x_type_de_compte_id) ? String(c.x_type_de_compte_id[1] || "").trim().toLowerCase() : null;
  if (scope === "clients") return isMine(c, uid) && (t === null || t === "client") && (c?.customer_rank ?? 1) > 0;
  if (scope === "prospects") return isMine(c, uid) && (t === null || t === "prospect") && String(c?.ref || "").startsWith(PROSPECT_REF_PREFIX);
  return (c?.customer_rank ?? 1) > 0;
}
