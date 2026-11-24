// lib/bonMatch.ts
// « Charger la commande » : recherche des articles du bon dans le catalogue Odoo,
// règle pour règle comme le module Odoo « sale_order_ocr_import » (v19.0.1.45.0,
// sale_order_ocr_import.py + product_matcher.py).
//
// Le catalogue (articles actifs ET archivés / non vendables) est chargé UNE fois ;
// toutes les recherches se font ensuite en mémoire — mêmes règles que les
// recherches Odoo du module (=, =ilike, ilike), sans un appel par ligne.
//
// Ordre appliqué à chaque ligne :
//   0. miniature (40…) / échantillon (5… non vendable) → lot « L » + code, quantité en lots ;
//   1. code article (=, sans casse, sans espaces/points/tirets) ;
//   2. EAN (sans les 0 de tête, tel quel, complété à 12/13/14, puis « contient ») ;
//   3. code numérique ≥ 8 chiffres essayé comme EAN ;
//   4. code / EAN introuvable → article archivé / non vendable portant ce code, puis
//      remplaçant cherché par le nom (même 1er caractère de code) ; sinon note de rupture ;
//   5. ni code ni EAN → recherche par le nom dans tout le catalogue.
// Ligne sans quantité ni UG : ignorée. Article introuvable : « ⚠ À SAISIR ».
import * as odoo from "@/lib/odoo";
import * as sync from "@/lib/sync";
import { optionalProductFields } from "@/lib/productFields";

// ═══ Recherche par le libellé (product_matcher.py) ═══════════════════════
const STOPWORDS = new Set(["de", "du", "des", "la", "le", "les", "l", "d", "a", "au", "aux", "et",
  "en", "pour", "avec", "sans", "un", "une", "the", "of", "and", "for", "ref", "reference", "art", "article"]);
const SYNONYMS: Record<string, string> = { corporel: "corps", corporelle: "corps", crm: "creme", deo: "deodorant" };
const SPECIAL_WORDS = ["testeur", "tester", "cabine", "miniature", "mini", "lot", "echantillon",
  "plv", "offert", "coffret", "dlv", "edition", "limitee", "presentoir"];
const TYPE_WORDS = ["testeur", "tester", "cabine", "miniature", "mini", "echantillon", "plv", "coffret", "presentoir"];
const VARIANT_WORDS = ["edition", "limitee", "limite", "anniversaire", "dlv", "offert", "offerte",
  "nouveau", "nouvelle", "new", "promo", "promotion", "noel", "collector",
  "special", "speciale", "comprise", "compris", "onpack", "onpacks"];
const TESTER_WORDS = ["testeur", "tester"];
const UNITS: Record<string, string> = { ml: "ml", l: "l", cl: "cl", g: "g", gr: "g", kg: "kg", mg: "mg" };
const VOLUME_RE = /(\d+(?:[.,]\d+)?)\s*(ml|cl|kg|mg|gr|g|l)\b/g;
const BUNDLE_RE = /\s\+[\s\S]*$/;
const ONPACK_RE = /\bon[\s\-_]*packs?\b/g;
const BRAND_RE = /\b(?:dr\s*\.?\s*h(?:auschka)?|hauschka|wala)\b/g;
const MIN_SCORE = 0.75;
const MIN_GAP = 0.06;
const SPECIAL_PENALTY = 0.2;

function stem(word: string): string {
  if (/^\d+$/.test(word)) return word;
  let w = SYNONYMS[word] ?? word;
  if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}
const stemmed = (ws: string[]) => new Set(ws.map(stem));
const SPECIAL_STEMS = stemmed(SPECIAL_WORDS);
const TYPE_STEMS = stemmed(TYPE_WORDS);
const VARIANT_STEMS = stemmed(VARIANT_WORDS);
const TESTER_STEMS = stemmed(TESTER_WORDS);
const LOT_FRIENDLY_STEMS = new Set([stem("miniature"), stem("echantillon")]);

