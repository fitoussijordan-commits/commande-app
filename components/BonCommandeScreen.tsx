"use client";
// Import d'un bon de commande client (PDF ou photo).
//
// 1. Le document est lu par /api/bon-commande (Claude) → lignes brutes
//    (EAN, référence, désignation, quantité, prix).
// 2. Chaque ligne est rapprochée du catalogue Odoo par recherche EXACTE sur
//    l'EAN (barcode) puis la référence (default_code). Aucune correspondance
//    « approchante » n'est RETENUE automatiquement : une ligne sans code reconnu
//    reçoit des suggestions par le nom, mais le commercial doit en toucher une —
//    un produit n'est jamais deviné.
// 3. Le commercial vérifie, corrige, puis les lignes retenues remplissent le
//    panier habituel — prix client, remises et validation restent ceux de la
//    prise de commande normale.
import { useState, useEffect, useRef } from "react";
import * as odoo from "@/lib/odoo";
import * as sync from "@/lib/sync";
import { apiUrl } from "@/lib/apiBase";
import QtyPad from "@/components/QtyPad";
import { PriceItem, applyPricelist } from "@/lib/pricing";
import { pickClientAmong } from "@/lib/clients";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  orange: "#ea580c", orangeSoft: "#fff7ed",
  green: "#16a34a", greenSoft: "#f0fdf4",
  red: "#dc2626", redSoft: "#fef2f2",
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)",
};

const PRODUCT_FIELDS = ["id", "name", "display_name", "default_code", "barcode", "lst_price", "product_tmpl_id", "virtual_available"];
// Photo iPad : 3 à 6 Mo en JPEG. Réduite à 2000 px de côté, elle reste très
// lisible pour la lecture et passe sous la limite de taille des requêtes Vercel.
const MAX_IMAGE_SIDE = 2000;
const MAX_FILE_BYTES = 3_000_000;

interface LigneLue {
  ean: string; reference: string; designation: string;
  quantite: number; prix_unitaire_ht: number | null;
}
interface ClientLu {
  nom: string; adresse: string; code_postal: string; ville: string;
  telephone: string; email: string; siret: string; numero_client: string;
}
interface BonLu {
  client: ClientLu;
  numero_commande: string; date_livraison: string; commentaire: string;
  lignes: LigneLue[];
}
interface Ligne {
  key: number;
  lue: LigneLue;
  product: any | null;
  matchedBy: "ean" | "reference" | "manuel" | null;
  qty: number;
  include: boolean;
  // Prix retenu : grille Odoo du client, prix écrit sur le bon, ou saisi à la main.
  priceMode: "odoo" | "bon" | "manuel";
  manualPrice: string;
  // Ligne sans code reconnu : produits proposés d'après la désignation.
  suggestions: any[];
}

// priceLocked : le prix a été choisi par le commercial (bon ou saisie) — la prise
// de commande ne doit pas le recalculer depuis la grille quand la quantité change.
export interface ImportedLine { product: any; qty: number; unitPrice: number; priceLocked?: boolean }

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
// mail ou un logiciel de pharmacie arrive souvent SANS extension (« BC Phi
// GERBAUD ») : le navigateur ne lui donne alors aucun type, alors que c'est un PDF.
async function sniffKind(file: File): Promise<"pdf" | "image" | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = String.fromCharCode(...Array.from(b));
  if (ascii.startsWith("%PDF-")) return "pdf";
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

// Rapprochement exact avec le catalogue : EAN d'abord (le plus sûr), puis référence.
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

