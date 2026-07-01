// lib/odoo.ts
// Client Odoo minimal — uniquement ce dont l'outil Commande a besoin
// (authentification + lecture + création). Pas de dépendance au reste du WMS.

export interface OdooConfig { url: string; db: string; }
export interface OdooSession { uid: number; name: string; login: string; sessionId: string; config: OdooConfig; }

async function rpc(config: OdooConfig, endpoint: string, params: any, sessionId?: string) {
  const res = await fetch("/api/odoo/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ odooUrl: config.url, endpoint, params, sessionId }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Erreur ${res.status}`);
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

export async function searchRead(session: OdooSession, model: string, domain: any[], fields: string[], limit = 0, order = "") {
  return call(session, "/web/dataset/call_kw", { model, method: "search_read", args: [domain], kwargs: { fields, limit, order } });
}

export async function create(session: OdooSession, model: string, values: any) {
  return call(session, "/web/dataset/call_kw", { model, method: "create", args: [values], kwargs: {} });
}

export async function write(session: OdooSession, model: string, ids: number[], values: any) {
  return call(session, "/web/dataset/call_kw", { model, method: "write", args: [ids, values], kwargs: {} });
}