export function normalizeLabel(text: any): string {
  const t = String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/&/g, " et ").replace(/\+/g, " plus ");
  return t.replace(BRAND_RE, " ");
}
function volumes(norm: string): Set<string> {
  const out = new Set<string>();
  for (const m of Array.from(norm.matchAll(VOLUME_RE))) out.add(`${parseFloat(m[1].replace(",", "."))}${UNITS[m[2]]}`);
  return out;
}
function tokens(norm: string): Set<string> {
  const text = norm.replace(VOLUME_RE, " ");
  return new Set((text.match(/[a-z0-9]+/g) || []).filter(w => !STOPWORDS.has(w) && w.length > 1).map(stem));
}
function similarity(q: string, c: string): number {
  if (q === c) return 1;
  if (/^\d+$/.test(q) || /^\d+$/.test(c)) return 0;
  if (q.length >= 2 && c.startsWith(q)) return 0.9;   // abréviation : DEMAQ → demaquillant
  if (c.length >= 4 && q.startsWith(c)) return 0.85;  // mot Odoo plus court
  let common = 0;
  for (let i = 0; i < Math.min(q.length, c.length); i++) { if (q[i] !== c[i]) break; common++; }
  if (common >= 5 && common >= 0.75 * Math.min(q.length, c.length)) return 0.8;
  return 0;
}
const inter = <T,>(a: Set<T>, b: Set<T>) => new Set(Array.from(a).filter(x => b.has(x)));
const minus = <T,>(a: Set<T>, b: Set<T>) => new Set(Array.from(a).filter(x => !b.has(x)));

interface MatcherItem { id: number; name: string; tokens: Set<string>; volumes: Set<string>; special: Set<string>; tester: boolean }