async function matchProducts(session: odoo.OdooSession, lignes: LigneLue[]): Promise<Ligne[]> {
  const eans = Array.from(new Set(lignes.map(l => digits(l.ean)).filter(e => e.length >= 8)));
  const refs = Array.from(new Set(lignes.map(l => (l.reference || "").trim()).filter(Boolean)));
  let products: any[] = [];
  if (eans.length || refs.length) {
    const domain: any[] = eans.length && refs.length
      ? ["|", ["barcode", "in", eans], ["default_code", "in", refs]]
      : eans.length ? [["barcode", "in", eans]] : [["default_code", "in", refs]];
    try {
      products = await odoo.searchRead(session, "product.product", domain, PRODUCT_FIELDS, 0);
    } catch (e) {
      if (!odoo.isNetworkError(e)) throw e;
      const eanSet = new Set(eans), refSet = new Set(refs);
      products = (await sync.getCachedProducts())
        .filter((p: any) => eanSet.has(p.barcode) || refSet.has(p.default_code));
    }
  }
  const byEan = new Map<string, any>(), byRef = new Map<string, any>();
  for (const p of products) {
    if (p.barcode) byEan.set(String(p.barcode), p);
    if (p.default_code) byRef.set(String(p.default_code), p);
  }
  return Promise.all(lignes.map(async (lue, i): Promise<Ligne> => {
    const pe = byEan.get(digits(lue.ean));
    const pr = byRef.get((lue.reference || "").trim());
    const product = pe || pr || null;
    const qty = Math.max(0, Math.round(lue.quantite || 0));
    const suggestions = product ? [] : await searchByDesignation(session, lue.designation, 4).catch(() => []);
    return {
      key: i, lue, product,
      matchedBy: pe ? "ean" : pr ? "reference" : null,
      qty, include: !!product && qty > 0,
      priceMode: "odoo", manualPrice: "",
      suggestions,
    };
  }));
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

function fmtPrice(n: number) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n); }

