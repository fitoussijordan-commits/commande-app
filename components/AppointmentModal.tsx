"use client";
import { useState, useEffect, useMemo } from "react";
import * as odoo from "@/lib/odoo";
import * as sync from "@/lib/sync";
import { descToText, routeLines, ROUTE_LINE } from "@/lib/text";
import { eventOnDay, ALLDAY_FIELDS } from "@/lib/calendar";
import { dedupeClients } from "@/lib/clients";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e",
  red: "#dc2626", redSoft: "#fef2f2", orange: "#ea580c", orangeSoft: "#fff7ed",
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

const clientAddress = (c: any) =>
  c?.street ? [c.street, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : (c?.city || "");
const pad2 = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const fromOdoo = (s: string) => new Date(String(s).replace(" ", "T") + "Z");

export default function AppointmentModal({ session, client: clientProp, event, adminMode, onClose, onToast }: Props) {
  const isEdit = Boolean(event);
  // Client choisi dans la fenêtre (bouton + du planning : RDV sans client au départ).
  const [picked, setPicked] = useState<any>(null);
  const client = clientProp || picked;
  const canPickClient = !isEdit && !clientProp;
  const adminTag = ADMIN_TAGS[0];

  // En édition : pré-remplissage depuis le RDV existant.
  const initStart = event?.start ? odooUTCToLocalInput(event.start) : defaultStartLocal();
  const initDuration = (event?.start && event?.stop)
    ? Math.max(0.25, (new Date(event.stop.replace(" ", "T") + "Z").getTime() - new Date(event.start.replace(" ", "T") + "Z").getTime()) / 3600000)
    : 1;
  // descToText : la description Odoo est du HTML sur une seule ligne dès que le
  // RDV a été touché côté Odoo. Sans conversion, split(/\n\n/) ne trouvait aucun
  // séparateur → la note existante passait pour vide et disparaissait à l'édition.
  const initNote = (() => {
    const d: string = descToText(event?.description || "");
    const parts = d.split(/\n\n/);
    return parts.length > 1 ? parts.slice(1).join("\n\n").trim() : "";
  })();

  const [title, setTitle] = useState(
    event?.name || (adminMode ? ADMIN_TAGS[0] : `RDV — ${client?.name || ""}`)
  );
  const [startLocal, setStartLocal] = useState(initStart);
  const [durationHours, setDurationHours] = useState(initDuration);
  // Adresse complète par défaut : elle sert au lien Waze / Plans.
  const [location, setLocation] = useState(event?.location || clientAddress(client));
  const [note, setNote] = useState(initNote);
  // Déplacement : RDV « journée entière » d'Odoo du … au …, titre = destination
  // (+ zone entre parenthèses), lieu = destination.
  const [trip, setTrip] = useState(Boolean(event?.allday));
  const todayStr = toLocalInput(new Date()).slice(0, 10);
  const [tripFrom, setTripFrom] = useState<string>(event?.allday ? event.start_date : todayStr);
  const [tripTo, setTripTo] = useState<string>(event?.allday ? (event.stop_date || event.start_date) : todayStr);
  const tripName = event?.allday ? String(event.name || "").match(/^(.*?)(?:\s*\(([^)]*)\))?$/) : null;
  const [destination, setDestination] = useState(tripName?.[1]?.trim() || "");
  const [zone, setZone] = useState(tripName?.[2]?.trim() || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Type de RDV = étiquette calendar.event.type. Liste chargée depuis Odoo.
  const [rdvTypes, setRdvTypes] = useState<{ id: number; name: string }[]>([]);
  const [rdvTypeId, setRdvTypeId] = useState<number | "">(
    Array.isArray(event?.categ_ids) && event.categ_ids.length ? event.categ_ids[0] : ""
  );
  useEffect(() => {
    odoo.searchRead(session, "calendar.event.type", [], ["id", "name"], 100, "name")
      .then((rows: any[]) => setRdvTypes(rows))
      .catch(() => setRdvTypes([]));
  }, [session]);

  // Recherche client (nom, code, ville) : Odoo, cache local hors ligne.
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<any[]>([]);
  useEffect(() => {
    const q = clientQuery.trim();
    if (!canPickClient || q.length < 2) { setClientResults([]); return; }
    const t = setTimeout(async () => {
      try {
        // Comme l'écran client : sans les contacts / adresses enfants ni doublons.
        setClientResults(dedupeClients(await odoo.searchRead(session, "res.partner",
          ["|", "|", ["name", "ilike", q], ["ref", "ilike", q], ["city", "ilike", q], ["customer_rank", ">", 0], ["active", "=", true]],
          ["id", "name", "ref", "street", "zip", "city", "phone", "parent_id", "type", "is_company"], 30)).slice(0, 10));
      } catch {
        try { setClientResults(dedupeClients(await sync.searchCachedClients(q, 30)).slice(0, 10)); } catch { setClientResults([]); }
      }
    }, 250);
    return () => clearTimeout(t);
  }, [clientQuery, canPickClient, session]);
  const pickClient = (c: any | null) => {
    setPicked(c); setClientQuery(""); setClientResults([]);
    if (c) { setTitle(`RDV — ${c.name}`); setLocation(clientAddress(c)); }
    else { setTitle(adminTag); setLocation(""); }
  };

  // Calendrier de la semaine du jour choisi (aperçu pour planifier) et
  // chevauchements (hors annulés et hors le RDV qu'on modifie).
  const [weekEvents, setWeekEvents] = useState<any[]>([]);
  const [startTouched, setStartTouched] = useState(isEdit);
  const day = startLocal.slice(0, 10);
  const monday = useMemo(() => {
    const d = new Date(`${day || toLocalInput(new Date()).slice(0, 10)}T00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }, [day]);
  // Chargé sur toute la grille du mois (6 semaines) : sert aux vues semaine et mois.
  const gridStart = useMemo(() => {
    const d = new Date(`${day || toLocalInput(new Date()).slice(0, 10)}T00:00`);
    d.setDate(1); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }, [day.slice(0, 7)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const to = new Date(gridStart); to.setDate(to.getDate() + 42);
    odoo.searchRead(session, "calendar.event",
      [["user_id", "=", session.uid], ["start", "<", toOdooUTC(to)], ["stop", ">", toOdooUTC(gridStart)]],
      ["id", "name", "start", "stop", ...ALLDAY_FIELDS, "location", "x_studio_annul"], 200, "start asc")
      .then((rows: any[]) => setWeekEvents(rows.filter(r => !r.x_studio_annul && r.id !== event?.id)))
      .catch(() => setWeekEvents([]));
  }, [gridStart, session, event?.id]);
  // Créneaux occupés du jour (les déplacements, journée entière, n'en bloquent pas).
  const dayEvents = useMemo(() => weekEvents.filter(r => !r.allday && eventOnDay(r, new Date(`${day}T12:00`))), [weekEvents, day]);
  const overlaps = useMemo(() => {
    const s = new Date(startLocal).getTime(), e = s + durationHours * 3600000;
    return isNaN(s) ? [] : dayEvents.filter(r => fromOdoo(r.start).getTime() < e && fromOdoo(r.stop).getTime() > s);
  }, [startLocal, durationHours, dayEvents]);
  // Prochain créneau libre de la même durée, par pas de 15 min, dans la journée.
  const nextFree = useMemo(() => {
    let s = new Date(startLocal).getTime();
    if (isNaN(s)) return null;
    const dur = durationHours * 3600000, end = new Date(`${day}T21:00`).getTime();
    for (let i = 0; i < 60 && s + dur <= end; i++) {
      const clash = dayEvents.find(r => fromOdoo(r.start).getTime() < s + dur && fromOdoo(r.stop).getTime() > s);
      if (!clash) return new Date(s);
      s = Math.ceil(fromOdoo(clash.stop).getTime() / 900000) * 900000;
    }
    return null;
  }, [startLocal, durationHours, dayEvents, day]);
  // Nouveau RDV : l'heure proposée saute d'office les créneaux déjà pris.
  useEffect(() => {
    if (startTouched || !overlaps.length || !nextFree) return;
    setStartLocal(toLocalInput(nextFree));
  }, [overlaps, nextFree, startTouched]);

  const submitTrip = async () => {
    if (!destination.trim() || !tripFrom || !tripTo) { setError("Destination et dates requises"); return; }
    if (tripTo < tripFrom) { setError("La date de fin est avant la date de début"); return; }
    setSaving(true);
    const name = `${destination.trim()}${zone.trim() ? ` (${zone.trim()})` : ""}`;
    const values: any = {
      name, allday: true, start_date: tripFrom, stop_date: tripTo,
      location: destination.trim(),
      description: [`Déplacement${zone.trim() ? ` — zone : ${zone.trim()}` : ""}`, note.trim()].filter(Boolean).join("\n\n"),
      user_id: session.uid,
    };
    try {
      // Étiquette au nom du déplacement : l'automatisation Studio recopie le
      // nom de la 1re étiquette dans le titre (cf. getOrCreateTagForTitle).
      const categId = await getOrCreateTagForTitle(session, name);
      const vals = { ...values, ...(categId ? { categ_ids: [[6, 0, [categId]]] } : {}) };
      if (isEdit) await odoo.write(session, "calendar.event", [event.id], vals);
      else await odoo.create(session, "calendar.event", vals);
      onToast(isEdit ? "Déplacement modifié" : "Déplacement ajouté au calendrier", "success");
      onClose();
    } catch (err: any) {
      if (!odoo.isNetworkError(err)) { setError("Odoo a refusé le déplacement : " + (err?.message || err)); setSaving(false); return; }
      if (isEdit) await sync.queueAppointmentEdit(event.id, name, values);
      else await sync.queueAppointment(name, values);
      onToast("Déplacement enregistré hors ligne — envoyé au retour du réseau", "info");
      onClose();
    }
    setSaving(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (trip) { await submitTrip(); return; }
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
        // Idem : sans descToText, clientLine valait TOUT le bloc HTML, qui était
        // alors réécrit tel quel dans la description à chaque modification.
        const orig: string = descToText(event?.description || "");
        // Liens d'itinéraire refaits d'après le lieu (il a pu changer).
        const clientLine = (orig.split(/\n\n/)[0] || "").split("\n").filter(l => !ROUTE_LINE.test(l)).join("\n").trim();
        const head = [clientLine, routeLines(location)].filter(Boolean).join("\n");
        description = head + (head && note ? "\n\n" : "") + (note || "");
      } else {
        const codeSuffix = client?.ref ? ` (${client.ref})` : "";
        const clientPart = client?.name
          ? `Client : ${client.name}${codeSuffix}${client?.phone ? ` — ${client.phone}` : ""}`
          : "";
        // 1er bloc = client + liens Waze / Plans (cliquables dans Outlook), puis la note.
        const head = [clientPart, routeLines(location)].filter(Boolean).join("\n");
        description = head + (head && note ? "\n\n" : "") + (note || "");
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

      // Lien vers la fiche client EXACTE, via le « document lié » natif d'Odoo.
      //
      // Avant, on n'enregistrait que le ref du client. Or le ref n'est pas unique
      // dans Odoo : un cas réel remonte 160 fiches pour 75-004421. Rouvrir la
      // fiche depuis le RDV revenait donc à deviner, alors que l'app connaît
      // l'identifiant au moment même de la prise de rendez-vous. On le garde.
      //
      // Isolé de baseValues pour pouvoir réessayer sans, si l'instance refuse ces
      // champs : mieux vaut un RDV sans lien qu'un RDV non créé.
      const clientLink: any = client?.id
        ? { res_model: "res.partner", res_id: Number(client.id) }
        : {};

      // Type de RDV choisi (étiquette) prioritaire ; sinon étiquette dérivée du titre.
      const resolveCategId = async (): Promise<number | null> =>
        (typeof rdvTypeId === "number" ? rdvTypeId : await getOrCreateTagForTitle(session, title));

      // ── MODE ÉDITION : write sur le RDV existant ──
      if (isEdit) {
        try {
          const categId = await resolveCategId();
          const values = {
            ...baseValues,
            ...(categId ? { categ_ids: [[6, 0, [categId]]] } : {}),
          };
          try {
            await odoo.write(session, "calendar.event", [event.id], { ...values, ...clientLink });
          } catch (linkErr: any) {
            if (odoo.isNetworkError(linkErr) || !Object.keys(clientLink).length) throw linkErr;
            await odoo.write(session, "calendar.event", [event.id], values);   // sans le lien
          }
          onToast("RDV modifié", "success");
        } catch (err: any) {
          // Seul le RÉSEAU justifie la file de synchro : une erreur métier Odoo
          // rejouée échouerait en boucle, et le message « hors ligne » masquerait
          // la vraie cause. (cf. lib/odoo.ts)
          if (!odoo.isNetworkError(err)) {
            setError("Odoo a refusé la modification : " + (err?.message || err));
            setSaving(false);
            return;
          }
          await sync.queueAppointmentEdit(event.id, title.trim(), { ...baseValues, ...clientLink });
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
          resolveCategId(),
        ]);
        // Important : le CLIENT n'est volontairement PAS ajouté comme participant.
        const values = {
          ...baseValues,
          ...(organizerPartnerId ? { partner_ids: [[6, 0, [organizerPartnerId]]] } : {}),
          ...(categId ? { categ_ids: [[6, 0, [categId]]] } : {}),
        };
        try {
          await odoo.create(session, "calendar.event", { ...values, ...clientLink });
        } catch (linkErr: any) {
          if (odoo.isNetworkError(linkErr) || !Object.keys(clientLink).length) throw linkErr;
          await odoo.create(session, "calendar.event", values);   // sans le lien
        }
        onToast("RDV créé dans le calendrier Odoo", "success");
      } catch (err: any) {
        // Idem : une erreur métier ne part PAS en file (elle rejouerait en boucle),
        // on affiche la cause pour que le RDV puisse être corrigé et resoumis.
        if (!odoo.isNetworkError(err)) {
          setError("Odoo a refusé la création : " + (err?.message || err));
          setSaving(false);
          return;
        }
        // Hors ligne → mise en file (version simplifiée, sans tag/organisateur résolus).
        await sync.queueAppointment(client?.name || title.trim(), { ...baseValues, ...clientLink });
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
        style={{ width: "100%", maxWidth: 820, maxHeight: "calc(100vh - 40px)", overflowY: "auto" as const, background: C.white, borderRadius: 20, padding: "24px 24px", boxShadow: C.shadowXl, fontFamily: "'DM Sans', sans-serif", display: "flex", flexWrap: "wrap" as const, gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 340px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "#f0fdfa", border: "1.5px solid #ccfbf1", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.teal} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>
              {trip ? (isEdit ? "Modifier le déplacement" : "Déplacement") : isEdit ? "Modifier le RDV" : adminMode ? "RDV administratif" : "Prendre un RDV"}
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>{client?.name || (adminMode ? "Sans client" : event?.name || "")}</div>
          </div>
        </div>

        {error && (
          <div style={{ background: C.redSoft, color: C.red, borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>{error}</div>
        )}

        {!clientProp && (!isEdit || event?.allday) && (
          <div style={{ display: "flex", background: C.bg, borderRadius: 10, padding: 3, marginBottom: 14 }}>
            {([[false, "Rendez-vous"], [true, "Déplacement"]] as const).map(([v, l]) => (
              <button type="button" key={l} onClick={() => { if (!isEdit) setTrip(v); }}
                style={{ flex: 1, height: 32, borderRadius: 8, border: "none", cursor: isEdit ? "default" : "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                  background: trip === v ? C.white : "transparent", color: trip === v ? C.tealDark : C.muted, boxShadow: trip === v ? "0 1px 4px rgba(15,23,42,0.1)" : "none" }}>
                {l}
              </button>
            ))}
          </div>
        )}

        {trip && <>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}><Field label="Du">
              <input type="date" value={tripFrom} onChange={e => { const v = e.target.value; setTripFrom(v); if (tripTo < v) setTripTo(v); }} style={inputStyle} />
            </Field></div>
            <div style={{ flex: 1 }}><Field label="Au">
              <input type="date" value={tripTo} min={tripFrom} onChange={e => setTripTo(e.target.value)} style={inputStyle} />
            </Field></div>
          </div>
          <Field label="Destination">
            <input value={destination} onChange={e => setDestination(e.target.value)} placeholder="Ex. Nice" style={inputStyle} autoFocus={!isEdit} />
          </Field>
          <Field label="Zone (optionnel)">
            <input value={zone} onChange={e => setZone(e.target.value)} placeholder="Ex. Sud-Est, 06…" style={inputStyle} />
          </Field>
        </>}

        {!trip && <>
        {canPickClient && (
          <Field label="Client (optionnel)">
            {picked ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, border: `1.5px solid ${C.teal}`, background: "#f0fdfa" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {picked.name}<span style={{ fontWeight: 500, color: C.muted }}>{[picked.ref, picked.city].filter(Boolean).map(x => ` · ${x}`).join("")}</span>
                </span>
                <button type="button" onClick={() => pickClient(null)} title="Retirer le client" style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 14 }}>✕</button>
              </div>
            ) : (
              <div style={{ position: "relative" as const }}>
                <input value={clientQuery} onChange={e => setClientQuery(e.target.value)} placeholder="Nom, code ou ville…" style={inputStyle} />
                {clientResults.length > 0 && (
                  <div style={{ position: "absolute" as const, left: 0, right: 0, top: "100%", marginTop: 4, background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: C.shadowXl, zIndex: 5, maxHeight: 220, overflowY: "auto" as const }}>
                    {clientResults.map(c => (
                      <button type="button" key={c.id} onClick={() => pickClient(c)}
                        style={{ display: "block", width: "100%", textAlign: "left" as const, padding: "9px 12px", background: "none", border: "none", borderBottom: `1px solid ${C.border}`, cursor: "pointer", fontFamily: "inherit" }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>{[c.ref, c.city].filter(Boolean).join(" · ")}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>
        )}

        <Field label="Titre">
          <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
        </Field>

        <Field label="Type de RDV">
          <select value={rdvTypeId} onChange={e => setRdvTypeId(e.target.value ? Number(e.target.value) : "")} style={inputStyle}>
            <option value="">— Choisir un type —</option>
            {rdvTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>

        <Field label="Date et heure">
          <input type="datetime-local" value={startLocal} onChange={e => { setStartTouched(true); setStartLocal(e.target.value); }}
            style={{ ...inputStyle, borderColor: overlaps.length ? C.orange : C.border }} />
          {overlaps.length > 0 && (
            <div style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, background: C.orangeSoft, color: C.orange, fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>
              Chevauche : {overlaps.map(r => `${fromOdoo(r.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} ${r.name}`).join(" ; ")}
              {nextFree && (
                <button type="button" onClick={() => setStartLocal(toLocalInput(nextFree))}
                  style={{ marginLeft: 8, background: "none", border: "none", padding: 0, color: C.orange, fontWeight: 800, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
                  Décaler à {nextFree.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </button>
              )}
            </div>
          )}
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

        </>}

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
        </div>
        <WeekPlanner monday={monday} gridStart={gridStart} day={day} events={weekEvents} startLocal={startLocal} durationHours={durationHours}
          hideSlot={trip}
          onPick={v => {
            if (trip) { const d = v.slice(0, 10); setTripFrom(d); if (tripTo < d) setTripTo(d); setStartLocal(`${d}T${startLocal.slice(11, 16) || "09:00"}`); return; }
            setStartTouched(true); setStartLocal(v);
          }} />
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

// Aperçu du calendrier pour planifier : semaine (nombre de RDV par jour, tap =
// changer de jour) + journée choisie de 8 h à 20 h, avec le créneau proposé.
// Tap sur un créneau vide = heure du RDV (au quart d'heure).
const H0 = 8, H1 = 20, PX = 34;   // heures affichées, pixels par heure
function WeekPlanner({ monday, gridStart, day, events, startLocal, durationHours, onPick, hideSlot }: {
  monday: Date; gridStart: Date; day: string; events: any[]; startLocal: string; durationHours: number; onPick: (v: string) => void; hideSlot?: boolean;
}) {
  const [view, setView] = useState<"week" | "month">(() => { try { return localStorage.getItem("wms_rdv_planner_view") === "month" ? "month" : "week"; } catch { return "week"; } });
  const chooseView = (v: "week" | "month") => { setView(v); try { localStorage.setItem("wms_rdv_planner_view", v); } catch {} };
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(d.getDate() + i); return d; });
  const monthDays = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(d.getDate() + i); return d; });
  const monthLabel = new Date(`${day}T12:00`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase());
  const dayStr = (d: Date) => toLocalInput(d).slice(0, 10);
  const hhmm = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const time = startLocal.slice(11, 16) || "09:00";
  const shiftWeek = (n: number) => {
    const d = new Date(`${day}T${time}`);
    if (view === "month") d.setMonth(d.getMonth() + n, 1); else d.setDate(d.getDate() + n * 7);
    onPick(toLocalInput(d));
  };
  const top = (d: Date) => (d.getHours() + d.getMinutes() / 60 - H0) * PX;
  const dayRef = new Date(`${day}T12:00`);
  const dayEv = events.filter(r => !r.allday && eventOnDay(r, dayRef));
  const dayTrips = events.filter(r => r.allday && eventOnDay(r, dayRef));
  const start = new Date(startLocal);
  const navBtn: React.CSSProperties = { width: 26, height: 26, borderRadius: 7, border: `1px solid ${C.border}`, background: C.white, cursor: "pointer", color: C.textSec, fontSize: 13, padding: 0 };
  return (
    <div style={{ flex: "1 1 300px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.textSec }}>Mon planning</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{monthLabel}</div>
        </div>
        <div style={{ display: "flex", background: C.bg, borderRadius: 8, padding: 2 }}>
          {([["week", "Semaine"], ["month", "Mois"]] as const).map(([v, l]) => (
            <button type="button" key={v} onClick={() => chooseView(v)}
              style={{ height: 24, padding: "0 9px", borderRadius: 6, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700,
                background: view === v ? C.white : "transparent", color: view === v ? C.tealDark : C.muted, boxShadow: view === v ? "0 1px 3px rgba(15,23,42,0.1)" : "none" }}>{l}</button>
          ))}
        </div>
        <button type="button" onClick={() => shiftWeek(-1)} style={navBtn} aria-label="Précédent">‹</button>
        <button type="button" onClick={() => shiftWeek(1)} style={navBtn} aria-label="Suivant">›</button>
      </div>
      {view === "month" ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 3 }}>
            {["L", "M", "M", "J", "V", "S", "D"].map((l, i) => <div key={i} style={{ textAlign: "center" as const, fontSize: 10, fontWeight: 700, color: C.muted }}>{l}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
            {monthDays.map(d => {
              const ds = dayStr(d), sel = ds === day, out = ds.slice(0, 7) !== day.slice(0, 7);
              const n = events.filter(r => !r.allday && eventOnDay(r, d)).length;
              const tripHere = events.find(r => r.allday && eventOnDay(r, d));
              return (
                <button type="button" key={ds} onClick={() => { onPick(`${ds}T${time}`); chooseView("week"); }} title={tripHere ? `Déplacement · ${tripHere.name}` : undefined}
                  style={{ minHeight: 46, padding: "4px 0", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", opacity: out ? 0.4 : 1,
                    background: sel ? C.teal : tripHere ? C.orangeSoft : C.bg, color: sel ? "#fff" : C.text }}>
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{d.getDate()}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: sel ? "#fff" : n ? C.teal : C.muted }}>{n ? `${n} RDV` : "·"}</div>
                  {tripHere && <div style={{ margin: "1px 2px 0", fontSize: 8, fontWeight: 800, color: sel ? "#fff" : C.orange, overflow: "hidden", whiteSpace: "nowrap" as const, textOverflow: "ellipsis" }}>{tripHere.name}</div>}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6 }}>Touche un jour pour voir ses créneaux.</div>
        </div>
      ) : <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 10 }}>
        {days.map(d => {
          const ds = dayStr(d), sel = ds === day;
          const n = events.filter(r => !r.allday && eventOnDay(r, d)).length;
          const tripHere = events.find(r => r.allday && eventOnDay(r, d));
          return (
            <button type="button" key={ds} onClick={() => onPick(`${ds}T${time}`)}
              style={{ padding: "5px 0", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", background: sel ? C.teal : C.bg, color: sel ? "#fff" : C.text }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, opacity: 0.75 }}>{d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "")}</div>
              <div style={{ fontSize: 14, fontWeight: 800 }}>{d.getDate()}</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, color: sel ? "#fff" : n ? C.teal : C.muted }}>{n ? `${n} RDV` : "libre"}</div>
              {tripHere && <div title={tripHere.name} style={{ margin: "2px 3px 0", fontSize: 8.5, fontWeight: 800, borderRadius: 4, padding: "0 2px", background: sel ? "rgba(255,255,255,0.25)" : C.orangeSoft, color: sel ? "#fff" : C.orange, overflow: "hidden", whiteSpace: "nowrap" as const, textOverflow: "ellipsis" }}>{tripHere.name}</div>}
            </button>
          );
        })}
      </div>
      {dayTrips.map(r => (
        <div key={r.id} style={{ marginBottom: 6, padding: "5px 9px", borderRadius: 8, background: C.orangeSoft, color: C.orange, fontSize: 11.5, fontWeight: 800 }}>
          Déplacement · {r.name}
        </div>
      ))}
      <div onClick={e => {
          const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
          const mins = Math.max(0, Math.min((H1 - H0) * 60 - 15, Math.floor((y / PX) * 4) * 15));
          onPick(`${day}T${String(H0 + Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);
        }}
        style={{ position: "relative" as const, height: (H1 - H0) * PX, borderRadius: 10, border: `1px solid ${C.border}`, background: C.white, cursor: "pointer", overflow: "hidden" }}>
        {Array.from({ length: H1 - H0 }, (_, i) => (
          <div key={i} style={{ position: "absolute" as const, left: 0, right: 0, top: i * PX, height: PX, borderTop: i ? `1px solid ${C.border}` : "none", fontSize: 9.5, color: C.muted, padding: "2px 5px", pointerEvents: "none" as const }}>{H0 + i}h</div>
        ))}
        {dayEv.map(r => {
          const s = fromOdoo(r.start), e = fromOdoo(r.stop);
          return (
            <div key={r.id} title={`${hhmm(s)}–${hhmm(e)} ${r.name}${r.location ? ` · ${r.location}` : ""}`}
              style={{ position: "absolute" as const, left: 32, right: 6, top: Math.max(0, top(s)), height: Math.max(14, top(e) - top(s) - 2), borderRadius: 6, background: "#e2e8f0", color: C.textSec, fontSize: 10.5, fontWeight: 700, padding: "2px 6px", overflow: "hidden", whiteSpace: "nowrap" as const, textOverflow: "ellipsis", pointerEvents: "none" as const }}>
              {hhmm(s)} {r.name}
            </div>
          );
        })}
        {!hideSlot && !isNaN(start.getTime()) && (
          <div style={{ position: "absolute" as const, left: 32, right: 6, top: top(start), height: Math.max(14, durationHours * PX - 2), borderRadius: 6, background: "rgba(13,148,136,0.18)", border: `1.5px solid ${C.teal}`, color: C.tealDark, fontSize: 10.5, fontWeight: 800, padding: "2px 6px", pointerEvents: "none" as const }}>
            {hhmm(start)} nouveau RDV
          </div>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6 }}>Touche un créneau pour y placer le RDV.</div>
      </>}
    </div>
  );
}