class ProductNameMatcher {
  items: MatcherItem[];
  constructor(products: [number, string][]) {
    this.items = products.map(([id, name]) => {
      const n = normalizeLabel(name), toks = tokens(n);
      return { id, name, tokens: toks, volumes: volumes(n), special: inter(toks, SPECIAL_STEMS), tester: inter(toks, TESTER_STEMS).size > 0 };
    });
  }
  static scoreDetail(q: Set<string>, item: MatcherItem): [number, number, number] {
    const c = item.tokens;
    if (!c.size) return [0, 0, 0];
    let total = 0;
    const used = new Set<string>();
    for (const qq of Array.from(q)) {
      let best = 0, bestC: string | null = null;
      for (const cc of Array.from(c)) {
        const sim = similarity(qq, cc);
        if (sim > best || (sim === best && sim && !used.has(cc))) { best = sim; bestC = cc; }
      }
      total += best;
      if (bestC) used.add(bestC);
    }
    if (!used.size) return [0, 0, 0];
    const qCov = total / q.size, cCov = used.size / c.size;
    let score = 0.75 * qCov + 0.25 * cCov;
    const allowed = new Set(q);
    if (inter(q, LOT_FRIENDLY_STEMS).size) { allowed.add(stem("lot")); allowed.add(stem("presentoir")); }
    score -= SPECIAL_PENALTY * minus(item.special, allowed).size;
    score -= SPECIAL_PENALTY * minus(inter(q, TYPE_STEMS), c).size;
    return [score, qCov, cCov];
  }
  // [id, nom trouvé, score, motif d'échec, candidats ex aequo]
  match(label: string, ignoreVolume = false, replacement = false): [number | null, string | null, number, string | null, number[]] {
    if (replacement) label = String(label || "").replace(BUNDLE_RE, "");
    let norm = normalizeLabel(label);
    if (replacement) norm = norm.replace(ONPACK_RE, " ");
    let q = tokens(norm);
    let qVol = volumes(norm);
    if (!q.size) return [null, null, 0, "libellé vide ou illisible", []];
    if (ignoreVolume) qVol = new Set();
    if (replacement) {
      const kept = new Set(Array.from(q).filter(t => !VARIANT_STEMS.has(t) && !/^\d+$/.test(t)));
      if (kept.size) q = kept;
    }
    const wantsTester = inter(q, TESTER_STEMS).size > 0;
    const scored: [number, MatcherItem][] = [], otherSizes: [number, MatcherItem][] = [];
    for (const item of this.items) {
      if (item.tester && !wantsTester) continue;
      let score = ProductNameMatcher.scoreDetail(q, item)[0];
      if (qVol.size && item.volumes.size && !inter(qVol, item.volumes).size) {
        if (score >= MIN_SCORE) otherSizes.push([score, item]);
        continue;
      }
      if (qVol.size && !item.volumes.size) score -= 0.05;
      if (score > 0) scored.push([score, item]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const [bestScore, best] = scored[0] || [0, null];
    if (bestScore < MIN_SCORE) {
      if (otherSizes.length) {
        otherSizes.sort((a, b) => b[0] - a[0]);
        const top = otherSizes[0][0];
        const names = otherSizes.filter(([s]) => top - s < MIN_GAP).map(([, i]) => i.name.trim()).slice(0, 4);
        return [null, null, bestScore, `contenance ${Array.from(qVol).sort().join(", ")} introuvable ; formats existants : ${names.join(" / ")}`, []];
      }
      if (!best) return [null, null, 0, "aucun article au libellé proche", []];
      return [null, null, bestScore, `libellé trop éloigné (le plus proche : ${best.name})`, []];
    }
    let close = scored.filter(([s]) => bestScore - s < MIN_GAP).map(([, i]) => i);
    if (close.length > 1) {
      const detail = new Map(close.map(i => [i.id, ProductNameMatcher.scoreDetail(q, i)]));
      const topQ = Math.max(...Array.from(detail.values()).map(d => d[1]));
      const full = close.filter(i => detail.get(i.id)![1] === topQ);
      const topC = Math.max(...full.map(i => detail.get(i.id)![2]));
      const leaders = full.filter(i => detail.get(i.id)![2] === topC);
      if (leaders.length === 1 && full.length > 1) return [leaders[0].id, leaders[0].name, bestScore, null, []];
      close = full;
      return [null, best!.name, bestScore, "libellé ambigu", close.map(i => i.id)];
    }
    return [best!.id, best!.name, bestScore, null, []];
  }
}

// ═══ Catalogue ═══════════════════════════════════════════════════════════
export interface Catalog {
  all: any[];            // actifs + archivés + non vendables
  sellable: any[];       // actifs et vendables (≈ _product_domain du module)
  matchers: Map<string, ProductNameMatcher>;
  offline: boolean;
}

const BASE_FIELDS = ["id", "name", "display_name", "default_code", "barcode", "lst_price", "product_tmpl_id",
  "virtual_available", "sale_ok", "active", "create_date"];

export async function loadCatalog(session: odoo.OdooSession): Promise<Catalog> {
  let all: any[];
  let offline = false;
  try {
    const extra = await optionalProductFields(session).catch(() => [] as string[]);
    const domain = [["active", "in", [true, false]]];
    try {
      all = await odoo.searchRead(session, "product.product", domain, [...BASE_FIELDS, "sale_line_warn_msg", ...extra], 0, "id");
    } catch (e) {
      if (odoo.isNetworkError(e)) throw e;
      all = await odoo.searchRead(session, "product.product", domain, [...BASE_FIELDS, ...extra], 0, "id");
    }
  } catch (e) {
    if (!odoo.isNetworkError(e)) throw e;
    // Hors ligne : catalogue préchargé (vendables + testeurs seulement).
    all = (await sync.getCachedProducts()).map((p: any) => ({ active: true, ...p }));
    offline = true;
  }
  return { all, sellable: all.filter(p => p.active !== false && p.sale_ok !== false), matchers: new Map(), offline };
}

const up = (s: any) => String(s ?? "").toUpperCase();
const code = (p: any) => String(p?.default_code || "").trim();
const isArchived = (p: any) => p?.active === false;
const byNewest = (a: any, b: any) => String(b.create_date || "").localeCompare(String(a.create_date || "")) || b.id - a.id;

// Résultat unique parmi les articles vendables, sinon [null, message].
function searchUnique(cat: Catalog, pred: (p: any) => boolean): [any | null, string | null] {
  const found = cat.sellable.filter(pred);
  if (found.length === 1) return [found[0], null];
  if (found.length > 1) return [null, "plusieurs articles correspondent"];
  return [null, null];
}

function eanVariants(digits: string): string[] {
  const stripped = digits.replace(/^0+/, "");
  const variants = [stripped, digits];
  for (const w of [12, 13, 14]) if (stripped.length < w) variants.push(stripped.padStart(w, "0"));
  return Array.from(new Set(variants)).filter(v => v.length >= 8);
}

function searchBarcode(cat: Catalog, digits: string): [any | null, string | null] {
  let ambiguous: string | null = null;
  for (const v of eanVariants(digits)) {
    const [p, msg] = searchUnique(cat, x => String(x.barcode || "") === v);
    if (p) return [p, null];
    ambiguous = ambiguous || msg;
  }
  const stripped = digits.replace(/^0+/, "");
  if (stripped.length >= 8) {
    const [p, msg] = searchUnique(cat, x => String(x.barcode || "").toLowerCase().includes(stripped));
    if (p) return [p, null];
    ambiguous = ambiguous || (msg && "EAN incomplet : plusieurs articles le contiennent");
  }
  return [null, ambiguous];
}

function findProduct(cat: Catalog, c: string, ean: string): [any | null, string, "code" | "ean" | null] {
  c = (c || "").trim();
  const eanDigits = (ean || "").replace(/\D/g, "");
  let ambiguous: string | null = null;
  if (c) {
    const stripped = c.replace(/[\s.\-/]/g, "");
    for (const pred of [
      (p: any) => String(p.default_code || "") === c,
      (p: any) => up(p.default_code) === up(c),
      (p: any) => up(p.default_code) === up(stripped),
    ]) {
      const [p, msg] = searchUnique(cat, pred);
      if (p) return [p, "", "code"];
      ambiguous = ambiguous || msg;
    }
  }
  if (eanDigits.length >= 8) {
    const [p, msg] = searchBarcode(cat, eanDigits);
    if (p) return [p, "", "ean"];
    ambiguous = ambiguous || msg;
  }
  if (c) {
    const cd = c.replace(/\D/g, "");
    if (cd === c.replace(/ /g, "") && cd.length >= 8) {
      const [p, msg] = searchBarcode(cat, cd);
      if (p) return [p, "", "ean"];
      ambiguous = ambiguous || msg;
    }
  }
  if (!c && eanDigits.length < 8) return [null, "ni code article ni EAN lisible", null];
  return [null, ambiguous || "article introuvable dans Odoo", null];
}

// Article archivé ou non vendable portant ce code / EAN.
function findUnavailable(cat: Catalog, c: string, ean: string): any | null {
  const eanDigits = (ean || "").replace(/\D/g, "");
  const tests: ((p: any) => boolean)[] = [];
  if (c) tests.push(p => up(p.default_code) === up(c.trim()));
  if (eanDigits.length >= 8) {
    const vs = new Set(eanVariants(eanDigits));
    tests.push(p => vs.has(String(p.barcode || "")));
    const s = eanDigits.replace(/^0+/, "");
    if (s.length >= 8) tests.push(p => String(p.barcode || "").includes(s));
  }
  for (const t of tests) {
    const hit = cat.all.filter(t).sort(byNewest)[0];
    if (hit) return hit;
  }
  return null;
}

// ═══ Miniatures / échantillons → lots « L » ══════════════════════════════
const UNIT_KINDS: [RegExp, string, number][] = [
  [/^40\d{5}$/, "miniature", 5],
  [/^5\d{6}$/, "échantillon", 10],
];
function unitKind(c: string): [string | null, number | null] {
  const clean = up(c).replace(/ /g, "").replace(/^L+/, "");
  for (const [re, kind, size] of UNIT_KINDS) if (re.test(clean)) return [kind, size];
  return [null, null];
}

function unitLot(cat: Catalog, c: string, ean: string): { lot: any; unitCode: string; unit: any } | null {
  let unitCode: string | null = null, unit: any = null;
  const clean = (c || "").replace(/ /g, "");
  if (unitKind(clean)[0] && !up(clean).startsWith("L")) unitCode = clean;
  else {
    const digits = (ean || "").replace(/\D/g, "");
    if (digits.length >= 8) {
      const vs = new Set(eanVariants(digits));
      const cand = cat.all.find(p => vs.has(String(p.barcode || "")));
      const cc = code(cand);
      if (cc && unitKind(cc)[0] && !up(cc).startsWith("L")) { unitCode = cc; unit = cand; }
    }
  }
  if (!unitCode) return null;
  if (!unit) unit = cat.all.find(p => String(p.default_code || "") === unitCode) || null;
  const kind = unitKind(unitCode)[0];
  // Miniature : toujours remplacée par son lot. Échantillon : seulement s'il n'est pas vendable.
  if (kind !== "miniature" && unit && unit.active !== false && unit.sale_ok !== false) return null;
  const [lot] = searchUnique(cat, p => up(p.default_code) === up("L" + unitCode));
  return lot ? { lot, unitCode, unit } : null;
}

function lotSize(lot: any): number {
  const name = String(lot?.name || "");
  for (const re of [
    /\blot\s*(?:de\s*)?(\d+)\s*(?:x|×|miniatures?|[ée]chantillons?)/i,
    /\blot\s*[x×]\s*(\d+)\b/i,
    /\b(\d+)\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:ml|g|gr|cl)\b/i,
  ]) {
    const m = name.match(re);
    if (m && parseInt(m[1], 10) > 0) return parseInt(m[1], 10);
  }
  const [kind, size] = unitKind(code(lot));
  if (kind) return size!;
  return /[ée]chantillon/i.test(name) ? 10 : 5;
}

function qtyInLots(qty: number, lot: any, origin: string): [number, string] {
  const size = lotSize(lot);
  const kind = unitKind(code(lot))[0] || (/[ée]chantillon/i.test(String(lot?.name || "")) ? "échantillon" : "miniature");
  const units = qty || 0;
  if (units <= 0) return [0, `${origin.trim()} : 0 ${kind}`];
  const nb = Math.max(1, Math.ceil(units / size - 1e-9));
  let note = `${origin.trim()} : ${units} ${kind}(s) → ${nb} lot(s) de ${size} [${code(lot)}]`;
  if (nb * size !== units) note += ` — arrondi au lot supérieur (${nb * size} ${kind}s)`;
  return [nb, note];
}

// ═══ Libellés de rupture ═════════════════════════════════════════════════
function replacedNote(old: any): string {
  const prefix = code(old) ? `[${code(old)}] ` : "";
  return `${prefix}${String(old.name || "").trim()} * RUPTURE DEFINITIVE *`;
}
function ruptureNote(old: any): string {
  const prefix = code(old) ? `[${code(old)}] ` : "";
  const msg = isArchived(old) ? "* RUPTURE DEFINITIVE *"
    : (String(old.sale_line_warn_msg || "").trim().toUpperCase() || "* RUPTURE *");
  return `${prefix}${String(old.name || "").trim()} ${msg}`;
}

// ═══ Recherche par le nom + départage ════════════════════════════════════
function matcherFor(cat: Catalog, prefix?: string | null): ProductNameMatcher {
  const key = prefix || "";
  if (!cat.matchers.has(key)) {
    const items = cat.sellable
      .filter(p => !prefix || String(p.default_code || "").startsWith(prefix))
      .map(p => [p.id, String(p.display_name || p.name || "").replace(/^\[[^\]]*\]\s*/, "")] as [number, string]);
    cat.matchers.set(key, new ProductNameMatcher(items));
  }
  return cat.matchers.get(key)!;
}