export default function BonCommandeScreen({ session, client, priceItems, onApply, onToast, onSelectClient, initialFile }: {
  session: odoo.OdooSession;
  // null = import lancé depuis l'accueil : le client est retrouvé d'après le bon.
  client: any | null;
  // Fourni seulement quand le client peut être choisi ici (import depuis l'accueil).
  onSelectClient?: (c: any) => void;
  // Fichier reçu depuis une autre app (Mail → partager → Commande) : analysé d'office.
  initialFile?: File | null;
  priceItems: PriceItem[];
  onApply: (lines: ImportedLine[], note: string) => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState<"" | "lecture" | "catalogue" | "client">("");
  const [candidates, setCandidates] = useState<ClientCandidate[]>([]);
  const [clientReasons, setClientReasons] = useState<string[] | null>(null); // client retenu d'office : pourquoi
  const [pickingClient, setPickingClient] = useState(false);
  const [error, setError] = useState("");
  const [bon, setBon] = useState<BonLu | null>(null);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [searchFor, setSearchFor] = useState<number | null>(null);
  // Aperçu du document d'origine, pour vérifier les lignes sans changer d'app.
  const [preview, setPreview] = useState<{ url: string; kind: "pdf" | "image" } | null>(null);
  const [showPreview, setShowPreview] = useState(false);   // plein écran (portrait)
  const [onlyToCheck, setOnlyToCheck] = useState(false);
  const [padFor, setPadFor] = useState<number | null>(null);
  const wide = useWide();

  // Libère l'URL d'aperçu quand on change de document ou quitte l'écran.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const clientPrice = (p: any, qty: number) =>
    applyPricelist(p.lst_price || 0, p.id, p.product_tmpl_id?.[0] || 0, priceItems, Math.max(1, qty));

  const analyse = async (file: File) => {
    setError(""); setBon(null); setLignes([]); setFileName(file.name);
    setPreview(null); setOnlyToCheck(false); setSearchFor(null);
    setCandidates([]); setClientReasons(null); setPickingClient(false);
    setLoading("lecture");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 65_000);
    try {
      let payload: { data: string; mediaType: string };
      const kind = await sniffKind(file);
      // Blob retypé : un PDF sans extension n'a pas de type, et l'aperçu ne s'afficherait pas.
      if (kind) setPreview({ url: URL.createObjectURL(new Blob([file], { type: kind === "pdf" ? "application/pdf" : file.type || "image/jpeg" })), kind });
      if (kind === "pdf") {
        if (file.size > MAX_FILE_BYTES) throw new Error("PDF trop volumineux (3 Mo maximum)");
        payload = { data: await readAsBase64(file), mediaType: "application/pdf" };
      } else if (kind === "image") {
        payload = await shrinkImage(file);
      } else {
        throw new Error("Ce fichier n'est ni un PDF ni une photo");
      }
      const res = await fetch(apiUrl("/api/bon-commande"), {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, odooUrl: session.config.url, sessionId: session.sessionId }),
      });
      const data = await res.json().catch(() => ({ error: `Réponse invalide (${res.status})` }));
      if (data.error) throw new Error(data.error);
      const lu: BonLu = data.bon;
      setBon(lu);
      setLoading("catalogue");
      setLignes(await matchProducts(session, lu.lignes || []));
      if (onSelectClient) {
        setLoading("client");
        const cands = await findClientCandidates(session, lu.client);
        setCandidates(cands);
        const best = autoPick(cands);
        if (best) { onSelectClient(best.row); setClientReasons(best.reasons); }
        else setPickingClient(true);
      }
    } catch (e: any) {
      setError(e?.name === "AbortError"
        ? "Lecture trop longue. Réessaie, ou envoie une photo plus nette."
        : e instanceof TypeError
          ? "Réseau indisponible — la lecture d'un bon nécessite une connexion."
          : e?.message || "Erreur inconnue");
    } finally {
      clearTimeout(timer);
      setLoading("");
    }
  };

  useEffect(() => {
    if (initialFile) void analyse(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  const update = (key: number, patch: Partial<Ligne>) =>
    setLignes(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));

  const manualValue = (l: Ligne): number | null => {
    const n = parseFloat(l.manualPrice.replace(",", "."));
    return isFinite(n) && n >= 0 ? n : null;
  };
  const linePrice = (l: Ligne): number => {
    if (l.priceMode === "bon" && l.lue.prix_unitaire_ht != null) return l.lue.prix_unitaire_ht;
    if (l.priceMode === "manuel") { const m = manualValue(l); if (m != null) return m; }
    return clientPrice(l.product, l.qty);
  };
  // Écart relatif entre le prix du bon et la grille Odoo (null si incomparable).
  const ecartPct = (l: Ligne): number | null => {
    if (!l.product || l.lue.prix_unitaire_ht == null) return null;
    const odooPrice = clientPrice(l.product, l.qty);
    if (odooPrice <= 0) return null;
    const pct = (l.lue.prix_unitaire_ht - odooPrice) / odooPrice * 100;
    return Math.abs(pct) > 2 ? pct : null;
  };
  const setAllPriceModes = (mode: "odoo" | "bon") =>
    setLignes(prev => prev.map(l =>
      mode === "bon" && l.lue.prix_unitaire_ht == null ? l : { ...l, priceMode: mode, manualPrice: "" }));

  const retenues = lignes.filter(l => l.include && l.product && l.qty > 0);
  const nonTrouvees = lignes.filter(l => !l.product).length;
  const avecEcart = lignes.filter(l => ecartPct(l) != null).length;
  const aVerifier = (l: Ligne) => !l.product || ecartPct(l) != null;
  const nbAVerifier = lignes.filter(aVerifier).length;
  const visibles = onlyToCheck ? lignes.filter(aVerifier) : lignes;
  const total = retenues.reduce((s, l) => s + l.qty * linePrice(l), 0);
  const autreClient = bon?.client?.nom && client && !onSelectClient ? !sameClientHint(bon.client.nom, client.name) : false;
  const canApply = !!client && !pickingClient && retenues.length > 0;

  const apply = () => {
    if (!canApply) return;
    // Plusieurs lignes du bon peuvent pointer sur le même produit : on cumule.
    const merged = new Map<number, ImportedLine>();
    for (const l of retenues) {
      const prev = merged.get(l.product.id);
      const qty = (prev?.qty || 0) + l.qty;
      const locked = l.priceMode !== "odoo" && linePrice(l) !== clientPrice(l.product, l.qty);
      merged.set(l.product.id, locked
        ? { product: l.product, qty, unitPrice: linePrice(l), priceLocked: true }
        : { product: l.product, qty, unitPrice: clientPrice(l.product, qty) });
    }
    const note = [
      bon?.numero_commande && `Bon de commande client n° ${bon.numero_commande}`,
      bon?.date_livraison && `Livraison souhaitée le ${fmtDay(bon.date_livraison)}`,
      bon?.commentaire,
    ].filter(Boolean).join(" — ");
    onApply(Array.from(merged.values()), note);
    onToast(`${merged.size} produit${merged.size > 1 ? "s" : ""} ajouté${merged.size > 1 ? "s" : ""} au panier`, "success");
  };

  const fileInput = (
    // Pas d'attribut accept : il masquerait les PDF sans extension. Le type est
    // vérifié sur le contenu (sniffKind). Sur iPad, le sélecteur propose quand
    // même Photothèque, Appareil photo et Fichiers.
    <input type="file" disabled={!!loading} style={{ display: "none" }}
      onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void analyse(f); }} />
  );
  const padLine = padFor != null ? lignes.find(l => l.key === padFor) : null;

  // ── Avant analyse : grande zone de dépôt centrée ──────────────────────────
  if (!bon || loading) {
    return (
      <div style={{ flex: 1, overflowY: "auto" as const, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 560, textAlign: "center" as const }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>Importer un bon de commande</div>
          <div style={{ fontSize: 14, color: C.muted, marginTop: 6, marginBottom: 24, lineHeight: 1.5 }}>
            PDF reçu par mail ou photo du bon papier. {onSelectClient ? "Le client et les produits sont retrouvés d'après le bon" : "Les produits sont retrouvés par EAN ou référence"} ; tu vérifies avant d'ajouter au panier.
          </div>
          <label style={{
            display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 10,
            minHeight: 180, padding: 24, borderRadius: 20, border: `2px dashed ${C.teal}`,
            background: C.tealSoft, color: C.tealDark, fontWeight: 800, fontSize: 17,
            cursor: loading ? "wait" : "pointer",
          }}>
            {fileInput}
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3"/>
            </svg>
            {loading === "lecture" ? "Lecture du bon…" : loading === "catalogue" ? "Recherche des produits…" : loading === "client" ? "Recherche du client…" : "Choisir un PDF ou prendre une photo"}
            {loading && <span style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>{fileName} · 10 à 30 secondes</span>}
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

  // ── Après analyse : aperçu du bon à gauche (paysage), lignes à droite ─────
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" as const }}>
      {/* En-tête compact : document + infos du bon sur une ligne */}
      <div style={{ padding: "12px 20px", background: C.white, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const }}>
        <div style={{ flex: 1, minWidth: 240, fontSize: 13, color: C.textSec, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 800, color: C.text, fontSize: 15 }}>{bon.client.nom || "Émetteur inconnu"}</span>
          {bon.client.ville && <span style={{ color: C.muted }}> · {bon.client.ville}</span>}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" as const, color: C.muted, fontSize: 12.5 }}>
            {bon.numero_commande && <span>N° <b style={{ color: C.textSec }}>{bon.numero_commande}</b></span>}
            {bon.date_livraison && <span>Livraison <b style={{ color: C.textSec }}>{fmtDay(bon.date_livraison)}</b></span>}
            {bon.commentaire && <span>« {bon.commentaire} »</span>}
          </div>
        </div>
        {!wide && preview && (
          <button onClick={() => setShowPreview(true)} style={toolBtn(false)}>Voir le bon</button>
        )}
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
          {/* Barre d'état + actions groupées */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "center", marginBottom: 12 }}>
            <span style={badge(C.greenSoft, C.green)}>{lignes.length - nonTrouvees} trouvée{lignes.length - nonTrouvees > 1 ? "s" : ""}</span>
            {nonTrouvees > 0 && <span style={badge(C.orangeSoft, C.orange)}>{nonTrouvees} à choisir</span>}
            {avecEcart > 0 && <span style={badge(C.orangeSoft, C.orange)}>{avecEcart} écart{avecEcart > 1 ? "s" : ""} de prix</span>}
            <span style={{ flex: 1 }} />
            {nbAVerifier > 0 && (
              <button onClick={() => setOnlyToCheck(v => !v)} style={toolBtn(onlyToCheck)}>
                À vérifier ({nbAVerifier})
              </button>
            )}
            {avecEcart > 0 && <button onClick={() => setAllPriceModes("bon")} style={toolBtn(false)}>Tout au prix du bon</button>}
            {avecEcart > 0 && <button onClick={() => setAllPriceModes("odoo")} style={toolBtn(false)}>Tout au prix Odoo</button>}
          </div>

          {lignes.length === 0 && (
            <div style={{ padding: 24, fontSize: 14, color: C.muted, textAlign: "center" as const }}>Aucune ligne de produit trouvée sur ce document.</div>
          )}
          {onlyToCheck && visibles.length === 0 && (
            <div style={{ padding: 24, fontSize: 14, color: C.green, fontWeight: 700, textAlign: "center" as const }}>Tout est vérifié.</div>
          )}

          <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
            {visibles.map(l => {
              const prixClient = l.product ? clientPrice(l.product, l.qty) : null;
              const ecart = ecartPct(l);
              const manualInvalid = l.priceMode === "manuel" && manualValue(l) == null;
              const actif = !!l.product && l.include;
              const stripe = !l.product ? C.orange : !l.include ? C.border : ecart != null && l.priceMode === "odoo" ? C.orange : C.green;
              return (
                <div key={l.key} style={{
                  display: "flex", background: C.white, borderRadius: 14, boxShadow: C.shadow,
                  border: `1px solid ${C.border}`, borderLeft: `5px solid ${stripe}`, overflow: "hidden",
                }}>
                  {/* Colonne case à cocher : toute la hauteur est tapable (≥ 44 px) */}
                  <button onClick={() => l.product && update(l.key, { include: !l.include })} disabled={!l.product}
                    aria-label={l.include ? "Retirer la ligne" : "Garder la ligne"}
                    style={{ width: 52, flexShrink: 0, border: "none", background: "transparent", cursor: l.product ? "pointer" : "default", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 14 }}>
                    <span style={{
                      width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                      border: `2px solid ${actif ? C.teal : C.border}`, background: actif ? C.teal : C.white, color: "#fff",
                    }}>
                      {actif && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>}
                    </span>
                  </button>

                  <div style={{ flex: 1, minWidth: 0, padding: "12px 14px 12px 0", opacity: l.product && !l.include ? 0.5 : 1 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                          {l.lue.designation}
                          {(l.lue.ean || l.lue.reference) && ` · ${[l.lue.ean, l.lue.reference].filter(Boolean).join(" / ")}`}
                        </div>
                        {l.product ? (
                          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 2, lineHeight: 1.3 }}>
                            {l.product.display_name || l.product.name}
                            <span style={{ fontSize: 11, fontWeight: 700, color: l.matchedBy === "manuel" ? C.teal : C.green, marginLeft: 8, whiteSpace: "nowrap" as const }}>
                              {l.matchedBy === "ean" ? "EAN ✓" : l.matchedBy === "reference" ? "Réf ✓" : "choisi à la main"}
                            </span>
                          </div>
                        ) : (
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.orange, marginTop: 2 }}>
                            {l.suggestions.length ? "Code absent — choisis le bon produit :" : "Produit non trouvé dans le catalogue"}
                          </div>
                        )}
                        {!l.product && l.suggestions.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginTop: 6 }}>
                            {l.suggestions.map(p => (
                              <button key={p.id} onClick={() => update(l.key, { product: p, matchedBy: "manuel", include: l.qty > 0 })}
                                style={{ ...chipBtn(false), borderColor: C.teal, color: C.tealDark, textAlign: "left" as const }}>
                                {p.display_name || p.name}
                                {p.default_code && <span style={{ color: C.muted, fontWeight: 600, marginLeft: 6 }}>{p.default_code}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                        <button onClick={() => setSearchFor(searchFor === l.key ? null : l.key)}
                          style={{ margin: "2px 0 0 -8px", padding: "6px 8px", border: "none", background: "transparent", color: C.teal, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                          {searchFor === l.key ? "Fermer la recherche" : l.product ? "Changer de produit" : l.suggestions.length ? "Autre produit…" : "Choisir le produit"}
                        </button>
                      </div>

                      {/* Quantité : − / chiffre (pavé numérique) / + */}
                      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                        <button onClick={() => update(l.key, { qty: Math.max(0, l.qty - 1) })} style={stepBtn(C.red)} aria-label="Moins">−</button>
                        <button onClick={() => setPadFor(l.key)} style={{ width: 52, height: 44, border: "none", borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, background: C.white, fontSize: 17, fontWeight: 800, color: C.text, cursor: "pointer", fontFamily: "inherit" }}>
                          {l.qty}
                        </button>
                        <button onClick={() => update(l.key, { qty: l.qty + 1, include: !!l.product })} style={stepBtn(C.teal)} aria-label="Plus">+</button>
                      </div>

                      {wide && (
                        <div style={{ width: 96, flexShrink: 0, textAlign: "right" as const, paddingTop: 2 }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: actif ? C.text : C.muted }}>{l.product ? fmtPrice(l.qty * linePrice(l)) : "—"}</div>
                          {l.product && <div style={{ fontSize: 11, color: C.muted }}>{l.qty} × {fmtPrice(linePrice(l))}</div>}
                        </div>
                      )}
                    </div>

                    {l.product && (
                    <div style={{ display: "flex", flexWrap: "wrap" as const, alignItems: "center", gap: 6, marginTop: 4 }}>
                        <>
                          <button onClick={() => update(l.key, { priceMode: "odoo", manualPrice: "" })} style={chipBtn(l.priceMode === "odoo")}>
                            Prix Odoo {fmtPrice(prixClient!)}
                          </button>
                          {l.lue.prix_unitaire_ht != null && (
                            <button onClick={() => update(l.key, { priceMode: "bon", manualPrice: "" })} style={chipBtn(l.priceMode === "bon")}>
                              Prix du bon {fmtPrice(l.lue.prix_unitaire_ht)}
                            </button>
                          )}
                          <input value={l.manualPrice} inputMode="decimal" placeholder="Autre prix €"
                            onChange={e => update(l.key, { manualPrice: e.target.value, priceMode: e.target.value.trim() ? "manuel" : "odoo" })}
                            style={{
                              width: 116, height: 44, borderRadius: 22, padding: "0 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit",
                              border: `1.5px solid ${manualInvalid ? C.red : l.priceMode === "manuel" ? C.teal : C.border}`,
                              background: l.priceMode === "manuel" ? C.tealSoft : C.white, color: C.text, boxSizing: "border-box" as const,
                            }} />
                          {ecart != null && (
                            <span style={{ fontSize: 12, fontWeight: 700, color: C.orange }}>
                              bon {ecart > 0 ? "+" : ""}{ecart.toFixed(0)} % vs Odoo
                            </span>
                          )}
                        </>
                    </div>
                    )}
                    {!wide && l.product && (
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.textSec, marginTop: 6 }}>
                        Total ligne {fmtPrice(l.qty * linePrice(l))}
                      </div>
                    )}
                    {searchFor === l.key && (
                      <ProductPicker session={session} initial={l.lue.designation}
                        onPick={p => { update(l.key, { product: p, matchedBy: "manuel", include: l.qty > 0 }); setSearchFor(null); }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Pied fixe : total + validation toujours visibles */}
      <div style={{ padding: "12px 20px", background: C.white, borderTop: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 16, boxShadow: "0 -4px 12px rgba(0,0,0,0.04)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>{fmtPrice(total)} <span style={{ fontSize: 12, color: C.muted, fontWeight: 700 }}>HT</span></div>
          <div style={{ fontSize: 12.5, color: nbAVerifier ? C.orange : C.muted, fontWeight: 600 }}>
            {retenues.length} ligne{retenues.length > 1 ? "s" : ""} retenue{retenues.length > 1 ? "s" : ""}
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

      {padLine && (
        <QtyPad name={padLine.product?.name || padLine.lue.designation} initial={padLine.qty}
          onSet={n => update(padLine.key, { qty: n, include: !!padLine.product && n > 0 })}
          onClose={() => setPadFor(null)} />
      )}

      {showPreview && preview && (
        <div style={{ position: "fixed", inset: 0, zIndex: 240, background: "rgba(15,23,42,0.85)", display: "flex", flexDirection: "column" as const, paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
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
function DocPreview({ preview }: { preview: { url: string; kind: "pdf" | "image" } }) {
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
