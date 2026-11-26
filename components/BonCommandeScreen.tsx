"use client";
// « Charger la commande » : import d'un bon de commande client (PDF, Excel, Word,
// JPG, PNG…), sur le modèle du module Odoo « sale_order_ocr_import ».
//
// 1. Le document est lu par ODOO (méthode flow_read_document du module, avec sa
//    clé API et son modèle Claude ; lecture directe pour les « Accord périmés »)
//    → lignes brutes : code article, EAN,
//    désignation, quantité, unités gratuites (UG). Aucun prix ni remise du bon.
// 2. Chaque ligne est cherchée PAR ODOO (option resolve, module 1.53+ : même code
//    que son bouton « Charger la commande »). Module plus ancien : recherche faite
//    ici avec une copie des règles (lib/bonMatch.ts) : code, EAN, miniatures / échantillons → lots, article
//    archivé ou non vendable → remplaçant ou note de rupture, recherche par le nom,
//    « ⚠ À SAISIR » sinon.
// 3. Le commercial vérifie, corrige, puis les lignes remplissent le panier
//    habituel : prix de la liste de prix du client, UG en gratuités « Geste Co. -
//    hors Coffre », notes à leur place. Le fichier et un récapitulatif sont joints
//    au chatter du devis à sa création.
import { useState, useEffect, useRef } from "react";
import * as odoo from "@/lib/odoo";
import * as sync from "@/lib/sync";
import QtyPad from "@/components/QtyPad";
import BonLoader from "@/components/BonLoader";
import { PriceItem, applyPricelist } from "@/lib/pricing";
import { pickClientAmong } from "@/lib/clients";
import { loadCatalog, resolveLines, saisirNote, type Resolved, type Highlight, type BonLine } from "@/lib/bonMatch";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  orange: "#ea580c", orangeSoft: "#fff7ed",
  green: "#16a34a", greenSoft: "#f0fdf4",
  red: "#dc2626", redSoft: "#fef2f2",
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)",
};

const PRODUCT_FIELDS = ["id", "name", "display_name", "default_code", "barcode", "lst_price", "product_tmpl_id", "virtual_available", "sale_ok"];
// Photo iPad : 3 à 6 Mo en JPEG. Réduite à 2000 px de côté, elle reste très
// lisible pour la lecture et passe sous la limite de taille des requêtes Vercel.
const MAX_IMAGE_SIDE = 2000;
const MAX_FILE_BYTES = 3_000_000;

interface ClientLu {
  nom: string; adresse: string; code_postal: string; ville: string;
  telephone: string; email: string; siret: string; numero_client: string;
}
interface BonLu {
  client: ClientLu;
  numero_commande: string; date_livraison: string; commentaire: string;
  lignes: BonLine[];
  lignes_ignorees: string[];
  remarques: string;
  code_client: string | null;
}
interface Ligne extends Resolved {
  include: boolean;
  suggestions: any[];      // ligne « À SAISIR » : articles proposés d'après la désignation
}

// Ligne déjà cherchée par Odoo (flow_read_document avec resolve, module 1.53+) :
// mêmes règles que le bouton « Charger la commande » d'Odoo.
const normCode = (s: any) => String(s || "").replace(/\s/g, "").toUpperCase();
function fromOdoo(r: any, key: number): Resolved {
  const p = r.product || null;
  const by = r.by_name || undefined;
  let matchedBy: Resolved["matchedBy"] = null;
  if (p) {
    if (/remplacé via le nom/.test(by || "")) matchedBy = "remplacement";
    else if (by) matchedBy = "nom";
    else if (r.in_lots) matchedBy = "lot";
    else if (r.code && normCode(p.default_code) === normCode(r.code)) matchedBy = "code";
    else if (r.ean) matchedBy = "ean";
    else matchedBy = "code";
  }
  return {
    key,
    lue: { code: r.code || "", ean: r.ean || "", label: r.label || "", qty: r.ordered_qty || 0, free: r.ordered_free || 0, comment: r.comment || "" },
    kind: r.kind === "rupture" || r.kind === "saisir" ? r.kind : "product",
    product: p, qty: r.qty || 0, freeQty: r.free_qty || 0, inLots: !!r.in_lots, matchedBy,
    description: r.description || undefined, highlight: r.highlight || undefined,
    byName: by, lotNote: r.lot_note || undefined, note: r.note || undefined, reason: r.reason || undefined,
  };
}

// Résultat transmis à la prise de commande.
export type ImportedLine =
  | { product: any; qty: number; unitPrice: number; lineName?: string; highlight?: Highlight }
  | { note: string; highlight?: Highlight };
export interface ImportMeta {
  clientRef: string;
  readByClaude: boolean;
  bdcOffline: boolean;
  summaryHtml: string;
  file: { name: string; data: string } | null;
}
export interface ImportResult {
  lines: ImportedLine[];
  gifts: { product: any; qty: number; unitPrice: number }[];
  note: string;
  meta: ImportMeta;
}

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("Lecture du fichier impossible"));
    r.readAsDataURL(file);
  });
}

async function shrinkImage(file: File): Promise<{ data: string; mediaType: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Image illisible (format HEIC ? prends une capture d'écran ou exporte en JPEG)"));
      i.src = url;
    });
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { data: dataUrl.split(",")[1] || "", mediaType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Type réel du fichier, lu dans ses premiers octets. Un bon enregistré depuis un
// mail ou un logiciel de pharmacie arrive souvent SANS extension : le navigateur
// ne lui donne alors aucun type, alors que c'est un PDF.
type FileKind = "pdf" | "image" | "docx" | "xlsx" | "csv" | "old-office";
const OFFICE_MIME: Record<"docx" | "xlsx" | "csv", string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};

async function sniffKind(file: File): Promise<FileKind | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = String.fromCharCode(...Array.from(b));
  const name = file.name.toLowerCase();
  if (ascii.startsWith("%PDF-")) return "pdf";
  if (ascii.startsWith("PK\x03\x04")) {
    const head = new TextDecoder("latin1").decode(await file.slice(0, Math.min(file.size, 4_000_000)).arrayBuffer());
    if (head.includes("word/")) return "docx";
    if (head.includes("xl/")) return "xlsx";
    if (name.endsWith(".docx")) return "docx";
    if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return "xlsx";
  }
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return "old-office";
  if (/\.(csv|tsv|txt)$/.test(name) || file.type === "text/csv") return "csv";
  if (b[0] === 0xff && b[1] === 0xd8) return "image";                 // JPEG
  if (ascii.startsWith("\x89PNG")) return "image";                    // PNG
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image";
  if (ascii.startsWith("GIF8")) return "image";
  if (ascii.slice(4, 8) === "ftyp") return "image";                   // HEIC (photo iPhone)
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  return null;
}