const fmtEur = (n: number) => `${(n || 0).toFixed(2).replace(".", ",")} €`;

function findByName(cat: Catalog, label: string, prefix?: string | null, ignoreVolume = false, replacement = false): [any | null, string | null, string | null] {
  if (!(label || "").trim()) return [null, "ni code article, ni EAN, ni libellé", null];
  const [id, foundName, score, reason, homonyms] = matcherFor(cat, prefix).match(label, ignoreVolume, replacement);
  const byId = (i: number) => cat.sellable.find(p => p.id === i);
  if (id) {
    const p = byId(id);
    return [p, null, `« ${label} » → [${code(p) || "-"}] ${foundName} (proximité ${Math.round(score * 100)} %)`];
  }
  if (homonyms.length) {
    const cands = homonyms.map(byId).filter(Boolean);
    const codes = cands.map(p => `${code(p) || "-"} (${fmtEur(p.lst_price)})`).join(", ");
    let pool = cands, prefixRule = "";
    const c10 = cands.filter(p => code(p).startsWith("10"));
    if (c10.length) { pool = c10; prefixRule = "code en 10"; }
    const top = Math.max(...pool.map(p => p.lst_price || 0));
    let priciest = pool.filter(p => (p.lst_price || 0) === top);
    let rule: string;
    if (pool.length === 1) rule = prefixRule;
    else if (priciest.length === 1) rule = [prefixRule, "le plus cher"].filter(Boolean).join(", ");
    else {
      priciest = [...priciest].sort(byNewest).slice(0, 1);
      const d = String(priciest[0].create_date || "").slice(0, 10).split("-").reverse().join("/");
      rule = [prefixRule, `même prix : le plus récent, créé le ${d}`].filter(Boolean).join(", ");
    }
    const p = priciest[0];
    return [p, null, `« ${label} » → [${code(p) || "-"}] ${p.name}, ${fmtEur(p.lst_price)} (ambigu, ${rule} parmi : ${codes})`];
  }
  return [null, `sans code ni EAN, et ${reason}`, null];
}

