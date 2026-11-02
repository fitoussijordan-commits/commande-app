// lib/outlookSync.ts
// Force la synchro Outlook d'Odoo (module microsoft_calendar) : même appel que
// celui que fait le calendrier Odoo à son ouverture. Il pousse vers Outlook les
// RDV modifiés dans Odoo et rapatrie ceux modifiés dans Outlook.
// Lancé après chaque création / modification / annulation de RDV (cf. odoo.ts)
// et à l'ouverture de l'agenda. Silencieux : sans le module ou sans synchro
// Outlook active pour l'utilisateur, il ne se passe rien.
import type { OdooSession } from "@/lib/odoo";

const DELAY = 1500;            // regroupe les écritures rapprochées
let timer: ReturnType<typeof setTimeout> | null = null;
let disabled = false;          // module absent sur l'instance

export async function syncOutlook(session: OdooSession, call: (s: OdooSession, endpoint: string, params: any) => Promise<any>): Promise<boolean> {
  if (disabled) return false;
  try {
    const res = await call(session, "/microsoft_calendar/sync_data", { model: "calendar.event", fromurl: false });
    return res?.status === "need_refresh";
  } catch (e: any) {
    if (!e?.network) disabled = /not found|404|introuvable/i.test(String(e?.message));
    return false;
  }
}

export function scheduleOutlookSync(session: OdooSession, call: (s: OdooSession, endpoint: string, params: any) => Promise<any>) {
  if (disabled) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; syncOutlook(session, call); }, DELAY);
}