const digits = (s: string) => (s || "").replace(/\D/g, "");
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function fmtPrice(n: number) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n); }
const fmtQty = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

// ── Recherche par désignation (lignes sans code, recherche manuelle) ──────
// Les bons écrivent « LOTION TONIFIANTE VISAGE - 30ML », Odoo « Lotion
// tonifiante 30 ml » : majuscules, accents absents, contenance collée, mots en
// plus. Exiger tous les mots ne trouve rien. On ramène donc large (les deux mots
// les plus distinctifs) puis on classe côté app : part des mots retrouvés,
// contenance identique (bonus) ou différente (malus), testeurs écartés.
const STOP_WORDS = new Set(["dr", "hauschka", "haushka", "de", "des", "du", "la", "le", "les", "et", "au", "aux", "en", "pour", "un", "une", "avec"]);
const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(ml|gr|g|cl|l)\b/;

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function sizeOf(s: string): string | null {
  const m = norm(s).match(SIZE_RE);
  return m ? `${m[1].replace(",", ".")}${m[2] === "gr" ? "g" : m[2]}` : null;
}
function parseDesignation(d: string): { words: string[]; size: string | null } {
  const n = norm(d).replace(/\bdr\.?\s*h\b\.?/g, " ");
  const words = n.replace(new RegExp(SIZE_RE.source, "g"), " ")
    .split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  return { words: Array.from(new Set(words)), size: sizeOf(n) };
}
function scoreProduct(p: any, q: { words: string[]; size: string | null }): number {
  const hay = norm(`${p.display_name || ""} ${p.name || ""}`);
  let score = q.words.length ? q.words.filter(w => hay.includes(w)).length / q.words.length : 0;
  if (q.size) {
    const ps = sizeOf(hay);
    if (ps) score += ps === q.size ? 0.5 : -0.5;
  }
  if (/testeur|tester|echantillon/.test(hay) && !q.words.some(w => /test|echant/.test(w))) score -= 0.4;
  return score;
}
// Accents : le bon écrit « ECLAT », Odoo « Éclat ». Dans un ilike, « _ » vaut
// un caractère quelconque : chaque e devient _ pour accepter é, è, ê.
const accentTolerant = (w: string) => w.replace(/e/g, "_");

async function searchByDesignation(session: odoo.OdooSession, text: string, limit = 8): Promise<any[]> {
  const q = parseDesignation(text);
  if (!q.words.length) return [];
  const key = [...q.words].sort((a, b) => b.length - a.length).slice(0, 2);
  let rows: any[];
  try {
    const nameOr: any[] = key.length === 2
      ? ["|", ["name", "ilike", accentTolerant(key[0])], ["name", "ilike", accentTolerant(key[1])]]
      : [["name", "ilike", accentTolerant(key[0])]];
    rows = await odoo.searchRead(session, "product.product", [["sale_ok", "=", true], ...nameOr], PRODUCT_FIELDS, 60);
  } catch (e) {
    if (!odoo.isNetworkError(e)) throw e;
    rows = (await sync.getCachedProducts()).filter((p: any) => {
      const hay = norm(`${p.display_name || ""} ${p.name || ""}`);
      return key.some(w => hay.includes(w));
    });
  }
  return rows
    .map(p => ({ p, s: scoreProduct(p, q) }))
    .filter(x => x.s > 0.3)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(x => x.p);
}


// ── Recherche du client émetteur dans Odoo ────────────────────────────────
// Chaque indice lu sur le bon donne des points ; les identifiants uniques
// (code client, SIRET) valent plus que le nom, souvent abrégé ou différent de la
// raison sociale saisie dans Odoo (« GRANDE PHARMACIE GERBAUD Mme Bonnet »).
interface ClientCandidate { row: any; score: number; reasons: string[] }

const CLIENT_MATCH_FIELDS = [...sync.CLIENT_FIELDS, "zip", "street"];
// Mots trop courants pour distinguer un client.
const GENERIC_WORDS = new Set(["pharmacie", "grande", "parapharmacie", "pharma", "officine", "sarl", "selarl", "sas", "sasu", "eurl",
  "centre", "comptoir", "comptoirs", "magasin", "boutique", "madame", "monsieur", "mme"]);

function nameWords(s: string): string[] {
  return Array.from(new Set(
    (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !GENERIC_WORDS.has(w)),
  ));
}

// « 04 66 67 34 82 », « 04.66.67.34.82 », « +33 4 66 67 34 82 » : on garde les
// 8 derniers chiffres, par paires séparées de % (joker Odoo) pour ignorer le format.
function phonePattern(tel: string): string | null {
  const d = (tel || "").replace(/\D/g, "");
  if (d.length < 9) return null;
  const last = d.slice(-8);
  return last.match(/../g)!.join("%");
}