// ═══ Code / EAN remis à leur place ═══════════════════════════════════════
const CODE_RE = /^(?:\d{6,9}|[A-Z]\d{6,8})$/;
const EAN_RE = /^\d{11,15}$/;
function cellKind(v: string, cat: Catalog): "code" | "ean" | null {
  const x = up(v).replace(/ /g, "");
  if (!x) return null;
  if (cat.all.some(p => up(p.default_code).replace(/ /g, "") === x)) return "code";
  if (/^\d+$/.test(x)) {
    const n = x.replace(/^0+/, "");
    if (cat.all.some(p => String(p.barcode || "").replace(/\D/g, "").replace(/^0+/, "") === n)) return "ean";
  }
  if (/^\d+$/.test(x) && x.replace(/^0+/, "").startsWith("4020829") && x.length >= 11) return "ean";
  if (EAN_RE.test(x)) return "ean";
  if (CODE_RE.test(x)) return "code";
  return null;
}
function fixCodeEan(c: string, ean: string, cat: Catalog): [string, string] {
  const kc = c ? cellKind(c, cat) : null;
  const ke = ean ? cellKind(ean, cat) : null;
  if (kc === "ean" && (ke === "code" || ke === null)) return [ke === "code" ? ean : "", c];
  if (ke === "code" && !c) return [ean, ""];
  return [c, ean];
}

