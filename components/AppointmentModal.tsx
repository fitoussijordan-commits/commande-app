"use client";
import { useState } from "react";
import * as odoo from "@/lib/odoo";
import * as sync from "@/lib/sync";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e",
  red: "#dc2626", redSoft: "#fef2f2",
  shadowXl: "0 20px 25px rgba(0,0,0,0.10), 0 8px 10px rgba(0,0,0,0.04)",
};

// Cache le partner_id de l'utilisateur courant (organisateur du RDV) — une résolution par session app.
let _currentUserPartnerIdCache: number | null | undefined = undefined;
async function getCurrentUserPartnerId(session: odoo.OdooSession): Promise<number | null> {
  if (_currentUserPartnerIdCache !== undefined) return _currentUserPartnerIdCache;
  try {
    const users = await odoo.searchRead(session, "res.users", [["id", "=", session.uid]], ["id", "partner_id"], 1);
    const pid = users[0]?.partner_id?.[0];
    _currentUserPartnerIdCache = typeof pid === "number" ? pid : null;
  } catch {
    _currentUserPartnerIdCache = null;
  }
  return _currentUserPartnerIdCache;
}

// Une automatisation Odoo Studio existante réécrit toujours le titre du RDV à partir du nom
// de la 1ère étiquette (categ_ids[0].name) quand le client n'est pas participant — ce qui est
// notre cas (volontairement, pour ne pas déclencher d'invitation Outlook). Plutôt que de toucher
// à cette automatisation, on s'appuie dessus : on crée/réutilise une étiquette qui porte EXACTEMENT
// le titre voulu, donc l'automatisation affiche le bon titre sans qu'on ait à changer quoi que ce
// soit côté Odoo. (Seul effet de bord : le champ "Code Client CLI" reste vide, il n'est rempli par
// l'automatisation que dans le cas — non utilisé ici — où le client est participant.)
async function getOrCreateTagForTitle(session: odoo.OdooSession, title: string): Promise<number | null> {
  const clean = title.trim();
  if (!clean) return null;
  try {
    const existing = await odoo.searchRead(session, "calendar.event.type", [["name", "=ilike", clean]], ["id"], 1);
    if (existing.length) return existing[0].id;
    const newId = await odoo.create(session, "calendar.event.type", { name: clean });
    return typeof newId === "number" ? newId : null;
  } catch {
    return null;
  }
}

// Convertit une Date (locale navigateur) en chaîne UTC "YYYY-MM-DD HH:MM:SS" attendue par Odoo.
function toOdooUTC(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
}

const DURATIONS = [
  { label: "30 min", hours: 0.5 },
  { label: "45 min", hours: 0.75 },
  { label: "1 h", hours: 1 },
  { label: "1 h 30", hours: 1.5 },
  { label: "2 h", hours: 2 },
];

