// lib/clientFlags.ts
// Étiquettes client (res.partner.category_id) qui changent le comportement de l'app.
//
// « Bloqué compta », « Redressement judiciaire » : la commande peut être saisie,
// mais doit être validée par le service client — l'app l'affiche en bandeau et
// ne pose pas l'étiquette « Validé » sur le devis.
//
// Les étiquettes sont repérées par leur NOM (les ids diffèrent d'une base à
// l'autre), et gardées sur l'appareil pour fonctionner hors ligne.
import * as odoo from "@/lib/odoo";

export interface BlockingTag { id: number; name: string }

const BLOCKING_PATTERNS = [/bloqu[ée]?\s*compta/i, /redressement\s+judiciaire/i];
const LS_BLOCKING = "wms_blocking_client_tags";
let _blocking: BlockingTag[] | null = null;

export async function loadBlockingTags(session: odoo.OdooSession): Promise<BlockingTag[]> {
  if (_blocking) return _blocking;
  try {
    const rows = await odoo.searchRead(session, "res.partner.category",
      ["|", ["name", "ilike", "bloqu"], ["name", "ilike", "redressement"]], ["id", "name"], 50);
    _blocking = rows
      .filter((r: any) => BLOCKING_PATTERNS.some(re => re.test(String(r.name || ""))))
      .map((r: any) => ({ id: r.id, name: String(r.name) }));
    try { localStorage.setItem(LS_BLOCKING, JSON.stringify(_blocking)); } catch {}
  } catch {
    // Hors ligne → dernière liste connue (non mémorisée : on réessaiera en ligne).
    try { return JSON.parse(localStorage.getItem(LS_BLOCKING) || "[]"); } catch { return []; }
  }
  return _blocking!;
}

// ── Jours de fermeture : « Fermé le lundi », « Fermé le mercredi »… ──────────
export interface ClosedDayTag { id: number; weekday: number }   // weekday : Date.getDay()
const WEEKDAYS: Record<string, number> = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };
const LS_CLOSED = "wms_closed_day_tags";
let _closed: ClosedDayTag[] | null = null;

export async function loadClosedDayTags(session: odoo.OdooSession): Promise<ClosedDayTag[]> {
  if (_closed) return _closed;
  try {
    const rows = await odoo.searchRead(session, "res.partner.category", [["name", "ilike", "ferm"]], ["id", "name"], 50);
    _closed = [];
    for (const r of rows) {
      const m = String(r.name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .match(/ferme?e?s?\s+(?:le\s+)?(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)/);
      if (m) _closed.push({ id: r.id, weekday: WEEKDAYS[m[1]] });
    }
    try { localStorage.setItem(LS_CLOSED, JSON.stringify(_closed)); } catch {}
  } catch {
    try { return JSON.parse(localStorage.getItem(LS_CLOSED) || "[]"); } catch { return []; }
  }
  return _closed!;
}

export function clientClosedWeekdays(client: any, tags: ClosedDayTag[]): number[] {
  const ids: number[] = Array.isArray(client?.category_id) ? client.category_id : [];
  return tags.filter(t => ids.includes(t.id)).map(t => t.weekday);
}

// Étiquettes bloquantes portées par ce client (vide = commande normale).
export function clientBlockingTags(client: any, tags: BlockingTag[]): BlockingTag[] {
  const ids: number[] = Array.isArray(client?.category_id) ? client.category_id : [];
  return tags.filter(t => ids.includes(t.id));
}