// ═══ Une ligne du bon → ligne(s) de devis ════════════════════════════════
export interface BonLine {
  code_article: string | null; ean: string | null; designation: string | null;
  quantite: number | null; quantite_gratuite?: number | null; commentaire?: string | null;
}
export type Highlight = "red" | "orange" | "green";
export interface Resolved {
  key: number;
  lue: { code: string; ean: string; label: string; qty: number; free: number; comment: string };
  kind: "product" | "rupture" | "saisir";
  product: any | null;
  qty: number;                 // quantité à commander (en lots si convertie)
  freeQty: number;             // unités gratuites (UG), 2e ligne à 100 % de remise
  inLots: boolean;
  matchedBy: "code" | "ean" | "nom" | "remplacement" | "lot" | "manuel" | null;
  description?: string;        // libellé de ligne (« [ancien] … * RUPTURE DEFINITIVE * »)
  highlight?: Highlight;       // couleur de la ligne dans Odoo (champ ocr_highlight)
  byName?: string;             // explication « trouvé par le nom — à vérifier »
  lotNote?: string;
  note?: string;               // texte de la note (rupture / À SAISIR)
  reason?: string;
}

export const toFloat = (v: any): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/[\s  ]/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
};

export function resolveLines(cat: Catalog, raw: BonLine[]): { lines: Resolved[]; skipped: number } {
  const kept = raw.filter(l => (toFloat(l.quantite) || 0) > 0 || (toFloat(l.quantite_gratuite) || 0) > 0);
  const out = kept.map((line, key) => resolveOne(cat, line, key));
  return { lines: out, skipped: raw.length - kept.length };
}