// Prochain créneau arrondi au 1/4 d'heure suivant, pour pré-remplir le champ date/heure.
function defaultStartLocal(): string {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Étiquettes proposées pour les RDV administratifs (sans client). Ajuste librement.
const ADMIN_TAGS = ["Administratif", "Formation", "Réunion", "Congé", "Déplacement", "Autre"];

interface Props {
  session: odoo.OdooSession;
  client?: any;      // res.partner (mode création rattachée à un client)
  event?: any;       // calendar.event existant (mode modification)
  adminMode?: boolean; // RDV sans client (administratif) avec étiquette
  onClose: () => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}

// UTC Odoo "YYYY-MM-DD HH:MM:SS" → valeur locale pour <input type="datetime-local">.
function odooUTCToLocalInput(s: string): string {
  const d = new Date(s.replace(" ", "T") + "Z");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AppointmentModal({ session, client, event, adminMode, onClose, onToast }: Props) {
  const isEdit = Boolean(event);
  const [adminTag, setAdminTag] = useState(ADMIN_TAGS[0]);

  // En édition : pré-remplissage depuis le RDV existant.
  const initStart = event?.start ? odooUTCToLocalInput(event.start) : defaultStartLocal();
  const initDuration = (event?.start && event?.stop)
    ? Math.max(0.25, (new Date(event.stop.replace(" ", "T") + "Z").getTime() - new Date(event.start.replace(" ", "T") + "Z").getTime()) / 3600000)
    : 1;
  const initNote = (() => {
    const d: string = event?.description || "";
    const parts = d.split(/\n\n/);
    return parts.length > 1 ? parts.slice(1).join("\n\n").trim() : "";
  })();

  const [title, setTitle] = useState(
    event?.name || (adminMode ? ADMIN_TAGS[0] : `RDV — ${client?.name || ""}`)
  );
  const [startLocal, setStartLocal] = useState(initStart);
  const [durationHours, setDurationHours] = useState(initDuration);
  const [location, setLocation] = useState(event?.location || client?.city || "");
  const [note, setNote] = useState(initNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!title.trim() || !startLocal) { setError("Titre et date/heure requis"); return; }
    setSaving(true);
    try {
      const start = new Date(startLocal); // interprété en heure locale du navigateur
      if (isNaN(start.getTime())) throw new Error("Date invalide");
      const stop = new Date(start.getTime() + durationHours * 3600 * 1000);

      // Description : en création on la construit à partir du client ; en édition
      // on conserve la 1ère ligne "Client : ..." d'origine et on remplace la note.
      let description: string;
      if (isEdit) {
        const orig: string = event?.description || "";
        const clientLine = orig.split(/\n\n/)[0] || "";
        description = clientLine + (note ? `\n\n${note}` : "");
      } else {
        const codeSuffix = client?.ref ? ` (${client.ref})` : "";
        const clientPart = client?.name
          ? `Client : ${client.name}${codeSuffix}${client?.phone ? ` — ${client.phone}` : ""}`
          : "";
        description = clientPart + (clientPart && note ? "\n\n" : "") + (note || "");
      }

      const baseValues: any = {
        name: title.trim(),
        start: toOdooUTC(start),
        stop: toOdooUTC(stop),
        location: location.trim(),
        description,
        user_id: session.uid,
        // Code client (uniquement si rattaché à un client).
        ...(!isEdit && client?.ref ? { x_studio_code_client_cli_calendar: client.ref } : {}),
      };

      // ── MODE ÉDITION : write sur le RDV existant ──
      if (isEdit) {
        try {
          const categId = await getOrCreateTagForTitle(session, title);
          await odoo.write(session, "calendar.event", [event.id], {
            ...baseValues,
            ...(categId ? { categ_ids: [[6, 0, [categId]]] } : {}),
          });
          onToast("RDV modifié", "success");
        } catch {
          await sync.queueAppointmentEdit(event.id, title.trim(), baseValues);
          onToast("Modification enregistrée hors ligne — sera envoyée au retour du réseau", "info");
        }
        onClose();
        setSaving(false);
        return;
      }

      // ── MODE CRÉATION ──
      try {
        const [organizerPartnerId, categId] = await Promise.all([
          getCurrentUserPartnerId(session),
          getOrCreateTagForTitle(session, title),
        ]);
        // Important : le CLIENT n'est volontairement PAS ajouté comme participant.
        await odoo.create(session, "calendar.event", {
          ...baseValues,
          ...(organizerPartnerId ? { partner_ids: [[6, 0, [organizerPartnerId]]] } : {}),
          ...(categId ? { categ_ids: [[6, 0, [categId]]] } : {}),
        });
        onToast("RDV créé dans le calendrier Odoo", "success");
      } catch {
        // Hors ligne → mise en file (version simplifiée, sans tag/organisateur résolus).
        await sync.queueAppointment(client?.name || title.trim(), baseValues);
        onToast("RDV enregistré hors ligne — sera créé au retour du réseau", "info");
      }
      onClose();
    } catch (e: any) {
      setError(e.message || (isEdit ? "Erreur lors de la modification" : "Erreur lors de la création du RDV"));
    }
    setSaving(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 420, background: C.white, borderRadius: 20, padding: "28px 26px", boxShadow: C.shadowXl, fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "#f0fdfa", border: "1.5px solid #ccfbf1", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.teal} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>
              {isEdit ? "Modifier le RDV" : adminMode ? "RDV administratif" : "Prendre un RDV"}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>{client?.name || (adminMode ? "Sans client" : event?.name || "")}</div>
          </div>
        </div>

        {error && (
          <div style={{ background: C.redSoft, color: C.red, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>{error}</div>
        )}

        {adminMode && (
          <Field label="Étiquette">
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8 }}>
              {ADMIN_TAGS.map(tag => (
                <button key={tag} type="button"
                  onClick={() => { setAdminTag(tag); setTitle(tag); }}
                  style={{
                    padding: "7px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                    background: adminTag === tag ? C.teal : C.white,
                    color: adminTag === tag ? "#fff" : C.textSec,
                    border: `1.5px solid ${adminTag === tag ? C.teal : C.border}`,
                  }}>
                  {tag}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="Titre">
          <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
        </Field>

        <Field label="Date et heure">
          <input type="datetime-local" value={startLocal} onChange={e => setStartLocal(e.target.value)} style={inputStyle} />
        </Field>

        <Field label="Durée">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
            {DURATIONS.map(d => (
              <button type="button" key={d.hours} onClick={() => setDurationHours(d.hours)}
                style={{ padding: "7px 12px", borderRadius: 8, border: `1.5px solid ${durationHours === d.hours ? C.teal : C.border}`, background: durationHours === d.hours ? C.teal : C.white, color: durationHours === d.hours ? "#fff" : C.textSec, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                {d.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Lieu">
          <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Adresse du RDV" style={inputStyle} />
        </Field>

        <Field label="Note (optionnel)">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} style={{ ...inputStyle, resize: "vertical" as const, fontFamily: "inherit" }} />
        </Field>

        <div style={{ fontSize: 11, color: C.muted, marginBottom: 18, lineHeight: 1.4 }}>
          Le client ne sera pas ajouté comme participant — aucune invitation ne lui sera envoyée par e-mail lors de la synchro Outlook.
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={onClose} style={{ flex: 1, padding: "12px", background: C.bg, color: C.textSec, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Annuler
          </button>
          <button type="submit" disabled={saving} style={{ flex: 1, padding: "12px", background: saving ? C.muted : C.teal, color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: saving ? "default" : "pointer", fontFamily: "inherit" }}>
            {saving ? "Enregistrement…" : (isEdit ? "Enregistrer" : "Créer le RDV")}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1.5px solid ${C.border}`, borderRadius: 10, fontSize: 14, color: C.text, outline: "none",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.textSec, marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}
