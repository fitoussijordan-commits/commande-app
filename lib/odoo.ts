// lib/odoo.ts
// Client Odoo minimal — uniquement ce dont l'outil Commande a besoin
// (authentification + lecture + création). Pas de dépendance au reste du WMS.

import { apiUrl } from "@/lib/apiBase";

export interface OdooConfig { url: string; db: string; }
export interface OdooSession { uid: number; name: string; login: string; sessionId: string; config: OdooConfig; }

// ── Classification des erreurs ────────────────────────────────────────────────
// Une erreur RÉSEAU (fetch échoué, proxy/Odoo injoignable, rate limit) est
// TRANSITOIRE : l'action peut être mise en file et rejouée plus tard.
// Une erreur MÉTIER renvoyée par Odoo (payload refusé, champ invalide…) est
// DÉFINITIVE : la rejouer telle quelle échouera toujours — il ne faut PAS la
// confondre avec du hors-ligne (avant, tout le catch partait en file de synchro).
export interface RpcError extends Error {
  network?: boolean;        // true = injoignable → rejouable plus tard
  sessionExpired?: boolean; // true = session Odoo expirée → se reconnecter
}

export function isNetworkError(e: any): boolean { return e?.network === true; }
export function isSessionExpired(e: any): boolean { return e?.sessionExpired === true; }

function rpcError(message: string, opts: { network?: boolean; sessionExpired?: boolean } = {}): RpcError {
  const err = new Error(message) as RpcError;
  if (opts.network) err.network = true;
  if (opts.sessionExpired) {
    err.sessionExpired = true;
    // Signale la session expirée à l'app (toast global dans page.tsx) sans
    // couplage direct — et surtout SANS déconnecter (règle absolue hors ligne).
    if (typeof window !== "undefined") {
      try { window.dispatchEvent(new Event("odoo:session-expired")); } catch {}
    }
  }
  return err;
}

async function rpc(config: OdooConfig, endpoint: string, params: any, sessionId?: string) {
  let res: Response;
  try {
    res = await fetch(apiUrl("/api/odoo/proxy"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ odooUrl: config.url, endpoint, params, sessionId }),
    });
  } catch {
    throw rpcError("Réseau indisponible", { network: true });
  }
  let data: any;
  try { data = await res.json(); }
  catch { throw rpcError(`Réponse serveur invalide (${res.status})`, { network: true }); }
  if (!res.ok || data.error) {
    const msg = typeof data?.error === "string" ? data.error : `Erreur ${res.status}`;
    throw rpcError(msg, {
      // 5xx = proxy/Odoo injoignable, 429 = rate limit : transitoire.
      network: res.status >= 500 || res.status === 429,
      sessionExpired: /session\s*(expired|expirée)|expired\s*session/i.test(msg),
    });
  }
  return { result: data.result, sessionId: data.sessionId };
}

export async function authenticate(config: OdooConfig, login: string, password: string): Promise<OdooSession> {
  const { result, sessionId: sid } = await rpc(config, "/web/session/authenticate", { db: config.db, login, password });
  if (!result || !result.uid || result.uid === false) throw new Error("Identifiants incorrects");
  return { uid: result.uid, name: result.name || result.username || login, login: login.toLowerCase(), sessionId: sid || result.session_id || "", config };
}

// Clé localStorage où cette app persiste la session — indépendante du WMS.
const SESSION_STORAGE_KEY = "commande_session";

// Odoo fait tourner le cookie session_id à chaque requête. On persiste la valeur
// rafraîchie pour ne pas continuer à envoyer un session_id périmé (→ "Session Expired").
function persistRefreshedSession(session: OdooSession, newSessionId?: string | null) {
  if (!newSessionId || newSessionId === session.sessionId) return;
  session.sessionId = newSessionId;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (stored && stored.sessionId !== undefined) {
      stored.sessionId = newSessionId;
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stored));
    }
  } catch {}
}

async function call(session: OdooSession, endpoint: string, params: any) {
  const { result, sessionId: refreshed } = await rpc(session.config, endpoint, params, session.sessionId);
  persistRefreshedSession(session, refreshed);
  return result;
}

// Contexte imposant la langue française pour toutes les lectures : les champs
// traduits (ex: nom de pricelist "WALAOFFERT_2026") sortent en FR, pas en EN.
const FR_CTX = { lang: "fr_FR" };

export async function searchRead(session: OdooSession, model: string, domain: any[], fields: string[], limit = 0, order = "") {
  return call(session, "/web/dataset/call_kw", { model, method: "search_read", args: [domain], kwargs: { fields, limit, order, context: FR_CTX } });
}

export async function create(session: OdooSession, model: string, values: any) {
  return call(session, "/web/dataset/call_kw", { model, method: "create", args: [values], kwargs: {} });
}

export async function write(session: OdooSession, model: string, ids: number[], values: any) {
  return call(session, "/web/dataset/call_kw", { model, method: "write", args: [ids, values], kwargs: {} });
}

export async function callMethod(session: OdooSession, model: string, method: string, args: any[] = [], kwargs: any = {}) {
  return call(session, "/web/dataset/call_kw", { model, method, args, kwargs });
}