function resolveOne(cat: Catalog, line: BonLine, key: number): Resolved {
  let c = String(line.code_article || "").trim();
  let ean = String(line.ean || "").trim();
  [c, ean] = fixCodeEan(c, ean, cat);
  const label = String(line.designation || "").trim();
  let qty = toFloat(line.quantite) || 0;
  const free = toFloat(line.quantite_gratuite) || 0;
  const comment = String(line.commentaire || "").trim();
  const r: Resolved = {
    key, lue: { code: c, ean, label, qty, free, comment },
    kind: "product", product: null, qty, freeQty: free, inLots: false, matchedBy: null,
  };
  let product: any = null, reason = "";
  let rupture: string | null = null;
  const eanOk = ean.replace(/\D/g, "").length >= 8;

  const mini = unitLot(cat, c, ean);
  if (mini) {
    product = mini.lot;
    const [q, note] = qtyInLots(qty, mini.lot, `[${mini.unitCode}] ${(mini.unit?.name || label) || ""}`);
    qty = q; r.lotNote = note; r.inLots = true; r.matchedBy = "lot";
  } else if (c || eanOk) {
    let how: "code" | "ean" | null;
    [product, reason, how] = findProduct(cat, c, ean);
    if (product) {
      r.matchedBy = how;
    } else {
      // Code / EAN introuvable : article archivé / non vendable → remplaçant par le nom.
      const old = findUnavailable(cat, c, ean);
      let docCode = c;
      if (/^\d+$/.test(c.replace(/ /g, "")) && c.replace(/ /g, "").length >= 12) docCode = "";   // c'est un EAN
      const refCode = (docCode || code(old) || "").trim();
      const prefix = refCode.slice(0, 1) || null;
      const names = Array.from(new Set([label, old?.name].filter(Boolean) as string[]));
      const archived1 = !!old && isArchived(old) && code(old).startsWith("1") && prefix === "1";
      for (const ignoreVolume of archived1 ? [false, true] : [false]) {
        for (const nm of names) {
          let [found, , explanation] = findByName(cat, nm, prefix, ignoreVolume, true);
          if (found && ignoreVolume && !code(found).startsWith("1")) found = null;
          if (found) {
            product = found;
            let origin = old
              ? `[${code(old) || ean || "-"}] ${isArchived(old) ? "archivé" : "non vendable"}`
              : `${c ? `réf. ${c}` : `EAN ${ean}`} introuvable`;
            if (ignoreVolume) origin += " (autre format)";
            r.byName = `${origin} → remplacé via le nom : ${explanation}`;
            r.matchedBy = "remplacement";
            if (old && !ignoreVolume) { r.description = replacedNote(old); r.highlight = "orange"; }
            else if (old && archived1) { r.description = replacedNote(old); r.highlight = "red"; }
            break;
          }
        }
        if (product) break;
      }
      if (!product && old) rupture = ruptureNote(old);
    }
  } else {
    const [found, why, explanation] = findByName(cat, label);
    product = found; reason = why || "";
    if (found) { r.byName = explanation || undefined; r.matchedBy = "nom"; }
  }

  // Miniature à l'unité trouvée autrement : remplacée par son lot « L ».
  if (product && !mini && unitKind(code(product))[0] === "miniature" && !up(code(product)).startsWith("L")) {
    const [unitLotP] = searchUnique(cat, p => up(p.default_code) === up("L" + code(product)));
    if (unitLotP) {
      const [q, note] = qtyInLots(qty, unitLotP, `[${code(product)}] ${product.name}`);
      qty = q; r.lotNote = note; r.inLots = true; product = unitLotP;
    }
  }
  // « Miniature … » / « Échantillon … » trouvé par le nom sous forme de lot.
  if (product && !mini && !r.inLots && up(code(product)).startsWith("L")
      && /miniature|[ée]chantillon/i.test(label) && !/\blots?\b/i.test(label)) {
    const [q, note] = qtyInLots(qty, product, label);
    qty = q; r.lotNote = note; r.inLots = true;
  }

  if (rupture) {
    return { ...r, kind: "rupture", product: null, qty: 0, freeQty: 0, note: rupture, highlight: "red" };
  }
  if (product) {
    let freeQty = free;
    if (r.inLots && free > 0) freeQty = qtyInLots(free, product, "UG")[0];
    return { ...r, product, qty, freeQty };
  }
  return { ...r, kind: "saisir", product: null, reason, highlight: "orange", note: saisirNote(r, reason) };
}