async function findClientCandidates(session: odoo.OdooSession, c: ClientLu): Promise<ClientCandidate[]> {
  const found = new Map<number, ClientCandidate>();
  const add = (rows: any[], points: number, reason: string) => {
    for (const r of rows) {
      const cur = found.get(r.id) || { row: r, score: 0, reasons: [] };
      if (!cur.reasons.includes(reason)) { cur.score += points; cur.reasons.push(reason); }
      found.set(r.id, cur);
    }
  };
  // Un champ absent de cette instance (siret, mobile…) fait échouer SA requête
  // seulement : les autres indices continuent de jouer.
  const q = async (domain: any[], points: number, reason: string, limit = 20) => {
    try { add(await odoo.searchRead(session, "res.partner", [["active", "=", true], ...domain], CLIENT_MATCH_FIELDS, limit), points, reason); }
    catch (e) { if (odoo.isNetworkError(e)) throw e; }
  };

  const tasks: Promise<void>[] = [];
  const code = (c.numero_client || "").trim();
  if (code) tasks.push(q([["ref", "=ilike", code]], 100, "code client"));
  const siret = digits(c.siret);
  if (siret.length >= 9) {
    tasks.push(q([["siret", "=like", siret.slice(0, 9) + "%"]], 100, "SIRET"));
    tasks.push(q([["company_registry", "=like", siret.slice(0, 9) + "%"]], 100, "SIRET"));
  }
  const email = (c.email || "").trim();
  if (email.includes("@")) tasks.push(q([["email", "=ilike", email]], 60, "e-mail"));
  const tel = phonePattern(c.telephone);
  if (tel) {
    tasks.push(q([["phone", "ilike", tel]], 60, "téléphone"));
    tasks.push(q([["mobile", "ilike", tel]], 60, "téléphone"));
  }
  const words = nameWords(c.nom);
  const zip = digits(c.code_postal).slice(0, 5);
  if (words.length) {
    const nameOr: any[] = [...Array(words.length - 1).fill("|"), ...words.map(w => ["name", "ilike", w])];
    if (zip.length === 5) tasks.push(q([["zip", "=", zip], ...nameOr], 40, "nom + code postal"));
    else if (c.ville) tasks.push(q([["city", "ilike", c.ville], ...nameOr], 30, "nom + ville"));
    // Nom seul : dernier recours, à confirmer à la main. Un mot suffit — le bon
    // mêle souvent la raison sociale et le nom du titulaire (« … GERBAUD Mme Bonnet »).
    tasks.push(q([["customer_rank", ">", 0], ...nameOr], 20, "nom"));
  }
  await Promise.all(tasks);

  // Bonus : chaque mot du nom retrouvé dans la fiche.
  for (const cand of Array.from(found.values())) {
    const rw = new Set(nameWords(cand.row.name));
    cand.score += words.filter(w => rw.has(w)).length * 5;
  }
  return Array.from(found.values()).sort((a, b) => b.score - a.score);
}

// Client retenu d'office seulement s'il se détache nettement : un identifiant
// fort (≥ 60 points) et aucun autre candidat au même niveau.
function autoPick(cands: ClientCandidate[]): ClientCandidate | null {
  if (!cands.length || cands[0].score < 60) return null;
  const top = cands.filter(c => c.score === cands[0].score);
  if (top.length === 1) return top[0];
  // Même score : société et ses adresses de livraison → pickClientAmong tranche.
  const { row, ambiguous } = pickClientAmong(top.map(c => c.row));
  return ambiguous ? null : top.find(c => c.row.id === row?.id) || null;
}

// Mots communs à deux noms (≥ 4 lettres) — sert seulement à AVERTIR si le bon
// semble venir d'un autre client que celui ouvert.
function sameClientHint(a: string, b: string): boolean {
  const words = (s: string) => new Set(
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !["pharmacie", "grande", "parapharmacie"].includes(w)),
  );
  const wa = words(a), wb = words(b);
  if (!wa.size || !wb.size) return true;
  return Array.from(wa).some(w => wb.has(w));
}

// La date est demandée au format AAAA-MM-JJ ; si le modèle renvoie autre chose,
// on l'affiche telle quelle plutôt que « Invalid Date ».
function fmtDay(s: string) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("fr-FR");
}

function chipBtn(active: boolean): React.CSSProperties {
  return {
    height: 44, padding: "0 14px", borderRadius: 22, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
    border: `1.5px solid ${active ? C.teal : C.border}`,
    background: active ? C.teal : C.white, color: active ? "#fff" : C.textSec,
  };
}


const STRIPE: Record<string, string> = { red: C.red, orange: C.orange, green: C.green };

