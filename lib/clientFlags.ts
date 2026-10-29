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

// Étiquettes bloquantes portées par ce client (vide = commande normale).
export function clientBlockingTags(client: any, tags: BlockingTag[]): BlockingTag[] {
  const ids: number[] = Array.isArray(client?.category_id) ? client.category_id : [];
  return tags.filter(t => ids.includes(t.id));
}