export function saisirNote(r: Resolved, reason: string): string {
  const d = [
    r.lue.code && `réf. ${r.lue.code}`,
    r.lue.ean && `EAN ${r.lue.ean}`,
    r.lue.label || null,
    `qté ${r.lue.qty}`,
    r.lue.free ? `UG ${r.lue.free}` : null,
    r.lue.comment || null,
  ].filter(Boolean);
  return `⚠ À SAISIR (${reason || "article introuvable dans Odoo"}) : ${d.join(" – ")}`;
}

// ═══ Champs du module Odoo, s'il est installé sur la base ═══════════════
// ocr_highlight (couleur des lignes), read_by_claude / bdc_offline (devis),
// source « Email - BDC Client ». Absents → simplement pas renseignés.
export const ORDER_SOURCE_NAME = "Email - BDC Client";
let _fields: Promise<{ line: Set<string>; order: Set<string>; sourceId: number | null }> | null = null;
export function importFields(session: odoo.OdooSession) {
  if (!_fields) {
    _fields = (async () => {
      const keys = async (model: string, names: string[]) => {
        try {
          const f = await odoo.callMethod(session, model, "fields_get", [names], { attributes: ["type"] });
          return new Set(Object.keys(f || {}));
        } catch { return new Set<string>(); }
      };
      const [line, order] = await Promise.all([
        keys("sale.order.line", ["ocr_highlight", "type_gratuit"]),
        keys("sale.order", ["read_by_claude", "bdc_offline", "source_id", "client_order_ref"]),
      ]);
      let sourceId: number | null = null;
      if (order.has("source_id")) {
        try {
          const rows = await odoo.searchRead(session, "utm.source", [["name", "=ilike", ORDER_SOURCE_NAME]], ["id"], 1);
          sourceId = rows[0]?.id ?? null;
        } catch { sourceId = null; }
      }
      return { line, order, sourceId };
    })().catch(e => { _fields = null; throw e; });
  }
  return _fields;
}