export default function BonCommandeScreen({ session, client, priceItems, onApply, onToast, onSelectClient, initialFile }: {
  session: odoo.OdooSession;
  // null = import lancé depuis l'accueil : le client est retrouvé d'après le bon.
  client: any | null;
  onSelectClient?: (c: any) => void;
  // Fichier reçu depuis une autre app (Mail → partager → Commande) : analysé d'office.
  initialFile?: File | null;
  priceItems: PriceItem[];
  onApply: (res: ImportResult) => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState<"" | "lecture" | "catalogue" | "client">("");
  const [candidates, setCandidates] = useState<ClientCandidate[]>([]);
  const [clientReasons, setClientReasons] = useState<string[] | null>(null);
  const [pickingClient, setPickingClient] = useState(false);
  const [error, setError] = useState("");
  const [bon, setBon] = useState<BonLu | null>(null);
  const [info, setInfo] = useState<{ model: string | null; bdcOffline: boolean; skipped: number; file: { name: string; data: string } | null }>({ model: null, bdcOffline: false, skipped: 0, file: null });
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [searchFor, setSearchFor] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ url: string; kind: "pdf" | "image" | "html"; html?: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [onlyToCheck, setOnlyToCheck] = useState(false);
  const [padFor, setPadFor] = useState<{ key: number; field: "qty" | "freeQty" } | null>(null);
  const wide = useWide();

  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  const clientPrice = (p: any, qty: number) =>
    applyPricelist(p.lst_price || 0, p.id, p.product_tmpl_id?.[0] || 0, priceItems, Math.max(1, qty));

  const analyse = async (file: File) => {
    setError(""); setBon(null); setLignes([]); setFileName(file.name);
    setPreview(null); setOnlyToCheck(false); setSearchFor(null);
    setCandidates([]); setClientReasons(null); setPickingClient(false);
    setLoading("lecture");
    try {
      let payload: { data: string; mediaType: string };
      const kind = await sniffKind(file);
      if (kind === "pdf" || kind === "image") {
        setPreview({ url: URL.createObjectURL(new Blob([file], { type: kind === "pdf" ? "application/pdf" : file.type || "image/jpeg" })), kind });
      }
      if (kind === "image") payload = await shrinkImage(file);
      else if (kind === "pdf" || kind === "docx" || kind === "xlsx" || kind === "csv") {
        if (file.size > MAX_FILE_BYTES) throw new Error("Fichier trop volumineux (3 Mo maximum)");
        payload = { data: await readAsBase64(file), mediaType: kind === "pdf" ? "application/pdf" : OFFICE_MIME[kind] };
      } else if (kind === "old-office") {
        throw new Error("Ancien format Word / Excel (.doc, .xls) : enregistre-le en .docx ou .xlsx, ou en PDF.");
      } else {
        throw new Error("Format non reconnu — PDF, Excel, Word, CSV, JPG, PNG…");
      }
      // Fichier joint au devis : celui envoyé à la lecture (photo réduite en JPEG).
      const original = payload.data;
      // Lecture par Odoo (module « Import de commandes clients par Claude ») : Odoo
      // utilise sa propre clé API et son modèle Claude (paramètres système).
      const sentName = kind === "image" ? `${(file.name || "photo").replace(/\.[^.]+$/, "")}.jpg` : (file.name || "commande");
      let data: any;
      try {
        // resolve : Odoo (module 1.53+) cherche aussi les articles, avec les règles
        // exactes de son bouton « Charger la commande ». Module plus ancien : il
        // refuse l'option → lecture seule, recherche faite ici (lib/bonMatch).
        try {
          data = await odoo.callMethod(session, "sale.order.ocr.import", "flow_read_document", [payload.data, sentName, payload.mediaType], { resolve: true });
        } catch (e: any) {
          if (!/unexpected keyword|resolve/i.test(String(e?.message || e))) throw e;
          data = await odoo.callMethod(session, "sale.order.ocr.import", "flow_read_document", [payload.data, sentName, payload.mediaType]);
        }
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (/sale\.order\.ocr\.import|flow_read_document|does not exist|n'existe pas/i.test(msg)) {
          throw new Error("Module Odoo « Import de commandes clients par Claude » (version 19.0.1.46.0 ou plus) non installé sur cette base.");
        }
        if (/abort|délai|timeout|timed out/i.test(msg)) throw new Error("Lecture trop longue. Réessaie, ou envoie une photo plus nette.");
        if (e?.network) throw new TypeError(msg);
        throw new Error(msg);
      }
      const lu: BonLu = data.bon;
      if (data.previewHtml) setPreview({ url: "", kind: "html", html: data.previewHtml });
      setBon(lu);
      let lines: Resolved[], skipped: number, cat: { offline?: boolean } = {};
      if (Array.isArray(data.resolved)) {
        lines = data.resolved.map(fromOdoo);
        skipped = data.skipped || 0;
      } else {
        setLoading("catalogue");
        const local = await loadCatalog(session);
        cat = local;
        ({ lines, skipped } = resolveLines(local, lu.lignes || []));
      }
      setInfo({
        model: data.model || null, bdcOffline: !!data.bdcOffline, skipped,
        file: { name: kind === "image" && !/\.(jpe?g)$/i.test(file.name) ? `${file.name.replace(/\.[^.]+$/, "")}.jpg` : file.name || "commande", data: original },
      });
      setLignes(await Promise.all(lines.map(async (l): Promise<Ligne> => ({
        ...l, include: true,
        suggestions: l.kind === "saisir" && l.lue.label ? await searchByDesignation(session, l.lue.label, 4).catch(() => []) : [],
      }))));
      if (cat.offline) onToast("Hors ligne : recherche sur le catalogue préchargé (articles archivés non vérifiés)", "info");
      if (onSelectClient) {
        setLoading("client");
        const cands = await findClientCandidates(session, { ...lu.client, numero_client: lu.client.numero_client || lu.code_client || "" });
        setCandidates(cands);
        const best = autoPick(cands);
        if (best) { onSelectClient(best.row); setClientReasons(best.reasons); }
        else setPickingClient(true);
      }
    } catch (e: any) {
      setError(e instanceof TypeError
          ? "Réseau indisponible — la lecture d'un bon nécessite une connexion."
          : e?.message || "Erreur inconnue");
    } finally {
      setLoading("");
    }
  };

  useEffect(() => {
    if (initialFile) void analyse(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const update = (key: number, patch: Partial<Ligne>) =>
    setLignes(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  const pickProduct = (l: Ligne, p: any) => update(l.key, {
    kind: "product", product: p, matchedBy: "manuel", include: true, note: undefined, highlight: undefined, description: undefined,
    qty: l.qty || l.lue.qty, freeQty: l.freeQty || l.lue.free,
  });

  const isProduct = (l: Ligne) => l.kind === "product" && !!l.product;
  const nonVendable = (l: Ligne) => isProduct(l) && l.product.sale_ok === false;
  const aVerifier = (l: Ligne) => l.kind !== "product" || !!l.byName || nonVendable(l) || !!l.description;
  const retenues = lignes.filter(l => l.include && isProduct(l) && (l.qty > 0 || l.freeQty > 0));
  const nbSaisir = lignes.filter(l => l.kind === "saisir").length;
  const nbRupture = lignes.filter(l => l.kind === "rupture").length;
  const nbNom = lignes.filter(l => isProduct(l) && !!l.byName).length;
  const nbAVerifier = lignes.filter(aVerifier).length;
  const visibles = onlyToCheck ? lignes.filter(aVerifier) : lignes;
  const total = retenues.reduce((s, l) => s + l.qty * clientPrice(l.product, l.qty), 0);
  const autreClient = bon?.client?.nom && client && !onSelectClient ? !sameClientHint(bon.client.nom, client.name) : false;
  // « Accord périmés » : code client du fichier ≠ client du devis.
  const clientRef = String(client?.ref || "").trim();
  const codeClientDiff = !!bon?.code_client && !!clientRef && bon.code_client.trim().toLowerCase() !== clientRef.toLowerCase();
  const canApply = !!client && !pickingClient && lignes.some(l => l.include);

  const apply = () => {
    if (!canApply || !bon) return;
    const lines: ImportedLine[] = [];
    const gifts: { product: any; qty: number; unitPrice: number }[] = [];
    const imported: string[] = [], byName: string[] = [], lots: string[] = [], ruptures: string[] = [], issues: string[] = [], freeLines: string[] = [];
    for (const l of lignes) {
      if (!l.include) continue;
      if (isProduct(l)) {
        if (l.qty > 0) {
          lines.push({ product: l.product, qty: l.qty, unitPrice: clientPrice(l.product, l.qty), lineName: l.description, highlight: l.highlight });
          imported.push(`[${l.product.default_code || "-"}] ${l.product.name} × ${fmtQty(l.qty)}`);
        }
        if (l.freeQty > 0) {
          gifts.push({ product: l.product, qty: l.freeQty, unitPrice: clientPrice(l.product, l.freeQty) });
          freeLines.push(`[${l.product.default_code || "-"}] ${l.product.name} : ${fmtQty(l.freeQty)} UG`);
        }
        if (l.byName) byName.push(l.byName);
        if (l.lotNote) lots.push(l.lotNote);
      } else if (l.kind === "rupture" && l.note) {
        lines.push({ note: l.note, highlight: "red" });
        ruptures.push(l.note);
      } else {
        const n = l.note || saisirNote(l, l.reason || "");
        lines.push({ note: n, highlight: "orange" });
        issues.push(n);
      }
    }
    const list = (title: string, items: string[]) => items.length
      ? `<p><b>${esc(title)}</b></p><ul>${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : "";
    const remarques = [bon.remarques, codeClientDiff ? `⚠ Code client du fichier (${bon.code_client}) différent de celui du client (${clientRef}).` : ""].filter(Boolean).join(" ");
    const summaryHtml = [
      `<p><b>Commande chargée depuis « ${esc(info.file?.name || fileName)} » (app Flow)</b></p><ul>`,
      `<li>${info.model ? `Modèle Claude : ${esc(info.model)}` : "Modèle Claude : aucun (fichier lu directement, sans appel à Claude)"}</li>`,
      `<li>${imported.length} ligne(s) importée(s) sur ${lignes.length}${info.skipped ? ` — ${info.skipped} ligne(s) sans quantité ignorée(s)` : ""}</li></ul>`,
      list("Articles trouvés par leur libellé — à vérifier :", byName),
      list("Unités gratuites (UG) — 2e ligne à 100 % de remise, Geste Co. - hors Coffre :", freeLines),
      list("Miniatures et échantillons convertis en lots :", lots),
      list("Articles archivés ou non vendables, sans équivalent (ligne de note) :", ruptures),
      list("Lignes à compléter :", issues),
      bon.lignes_ignorees?.length ? `<p>Lignes ignorées : ${esc(bon.lignes_ignorees.join("; "))}</p>` : "",
      remarques ? `<p>Remarques : ${esc(remarques)}</p>` : "",
    ].join("");
    const note = [
      bon.date_livraison && `Livraison souhaitée le ${fmtDay(bon.date_livraison)}`,
      bon.commentaire,
    ].filter(Boolean).join(" — ");
    onApply({
      lines, gifts, note,
      meta: { clientRef: bon.numero_commande || "", readByClaude: !!info.model, bdcOffline: info.bdcOffline, summaryHtml, file: info.file },
    });
    const n = lines.filter(x => !("note" in x)).length;
    onToast(`${n} article${n > 1 ? "s" : ""} ajouté${n > 1 ? "s" : ""} au panier`
      + (gifts.length ? ` · ${gifts.length} ligne${gifts.length > 1 ? "s" : ""} UG` : "")
      + (issues.length ? ` · ${issues.length} à saisir` : ""), issues.length ? "info" : "success");
  };

  const fileInput = (
    <input type="file" disabled={!!loading} style={{ display: "none" }}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void analyse(f); }} />
  );
  const padLine = padFor ? lignes.find(l => l.key === padFor.key) : null;

  if (loading) {
    return (
      <div style={{ flex: 1, overflowY: "auto" as const, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 560 }}>
          <BonLoader step={loading} fileName={fileName} withClient={!!onSelectClient} />
        </div>
      </div>
    );
  }

  if (!bon) {
    return (
      <div style={{ flex: 1, overflowY: "auto" as const, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 560, textAlign: "center" as const }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>Charger la commande</div>
          <div style={{ fontSize: 14, color: C.muted, marginTop: 6, marginBottom: 24, lineHeight: 1.5 }}>
            PDF, Excel, Word, JPG, PNG, etc. {onSelectClient ? "Le client et les articles sont retrouvés d'après le bon" : "Les articles et les quantités sont retrouvés d'après le bon"} ; les prix viennent de la liste de prix du client. Tu vérifies avant d'ajouter au panier.
          </div>
          <label style={{
            display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 10,
            minHeight: 180, padding: 24, borderRadius: 20, border: `2px dashed ${C.teal}`,
            background: C.tealSoft, color: C.tealDark, fontWeight: 800, fontSize: 17, cursor: "pointer",
          }}>
            {fileInput}
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"/>
            </svg>
            Choisir le fichier ou prendre une photo
          </label>
          {error && (
            <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 12, background: C.redSoft, color: C.red, fontSize: 14, fontWeight: 600, textAlign: "left" as const }}>
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  const tag = (text: string, color: string, bg: string) => (
    <span style={{ fontSize: 11, fontWeight: 700, color, background: bg, borderRadius: 6, padding: "2px 7px", whiteSpace: "nowrap" as const }}>{text}</span>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" as const }}>
      <div style={{ padding: "12px 20px", background: C.white, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const }}>
        <div style={{ flex: 1, minWidth: 240, fontSize: 13, color: C.textSec, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 800, color: C.text, fontSize: 15 }}>{bon.client.nom || fileName}</span>
          {bon.client.ville && <span style={{ color: C.muted }}> · {bon.client.ville}</span>}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" as const, color: C.muted, fontSize: 12.5 }}>
            {bon.numero_commande && <span>Réf. client <b style={{ color: C.textSec }}>{bon.numero_commande}</b></span>}
            {bon.date_livraison && <span>Livraison <b style={{ color: C.textSec }}>{fmtDay(bon.date_livraison)}</b></span>}
            {bon.commentaire && <span>« {bon.commentaire} »</span>}
            <span>{info.model ? `Lu par Claude (${info.model})` : "Lu directement (sans Claude)"}{info.bdcOffline ? " · BDC Offline" : ""}</span>
          </div>
        </div>
        {!wide && preview && <button onClick={() => setShowPreview(true)} style={toolBtn(false)}>Voir le bon</button>}
        <label style={{ ...toolBtn(false), display: "inline-flex", alignItems: "center" }}>
          {fileInput}
          Changer de document
        </label>
      </div>
      {autreClient && (
        <div style={{ padding: "10px 20px", background: C.orangeSoft, color: C.orange, fontSize: 13.5, fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>
          Ce bon semble venir de « {bon.client.nom} », pas de {client.name}. Vérifie le client avant de continuer.
        </div>
      )}
      {codeClientDiff && (
        <div style={{ padding: "10px 20px", background: C.orangeSoft, color: C.orange, fontSize: 13.5, fontWeight: 700, borderBottom: `1px solid ${C.border}` }}>
          Code client du fichier ({bon.code_client}) différent de celui du client ({clientRef}).
        </div>
      )}
      {onSelectClient && (
        <ClientBar session={session} client={client} reasons={clientReasons} candidates={candidates}
          picking={pickingClient || !client} bonClient={bon.client}
          onChange={() => setPickingClient(true)}
          onPick={c => { onSelectClient(c.row ?? c); setClientReasons(c.reasons ?? ["choisi à la main"]); setPickingClient(false); }} />
      )}

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {wide && preview && (
          <div style={{ width: "42%", maxWidth: 620, borderRight: `1px solid ${C.border}`, background: "#e2e8f0", display: "flex" }}>
            <DocPreview preview={preview} />
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0, overflowY: "auto" as const, padding: "14px 20px 20px", WebkitOverflowScrolling: "touch" as any }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "center", marginBottom: 12 }}>
            <span style={badge(C.greenSoft, C.green)}>{lignes.filter(isProduct).length} trouvée{lignes.filter(isProduct).length > 1 ? "s" : ""}</span>
            {nbNom > 0 && <span style={badge(C.orangeSoft, C.orange)}>{nbNom} par le nom</span>}
            {nbRupture > 0 && <span style={badge(C.redSoft, C.red)}>{nbRupture} rupture{nbRupture > 1 ? "s" : ""}</span>}
            {nbSaisir > 0 && <span style={badge(C.orangeSoft, C.orange)}>{nbSaisir} à saisir</span>}
            {info.skipped > 0 && <span style={badge(C.bg, C.muted)}>{info.skipped} sans quantité ignorée{info.skipped > 1 ? "s" : ""}</span>}
            <span style={{ flex: 1 }} />
            {nbAVerifier > 0 && (
              <button onClick={() => setOnlyToCheck(v => !v)} style={toolBtn(onlyToCheck)}>À vérifier ({nbAVerifier})</button>
            )}
          </div>
          {bon.remarques && <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>{bon.remarques}</div>}

          {lignes.length === 0 && (
            <div style={{ padding: 24, fontSize: 14, color: C.muted, textAlign: "center" as const }}>Aucune ligne d'article avec une quantité dans ce fichier.</div>
          )}
          {onlyToCheck && visibles.length === 0 && (
            <div style={{ padding: 24, fontSize: 14, color: C.green, fontWeight: 700, textAlign: "center" as const }}>Tout est vérifié.</div>
          )}

          <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
            {visibles.map(l => {
              const prod = isProduct(l);
              const stripe = !l.include ? C.border : l.kind === "rupture" ? C.red : l.kind === "saisir" ? C.orange
                : l.highlight ? STRIPE[l.highlight] : l.byName || nonVendable(l) ? C.orange : C.green;
              const price = prod ? clientPrice(l.product, l.qty) : 0;
              return (
                <div key={l.key} style={{
                  display: "flex", background: C.white, borderRadius: 14, boxShadow: C.shadow,
                  border: `1px solid ${C.border}`, borderLeft: `5px solid ${stripe}`, overflow: "hidden",
                }}>
                  <button onClick={() => update(l.key, { include: !l.include })}
                    aria-label={l.include ? "Retirer la ligne" : "Garder la ligne"}
                    style={{ width: 52, flexShrink: 0, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 14 }}>
                    <span style={{
                      width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                      border: `2px solid ${l.include ? C.teal : C.border}`, background: l.include ? C.teal : C.white, color: "#fff",
                    }}>
                      {l.include && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>}
                    </span>
                  </button>

                  <div style={{ flex: 1, minWidth: 0, padding: "12px 14px 12px 0", opacity: l.include ? 1 : 0.5 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                          {[l.lue.code && `Réf. ${l.lue.code}`, l.lue.ean && `EAN ${l.lue.ean}`, l.lue.label, `qté ${fmtQty(l.lue.qty)}`, l.lue.free ? `UG ${fmtQty(l.lue.free)}` : ""].filter(Boolean).join(" · ")}
                        </div>
                        {prod ? (
                          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 2, lineHeight: 1.3 }}>
                            {l.product.display_name || l.product.name}
                            <span style={{ marginLeft: 8, display: "inline-flex", gap: 4, flexWrap: "wrap" as const, verticalAlign: "middle" }}>
                              {l.matchedBy === "code" && tag("Réf ✓", C.green, C.greenSoft)}
                              {l.matchedBy === "ean" && tag("EAN ✓", C.green, C.greenSoft)}
                              {l.matchedBy === "nom" && tag("par le nom — à vérifier", C.orange, C.orangeSoft)}
                              {l.matchedBy === "remplacement" && tag("remplacé", l.highlight === "red" ? C.red : C.orange, l.highlight === "red" ? C.redSoft : C.orangeSoft)}
                              {l.matchedBy === "manuel" && tag("choisi à la main", C.teal, C.tealSoft)}
                              {l.inLots && tag("en lots", C.teal, C.tealSoft)}
                            </span>
                          </div>
                        ) : l.kind === "rupture" ? (
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.red, marginTop: 2 }}>{l.note}</div>
                        ) : (
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.orange, marginTop: 2 }}>
                            ⚠ À SAISIR — {l.reason || "article introuvable dans Odoo"}
                          </div>
                        )}
                        {l.description && <div style={{ fontSize: 12.5, fontWeight: 700, color: l.highlight === "red" ? C.red : C.orange, marginTop: 2 }}>Libellé de la ligne : {l.description}</div>}
                        {l.byName && <div style={{ fontSize: 12, color: C.textSec, marginTop: 2 }}>{l.byName}</div>}
                        {l.lotNote && <div style={{ fontSize: 12, color: C.teal, marginTop: 2 }}>{l.lotNote}</div>}
                        {l.lue.comment && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Note de lecture : {l.lue.comment}</div>}
                        {nonVendable(l) && (
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.orange, marginTop: 2 }}>
                            « Peut être vendu » est décoché dans Odoo pour cet article — vérifie avant de l'ajouter.
                          </div>
                        )}
                        {l.kind === "saisir" && l.suggestions.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginTop: 6 }}>
                            {l.suggestions.map(p => (
                              <button key={p.id} onClick={() => pickProduct(l, p)}
                                style={{ ...chipBtn(false), borderColor: C.teal, color: C.tealDark, textAlign: "left" as const }}>
                                {p.display_name || p.name}
                                {p.default_code && <span style={{ color: C.muted, fontWeight: 600, marginLeft: 6 }}>{p.default_code}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                        {l.kind !== "rupture" && (
                          <button onClick={() => setSearchFor(searchFor === l.key ? null : l.key)}
                            style={{ margin: "2px 0 0 -8px", padding: "6px 8px", border: "none", background: "transparent", color: C.teal, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                            {searchFor === l.key ? "Fermer la recherche" : prod ? "Changer d'article" : "Choisir l'article"}
                          </button>
                        )}
                        {l.kind === "saisir" && l.include && (
                          <div style={{ fontSize: 11.5, color: C.muted }}>Sans article choisi, la ligne part en note « ⚠ À SAISIR » sur le devis.</div>
                        )}
                        {l.kind === "rupture" && l.include && (
                          <div style={{ fontSize: 11.5, color: C.muted }}>Ligne de note sur le devis (rupture).</div>
                        )}
                      </div>

                      {prod && (
                        <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                            <button onClick={() => update(l.key, { qty: Math.max(0, l.qty - 1) })} style={stepBtn(C.red)} aria-label="Moins">−</button>
                            <button onClick={() => setPadFor({ key: l.key, field: "qty" })} style={{ width: 52, height: 44, border: "none", borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, background: C.white, fontSize: 17, fontWeight: 800, color: C.text, cursor: "pointer", fontFamily: "inherit" }}>
                              {fmtQty(l.qty)}
                            </button>
                            <button onClick={() => update(l.key, { qty: l.qty + 1, include: true })} style={stepBtn(C.teal)} aria-label="Plus">+</button>
                          </div>
                          <button onClick={() => setPadFor({ key: l.key, field: "freeQty" })}
                            title="Unités gratuites (UG) : 2e ligne, Type de Gratuité « Geste Co. - hors Coffre »"
                            style={{ height: 30, padding: "0 10px", borderRadius: 15, border: `1.5px solid ${l.freeQty > 0 ? C.green : C.border}`, background: l.freeQty > 0 ? C.greenSoft : C.white, color: l.freeQty > 0 ? C.green : C.muted, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                            {l.freeQty > 0 ? `+ ${fmtQty(l.freeQty)} UG offert${l.freeQty > 1 ? "s" : ""}` : "+ UG"}
                          </button>
                        </div>
                      )}

                      {wide && prod && (
                        <div style={{ width: 96, flexShrink: 0, textAlign: "right" as const, paddingTop: 2 }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: l.include ? C.text : C.muted }}>{fmtPrice(l.qty * price)}</div>
                          <div style={{ fontSize: 11, color: C.muted }}>{fmtQty(l.qty)} × {fmtPrice(price)}</div>
                        </div>
                      )}
                    </div>
                    {searchFor === l.key && (
                      <ProductPicker session={session} initial={l.lue.label || l.lue.code || l.lue.ean}
                        onPick={p => { pickProduct(l, p); setSearchFor(null); }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 20px", background: C.white, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16, boxShadow: "0 -4px 12px rgba(0,0,0,0.04)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>{fmtPrice(total)} <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>HT · prix client</span></div>
          <div style={{ fontSize: 12.5, color: nbAVerifier ? C.orange : C.muted, fontWeight: 600 }}>
            {retenues.length} article{retenues.length > 1 ? "s" : ""} retenu{retenues.length > 1 ? "s" : ""}
            {nbAVerifier > 0 && ` · ${nbAVerifier} à vérifier`}
            {!client && " · client à choisir"}
          </div>
        </div>
        <button onClick={apply} disabled={!canApply}
          style={{
            height: 52, padding: "0 28px", borderRadius: 16, border: "none",
            background: canApply ? C.teal : C.border, color: "#fff",
            fontSize: 16, fontWeight: 800, cursor: canApply ? "pointer" : "default", fontFamily: "inherit",
            boxShadow: canApply ? "0 8px 20px rgba(13,148,136,0.25)" : "none",
          }}>
          {client ? "Ajouter au panier" : "Choisis le client"}
        </button>
      </div>

      {padLine && padFor && (
        <QtyPad name={(padLine.product?.name || padLine.lue.label) + (padFor.field === "freeQty" ? " — UG offertes" : "")}
          initial={padFor.field === "qty" ? padLine.qty : padLine.freeQty}
          onSet={n => update(padLine.key, padFor.field === "qty" ? { qty: n, include: true } : { freeQty: n })}
          onClose={() => setPadFor(null)} />
      )}

      {showPreview && preview && (
        <div className="fade-in" style={{ position: "fixed", inset: 0, zIndex: 240, background: "rgba(15,23,42,0.85)", display: "flex", flexDirection: "column" as const, paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", padding: 12 }}>
            <button onClick={() => setShowPreview(false)} style={{ ...toolBtn(false), background: C.white }}>Fermer</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: "flex", margin: "0 12px 12px", borderRadius: 12, overflow: "hidden", background: C.white }}>
            <DocPreview preview={preview} />
          </div>
        </div>
      )}
    </div>
  );
}

// Bandeau client de l'import depuis l'accueil : client reconnu (avec la raison),
// ou choix parmi les candidats + recherche libre.
function ClientBar({ session, client, reasons, candidates, picking, bonClient, onChange, onPick }: {
  session: odoo.OdooSession; client: any | null; reasons: string[] | null;
  candidates: ClientCandidate[]; picking: boolean; bonClient: ClientLu;
  onChange: () => void; onPick: (c: any) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const reqId = useRef(0);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      let rows: any[] = [];
      try {
        rows = await odoo.searchRead(session, "res.partner",
          ["|", "|", ["name", "ilike", q], ["ref", "ilike", q], ["city", "ilike", q], ["customer_rank", ">", 0], ["active", "=", true]],
          CLIENT_MATCH_FIELDS, 12);
      } catch {
        try { rows = await sync.searchCachedClients(q, 12); } catch {}
      }
      if (id === reqId.current) setResults(rows);
    }, 300);
    return () => clearTimeout(timer);
  }, [q, session]);

  if (client && !picking) {
    return (
      <div style={{ padding: "10px 20px", background: C.greenSoft, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: C.textSec }}>
          Client : <b style={{ color: C.text }}>{client.name}</b>
          {client.city && <span style={{ color: C.muted }}> · {client.city}</span>}
          {client.ref && <span style={{ color: C.muted }}> · {client.ref}</span>}
          {reasons && <span style={{ color: C.green, fontWeight: 700 }}> — reconnu par {reasons.join(", ")}</span>}
        </div>
        <button onClick={onChange} style={toolBtn(false)}>Changer</button>
      </div>
    );
  }

  const clientRow = (row: any, sub?: string, cand?: ClientCandidate) => (
    <button key={row.id} onClick={() => onPick(cand || { row, reasons: ["choisi à la main"] })}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 48, padding: "8px 12px", marginTop: 6, borderRadius: 12, border: `1.5px solid ${C.border}`, background: C.white, cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{row.name}</div>
        <div style={{ fontSize: 12, color: C.muted }}>{[row.ref, row.zip, row.city].filter(Boolean).join(" · ")}</div>
      </div>
      {sub && <span style={{ fontSize: 11.5, fontWeight: 700, color: C.teal, textAlign: "right" as const }}>{sub}</span>}
    </button>
  );

  return (
    <div style={{ padding: "12px 20px 14px", background: C.orangeSoft, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.orange }}>
        {candidates.length ? "Quel client ?" : "Client non retrouvé dans Odoo"}
        <span style={{ fontWeight: 600, color: C.textSec }}> — sur le bon : {[bonClient.nom, bonClient.code_postal, bonClient.ville].filter(Boolean).join(", ") || "rien d'exploitable"}</span>
      </div>
      <div style={{ maxWidth: 720 }}>
        {candidates.slice(0, 4).map(c => clientRow(c.row, c.reasons.join(", "), c))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un autre client (nom, code, ville)"
          style={{ width: "100%", boxSizing: "border-box" as const, height: 44, marginTop: 8, borderRadius: 12, border: `1.5px solid ${C.teal}`, padding: "0 12px", fontSize: 14, fontFamily: "inherit", background: C.white }} />
        {results.map(r => clientRow(r))}
      </div>
    </div>
  );
}

// Aperçu du document. PDF dans un iframe (visionneuse intégrée du navigateur),
// photo en image zoomable par pincement.
function DocPreview({ preview }: { preview: { url: string; kind: "pdf" | "image" | "html"; html?: string } }) {
  // Word / Excel convertis : iframe sandboxée (aucun script ne s'exécute).
  if (preview.kind === "html") {
    return <iframe srcDoc={preview.html} sandbox="" title="Bon de commande" style={{ flex: 1, width: "100%", border: "none", background: C.white }} />;
  }
  if (preview.kind === "pdf") {
    return <iframe src={preview.url} title="Bon de commande" style={{ flex: 1, width: "100%", border: "none", background: C.white }} />;
  }
  return (
    <div style={{ flex: 1, overflow: "auto" as const, WebkitOverflowScrolling: "touch" as any }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={preview.url} alt="Bon de commande" style={{ width: "100%", display: "block" }} />
    </div>
  );
}

// Paysage iPad (≥ 1000 px) : place pour l'aperçu du bon à côté des lignes.
function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const check = () => setWide(window.innerWidth >= 1000);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return wide;
}

function badge(bg: string, color: string): React.CSSProperties {
  return { padding: "6px 12px", borderRadius: 10, background: bg, color, fontSize: 12.5, fontWeight: 700 };
}

function toolBtn(active: boolean): React.CSSProperties {
  return {
    height: 40, padding: "0 14px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
    border: `1.5px solid ${active ? C.teal : C.border}`,
    background: active ? C.tealSoft : C.white, color: active ? C.tealDark : C.textSec,
  };
}

function stepBtn(color: string): React.CSSProperties {
  return { width: 44, height: 44, border: "none", background: C.white, color, fontSize: 22, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", lineHeight: 1 };
}

// Recherche manuelle d'un produit, lancée à la frappe (nom, référence ou EAN),
// pour les lignes sans code reconnu ou pour substituer un produit.
function ProductPicker({ session, initial, onPick }: {
  session: odoo.OdooSession; initial: string; onPick: (p: any) => void;
}) {
  // Les bons préfixent souvent la marque (« DR H », « DR HAUSCHKA ») : inutile pour chercher.
  const [q, setQ] = useState(initial.replace(/\bdr\.?\s*(h|haus\w*)\b\.?/gi, "").replace(/\s+/g, " ").trim());
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  const boxRef = useRef<HTMLDivElement>(null);

  // À l'ouverture, amène la recherche à l'écran : sur iPad elle s'ouvrait parfois
  // hors de la zone visible et le tap semblait sans effet.
  useEffect(() => { boxRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setResults([]); return; }
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      let rows: any[] = [];
      try {
        // Un seul terme avec des chiffres : référence ou EAN.
        if (!/\s/.test(text) && /\d/.test(text)) {
          try {
            rows = await odoo.searchRead(session, "product.product",
              [["sale_ok", "=", true], "|", ["default_code", "ilike", text], ["barcode", "ilike", text]], PRODUCT_FIELDS, 10, "name");
          } catch (e) {
            if (!odoo.isNetworkError(e)) throw e;
            rows = (await sync.getCachedProducts())
              .filter((p: any) => `${p.default_code || ""} ${p.barcode || ""}`.includes(text)).slice(0, 10);
          }
        }
        if (!rows.length) rows = await searchByDesignation(session, text, 10);
      } catch { rows = []; }
      // Ignore une réponse arrivée après une frappe plus récente.
      if (id !== reqId.current) return;
      setResults(rows);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [q, session]);

  return (
    <div ref={boxRef} style={{ marginTop: 8 }}>
      <div style={{ position: "relative" as const }}>
        <input value={q} autoFocus onChange={e => setQ(e.target.value)}
          placeholder="Nom, référence ou EAN"
          style={{ width: "100%", boxSizing: "border-box" as const, height: 44, borderRadius: 12, border: `1.5px solid ${C.teal}`, padding: "0 36px 0 12px", fontSize: 14, fontFamily: "inherit" }} />
        {loading && <span style={{ position: "absolute" as const, right: 12, top: 13, fontSize: 12, color: C.muted }}>…</span>}
      </div>
      {!loading && q.trim().length >= 2 && results.length === 0 && (
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Aucun produit trouvé.</div>
      )}
      {results.map(p => (
        <button key={p.id} onClick={() => onPick(p)}
          style={{ display: "block", width: "100%", textAlign: "left" as const, marginTop: 4, minHeight: 44, padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, cursor: "pointer", fontFamily: "inherit", fontSize: 14, color: C.text }}>
          {p.display_name || p.name} <span style={{ color: C.muted, fontSize: 11 }}>{[p.default_code, p.barcode].filter(Boolean).join(" · ")}</span>
        </button>
      ))}
    </div>
  );
}
