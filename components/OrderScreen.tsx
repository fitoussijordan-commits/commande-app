"use client";
import LogoutButton from "@/components/LogoutButton";
import HomeButton, { HOME_EVENT } from "@/components/HomeButton";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import * as odoo from "@/lib/odoo";
import AppointmentModal from "@/components/AppointmentModal";
import ClientNoteModal from "@/components/ClientNoteModal";
import OfflineBar from "@/components/OfflineBar";
import PerimeScreen from "@/components/PerimeScreen";
import BonCommandeScreen, { ImportResult, ImportMeta } from "@/components/BonCommandeScreen";
import { importFields } from "@/lib/bonMatch";
import QtyPad from "@/components/QtyPad";
import PerimesReportScreen from "@/components/PerimesReportScreen";
import VisitPriority from "@/components/VisitPriority";
import Dashboard from "@/components/Dashboard";
import AgendaGlass from "@/components/AgendaGlass";
import { resolveClientFamily, odooRecordUrl } from "@/lib/perimes";
import InvoiceHistory from "@/components/InvoiceHistory";
import { GLASS, GLASS_PILL } from "@/components/glass";
import { saleStep, snapQty, optionalProductFields, ppcOf } from "@/lib/productFields";
import { deliveredMoves, type DeliveredRow } from "@/lib/rdvPrep";
import { orderMeta, isMea, isImplantation, offerNames, offerOptions, offerNamesByIds, templateMeta, templateLineMeta, type OrderMeta } from "@/lib/orderOffers";
import { loadBlockingTags, clientBlockingTags, loadClosedDayTags, clientClosedWeekdays, type BlockingTag, type ClosedDayTag } from "@/lib/clientFlags";
import { planShipping, toOdooDate, toOdooDatetime, isDirectLogistics, type ShippingPlan } from "@/lib/delivery";
import { onIncomingFile } from "@/lib/incomingFile";
import { needsShippingFee, shippingProduct, SHIPPING_FEE_HT, FRANCO_HT } from "@/lib/franco";
import OrderCheck from "@/components/OrderCheck";
import OrderDetailModal from "@/components/OrderDetailModal";
import VersionFooter from "@/components/VersionFooter";
import RdvPrepModal from "@/components/RdvPrepModal";
import OrderMessages from "@/components/OrderMessages";
import PortalOrders from "@/components/PortalOrders";
import OrderSubmitLoader, { type SubmitStep } from "@/components/OrderSubmitLoader";
import { caDateFields as caDateFieldsShared } from "@/lib/salesStats";
import { CountUp, TubeLoader, TubeSuccess, CatalogSkeleton, ListSkeleton } from "@/components/motion";
import * as sync from "@/lib/sync";
import * as geo from "@/lib/geo";
import { apiUrl } from "@/lib/apiBase";
import * as loyalty from "@/lib/loyalty";
import { PriceItem, sortPriceItems, applyPricelist, resolveBaseLists } from "@/lib/pricing";
import { descToText, routeUrls, stripRouteLinks } from "@/lib/text";
import { dedupeClients, NOT_SUPPLIER, getMineOnly, setMineOnly, mineDomain, isMine, ClientScope, cachedOwnDocsOnly, fetchOwnDocsOnly, scopeDomain, matchesScope, isProspect } from "@/lib/clients";
import { eventOnDay, ALLDAY_FIELDS, linkedPartnerId } from "@/lib/calendar";
import { pickClientAmong } from "@/lib/clients";
import { SHOW_PRODUCT_IMAGES } from "@/lib/features";
import { asset } from "@/lib/appTarget";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#7d8ca3", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  // Refonte : accent unique teal. "purple" est conservé comme alias (le panneau
  // règles masqué et d'anciens usages y font référence) mais pointe sur du teal.
  purple: "#0d9488", purpleSoft: "#f0fdfa",
  orange: "#ea580c", orangeSoft: "#fff7ed",
  green: "#16a34a", greenSoft: "#f0fdf4",
  red: "#dc2626", redSoft: "#fef2f2",
  blue: "#2563eb", blueSoft: "#eff6ff",
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)",
  shadowMd: "0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.05)",
  shadowXl: "0 20px 25px rgba(0,0,0,0.10), 0 8px 10px rgba(0,0,0,0.04)",
};

// ── Icônes SVG (remplacent les emojis du chrome — trait unique, currentColor) ──
const ICON_PATHS: Record<string, React.ReactNode> = {
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></>,
  note: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></>,
  cart: <><circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.4 12h10.2L20 8H6"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/></>,
  pin: <><path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></>,
  phone: <path d="M5 4h4l1.5 4L8 10a13 13 0 0 0 6 6l2-2.5 4 1.5v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>,
  package: <><path d="M21 8v8l-9 5-9-5V8l9-5 9 5Z"/><path d="M3.5 8.5 12 13l8.5-4.5M12 13v8"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>,
  star: <path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6L12 16.7 6.6 19.6l1.1-6L3.2 9.4l6.1-.8Z"/>,
  gift: <><rect x="3" y="8" width="18" height="4"/><path d="M5 12v8h14v-8M12 8v12"/><path d="M12 8c-4 0-5.2-4.5-2.3-4.5C11.5 3.5 12 8 12 8Zm0 0c4 0 5.2-4.5 2.3-4.5C12.5 3.5 12 8 12 8Z"/></>,
  home: <><path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/></>,
  tag: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7-7V4h9.6l7.4 7.4a2 2 0 0 1 0 2Z"/><circle cx="8" cy="8" r="1.5"/></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></>,
  // Baguette magique (« Charger la commande »)
  wand: <><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"/></>,
  inbox: <><path d="M22 13h-6l-2 3h-4l-2-3H2"/><path d="M5 4h14l3 9v7H2v-7Z"/></>,
  check: <path d="M20 6 9 17l-5-5"/>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>,
  wifiOff: <><path d="M2 2l20 20"/><path d="M5 10a13 13 0 0 1 4.2-2.6M12 4c3.8 0 7.3 1.5 10 4M8.5 13.5a8 8 0 0 1 2.3-1.3M12 8c2.7 0 5.2 1 7 2.8"/><circle cx="12" cy="18" r="1.3"/></>,
};
function Icon({ name, size = 18, color = "currentColor", strokeWidth = 2, style }: {
  name: string; size?: number; color?: string; strokeWidth?: number; style?: React.CSSProperties;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Props {
  session: odoo.OdooSession;
  onBack: () => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
  desktop?: boolean;
}
// priceLocked : prix fixé à la main (ex. prix d'un bon de commande importé) —
// il n'est plus recalculé depuis la grille quand la quantité change.
// bonBrut / bonRemise : prix d'un bon importé, envoyé à Odoo en brut + % de remise
// comme dans le logiciel du client (voir handleValidate).
// seq : ordre d'ajout (l'objet panier, indexé par id produit, se trie tout seul
// par id). group : MEA d'origine, pour regrouper ses lignes sous un séparateur.
// note : ligne de commentaire (display_type Odoo) — product = { id négatif, name = texte }.
// lineName / highlight : ligne venue de « Charger la commande » (libellé « … * RUPTURE
// DEFINITIVE * », couleur ocr_highlight du module Odoo d'import).
// freeType : ligne de MEA envoyée avec un « Type de gratuité » (article MEA code 7,
// 1re ligne de la MEA dans le panier, à 0 €) — contrôle de stock comme les autres.
interface CartItem { product: any; qty: number; unitPrice: number; priceLocked?: boolean; bonBrut?: number; bonRemise?: number; seq?: number; group?: string; note?: "line_note" | "line_section"; lineName?: string; highlight?: string; freeType?: string; }
const noStockCheck = (i: { product: any }) => isSeparatorProduct(i.product);

// Lignes du panier dans l'ordre d'ajout (paniers anciens sans seq : en tête).
function orderedCart(cart: Record<number, CartItem>): CartItem[] {
  return Object.values(cart).sort((a, b) => (a.seq || 0) - (b.seq || 0));
}
// Remises Odoo (programmes de fidélité) : les lignes d'un devis d'implantation
// n'y comptent pas — ni pour déclencher une promo, ni pour en recevoir la remise.
function promoCart(cart: Record<number, CartItem>): Record<number, CartItem> {
  return Object.fromEntries(Object.entries(cart).filter(([, i]) => !i.note && !/implantation/i.test(i.group || ""))) as Record<number, CartItem>;
}
// Prix d'une ligne du panier.
// Remise d'une promo Odoo (MEA, « Réductions & fidélité ») : ADDITIONNÉE à celle
// de la liste de prix du client, pas en cascade comme le fait Odoo — règle maison :
// tarif −15 % + promo −10 % = −25 % sur le prix catalogue (et non −23,5 %).
// Remise événement (10 / 15 %) : additionnée elle aussi, sur les lignes payantes
// (tarif −17 % + événement −10 % = −27 %). Remise saisie sur un devis d'implantation :
// c'est la remise FINALE de la ligne sur le prix catalogue (17 % saisi = −17 %),
// à la place de celle du tarif client et des promos.
// brut = prix de référence de la ligne envoyée à Odoo ; discount = % de remise de
// la ligne (sur brut) ; net = PU net. additive : la ligne part « brut + remise »,
// comme Odoo l'affiche : prix CATALOGUE + remise totale (tarif client compris),
// même sans promo — envoyée en net sans remise, Odoo y ajoutait la remise du tarif.
function linePricing(item: { product: any; unitPrice: number; priceLocked?: boolean }, promoPct: number, otherPct: number) {
  const unit = item.unitPrice;
  const other = Math.min(100, Math.max(0, otherPct));
  if (item.priceLocked) {
    const disc = other > 0 ? other : Math.min(100, promoPct);
    return { brut: unit, discount: disc, net: unit * (1 - disc / 100), additive: false };
  }
  const lst = Number(item.product?.lst_price) || 0;
  const brut = lst > unit ? lst : unit;
  const tarifPct = brut > 0 ? (1 - unit / brut) * 100 : 0;
  const total = other > 0 ? other : Math.min(100, tarifPct + promoPct);
  const net = brut * (1 - total / 100);
  return { brut, discount: brut > 0 ? (1 - net / brut) * 100 : 0, net, additive: true };
}
const isImplantLine = (i: { group?: string }) => /implantation/i.test(i.group || "");
// % additionnés au tarif client : promo Odoo + remise événement (lignes payantes,
// jamais celles d'un devis d'implantation).
const addPctOf = (i: CartItem, lineDiscounts: Record<number, number>, eventDiscount: number) =>
  (lineDiscounts[i.product.id] || 0) + (i.unitPrice > 0 && !isImplantLine(i) ? eventDiscount || 0 : 0);
// Remise saisie du devis d'implantation : remise finale de la ligne (cf. linePricing).
const otherPctOf = (i: CartItem, groupDiscounts: Record<string, number>) =>
  i.group ? groupDiscounts[i.group] || 0 : 0;

// Total HT net du panier (remises promo + événement + implantation), hors frais de port.
function cartNet(cart: Record<number, CartItem>, lineDiscounts: Record<number, number>, eventDiscount: number, groupDiscounts: Record<string, number>): number {
  return Object.values(cart).reduce((s, i) => {
    if (i.note) return s;
    return s + i.qty * linePricing(i, addPctOf(i, lineDiscounts, eventDiscount), otherPctOf(i, groupDiscounts)).net;
  }, 0);
}
// Lignes dont la quantité dépasse le stock prévisionnel (pastille rouge).
function cartRuptures(cart: Record<number, CartItem>) {
  return orderedCart(cart)
    .filter(i => !i.note && i.qty > 0 && !noStockCheck(i) && i.qty > Math.floor(i.product.virtual_available || 0))
    .map(i => ({ name: String(i.product.name || ""), code: i.product.default_code || undefined, qty: i.qty, stock: Math.max(0, Math.floor(i.product.virtual_available || 0)) }));
}
// Recherche : chaque mot tapé doit se retrouver dans le nom, la réf. ou l'EAN
// (sans tenir compte des accents ni des majuscules).
const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function matchesSearch(p: any, words: string[]): boolean {
  const hay = fold(`${p.name || ""} ${p.default_code || ""} ${p.barcode || ""}`);
  return words.every(w => hay.includes(w));
}
// Ligne offerte : produit à 0€ + type de gratuité (type_gratuit sur sale.order.line).
// cond : gratuité d'un modèle (MEA) — valable tant que le TOTAL des articles
// payants du modèle est atteint, répartition libre (« 48 coffrets + 8 offerts » :
// 13 + 25 + 16 = 54 ≥ 48 → offert).
// fullDiscountPrice : UG d'un bon chargé — comme le module Odoo d'import, ligne au
// prix client avec 100 % de remise (au lieu d'un prix à 0 €).
// cond.mea : gratuité d'une MEA — active seulement si la MEA est éligible (promo
// Odoo liée éligible + article MEA code 7 présent) ; `off` est tenu à jour par
// l'app (useEffect « Éligibilité des MEA »).
interface GiftItem {
  product: any; qty: number; type: string;
  cond?: { label: string; required: Record<number, number>; mea?: { code?: string; programId?: number } };
  off?: boolean; highlight?: string; fullDiscountPrice?: number;
  afterIdx?: number;   // gratuité de MEA : nb de lignes du modèle avant elle (place dans le devis)
  afterProductId?: number;   // UG d'un bon chargé : juste après la ligne payante de cet article
}

// Quantité offerte non couverte par le stock prévisionnel : le stock sert d'abord
// la ligne payante du même article, puis la gratuité.
function giftShortage(g: GiftItem, cart: Record<number, { qty: number }>): number {
  if (isSeparatorProduct(g.product)) return 0;
  const stock = Math.max(0, Math.floor(g.product?.virtual_available || 0));
  const paid = cart[g.product.id]?.qty || 0;
  return Math.max(0, g.qty - Math.max(0, stock - paid));
}

// Place des gratuités dans le panier et le devis :
//   • UG d'un bon chargé → juste après la ligne payante du même article ;
//   • gratuités d'une MEA / d'un devis d'implantation → dans le bloc de leur groupe,
//     après la k-ième ligne du bloc (afterIdx = position dans le modèle de devis),
//     sinon en fin de bloc ;
//   • les autres (bouton Offrir, groupe retiré…) → `rest`, en fin de commande.
// before / after : index de ligne du panier → gratuités à placer avant / après elle.
function placeGifts(items: CartItem[], gifts: GiftItem[]) {
  const before = new Map<number, GiftItem[]>(), after = new Map<number, GiftItem[]>();
  const placed = new Set<GiftItem>();
  const take = (map: Map<number, GiftItem[]>, i: number, list: GiftItem[]) => {
    if (!list.length) return;
    list.forEach(g => placed.add(g));
    map.set(i, [...(map.get(i) || []), ...list]);
  };
  const of = (label: string, ok: (g: GiftItem) => boolean) => gifts.filter(g => !placed.has(g) && g.cond?.label === label && ok(g));
  const lastOfGroup = new Map<string, number>();
  items.forEach((it, i) => { if (it.group) lastOfGroup.set(it.group, i); });
  const seen: Record<string, number> = {};
  items.forEach((item, i) => {
    const grp = item.group;
    if (grp && seen[grp] === undefined) { seen[grp] = 0; take(before, i, of(grp, g => (g.afterIdx ?? Infinity) <= 0)); }
    if (!item.note) take(after, i, gifts.filter(g => !placed.has(g) && g.afterProductId === item.product.id));
    if (grp) {
      seen[grp]++;
      take(after, i, of(grp, g => (g.afterIdx ?? Infinity) <= seen[grp]));
      if (lastOfGroup.get(grp) === i) take(after, i, of(grp, () => true));
    }
  });
  return { before, after, rest: gifts.filter(g => !placed.has(g)) };
}
function giftActive(g: GiftItem, cart: Record<number, { qty: number }>): boolean {
  if (!g.cond) return true;
  if (g.cond.mea) return !g.off;
  const ids = Object.keys(g.cond.required).map(Number);
  const need = ids.reduce((s, id) => s + g.cond!.required[id], 0);
  return ids.reduce((s, id) => s + (cart[id]?.qty || 0), 0) >= need;
}
interface FreeRule {
  id: string; name: string; triggerQty: number; freeQty: number;
  allProducts: boolean; productRefs: string[];
}
interface FreeItem { product: any; qty: number; ruleName: string; }

const LS_RULES  = "wms_order_rules_v2";
const LS_DRAFTS = "wms_order_drafts_v1"; // un brouillon PAR client (map clientId → Draft), plus d'écrasement

// Brouillons et « derniers clients » : propres à l'utilisateur Odoo connecté (clé
// suffixée par son uid). Avant, ils étaient communs à l'appareil : un commercial
// voyait les clients ouverts par un collègue ou un admin sur le même iPad.
let _lsUid = 0;
function setStorageUser(uid: number) { _lsUid = uid || 0; }
// Clé de l'utilisateur ; à la 1re lecture, reprise des anciennes données communes,
// limitée aux clients dont il est le vendeur.
function userKey(base: string, keepLegacy: (value: any) => any): string {
  const key = `${base}:${_lsUid}`;
  try {
    if (_lsUid && localStorage.getItem(key) === null) {
      const legacy = localStorage.getItem(base);
      localStorage.setItem(key, legacy ? JSON.stringify(keepLegacy(JSON.parse(legacy))) : (base === LS_DRAFTS ? "{}" : "[]"));
    }
  } catch {}
  return key;
}
// Reprise des anciennes données : filtrée sur « vendeur = moi » pour les
// commerciaux (Ventes « mes documents seulement »), complète pour les autres.
const ownedBy = (c: any) => cachedOwnDocsOnly() === false || (Array.isArray(c?.user_id) && c.user_id[0] === _lsUid);
const LS_CATS   = "wms_order_smart_cats";

// Règles "maison" (articles offerts configurés localement, panneau ⚙️) — masquées pour le moment
// au profit des vraies remises Odoo. Code conservé intact, juste désactivé : remettre à true pour
// réactiver l'accès (bouton ⚙️ + déclenchement des règles) sans rien avoir à réécrire.
const HOMEMADE_RULES_ENABLED = false;

// ── Catégories par codification référence (chars 1-2 de default_code) ─────────
// Ex : 1010101 → "01" = Visage
interface SmartCat { id: string; code: string; emoji: string; label: string; }

const DEFAULT_CATS: SmartCat[] = [
  { id: "01", code: "01", emoji: "🌸", label: "Visage" },
  { id: "02", code: "02", emoji: "✨", label: "Régénérant" },
  { id: "03", code: "03", emoji: "💆", label: "Corps" },
  { id: "04", code: "04", emoji: "🚿", label: "Hygiène" },
  { id: "05", code: "05", emoji: "💊", label: "Med" },
  { id: "06", code: "06", emoji: "💄", label: "Maquillage" },
];

function loadSmartCats(): SmartCat[] {
  try { const r = localStorage.getItem(LS_CATS); return r ? JSON.parse(r) : DEFAULT_CATS; } catch { return DEFAULT_CATS; }
}
function saveSmartCats(c: SmartCat[]) { localStorage.setItem(LS_CATS, JSON.stringify(c)); }

// Extrait le code catégorie : chars 1 et 2 (0-indexé) de la référence
function getCatCode(product: any): string {
  const ref = product.default_code || "";
  return ref.length >= 3 ? ref.substring(1, 3) : "";
}

// Produit phare illustrant chaque gamme dans le menu (photo Odoo, en cache hors
// ligne). Par nom ; à défaut, premier produit de vente de la gamme.
const GAMME_HERO: Record<string, RegExp> = {
  "01": /cr[eè]me purifiante/i,
  "02": /cr[eè]me r[ée]g[ée]n[ée]rante/i,
  "03": /lait corporel|huile de soin|cr[eè]me.*corps/i,
  "04": /dentifrice|savon|gel douche/i,
  "05": /med\b|dentifrice|cr[eè]me/i,
  "06": /rouge [àa] l[eè]vres|mascara|fond de teint/i,
};

function gammeHero(products: any[], cat: SmartCat): any | null {
  const inCat = products.filter(p => matchesCat(p, cat) && isSaleProduct(p));
  const re = GAMME_HERO[cat.code];
  return (re && inCat.find(p => re.test(String(p.name || "")))) || inCat[0] || null;
}

function matchesCat(product: any, cat: SmartCat): boolean {
  return getCatCode(product) === cat.code;
}

// Gamme « Produit vente » : Visage + Régénérant + Corps + Hygiène + Med +
// Maquillage (produits de vente seulement). Sélectionnée par défaut à l'ouverture
// du catalogue (avant : « Tous »).
const VENTE_CAT_ID = "__vente__";
const VENTE_CODES = new Set(["01", "02", "03", "04", "05", "06"]);
function isVenteProduct(product: any): boolean {
  return VENTE_CODES.has(getCatCode(product)) && isSaleProduct(product);
}

// Liste des articles : triée par référence (code article), ordre croissant ;
// sans référence en fin de liste.
function byRef(a: any, b: any): number {
  const ra = String(a?.default_code || "").trim(), rb = String(b?.default_code || "").trim();
  if (!ra || !rb) return ra ? -1 : rb ? 1 : 0;
  return ra.localeCompare(rb, "fr", { numeric: true });
}

// ── Type de produit Odoo (x_type_de_produit_id sur product.template) ──────────
// Volontairement PAS la liste brute des types Odoo : seulement les six catégories
// utiles en visite. « Accessoires » regroupe plusieurs types Odoo (sacs, éponges).
//
// Le rattachement se fait par MOT-CLÉ sur le libellé, pas sur l'ID : les IDs de
// x_type_de_produit diffèrent d'une base à l'autre, et un libellé au singulier,
// au pluriel ou mal accentué tombe quand même dans la bonne catégorie.
const TYPE_CAT_PREFIX = "type:";

// `also` : repli quand le type Odoo n'est pas renseigné — par la référence ou le
// nom. Premier chiffre de la référence : 1 vente, 3 testeur, 5 échantillon,
// 6 PLV, 7 offre MEA, 8 gratuité allemande.
const PRODUCT_TYPE_GROUPS: { id: string; label: string; patterns: RegExp[]; also?: (p: any) => boolean }[] = [
  // Testeurs : référence en 3 seulement. Pas de repli par le nom : les PLV
  // « Module-Conseil testeur », « Présentoir … + 4 testeurs » y tombaient.
  { id: "testeurs",    label: "Testeurs",     patterns: [],
    also: p => /^3/.test(String(p.default_code || "").trim()) },
  { id: "echantillons", label: "Échantillons", patterns: [/[ée]chantillon/i],
    also: p => /^5/.test(String(p.default_code || "").trim()) },
  { id: "travel",      label: "Travel size",  patterns: [/travel/i] },
  { id: "miniatures",  label: "Miniatures",   patterns: [/miniature/i] },
  { id: "accessoires", label: "Accessoires",  patterns: [/\bsacs?\b/i, /[ée]ponge/i, /accessoire/i] },
  { id: "plv",         label: "PLV",          patterns: [/\bplv\b/i, /pr[ée]sentoir/i, /publicit/i, /merchandising/i],
    also: p => /^6/.test(String(p.default_code || "").trim())
      || /^(pr[ée]sentoir|chevalet|panneau|stop-rayon|r[ée]glette|brochure|emballage vide|vitrophanie|affiche)/i.test(String(p.name || "")) },
];

function productTypeLabel(product: any): string {
  const v = product?.x_type_de_produit_id;
  return Array.isArray(v) ? String(v[1] || "") : "";
}

function matchesTypeGroup(product: any, groupId: string): boolean {
  const group = PRODUCT_TYPE_GROUPS.find(g => g.id === groupId);
  if (!group) return false;
  const label = productTypeLabel(product);
  return (!!label && group.patterns.some(re => re.test(label))) || !!group.also?.(product);
}

// Produit de VENTE, seul affiché dans les gammes (Visage, Corps, Régénérant…) et
// seul pris en compte comme article « payant » d'une MEA : Type de produit Odoo
// (x_type_de_produit_id) = « Produit vente ». Type non renseigné (ou champ absent
// de la base) : repli sur la référence en 1xxxxxx hors testeurs, échantillons,
// travel size, miniatures, accessoires et PLV.
function isSaleProduct(product: any): boolean {
  const label = productTypeLabel(product);
  if (label) return fold(label).replace(/[^a-z]/g, "") === "produitvente";
  if (!/^1/.test(String(product.default_code || "").trim())) return false;
  return !PRODUCT_TYPE_GROUPS.some(g => matchesTypeGroup(product, g.id));
}

function loadRules(): FreeRule[] { try { return JSON.parse(localStorage.getItem(LS_RULES) || "[]"); } catch { return []; } }
function saveRules(r: FreeRule[]) { localStorage.setItem(LS_RULES, JSON.stringify(r)); }

interface Draft {
  client: any;
  cart: Record<number, CartItem>;
  note: string;
  savedAt: number; // timestamp
  // Infos des MEA du panier (date de début d'expédition, note, code offre) et
  // offres cochées : sans elles, un brouillon repris perdait la date d'expé.
  templateInfo?: Record<string, { note?: string; shipDate?: string; code?: string }>;
  offerIds?: number[];
  // Gratuités (article MEA code 7, PLV, testeurs…), remise événement et remises
  // d'implantation : sans elles, une MEA reprise n'avait plus son article code 7,
  // donc plus de promo, et ne changeait plus de palier.
  giftItems?: GiftItem[];
  eventDiscount?: number;
  groupDiscounts?: Record<string, number>;
  // … et tout le reste de la commande en cours : type de commande, date
  // d'expédition choisie, remises Odoo retirées à la main, commande portail en
  // cours de modification (sans elle, la reprise créait un 2e devis), bon chargé.
  orderType?: string | number | "";
  wantedExpedition?: string | null;
  removedPromoIds?: number[];
  editOrder?: any;
  importMeta?: any;
}

// Brouillons stockés par client (clientId → Draft) — changer de client n'écrase plus rien.
function loadAllDrafts(): Record<string, Draft> {
  const keep = (all: Record<string, Draft>) => Object.fromEntries(Object.entries(all || {}).filter(([, d]) => ownedBy(d?.client)));
  try { return JSON.parse(localStorage.getItem(userKey(LS_DRAFTS, keep)) || "{}"); } catch { return {}; }
}
function saveAllDrafts(d: Record<string, Draft>) {
  const key = userKey(LS_DRAFTS, () => ({}));
  try { localStorage.setItem(key, JSON.stringify(d)); }
  catch {
    // Stockage plein (fichier d'un bon chargé, plusieurs Mo) : brouillons gardés
    // sans le fichier joint — le panier, lui, est toujours enregistré.
    const light = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.importMeta?.file ? { ...v, importMeta: { ...v.importMeta, file: null } } : v]));
    try { localStorage.setItem(key, JSON.stringify(light)); } catch {}
  }
}

function loadDraftForClient(clientId: number): Draft | null {
  return loadAllDrafts()[String(clientId)] || null;
}
function saveDraftForClient(clientId: number, draft: Draft) {
  const all = loadAllDrafts();
  all[String(clientId)] = draft;
  saveAllDrafts(all);
}
function removeDraftForClient(clientId: number) {
  const all = loadAllDrafts();
  delete all[String(clientId)];
  saveAllDrafts(all);
}
// Liste triée (plus récent d'abord) pour le panneau discret "brouillons en attente"
function listDrafts(): { clientId: string; draft: Draft }[] {
  const all = loadAllDrafts();
  return Object.entries(all)
    .map(([clientId, draft]) => ({ clientId, draft }))
    .sort((a, b) => b.draft.savedAt - a.draft.savedAt);
}

// Derniers clients ouverts (accueil → « Reprendre ») : 6 max, sur l'appareil.
const LS_RECENTS = "wms_recent_clients";
function loadRecentClients(): any[] {
  const keep = (v: any) => (Array.isArray(v) ? v : []).filter(ownedBy);
  try { const v = JSON.parse(localStorage.getItem(userKey(LS_RECENTS, keep)) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function pushRecentClient(c: any) {
  if (!c?.id) return;
  try { localStorage.setItem(userKey(LS_RECENTS, () => []), JSON.stringify([c, ...loadRecentClients().filter(r => r.id !== c.id)].slice(0, 6))); } catch {}
}

// ── Migration douce de l'ancien format (1 seul brouillon global) ──────────────
function migrateLegacyDraft() {
  try {
    const legacy = localStorage.getItem("wms_order_draft");
    if (!legacy) return;
    const d: Draft = JSON.parse(legacy);
    if (d?.client?.id && Object.keys(d.cart || {}).length > 0) {
      saveDraftForClient(d.client.id, d);
    }
    localStorage.removeItem("wms_order_draft");
  } catch {}
}

function uid() { return Math.random().toString(36).slice(2, 9); }
function fmtPrice(n: number) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n); }

// Type de gratuité proposé par défaut (valeur de la sélection `type_gratuit` sur
// sale.order.line côté Odoo). C'est le cas très majoritaire — on le présélectionne,
// le commercial reste libre d'en choisir un autre.
const DEFAULT_FREE_TYPE = "coffre_dc";

// Certaines offres Odoo utilisent un vrai produit comme titre de rubrique, dont le
// nom est encadré de tirets — ex. « ----- Éléments de PLV optionnels : ----- ».
// Ce n'est pas un article à vendre : prix nul, stock nul, et sa présence au panier
// déclenchait une fausse alerte de rupture qui bloquait le devis.
function isSeparatorProduct(product: any): boolean {
  return /^\s*[-–—]{3,}/.test(String(product?.name || ""));
}
function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

// descToText vit dans lib/text.ts — la description Odoo est du HTML, elle est
// aussi relue par AppointmentModal.

// Le calcul de prix vit dans lib/pricing.ts — réutilisé par le module périmés.

async function fetchPricelistItems(session: odoo.OdooSession, pricelistId: number): Promise<PriceItem[]> {
  // Pas de tri "sequence asc" : ce champ n'existe pas sur product.pricelist.item
  // dans cette instance Odoo et faisait échouer la requête (prix → catalogue).
  // Limite 0 = TOUTES les règles (avant : 500 → grille tronquée = prix faux).
  // Pas de filtre "active" non plus : ce champ n'existe pas sur product.pricelist.item
  // ici (« Invalid field ») — la requête échouait, et les prix retombaient au catalogue.
  // Les règles « X % de remise sur <autre liste> » reçoivent les règles de cette
  // liste de base (resolveBaseLists), sinon la remise partirait du prix catalogue.
  const readList = (id: number) => sync.readPricelistItems(session, [["pricelist_id", "=", id]]) as Promise<PriceItem[]>;
  try {
    return await resolveBaseLists(sortPriceItems(await readList(pricelistId)), readList);
  } catch {
    // Hors ligne → règles préchargées par « Télécharger les données ».
    // (Avant : ce cache existait mais n'était JAMAIS lu → prix catalogue hors ligne.)
    const readCached = (id: number) => sync.getCachedPricelistItems(id) as Promise<PriceItem[]>;
    return resolveBaseLists(sortPriceItems(await readCached(pricelistId)), readCached);
  }
}

function computeFreeItems(cart: Record<number, CartItem>, rules: FreeRule[]): FreeItem[] {
  const out: FreeItem[] = [];
  for (const rule of rules) {
    let total = 0;
    const matched: any[] = [];
    for (const item of Object.values(cart)) {
      if (item.note) continue;
      const ref = item.product.default_code || "";
      if (rule.allProducts || rule.productRefs.includes(ref)) { total += item.qty; matched.push(item.product); }
    }
    if (total >= rule.triggerQty && matched.length > 0) {
      const sets = Math.floor(total / rule.triggerQty);
      const top = matched.sort((a, b) => (cart[b.id]?.qty || 0) - (cart[a.id]?.qty || 0))[0];
      out.push({ product: top, qty: sets * rule.freeQty, ruleName: rule.name });
    }
  }
  return out;
}

// Résout l'id de l'étiquette Odoo "Validé DC" (crm.tag, utilisée sur sale.order.tag_ids)
// — mise en cache au niveau module pour ne la chercher qu'une fois par session.
let _validatedTagIdCache: number | null | undefined = undefined;
// Étiquette « Transmise » (crm.tag) : commande partie directement à la logistique.
let _transmiseTagIdCache: number | null | undefined = undefined;
async function getTransmiseTagId(session: odoo.OdooSession): Promise<number | null> {
  if (_transmiseTagIdCache !== undefined) return _transmiseTagIdCache;
  try {
    const tags = await odoo.searchRead(session, "crm.tag", [["name", "ilike", "transmis"]], ["id", "name"], 20);
    _transmiseTagIdCache = tags.find((t: any) => /^transmise?s?$/i.test(String(t.name || "").trim()))?.id ?? null;
  } catch { return null; }
  return _transmiseTagIdCache ?? null;
}

const EXPEDITION_FIELD = "x_studio_date_dexpdition_prvue";   // « Date d'expédition prévue »

async function getValidatedTagId(session: odoo.OdooSession): Promise<number | null> {
  if (_validatedTagIdCache !== undefined) return _validatedTagIdCache;
  try {
    const tags = await odoo.searchRead(session, "crm.tag", [["name", "ilike", "valid"]], ["id", "name"], 20);
    // Priorité au nom exact "Validé DC"; repli sur "Validé" puis 1er résultat.
    const norm = (s: string) => (s || "").trim().toLowerCase();
    const dc = tags.find((t: any) => norm(t.name) === "validé dc");
    const valide = tags.find((t: any) => norm(t.name) === "validé");
    _validatedTagIdCache = (dc || valide || tags[0])?.id ?? null;
  } catch {
    // Ne fige PAS le cache (ex. échec réseau hors ligne) : sinon plus aucune
    // commande ne serait étiquetée de toute la session, même en ligne.
    return null;
  }
  return _validatedTagIdCache ?? null;
}

// Programmes de remise Odoo (Ventes → Réductions & fidélité) — récupérés une fois par session app,
// ce sont des données globales (pas liées à un client précis).
let _loyaltyProgramsCache: loyalty.LoyaltyProgram[] | null = null;
async function getLoyaltyPrograms(session: odoo.OdooSession): Promise<loyalty.LoyaltyProgram[]> {
  if (_loyaltyProgramsCache !== null) return _loyaltyProgramsCache;
  try {
    const programs = await loyalty.fetchActiveLoyaltyPrograms(session);
    _loyaltyProgramsCache = programs;
    sync.cacheLoyaltyPrograms(programs).catch(() => {});
    return programs;
  } catch {
    // Hors ligne → programmes préchargés. On ne fige PAS le cache mémoire :
    // au prochain passage en ligne, la vraie liste sera rechargée.
    const cached = await sync.getCachedLoyaltyPrograms().catch(() => undefined);
    return (cached as loyalty.LoyaltyProgram[]) || [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Image produit : privilégie l'image préchargée en local (offline), sinon le
// proxy réseau. Rend le même <img> qu'avant, avec les styles passés en props.
// Photos désactivées (lib/features.ts) : rien n'est rendu ni chargé, le pictogramme
// ou l'initiale de gamme placés derrière restent visibles.
function ProductImage(props: { id: number; networkUrl: string; style: React.CSSProperties }) {
  return SHOW_PRODUCT_IMAGES ? <ProductImageInner {...props} /> : null;
}
function ProductImageInner({ id, networkUrl, style }: { id: number; networkUrl: string; style: React.CSSProperties }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cached = await sync.getCachedImage(id);
        if (alive) setSrc(cached || networkUrl);
      } catch {
        if (alive) setSrc(networkUrl);
      }
    })();
    return () => { alive = false; };
  }, [id, networkUrl]);
  if (!src) return null;
  return <img src={src} alt="" loading="lazy" className="img-fade" style={style} onLoad={e => e.currentTarget.classList.add("is-loaded")} onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />;
}

// ═══════════════════════════════════════════════════════════════════════════
// Hauteur réellement visible, exposée en CSS (--app-h) : window.innerHeight suit
// les barres de Safari (iPad) et la rotation, sans rétrécir quand le clavier
// s'ouvre (visualViewport, lui, rétrécirait tout l'écran) ; 100dvh en repli.
function useVisibleHeight() {
  useEffect(() => {
    const root = document.documentElement;
    const set = () => {
      const h = window.innerHeight;
      if (h > 0) root.style.setProperty("--app-h", `${Math.round(h)}px`);
    };
    set();
    window.addEventListener("resize", set);
    window.addEventListener("orientationchange", set);
    return () => {
      window.removeEventListener("resize", set);
      window.removeEventListener("orientationchange", set);
    };
  }, []);
}

export default function OrderScreen({ session, onBack, onToast, desktop }: Props) {
  setStorageUser(session.uid);
  useVisibleHeight();
  const [step, setStep] = useState<"home" | "client" | "hub" | "catalog" | "history" | "perime" | "assistant" | "bon" | "perimesReport">("client");
  // Sens de la transition d'écran : on glisse vers la gauche en avançant, vers
  // la droite en revenant (profondeur de l'écran dans le parcours).
  const stepDepth = (s: typeof step) => s === "client" ? 0 : s === "home" ? 1 : s === "hub" ? 2 : s === "perimesReport" ? 4 : 3;
  const prevStepRef = useRef(step);
  const stepDirRef = useRef<"fwd" | "back">("fwd");
  if (prevStepRef.current !== step) {
    stepDirRef.current = stepDepth(step) < stepDepth(prevStepRef.current) ? "back" : "fwd";
    prevStepRef.current = step;
  }
  const [client, setClient] = useState<any>(null);
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]); // items pricelist du client
  const [cart, setCart] = useState<Record<number, CartItem>>({});
  const [rules, setRules] = useState<FreeRule[]>([]);
  const [freeItems, setFreeItems] = useState<FreeItem[]>([]);
  const [showRules, setShowRules] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPrep, setShowPrep] = useState(false);   // préparation de RDV du client
  const [submitStep, setSubmitStep] = useState<SubmitStep>("prep");   // étape affichée pendant la création
  const [done, setDone] = useState<{ mainId: number | null; freeId: number | null; mainName?: string; freeName?: string; offline?: boolean; ruptures?: number } | null>(null);
  const [note, setNote] = useState("");
  // Brouillon détecté pour le client qu'on vient de sélectionner (jamais un autre client — pas de fuite visuelle)
  const [resumePrompt, setResumePrompt] = useState<Draft | null>(null);
  // Liste de tous les brouillons en attente (tous clients confondus) — accès discret, jamais affiché tout seul
  const [pendingDrafts, setPendingDrafts] = useState<{ clientId: string; draft: Draft }[]>([]);
  const [showDraftsPanel, setShowDraftsPanel] = useState(false);
  const [showAppointment, setShowAppointment] = useState(false);
  const [showClientNote, setShowClientNote] = useState(false);
  const [noteAutoRec, setNoteAutoRec] = useState(false);   // ouvert par le bouton REC
  // Remises additionnelles Odoo (Ventes → Réductions & fidélité)
  const [loyaltyPrograms, setLoyaltyPrograms] = useState<loyalty.LoyaltyProgram[]>([]);
  const [appliedPromos, setAppliedPromos] = useState<Record<number, loyalty.AppliedPromo>>({});
  const [showPromoPanel, setShowPromoPanel] = useState(false);
  // Gratuités : lignes offertes (produit à 0€ + type_gratuit) + liste des types.
  const [giftItems, setGiftItems] = useState<GiftItem[]>([]);
  const [freeTypes, setFreeTypes] = useState<sync.FreeType[]>([]);
  // Remise événement Co (10 % ou 15 % uniquement) appliquée sur TOUT le panier (0 = aucune).
  const [eventDiscount, setEventDiscount] = useState(0);
  // Remise par devis d'implantation ajouté (clé = nom du modèle = groupe du panier).
  const [groupDiscounts, setGroupDiscounts] = useState<Record<string, number>>({});
  // « Type de commande » et « Offres commandées » saisis dans l'app (champs Odoo).
  const [orderType, setOrderType] = useState<string | number | "">("");
  const [offerIds, setOfferIds] = useState<number[]>([]);
  // Offres des articles du panier (champ « Offre produit » de l'article) :
  // ajoutées d'office aux « Offres commandées ».
  const autoOffers = useMemo(() => {
    const m = new Map<number, string>();
    for (const it of [...Object.values(cart), ...giftItems]) {
      const o = (it as any).product?.x_offre_produit_id;
      if (Array.isArray(o) && o[0] && (("qty" in it) ? (it as any).qty > 0 : true)) m.set(o[0], o[1]);
    }
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [cart, giftItems]);
  // Infos des modèles ajoutés (MEA / implantation) : note interne de campagne, date d'expédition.
  const [templateInfo, setTemplateInfo] = useState<Record<string, { note?: string; shipDate?: string; code?: string }>>({});
  const refreshPendingDrafts = useCallback(() => setPendingDrafts(listDrafts()), []);

  // D'où vient-on quand on ouvre une fiche client : recherche ou planning.
  // Sert au bouton retour pour revenir au bon écran.
  const [clientOrigin, setClientOrigin] = useState<"search" | "planning">("search");

  // 1 seul appel pricelist par client, réutilisé plus tard par la prise de commande.
  const loadClientPricelist = useCallback((c: any) => {
    const plId = c.property_product_pricelist?.[0];
    if (plId) fetchPricelistItems(session, plId).then(setPriceItems).catch(() => setPriceItems([]));
    else setPriceItems([]);
  }, [session]);

  // Sélectionne un client (depuis la recherche ou depuis un RDV du planning) et ouvre sa fiche.
  const selectClient = useCallback((c: any, origin: "search" | "planning" = "search") => {
    pushRecentClient(c);
    setClient(c);
    setClientOrigin(origin);
    setStep("hub");
    loadClientPricelist(c);
  }, [loadClientPricelist]);

  // Depuis l'accueil (RDV du jour) : ouvre la fiche du client, ou directement son catalogue.
  const openPartner = async (partnerId: number, order: boolean) => {
    let c: any = null;
    try { c = (await odoo.searchRead(session, "res.partner", [["id", "=", partnerId]], CLIENT_FIELDS, 1))[0]; }
    catch { c = loadRecentClients().find(r => r.id === partnerId) || null; }
    if (!c) { onToast("Fiche client indisponible (hors ligne ?) — passe par la recherche", "error"); return; }
    selectClient(c);
    if (order) beginOrder(c);
  };

  // Modifier une commande portail non validée : ses lignes sont chargées dans le
  // panier (quantités, prix et remise d'origine conservés), on modifie / retire /
  // ajoute, puis la validation RÉÉCRIT la commande (voir handleValidate).
  // validate : commande portail → étiquette Validé DC à l'enregistrement ;
  // commande ouverte depuis un message → simple modification, sans étiquette.
  const startPortalEdit = async (o: any, validate = true) => {
    const pid = Array.isArray(o.partner_id) ? o.partner_id[0] : 0;
    try {
      const lines: any[] = await odoo.searchRead(session, "sale.order.line", [["order_id", "=", o.id], ["display_type", "=", false], ["product_id", "!=", false]],
        ["id", "product_id", "product_uom_qty", "price_unit", "discount", "sequence"], 0, "sequence, id");
      const keep = lines.filter(l => !/frais\s+de\s+port|livraison/i.test(String(l.product_id[1])));
      const pids = Array.from(new Set(keep.map(l => l.product_id[0])));
      const prods: any[] = pids.length ? await odoo.searchRead(session, "product.product", [["id", "in", pids]],
        ["id", "name", "default_code", "barcode", "lst_price", "product_tmpl_id", "virtual_available", ...await optionalProductFields(session)], 0) : [];
      const pmap = new Map<number, any>(prods.map(p => [p.id, p]));
      await openPartner(pid, true);
      setEditOrder({ id: o.id, name: o.name, partnerId: pid, state: o.state, lines: keep.map(l => ({ id: l.id, productId: l.product_id[0] })), validate });
      const cartFromOrder: Record<number, CartItem> = {};
      keep.forEach((l, i) => {
        const product = pmap.get(l.product_id[0]); if (!product) return;
        const cur = cartFromOrder[product.id];
        const disc = Number(l.discount) || 0, pu = Number(l.price_unit) || 0;
        if (cur) { cur.qty += Number(l.product_uom_qty) || 0; return; }   // même article sur 2 lignes : regroupé
        cartFromOrder[product.id] = { product, qty: Number(l.product_uom_qty) || 0, unitPrice: Math.round(pu * (1 - disc / 100) * 100) / 100,
          priceLocked: true, bonBrut: pu, bonRemise: disc || undefined, seq: i + 1 };
      });
      setCart(cartFromOrder);
      onToast(`${o.name} chargée : modifie, retire ou ajoute des articles, puis valide`, "info");
    } catch (e: any) {
      onToast(odoo.isNetworkError(e) ? "Hors ligne : commande portail indisponible" : `Lecture impossible : ${e?.message || e}`, "error");
    }
  };

  // Import d'un bon : depuis la fiche client (client connu) ou depuis l'accueil /
  // la recherche client (client retrouvé d'après le bon, puis confirmé).
  const [bonOrigin, setBonOrigin] = useState<"hub" | "home" | "client">("hub");
  // Étiquettes client « Bloqué compta » / « Redressement judiciaire » : commande
  // saisissable mais à valider par le service client (bandeau + pas d'étiquette
  // « Validé » sur le devis).
  const [blockingTags, setBlockingTags] = useState<BlockingTag[]>([]);
  useEffect(() => { loadBlockingTags(session).then(setBlockingTags).catch(() => {}); }, [session]);
  const clientBlocks = client ? clientBlockingTags(client, blockingTags) : [];
  const clientBlocked = clientBlocks.length > 0;

  // Commande transmise directement à la logistique (délégués en test) : étiquette
  // « Transmise » + date d'expédition prévue. Jamais pour un client bloqué.
  const [closedDayTags, setClosedDayTags] = useState<ClosedDayTag[]>([]);
  useEffect(() => { loadClosedDayTags(session).then(setClosedDayTags).catch(() => {}); }, [session]);
  const directLogistics = isDirectLogistics(session) && !clientBlocked;
  // Devis du client saisis mais pas encore confirmés (non transmis à la logistique),
  // hors reprises de périmés : le commercial peut les joindre à sa commande.
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [bigOrder, setBigOrder] = useState<any | null>(null);
  // Commande portail à compléter : les articles du panier sont AJOUTÉS à cette
  // commande (au lieu d'en créer une), puis elle reçoit l'étiquette « Validé DC ».
  const [editOrder, setEditOrder] = useState<{ id: number; name: string; partnerId: number; state?: string; lines?: { id: number; productId: number }[]; validate?: boolean } | null>(null);   // commande en attente ouverte en grand
  const [joinIds, setJoinIds] = useState<number[]>([]);
  const [showPending, setShowPending] = useState(false);
  // Contenu d'une commande en attente, déplié dans la liste (sans passer par Odoo).
  const [openPending, setOpenPending] = useState<number | null>(null);
  const [pendingLines, setPendingLines] = useState<Record<number, any[] | "loading" | "error">>({});
  const togglePendingLines = async (id: number) => {
    if (openPending === id) { setOpenPending(null); return; }
    setOpenPending(id);
    if (pendingLines[id] && pendingLines[id] !== "error") return;
    setPendingLines(m => ({ ...m, [id]: "loading" }));
    try {
      const rows = await odoo.searchRead(session, "sale.order.line",
        [["order_id", "=", id]], ["id", "name", "product_id", "product_uom_qty", "price_subtotal", "display_type"], 0, "sequence, id");
      setPendingLines(m => ({ ...m, [id]: rows }));
    } catch { setPendingLines(m => ({ ...m, [id]: "error" })); }
  };
  useEffect(() => {
    setPendingOrders([]); setJoinIds([]); setShowPending(false); setOpenPending(null); setPendingLines({});
    if (!client || step !== "catalog") return;
    let cancelled = false;
    (async () => {
      try {
        const family = await resolveClientFamily(session, client).catch(() => [client.id]);
        const rows = await odoo.searchRead(session, "sale.order",
          [["partner_id", "child_of", family], ["state", "in", ["draft", "sent"]],
           "|", ["client_order_ref", "=", false], ["client_order_ref", "not like", "PERIM-"]],
          ["id", "name", "date_order", "amount_total", "user_id", "state"], 30, "date_order desc");
        if (!cancelled) setPendingOrders(rows);
      } catch { /* hors ligne : pas d'info, pas de pastille */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, step === "catalog", session]);

  // Date d'expédition modifiée par le délégué (null = calculée). Remise à zéro
  // quand on change de client.
  const [wantedExpedition, setWantedExpedition] = useState<Date | null>(null);
  // Nouveau client : date d'expédition remise à zéro — sauf reprise d'un brouillon
  // (la date enregistrée est rendue).
  useEffect(() => {
    const r = restoreExpRef.current;
    setWantedExpedition(r && r.clientId === client?.id ? r.date : null);
    restoreExpRef.current = null;
  }, [client?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Date d'expédition des offres du panier (la plus tardive) : sert de date par défaut.
  const offerShipDate = (() => {
    const groups = new Set(Object.values(cart).map(i => i.group).filter(Boolean) as string[]);
    const dates = Object.entries(templateInfo).filter(([g, t]) => groups.has(g) && t.shipDate).map(([, t]) => String(t.shipDate).slice(0, 10)).sort();
    return dates.length ? new Date(`${dates[dates.length - 1]}T12:00:00`) : null;
  })();
  // Date d'expédition voulue : jamais avant la date de début d'expédition des MEA du panier.
  const effectiveExpedition = wantedExpedition && offerShipDate ? (wantedExpedition < offerShipDate ? offerShipDate : wantedExpedition) : (wantedExpedition ?? offerShipDate);
  const shippingPlan = client ? planShipping(new Date(), clientClosedWeekdays(client, closedDayTags), effectiveExpedition) : null;
  const blockLabel = clientBlocks.map(t => t.name).join(" · ");

  // Écran d'où l'on a ouvert le rapport Périmés, pour y revenir.
  const [reportOrigin, setReportOrigin] = useState<"client" | "perime">("client");
  // Semaine à ouvrir dans le planning quand on vient de l'agenda de l'accueil.
  const [planningDate, setPlanningDate] = useState<Date | null>(null);
  const [showDash, setShowDash] = useState(false);   // tableau de bord du commercial
  // Bouton « Accueil » (components/HomeButton) de n'importe quel écran : ferme les
  // écrans ouverts par-dessus et revient à l'accueil, sans client (comme le ✕ du
  // badge client ; le panier en cours reste dans les brouillons).
  const goHomeRef = useRef<() => void>(() => {});
  goHomeRef.current = () => {
    setShowDash(false); setShowPrep(false); setShowAppointment(false); setShowClientNote(false);
    setShowDraftsPanel(false); setShowPromoPanel(false); setShowPending(false);
    setDone(null); setNote(""); setResumePrompt(null);
    setClient(null); setCart({}); setAppliedPromos({}); setStep("client");
  };
  useEffect(() => {
    const on = () => goHomeRef.current();
    window.addEventListener(HOME_EVENT, on);
    return () => window.removeEventListener(HOME_EVENT, on);
  }, []);
  // Fichier à analyser : choisi via un bouton « Importer », ou ouvert dans l'app
  // depuis Mail (partager → Commande).
  const [incomingFile, setIncomingFile] = useState<File | null>(null);
  const openImportBon = (origin: "hub" | "home" | "client") => {
    setBonOrigin(origin);
    setIncomingFile(null);
    if (origin !== "hub") {
      setClient(null); setCart({}); setAppliedPromos({}); setPriceItems([]);
      setClientOrigin(origin === "home" ? "planning" : "search");
    }
    setStep("bon");
  };
  // Les boutons « Importer » ouvrent directement le sélecteur de fichier : l'écran
  // d'import n'apparaît qu'une fois le fichier choisi, analyse déjà lancée.
  const bonFileInput = useRef<HTMLInputElement>(null);
  const bonPickOrigin = useRef<"hub" | "home" | "client">("hub");
  const pickBonFile = (origin: "hub" | "home" | "client") => {
    bonPickOrigin.current = origin;
    bonFileInput.current?.click();
  };
  const onBonFilePicked = (f: File) => {
    openImportBon(bonPickOrigin.current);
    setIncomingFile(f);
  };
  useEffect(() => onIncomingFile(f => {
    openImportBon("home");
    setIncomingFile(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const selectClientForImport = useCallback((c: any) => {
    setClient(c);
    loadClientPricelist(c);
  }, [loadClientPricelist]);

  // Chargement initial : règles + migration de l'ancien format de brouillon unique + remises Odoo
  useEffect(() => {
    setRules(loadRules());
    migrateLegacyDraft();
    refreshPendingDrafts();
    getLoyaltyPrograms(session).then(setLoyaltyPrograms).catch(() => {});
    sync.loadFreeTypes(session).then(setFreeTypes).catch(() => {});
  }, [session, refreshPendingDrafts]);

  // Programmes dont les conditions sont actuellement remplies par le panier
  // Promo liée à une MEA (nom « 7xxxxxx … ») : en plus des règles Odoo, l'article
  // MEA de ce code doit être dans la commande (panier ou gratuités) avec qté > 0.
  const meaCodePresent = (code: string) =>
    Object.values(cart).some(i => !i.note && i.qty > 0 && String(i.product?.default_code || "").trim() === code)
    || giftItems.some(g => g.qty > 0 && String(g.product?.default_code || "").trim() === code);
  const clientPricelistId = client?.property_product_pricelist?.[0] ?? null;
  const triggeredPromos = loyaltyPrograms.filter(p => loyalty.isProgramTriggered(p, promoCart(cart), clientPricelistId)
    && (!p.meaCode || meaCodePresent(p.meaCode)));
  const availablePromoCount = triggeredPromos.filter(p => !appliedPromos[p.id]).length;

  const applyPromo = async (program: loyalty.LoyaltyProgram) => {
    // Récompense « produit offert » prioritaire (ex. coffret de Noël) si le programme en a une.
    const reward = program.rewards.find(r => r.reward_type === "product" && r.reward_product_id) || program.rewards[0];
    if (!reward) return;
    if (reward.reward_type === "product" && reward.reward_product_id) {
      const prod = await loyalty.fetchProductBasics(session, reward.reward_product_id);
      setAppliedPromos(prev => ({ ...prev, [program.id]: { type: "product", program, reward, productName: prod?.name || "Produit offert" } }));
    } else if (reward.reward_type === "discount") {
      setAppliedPromos(prev => ({ ...prev, [program.id]: { type: "discount", program, reward } }));
    } else {
      onToast("Type de récompense non géré par l'app (livraison gratuite ?)", "info");
      return;
    }
    onToast(`Remise « ${program.name} » appliquée`, "success");
  };
  // Mémoire des remises retirées manuellement (l'auto-application ne les remet pas).
  const manuallyRemovedRef = useRef<Set<number>>(new Set());
  const removePromo = (programId: number) => {
    manuallyRemovedRef.current.add(programId);
    setAppliedPromos(prev => { const n = { ...prev }; delete n[programId]; return n; });
  };

  // ── Application AUTOMATIQUE des remises ───────────────────────────────────
  // Dès que le panier remplit les conditions d'un programme, la remise est
  // appliquée sans clic. Si le panier ne remplit plus les conditions, elle est
  // retirée automatiquement (sauf si l'utilisateur l'a retirée manuellement).
  useEffect(() => {
    const triggeredIds = new Set(triggeredPromos.map(p => p.id));

    // 1) Retirer les remises dont les conditions ne sont plus remplies.
    setAppliedPromos(prev => {
      let changed = false;
      const next = { ...prev };
      for (const idStr of Object.keys(prev)) {
        const id = Number(idStr);
        if (!triggeredIds.has(id)) { delete next[id]; changed = true; }
      }
      return changed ? next : prev;
    });

    // 2) Appliquer automatiquement les remises déclenchées et pas encore appliquées
    //    (et non retirées manuellement par l'utilisateur).
    for (const program of triggeredPromos) {
      if (appliedPromos[program.id]) continue;
      if (manuallyRemovedRef.current.has(program.id)) continue;
      void applyPromo(program);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, giftItems]);

  // ── Éligibilité des MEA ───────────────────────────────────────────────────
  // Gratuités d'une MEA (code 7, PLV, testeurs, produits offerts du modèle) :
  // envoyées seulement si la promo liée est éligible selon ses règles Odoo et
  // que l'article MEA (code 7) est présent avec une quantité > 0.
  useEffect(() => {
    const pc = promoCart(cart);
    const ok = (g: GiftItem) => {
      const m = g.cond?.mea;
      if (!m) return true;
      const prog = m.programId ? loyaltyPrograms.find(p => p.id === m.programId) : undefined;
      if (m.programId && !prog) return false;               // promo introuvable (archivée, hors période)
      if (prog && !loyalty.isProgramTriggered(prog, pc, clientPricelistId)) return false;
      return !m.code || meaCodePresent(m.code);
    };
    if (giftItems.some(g => g.cond?.mea && !!g.off !== !ok(g)))
      setGiftItems(prev => prev.map(g => g.cond?.mea ? { ...g, off: !ok(g) } : g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, giftItems, loyaltyPrograms]);

  // Depuis le hub client → "Prise de commande" : repart d'un panier vide, détecte un brouillon
  // existant pour CE client précisément, puis entre dans le catalogue.
  // (La pricelist est déjà chargée par selectClient — pas de 2ᵉ appel redondant.)
  const enterOrderMode = () => { if (client) beginOrder(client); };
  const [pendingQuote, setPendingQuote] = useState<{ templateId: number; qtys: Record<number, number> } | null>(null);
  const beginOrder = (client: any) => {
    restoreExpRef.current = null;
    setImportMeta(null);
    setCart({});
    setNote("");
    setAppliedPromos({});
    setGiftItems([]);
    setEventDiscount(0);
    setGroupDiscounts({});
    setOrderType("");
    setOfferIds([]);
    setTemplateInfo({});
    manuallyRemovedRef.current.clear(); // nouvelle commande → réinitialise les retraits manuels
    setResumePrompt(loadDraftForClient(client.id));
    setStep("catalog");
  };

  // Depuis l'import d'un bon de commande : même point de départ qu'une nouvelle
  // commande, mais panier pré-rempli avec les lignes vérifiées par le commercial.
  // Commande chargée : lignes dans l'ordre du bon (notes « À SAISIR » / rupture
  // comprises), unités gratuites (UG) en gratuités « Geste Co. - hors Coffre ».
  const [importMeta, setImportMeta] = useState<ImportMeta | null>(null);
  const enterOrderModeWithLines = (res: ImportResult) => {
    if (!client) return;
    enterOrderMode();
    setResumePrompt(null); // le bon importé remplace un éventuel brouillon
    const next: Record<number, CartItem> = {};
    let noteId = -1;
    res.lines.forEach((l, i) => {
      const seq = i + 1;
      if ("note" in l) { next[noteId] = { product: { id: noteId, name: l.note }, qty: 0, unitPrice: 0, seq, note: "line_note", highlight: l.highlight }; noteId--; return; }
      const prev = next[l.product.id];
      next[l.product.id] = prev
        ? { ...prev, qty: prev.qty + l.qty }
        : { product: l.product, qty: l.qty, unitPrice: l.unitPrice, seq, lineName: l.lineName, highlight: l.highlight };
    });
    setCart(next);
    const giftType = freeTypes.find(t => t.value === "geste_co_hors_quota")?.value
      || freeTypes.find(t => fold(t.label) === fold("Geste Co. - hors Coffre"))?.value || "geste_co_hors_quota";
    setGiftItems(res.gifts.map(g => ({ product: g.product, qty: g.qty, type: giftType, highlight: "green", fullDiscountPrice: g.unitPrice, afterProductId: g.product.id })));
    setNote(res.note);
    setImportMeta(res.meta);
  };

  // Sauvegarde auto du brouillon du client courant dès que le panier ou la note change —
  // stocké par client, ne touche jamais aux brouillons des autres clients.
  // Jamais pendant l'envoi ni après « Devis créé ! » : le brouillon vient d'être
  // supprimé, et la remise à zéro des promos relançait cette sauvegarde.
  useEffect(() => {
    if (submitting || done) return;
    if (client && Object.keys(cart).length > 0) {
      saveDraftForClient(client.id, {
        client, cart, note, savedAt: Date.now(), templateInfo, offerIds, giftItems, eventDiscount, groupDiscounts,
        orderType, wantedExpedition: wantedExpedition ? wantedExpedition.toISOString() : null,
        removedPromoIds: Array.from(manuallyRemovedRef.current), editOrder, importMeta,
      });
      refreshPendingDrafts();
    }
  }, [cart, client, note, templateInfo, offerIds, giftItems, eventDiscount, groupDiscounts, orderType, wantedExpedition, appliedPromos, editOrder, importMeta, refreshPendingDrafts, submitting, done]);

  // Remet TOUT l'état de la commande depuis un brouillon (reprise).
  const restoreExpRef = useRef<{ clientId: number; date: Date | null } | null>(null);
  const applyDraftState = (d: Draft) => {
    setCart(d.cart);
    setTemplateInfo(d.templateInfo || {}); setOfferIds(d.offerIds || []);
    setGiftItems(d.giftItems || []); setEventDiscount([10, 15].includes(d.eventDiscount || 0) ? d.eventDiscount! : 0); setGroupDiscounts(d.groupDiscounts || {});
    setOrderType(d.orderType ?? "");
    const exp = d.wantedExpedition ? new Date(d.wantedExpedition) : null;
    const date = exp && !isNaN(exp.getTime()) ? exp : null;
    restoreExpRef.current = { clientId: d.client?.id, date };
    setWantedExpedition(date);
    manuallyRemovedRef.current = new Set(d.removedPromoIds || []);
    setEditOrder(d.editOrder || null);
    setImportMeta(d.importMeta || null);
    setNote(d.note || "");
  };

  useEffect(() => { setFreeItems(HOMEMADE_RULES_ENABLED ? computeFreeItems(cart, rules) : []); }, [cart, rules]);

  const cartCount = Object.values(cart).reduce((s, i) => s + i.qty, 0);
  const cartTotal = Object.values(cart).reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const freeCount = freeItems.reduce((s, i) => s + i.qty, 0);

  // keepZero : ligne de MEA / devis d'implantation à 0 dans le modèle — gardée au
  // panier à 0 pour que le délégué choisisse la quantité (non envoyée à Odoo).
  // Place (rubrique + rang) des lignes retirées du panier : un article retiré puis
  // remis reprend sa place dans son devis d'implantation / sa MEA (« Best seller »…).
  const removedSlots = useRef<Record<number, { seq?: number; group?: string }>>({});
  // regroup : la ligne passe dans ce groupe (une MEA ajoutée par-dessus un devis
  // d'implantation reprend les articles communs → remises de l'offre applicables).
  // extra : champs de ligne en plus (freeType, seq imposée — ex. article MEA code 7 en tête de la MEA).
  const setQty = (product: any, wanted: number, unitPrice?: number, group?: string, keepZero?: boolean, regroup?: boolean, extra?: Partial<CartItem>) => {
    setCart(prev => {
      const cur = prev[product.id];
      // Quantité minimum (« par 2 ») : toujours un multiple du pas de vente.
      const qty = snapQty(product, wanted, cur?.qty || 0);
      if (qty < 0 || (qty === 0 && !keepZero)) {
        if (cur && !cur.note && cur.group) removedSlots.current[product.id] = { seq: cur.seq, group: cur.group };
        const n = { ...prev }; delete n[product.id]; return n;
      }
      const nextSeq = () => Math.max(0, ...Object.values(prev).map(i => i.seq || 0)) + 1;
      if (cur && regroup && group && cur.group !== group) {
        return { ...prev, [product.id]: { ...cur, qty, unitPrice: cur.priceLocked ? cur.unitPrice : unitPrice ?? cur.unitPrice, group, seq: nextSeq() } };
      }
      if (cur?.priceLocked) return { ...prev, [product.id]: { ...cur, qty } };
      const price = unitPrice ?? cur?.unitPrice ?? product.lst_price ?? 0;
      // Une ligne déjà au panier garde sa place et sa MEA d'origine ; une ligne
      // retirée puis remise retrouve la sienne si son groupe est toujours là.
      const slot = !cur && !group ? removedSlots.current[product.id] : undefined;
      const back = slot && Object.values(prev).some(i => i.group === slot.group) ? slot : undefined;
      if (!cur) delete removedSlots.current[product.id];
      const seq = cur?.seq ?? back?.seq ?? nextSeq();
      return { ...prev, [product.id]: { ...(cur?.freeType ? { freeType: cur.freeType } : {}), product, qty, unitPrice: price, seq, group: cur ? cur.group : group ?? back?.group, ...(extra || {}) } };
    });
  };

  // Ligne de commentaire (ou titre de section) : id négatif, placée à la suite du panier.
  const addNote = (text: string, kind: "line_note" | "line_section" = "line_note", group?: string) => {
    setCart(prev => {
      const id = Math.min(0, ...Object.keys(prev).map(Number)) - 1;
      const seq = Math.max(0, ...Object.values(prev).map(i => i.seq || 0)) + 1;
      return { ...prev, [id]: { product: { id, name: text }, qty: 0, unitPrice: 0, seq, group, note: kind } };
    });
  };
  const setNoteText = (id: number, text: string) => {
    setCart(prev => prev[id] ? { ...prev, [id]: { ...prev[id], product: { ...prev[id].product, name: text } } } : prev);
  };

  // Reprendre le brouillon proposé pour le client qu'on vient de sélectionner
  const acceptResumePrompt = () => {
    if (!resumePrompt) return;
    applyDraftState(resumePrompt);
    setResumePrompt(null);
    onToast("Brouillon restauré", "success");
  };
  // Repartir de zéro pour ce client — supprime son brouillon en attente
  const discardResumePrompt = () => {
    if (resumePrompt?.client?.id) removeDraftForClient(resumePrompt.client.id);
    setResumePrompt(null);
    refreshPendingDrafts();
  };

  // Reprendre un brouillon depuis le panneau global (n'importe quel client)
  const resumeDraftFromPanel = (d: Draft) => {
    setClient(d.client);
    applyDraftState(d);
    setResumePrompt(null);
    setAppliedPromos({});
    setShowDraftsPanel(false);
    setStep("catalog");
    const plId = d.client?.property_product_pricelist?.[0];
    if (plId) fetchPricelistItems(session, plId).then(setPriceItems).catch(() => setPriceItems([]));
    else setPriceItems([]);
    onToast("Brouillon restauré", "success");
  };
  const deleteDraftFromPanel = (clientId: string) => {
    removeDraftForClient(Number(clientId));
    refreshPendingDrafts();
  };

  const handleValidate = async () => {
    setSubmitStep("prep");
    setSubmitting(true);
    try {
      // Client bloqué (compta, redressement) : PAS d'étiquette « Validé » — c'est le service
      // client qui validera ; la note du devis le signale en tête.
      const validatedTagId = clientBlocked ? null : await getValidatedTagId(session);
      if (validatedTagId === null && !clientBlocked) {
        onToast("Étiquette « Validé » introuvable dans Odoo — commande créée sans étiquette", "info");
      }
      const transmiseId = directLogistics ? await getTransmiseTagId(session) : null;
      if (directLogistics && transmiseId === null) {
        onToast("Étiquette « Transmise » introuvable dans Odoo — commande non marquée transmise", "info");
      }
      const tagIds = [validatedTagId, transmiseId].filter((x): x is number => x !== null);
      const tagVals = tagIds.length ? { tag_ids: [[6, 0, tagIds]] } : {};
      // Date calculée AU MOMENT de la validation (l'heure compte : coupure 14 h 30).
      const plan = planShipping(new Date(), clientClosedWeekdays(client, closedDayTags), effectiveExpedition);
      // Délégué « direct logistique » : date calculée ; sinon, date de début
      // d'expédition des MEA — ou la première date possible si elle est passée.
      const shipVals = directLogistics || offerShipDate ? { [EXPEDITION_FIELD]: toOdooDate(plan.expedition) } : {};
      let orderNote = clientBlocked
        ? `CLIENT ${blockLabel.toUpperCase()} — commande à valider par le service client.${note ? `\n${note}` : ""}`
        : (note || "");
      // Commandes en attente que le commercial a choisi de joindre à celle-ci :
      // champ « Commandes jointes » s'il existe, et toujours citées dans la note.
      const joined = pendingOrders.filter(o => joinIds.includes(o.id));
      let joinVals: any = {};
      if (joined.length) {
        orderNote = `${orderNote}${orderNote ? "\n" : ""}Commandes jointes : ${joined.map(o => o.name).join(", ")}`;
        const m = await orderMeta(session).catch(() => null);
        // Champ texte (x_commandes_jointes) : numéros des commandes ; many2many : ids.
        if (m?.joinedField) joinVals = { [m.joinedField]: m.joinedKind === "text" ? joined.map(o => o.name).join(", ") : [[6, 0, joined.map(o => o.id)]] };
      }

      // Commande chargée depuis un bon (« Charger la commande ») : champs du module
      // Odoo d'import s'ils existent sur la base (n° de commande client, source
      // « Email - BDC Client », Lu par Claude, BDC Offline, couleur des lignes).
      const imp = importMeta ? await importFields(session).catch(() => null) : null;
      const importVals: any = {};
      if (importMeta && imp) {
        if (importMeta.clientRef && imp.order.has("client_order_ref")) importVals.client_order_ref = importMeta.clientRef;
        if (imp.sourceId) importVals.source_id = imp.sourceId;
        if (importMeta.readByClaude && imp.order.has("read_by_claude")) importVals.read_by_claude = true;
        if (importMeta.bdcOffline && imp.order.has("bdc_offline")) importVals.bdc_offline = true;
      }

      // Type de commande / Offres commandées : champs repérés dans Odoo (orderMeta).
      const metaVals: any = {};
      const m = await orderMeta(session).catch(() => null);
      if (m?.typeField && orderType !== "") metaVals[m.typeField] = orderType;
      // Code offre des MEA du panier (ex. SERUM26) → champ « Note interne » de la commande.
      const offerCodes = Array.from(new Set(Object.entries(templateInfo)
        .filter(([g, t]) => t.code && Object.values(cart).some(i => i.group === g)).map(([, t]) => String(t.code))));
      if (offerCodes.length && m?.internalNoteField) metaVals[m.internalNoteField] = offerCodes.join(", ");
      const allOfferIds = Array.from(new Set([...offerIds, ...autoOffers.map(o => o.id)]));
      if (m?.offersField && allOfferIds.length) metaVals[m.offersField] = [[6, 0, allOfferIds]];
      // Note INTERNE (jamais imprimée sur le devis) : ruptures à vérifier par le
      // service client + notes de suivi des campagnes ajoutées (ex. SERUM26).
      const ruptures = [
        ...cartRuptures(cart),
        // Gratuités en rupture (signalées comme un article payant).
        ...giftItems.filter(g => giftActive(g, cart) && g.qty > 0 && giftShortage(g, cart) > 0)
          .map(g => ({ name: String(g.product.name || ""), code: g.product.default_code || undefined, qty: g.qty, stock: g.qty - giftShortage(g, cart) })),
      ];
      const groupsInCart = new Set(Object.values(cart).map(i => i.group).filter(Boolean) as string[]);
      const internalLines = [
        ...(ruptures.length ? [`RUPTURES (quantité totale saisie sur le devis, stock insuffisant) : ${ruptures.map(r => `${r.code || r.name} (${r.qty} dem. / ${r.stock} en stock)`).join(", ")}`] : []),
        ...Object.entries(templateInfo).filter(([g, t]) => groupsInCart.has(g) && t.note).map(([, t]) => String(t.note)),
      ];
      const internalNote = internalLines.join("\n");
      // Champ « Note interne » du devis laissé vide pour l'instant (un champ Studio
      // dédié viendra) : ces lignes vont en note interne dans le chatter.

      // Franco : sous 250 € HT net → 10 € HT de frais de livraison.
      const netHt = cartNet(cart, loyalty.computeLineDiscounts(appliedPromos, promoCart(cart)), eventDiscount, groupDiscounts);
      // Commande portail modifiée : ses frais de port d'origine restent, pas de second forfait.
      const feeProduct = needsShippingFee(netHt) && !(editOrder && editOrder.partnerId === client.id) ? await shippingProduct(session) : null;
      if (needsShippingFee(netHt) && !feeProduct) {
        onToast("Article [982040] « Frais de port - Transporteurs » introuvable dans Odoo — frais de livraison à ajouter à la main", "error");
      }

      const pricelistId = client.property_product_pricelist?.[0] || false;

      // Remises additionnelles Odoo appliquées manuellement (bouton 🏷️) : % par produit du panier
      const lineDiscounts = loyalty.computeLineDiscounts(appliedPromos, promoCart(cart));
      // Produits offerts par une remise "Achetez X" (distincts des règles maison du panneau ⚙️)
      const promoFreeLines = Object.values(appliedPromos).filter((p): p is loyalty.AppliedFreePromo => p.type === "product");

      // Commande + toutes ses lignes créées en UN SEUL appel Odoo (commandes one2many [0,0,{...}])
      // au lieu d'un appel par ligne — c'est ça qui rendait les gros devis lents.
      // Une ligne du panier → une ligne de devis, quantité totale (même en rupture).
      const cartLineCmds = (item: CartItem): any[] => {
            const hl = item.highlight && imp?.line.has("ocr_highlight") ? { ocr_highlight: item.highlight } : {};
            if (item.note) return [[0, 0, { display_type: item.note, name: String(item.product.name).trim(), ...hl }]];
            // Remise ligne = promo Odoo + remise événement Co + remise du devis
            // d'implantation (cumul, plafonné à 100%).
            const promoDisc = Math.min(100, (lineDiscounts[item.product.id] || 0) + (isImplantLine(item) ? 0 : eventDiscount || 0)
              + (item.group ? groupDiscounts[item.group] || 0 : 0));
            // Promo Odoo : remise additionnée à celle du tarif client (cf. linePricing) →
            // la ligne part au prix catalogue avec la remise totale.
            const lp = linePricing(item, addPctOf(item, lineDiscounts, eventDiscount), otherPctOf(item, groupDiscounts));
            // Prix d'un bon importé avec remise : brut + % comme le logiciel du client.
            // Envoyé en net, Odoo l'arrondit à 2 décimales (22,8997 → 22,90) et le
            // total dérive de quelques centimes (549,60 au lieu de 549,59).
            const asBon = item.priceLocked && item.bonBrut != null && !!item.bonRemise;
            const price = asBon ? item.bonBrut! : lp.additive ? lp.brut : item.unitPrice;
            const disc = asBon
              ? Math.round(10000 * (1 - (1 - item.bonRemise! / 100) * (1 - promoDisc / 100))) / 100
              : Math.round(lp.discount * 100) / 100;
            // Rupture : l'article part TOUJOURS avec sa quantité totale (pas de ligne
            // « RUPTURE » à part) ; la rupture est signalée dans la note interne.
            const line = (qty: number, extra: any = {}) => [0, 0, {
              product_id: item.product.id,
              product_uom_qty: qty,
              price_unit: price,
              // Remise TOUJOURS envoyée (même 0) : sans elle, Odoo y met la remise
              // de la liste de prix du client, en plus d'un prix déjà remisé.
              discount: disc,
              ...(item.lineName ? { name: item.lineName } : {}),
              ...(item.freeType ? { type_gratuit: item.freeType } : {}),
              ...hl,
              ...extra,
            }];
            return [line(item.qty)];
      };
      // Gratuité → ligne de devis : TOUTES (bouton cadeau, UG d'un bon, MEA, devis
      // d'implantation) au prix normal du client avec 100 % de remise, quantité totale
      // même en rupture (signalée dans la note interne, comme un article payant).
      const giftCmds = (g: GiftItem): any[] => {
        const base = {
          product_id: g.product.id,
          ...(g.type ? { type_gratuit: g.type } : {}),
          ...(g.highlight && imp?.line.has("ocr_highlight") ? { ocr_highlight: g.highlight } : {}),
        };
        const price = g.fullDiscountPrice ?? applyPricelist(g.product.lst_price || 0, g.product.id, g.product.product_tmpl_id?.[0] || 0, priceItems, Math.max(1, g.qty));
        return [[0, 0, { ...base, product_uom_qty: g.qty, price_unit: price, discount: 100 }]];
      };
      // Gratuités placées comme dans le panier (placeGifts) : celles d'une MEA dans
      // son bloc, les UG d'un bon chargé après leur article payant ; le reste en fin.
      const ordered = orderedCart(cart);
      const gp = placeGifts(ordered, giftItems.filter(g => giftActive(g, cart) && g.qty > 0));
      // Devis d'implantation : une ligne de commentaire / section qui sépare un groupe
      // d'articles est retirée si TOUT son groupe est à 0 (rien n'en part dans Odoo).
      const entries: { sep: boolean; group?: string; cmds: any[] }[] = [];
      const giftEntry = (g: GiftItem) => ({ sep: false, group: g.cond?.label, cmds: giftCmds(g) });
      ordered.forEach((item, i) => {
        entries.push(...(gp.before.get(i) || []).map(giftEntry));
        if (item.note) {
          if (String(item.product.name || "").trim()) entries.push({ sep: isImplantLine(item), group: item.group, cmds: cartLineCmds(item) });
        } else entries.push({ sep: false, group: item.group, cmds: item.qty > 0 ? cartLineCmds(item) : [] });
        entries.push(...(gp.after.get(i) || []).map(giftEntry));
      });
      const orderBody: any[] = entries.flatMap((e, i) => {
        if (!e.sep) return e.cmds;
        for (let j = i + 1; j < entries.length && !entries[j].sep && entries[j].group === e.group; j++)
          if (entries[j].cmds.length) return e.cmds;
        return [];
      });

      const mainPayload: any = {
        partner_id: client.id, state: "draft",
        ...importVals,
        ...(pricelistId ? { pricelist_id: pricelistId } : {}),
        [sync.CHATTER_KEY]: orderNote,   // note de la commande → chatter (cf. sync.createOrder)
        ...tagVals,
        ...shipVals,
        ...joinVals,
        ...metaVals,
        order_line: [
          // Ordre d'ajout : les lignes d'une même MEA restent groupées dans le devis.
          // Lignes du panier dans l'ordre d'ajout, avec les gratuités de chaque MEA /
          // devis d'implantation DANS son bloc, à leur place du modèle (cf. orderBody).
          ...orderBody,          // Produits offerts par une offre marketing → 0€ + type "Gratuités des offres" (auto).
          ...promoFreeLines.map(p => [0, 0, {
            product_id: p.reward.reward_product_id,
            product_uom_qty: p.reward.reward_product_qty * Math.max(1, loyalty.rewardTimes(p.program, p.reward, promoCart(cart))),
            price_unit: 0, discount: 0,
            type_gratuit: "gratuites_des_offres",
          }]),
          // Gratuités hors MEA (bouton Offrir, bon chargé…) et celles d'une MEA retirée.
          ...gp.rest.flatMap(giftCmds),
          // Franco non atteint : frais de livraison.
          ...(feeProduct ? [[0, 0, { product_id: feeProduct.id, product_uom_qty: 1, price_unit: SHIPPING_FEE_HT, discount: 0 }]] : []),
        ],
      };

      // Complément d'une commande portail : lignes ajoutées à la commande existante.
      if (editOrder && editOrder.partnerId === client.id) {
        setSubmitStep("devis");
        const tag = editOrder.validate === false ? null : await getValidatedTagId(session);
        try {
          // Réécriture : chaque ligne existante est mise à jour avec la ligne du
          // panier du même article ; celles retirées du panier sont supprimées
          // (devis) ou passées à 0 (commande confirmée, suppression interdite).
          const free = [...(editOrder.lines || [])];
          const cmds: any[] = (mainPayload.order_line as any[]).map(c => {
            const vals = c[2] || {};
            if (c[0] !== 0 || !vals.product_id) return c;
            const i = free.findIndex(l => l.productId === vals.product_id);
            if (i < 0) return c;
            const [l] = free.splice(i, 1);
            return [1, l.id, vals];
          });
          const draft = editOrder.state === "draft" || editOrder.state === "sent";
          for (const l of free) cmds.push(draft ? [2, l.id] : [1, l.id, { product_uom_qty: 0 }]);
          await odoo.write(session, "sale.order", [editOrder.id], {
            order_line: cmds,
            ...(tag && !clientBlocked ? { tag_ids: [[4, tag]] } : {}),
          });
          await odoo.callMethod(session, "sale.order", "message_post", [[editOrder.id]], {
            body: `Commande ${editOrder.validate === false ? "" : "portail "}modifiée depuis l'app par ${session.name}${tag && !clientBlocked ? " et validée DC" : ""}.${orderNote ? `<br/>${orderNote.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br/>")}` : ""}`,
            message_type: "comment", subtype_xmlid: "mail.mt_note", body_is_html: true,
          }).catch(() => {});
        } catch (e: any) {
          onToast(odoo.isNetworkError(e) ? "Hors ligne : la commande portail n'a pas pu être complétée" : `Odoo a refusé l'ajout : ${e?.message || e}`, "error");
          setSubmitting(false);
          return;
        }
        setSubmitStep("final");
        removeDraftForClient(client.id);
        refreshPendingDrafts();
        setAppliedPromos({});
        setDone({ mainId: editOrder.id, freeId: null, mainName: editOrder.name, ruptures: ruptures.length });
        setEditOrder(null);
        setSubmitting(false);
        return;
      }

      const freePayload: any | null = freeItems.length > 0 ? {
        partner_id: client.id, state: "draft",
        note: `Articles offerts — lié au devis principal`,
        ...tagVals,
        order_line: freeItems.map(fi => [0, 0, {
          product_id: fi.product.id,
          product_uom_qty: fi.qty,
          price_unit: 0, discount: 0,
        }]),
      } : null;

      const cartTotal = Object.values(cart).reduce((s, it) => s + it.qty * it.unitPrice, 0);

      // 1) Devis principal
      setSubmitStep("devis");
      let mainId: number;
      try {
        try {
          mainId = await sync.createOrder(session, mainPayload);
        } catch (e1: any) {
          // Champ « Date d'expédition prévue » absent de cette base : on crée sans.
          if (odoo.isNetworkError(e1) || !(EXPEDITION_FIELD in mainPayload) || !String(e1?.message || "").includes(EXPEDITION_FIELD)) throw e1;
          delete mainPayload[EXPEDITION_FIELD];
          mainId = await sync.createOrder(session, mainPayload);
          onToast("Champ « Date d'expédition prévue » introuvable — devis créé sans", "info");
        }
      } catch (e: any) {
        if (odoo.isNetworkError(e)) {
          // Réseau indisponible → on met la commande en file de synchro locale.
          const payloads = freePayload ? [mainPayload, freePayload] : [mainPayload];
          await sync.queueOrder(client.name, cartTotal, payloads, undefined,
            directLogistics ? { pickingNote: orderNote, scheduledDate: toOdooDatetime(plan.expedition),
              joinedIds: joined.map(o => o.id), expeditionDate: toOdooDate(plan.expedition), tagIds } : undefined);
          removeDraftForClient(client.id);
          refreshPendingDrafts();
          setAppliedPromos({});
          setDone({ mainId: null, freeId: null, offline: true });
          setSubmitting(false);
          return;
        }
        // Erreur MÉTIER Odoo (payload refusé) : la mettre en file rééchouerait en
        // boucle. On affiche la cause exacte et on GARDE panier + brouillon pour
        // corriger et revalider. (Avant : traitée à tort comme du hors-ligne.)
        onToast("Odoo a refusé le devis : " + (e?.message || e), "error");
        setSubmitting(false);
        return;
      }

      // Commande chargée : récapitulatif + fichier du bon joints au chatter.
      if (importMeta) {
        (async () => {
          let attachmentIds: number[] = [];
          if (importMeta.file) {
            try {
              const aid = await odoo.create(session, "ir.attachment", {
                name: importMeta.file.name, datas: importMeta.file.data, res_model: "sale.order", res_id: mainId,
              });
              attachmentIds = [aid];
            } catch { /* fichier non joint : le récapitulatif part quand même */ }
          }
          await odoo.callMethod(session, "sale.order", "message_post", [[mainId]], {
            body: importMeta.summaryHtml, message_type: "comment", subtype_xmlid: "mail.mt_note", body_is_html: true,
            ...(attachmentIds.length ? { attachment_ids: attachmentIds } : {}),
          });
        })().catch(() => {});
        setImportMeta(null);
      }

      // Ruptures et notes de campagne : note interne dans le chatter.
      if (internalNote) {
        const html = internalNote.split("\n").map(l => l.replace(/&/g, "&amp;").replace(/</g, "&lt;")).join("<br/>");
        odoo.callMethod(session, "sale.order", "message_post", [[mainId]],
          { body: html, message_type: "comment", subtype_xmlid: "mail.mt_note", body_is_html: true }).catch(() => {});
      }

      // 1 bis) Commande directe logistique : confirmation automatique + note de la
      // commande recopiée sur le bon de préparation (la logistique ne lit que celle-là).
      if (directLogistics) {
        setSubmitStep("logistique");
        const t = await sync.transmitToLogistics(session, mainId, orderNote, toOdooDatetime(plan.expedition));
        if (t.error) onToast(`Devis #${mainId} créé, mais ${t.error}`, "error");
        else onToast(`Commande confirmée et transmise${t.pickings.length ? ` — ${t.pickings.join(", ")}` : ""}`, "success");
        // Commandes jointes : même date, Validé DC + Transmise, confirmées — pour partir ensemble.
        const j = await sync.transmitJoined(session, joined.map(o => o.id), EXPEDITION_FIELD,
          toOdooDate(plan.expedition), tagIds, toOdooDatetime(plan.expedition));
        if (j) onToast(j, "error");
      }

      // 1 ter) Commandes jointes : lien visible des DEUX côtés dans Odoo, quel que
      // soit le circuit (avant, hors logistique directe, seul le chatter de la
      // nouvelle commande les citait — et rien n'apparaissait sur les jointes).
      if (joined.length) {
        const mainName = (await odoo.searchRead(session, "sale.order", [["id", "=", mainId]], ["name"], 1).catch(() => []))[0]?.name || `#${mainId}`;
        const jm = await orderMeta(session).catch(() => null);
        const problems: string[] = [];
        // Champ « Commandes jointes » : la nouvelle commande sur chaque jointe.
        if (jm?.joinedField && jm.joinedKind === "text") {
          // Chaque jointe reçoit les numéros des autres commandes du groupe (ajoutés à ce qu'elle avait déjà).
          const cur = await odoo.searchRead(session, "sale.order", [["id", "in", joined.map(o => o.id)]], ["id", jm.joinedField], 0).catch(() => [] as any[]);
          for (const o of joined) {
            const had = String(cur.find((r: any) => r.id === o.id)?.[jm.joinedField] || "").split(/[,;\s]+/).filter(Boolean);
            const all = Array.from(new Set([...had, mainName, ...joined.filter(x => x.id !== o.id).map(x => x.name)]));
            await odoo.write(session, "sale.order", [o.id], { [jm.joinedField]: all.join(", ") })
              .catch((e: any) => problems.push(`${o.name} : champ non écrit (${e?.message || e})`));
          }
        } else if (jm?.joinedField) {
          await odoo.write(session, "sale.order", joined.map(o => o.id), { [jm.joinedField]: [[4, mainId]] })
            .catch((e: any) => problems.push(`lien non écrit (${e?.message || e})`));
        }
        // Note interne sur chaque commande jointe, et rappel sur la nouvelle.
        const others = (o: any) => [mainName, ...joined.filter(x => x.id !== o.id).map(x => x.name)].join(", ");
        for (const o of joined) {
          await odoo.callMethod(session, "sale.order", "message_post", [[o.id]], {
            body: `Jointe à la commande <strong>${mainName}</strong> (${client.name}) — à expédier ensemble avec ${others(o)}.`,
            message_type: "comment", subtype_xmlid: "mail.mt_note", body_is_html: true,
          }).catch((e: any) => problems.push(`${o.name} : note non ajoutée (${e?.message || e})`));
        }
        await odoo.callMethod(session, "sale.order", "message_post", [[mainId]], {
          body: `Commandes jointes : <strong>${joined.map(o => o.name).join(", ")}</strong> — à expédier ensemble.`,
          message_type: "comment", subtype_xmlid: "mail.mt_note", body_is_html: true,
        }).catch(() => {});
        if (problems.length) onToast(`Commandes jointes : ${problems.join(" ; ")}`, "error");
        else onToast(`${joined.length} commande${joined.length > 1 ? "s" : ""} jointe${joined.length > 1 ? "s" : ""} à ${mainName} : ${joined.map(o => o.name).join(", ")}${jm?.joinedField ? "" : " (note interne ; champ « Commandes jointes » absent)"}`, "success");
        setJoinIds([]);
      }

      // 2) BC gratuit — le devis principal EXISTE déjà dans Odoo : quoi qu'il
      // arrive ici, on ne remet JAMAIS mainPayload en file (sinon doublon au rejeu).
      let freeId: number | null = null;
      if (freePayload) {
        setSubmitStep("gratuit");
        freePayload.note = `Articles offerts — lié au devis #${mainId}`;
        try {
          freeId = await sync.createOrder(session, freePayload);   // case Flow + « Devis créé dans Flow »
        } catch (e: any) {
          if (odoo.isNetworkError(e)) {
            await sync.queueOrder(client.name, 0, [freePayload], `BC gratuit — ${client.name}`);
            onToast("Devis créé ; le BC gratuit part en file (réseau coupé), envoi auto", "info");
          } else {
            onToast(`Devis #${mainId} créé, mais Odoo a refusé le BC gratuit : ${e?.message || e}`, "error");
          }
        }
      }

      setSubmitStep("final");
      removeDraftForClient(client.id);
      refreshPendingDrafts();
      setAppliedPromos({});
      // Numéro Odoo (S78301…) : c'est celui que tout le monde connaît, pas l'id technique.
      const names = new Map<number, string>();
      try {
        const rows = await odoo.searchRead(session, "sale.order", [["id", "in", freeId ? [mainId, freeId] : [mainId]]], ["name"], 2);
        rows.forEach((r: any) => names.set(r.id, String(r.name || "")));
      } catch {}
      setDone({ mainId, freeId, mainName: names.get(mainId), freeName: freeId ? names.get(freeId) : undefined, ruptures: ruptures.length });
    } catch (e: any) { onToast("Erreur : " + e.message, "error"); }
    setSubmitting(false);
  };

  // Écran confirmation finale
  if (done) return (
    // key distincte de l'écran principal : sinon React réutilise le même <div> et, en
    // retirant « inset », efface aussi la position gauche de l'écran principal (décalé
    // à droite avec une zone blanche après « Nouvelle commande », jusqu'à actualiser).
    <div key="done-screen" className="fade-in" style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: desktop ? 248 : 0, background: "#0f766e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: "48px 40px", maxWidth: 480, width: "90%", textAlign: "center", boxShadow: C.shadowXl }}>
        {/* Le tube dépose sa noisette de crème, la coche se dessine */}
        <TubeSuccess color={done.offline ? C.orange : C.teal}>
          {done.offline ? <Icon name="wifiOff" size={38} color="#fff" strokeWidth={2.5} /> : undefined}
        </TubeSuccess>
        <div className="ts-text" style={{ fontSize: 26, fontWeight: 800, color: C.text, marginBottom: 8 }}>
          {done.offline ? "Commande en attente" : "Devis créé !"}
        </div>
        <div className="ts-text" style={{ fontSize: 15, color: C.muted, lineHeight: 1.6, marginBottom: 32 }}>
          {done.offline ? (
            <>Enregistrée hors ligne sur cet appareil.<br/>
            Elle sera envoyée à Odoo automatiquement dès le retour du réseau — voir « en attente » en haut de l'écran.</>
          ) : (
            <>Devis <span style={{ color: C.teal, fontWeight: 700 }}>{done.mainName || `#${done.mainId}`}</span> dans Odoo
            {done.freeId && <><br/>BC gratuit <span style={{ color: C.purple, fontWeight: 700 }}>{done.freeName || `#${done.freeId}`}</span> créé automatiquement</>}</>
          )}
          {!!done.ruptures && (
            <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 12, background: C.orangeSoft, color: C.orange, fontSize: 13.5, fontWeight: 700, lineHeight: 1.45 }}>
              {done.ruptures} article{done.ruptures > 1 ? "s" : ""} en rupture : saisi{done.ruptures > 1 ? "s" : ""} avec la quantité totale, signalé{done.ruptures > 1 ? "s" : ""} dans la note interne du devis.
            </div>
          )}
        </div>
        <div className="ts-text" style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button onClick={() => { setDone(null); setCart({}); setClient(null); setNote(""); setResumePrompt(null); setAppliedPromos({}); setStep("client"); }}
            style={{ padding: "14px 28px", background: C.teal, color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Nouvelle commande
          </button>
          {/* Mène au planning (avant : doublon exact de « Nouvelle commande ») */}
          <button onClick={() => { setDone(null); setCart({}); setClient(null); setNote(""); setResumePrompt(null); setAppliedPromos({}); setPlanningDate(null); setStep("home"); }}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 24px", background: C.bg, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>
            <Icon name="calendar" size={16} /> Mon planning
          </button>
        </div>
      </div>
    </div>
  );

  return (
    // Hauteur = zone réellement visible (--app-h, cf. useVisibleHeight) : sur iPad,
    // Safari compte sous ses barres une hauteur qu'il n'affiche pas, et le bas de
    // l'écran (total du panier, bas des gammes) passait hors de l'écran.
    <div key="main-screen" style={{ position: "fixed", top: 0, right: 0, height: "var(--app-h, 100dvh)", left: desktop ? 248 : 0, zIndex: 150, background: C.bg, display: "flex", flexDirection: "column" as const, fontFamily: "'DM Sans', sans-serif", overflow: "hidden", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)", boxSizing: "border-box" as const }}>

      {/* Sélecteur de fichier des boutons « Importer un bon » — sans accept : un PDF
           sans extension serait masqué ; le type est vérifié sur le contenu. */}
      <input ref={bonFileInput} type="file" style={{ display: "none" }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onBonFilePicked(f); }} />

      {/* ── Top bar ── */}
      <div style={{ height: 56, background: "#fff", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 16px", gap: 10, flexShrink: 0, boxShadow: C.shadow }}>
        {/* Accueil : le plus à gauche, sur tous les écrans sauf l'accueil lui-même */}
        {step !== "client" && <HomeButton />}
        {/* Flèche retour — jamais sur l'écran racine (avant, elle déconnectait : un tap
             accidentel en tournée = impossible de se reconnecter hors ligne). */}
        {step !== "client" && (
          <button onClick={() => {
              if (step === "bon") setStep(bonOrigin);
              else if (step === "perimesReport") setStep(reportOrigin);
              else if (step === "catalog" || step === "history" || step === "perime" || step === "assistant") setStep("hub");
              else if (step === "hub") setStep(clientOrigin === "planning" ? "home" : "client");
              else setStep("client");
            }}
            title="Retour"
            style={{ width: 36, height: 36, borderRadius: 10, background: C.bg, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          </button>
        )}

        {/* Fil d'ariane simple : où on en est pour ce client */}
        <div style={{ fontSize: 13, fontWeight: 700, color: C.muted, minWidth: 0, flexShrink: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
          {step === "home" && "Accueil"}
          {step === "client" && "Choisir un client"}
          {step === "hub" && "Fiche client"}
          {step === "catalog" && "Prise de commande"}
          {step === "history" && "Historique des commandes"}
          {step === "perime" && "Retour périmés"}
          {step === "assistant" && "Assistant"}
          {step === "bon" && "Import bon de commande"}
          {step === "perimesReport" && "Périmés — tous clients"}
        </div>

        <div style={{ flex: 1 }} />

        {/* Pastille réseau + données + file d'envoi (remplace l'ancien bandeau permanent) */}
        <OfflineBar session={session} onToast={onToast} />

        {/* Commandes du client en attente (saisies, non transmises) — à joindre ? */}
        {step === "catalog" && pendingOrders.length > 0 && (
          <div style={{ position: "relative" as const }}>
            <button onClick={() => setShowPending(v => !v)}
              title="Commandes de ce client saisies mais pas encore transmises"
              style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 12px", borderRadius: 10, flexShrink: 0, whiteSpace: "nowrap" as const, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
                background: joinIds.length ? C.tealSoft : C.orangeSoft, color: joinIds.length ? C.tealDark : C.orange, border: `1px solid ${joinIds.length ? C.tealMid : "#fed7aa"}` }}>
              <Icon name="file" size={14} />
              {pendingOrders.length} cde à joindre{joinIds.length ? ` · ${joinIds.length} jointe${joinIds.length > 1 ? "s" : ""}` : ""}
            </button>
            {showPending && (
              <div style={{ position: "absolute" as const, top: 42, right: 0, width: 340, zIndex: 320, background: C.white, borderRadius: 14, boxShadow: C.shadowXl, border: `1px solid ${C.border}`, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: C.text, marginBottom: 2 }}>Commandes en attente</div>
                <div style={{ fontSize: 11.5, color: C.muted, marginBottom: 10 }}>Saisies pour ce client, pas encore transmises. Coche celles à joindre à la commande en cours.</div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 6, maxHeight: 300, overflowY: "auto" as const }}>
                  {pendingOrders.map(o => {
                    const on = joinIds.includes(o.id);
                    const lines = pendingLines[o.id];
                    return (
                      <div key={o.id}>
                      <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, border: `1px solid ${on ? C.tealMid : C.border}`, background: on ? C.tealSoft : C.bg, cursor: "pointer" }}>
                        <input type="checkbox" checked={on} onChange={() => setJoinIds(ids => on ? ids.filter(x => x !== o.id) : [...ids, o.id])}
                          style={{ width: 20, height: 20, accentColor: C.teal, flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: C.text }}>
                            {/* Ouvre la commande en grand dans l'app : produits, livraison, échanges avec le service client */}
                            <button onClick={e => { e.preventDefault(); e.stopPropagation(); setShowPending(false); setBigOrder(o); }}
                              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 800, color: C.teal, textDecoration: "underline" }}>{o.name} ⤢</button>
                          </span>
                          <span style={{ display: "block", fontSize: 11, color: C.muted }}>
                            {String(o.date_order || "").slice(0, 10).split("-").reverse().join("/")}
                            {Array.isArray(o.user_id) ? ` · ${o.user_id[1]}` : ""}
                          </span>
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.tealDark, flexShrink: 0 }}>{fmtPrice(o.amount_total || 0)}</span>
                        {/* Voir le contenu sans quitter l'app */}
                        <button onClick={e => { e.preventDefault(); e.stopPropagation(); void togglePendingLines(o.id); }}
                          title="Voir le contenu" aria-label="Voir le contenu"
                          style={{ width: 32, height: 32, flexShrink: 0, borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, cursor: "pointer", color: C.textSec, fontSize: 13 }}>
                          {openPending === o.id ? "▴" : "▾"}
                        </button>
                      </label>
                      {openPending === o.id && (
                        <div style={{ margin: "4px 0 2px 30px", padding: "6px 8px", borderLeft: `2px solid ${C.tealMid}`, display: "flex", flexDirection: "column" as const, gap: 3 }}>
                          {lines === "loading" && <ListSkeleton count={2} height={14} />}
                          {lines === "error" && <div style={{ fontSize: 11.5, color: C.red }}>Contenu indisponible (hors ligne ?)</div>}
                          {Array.isArray(lines) && lines.length === 0 && <div style={{ fontSize: 11.5, color: C.muted }}>Commande vide.</div>}
                          {Array.isArray(lines) && lines.map(l => l.display_type ? (
                            <div key={l.id} style={{ fontSize: 10.5, fontWeight: 800, color: C.tealDark, textTransform: "uppercase" as const, marginTop: 4 }}>{l.name}</div>
                          ) : (
                            <div key={l.id} style={{ display: "flex", gap: 8, fontSize: 11.5, color: C.textSec }}>
                              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                                {Array.isArray(l.product_id) ? l.product_id[1] : l.name}
                              </span>
                              <span style={{ color: C.muted, flexShrink: 0 }}>× {l.product_uom_qty}</span>
                              <span style={{ fontWeight: 700, flexShrink: 0, minWidth: 64, textAlign: "right" as const }}>{fmtPrice(l.price_subtotal || 0)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Voir planning — visible sur l'écran de recherche client (pas de client sélectionné) */}
        {step === "client" && (
          <button onClick={() => { setPlanningDate(null); setStep("home"); }}
            style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 14px", borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: C.textSec }}>
            <Icon name="calendar" size={15} /> Planning
          </button>
        )}
        {/* Rapport Périmés (tous clients + export Excel), accessible dès l'accueil */}
        {step === "client" && (
          <button onClick={() => { setReportOrigin("client"); setStep("perimesReport"); }}
            style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 14px", borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: C.textSec }}>
            <Icon name="package" size={15} /> Périmés
          </button>
        )}
        {/* Tableau de bord du commercial (écran à part) */}
        {step === "client" && (
          <button onClick={() => setShowDash(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 14px", borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: C.textSec }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>
            Tableau de bord
          </button>
        )}
        {showDash && <Dashboard session={session} onClose={() => setShowDash(false)} onOpenClient={c => { setShowDash(false); selectClient(c); }} onToast={onToast} />}

        {/* Utilisateur Odoo connecté : initiales (Astrid Bodin → AB), nom au survol */}
        {(() => {
          const name = String(session.name || session.login || "").trim();
          const initials = name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
          return (
            <div title={`Connecté : ${name}`} aria-label={`Connecté : ${name}`}
              style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                background: "linear-gradient(135deg, #2dd4bf 0%, #0f766e 100%)", color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: "0.04em",
                boxShadow: "0 2px 8px rgba(15,118,110,0.35), inset 0 0 0 2px rgba(255,255,255,0.55)", userSelect: "none" as const }}>
              {initials}
            </div>
          );
        })()}

        {/* Client badge — cliquable pour revenir au hub de ce client depuis n'importe où */}
        {client && (
          <div
            onClick={() => { if (step !== "hub") setStep("hub"); }}
            title={step !== "hub" ? "Revenir à la fiche client" : undefined}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: C.tealSoft, borderRadius: 10, border: `1px solid ${C.tealMid}`, cursor: step !== "hub" ? "pointer" : "default" }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: C.teal, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 700 }}>
              {client.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.tealDark, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{client.name}</div>
              {client.property_product_pricelist && <div style={{ fontSize: 10, color: C.teal, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{client.property_product_pricelist[1]}</div>}
            </div>
            {step !== "client" && <button onClick={(e) => { e.stopPropagation(); setClient(null); setCart({}); setAppliedPromos({}); setStep("client"); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 14, lineHeight: 1 }}>✕</button>}
          </div>
        )}

        {/* RDV — uniquement sur l'écran de commande (catalogue & panier), pas sur la sélection client */}
        {client && step === "catalog" && (
          <button onClick={() => setShowAppointment(true)} title="Prendre un RDV avec ce client"
            style={{ height: 36, padding: "0 12px", gap: 6, borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.textSec, flexShrink: 0, fontFamily: "inherit", fontSize: 12.5, fontWeight: 700 }}>
            <Icon name="calendar" size={15} /> RDV
          </button>
        )}

        {/* Remises additionnelles Odoo disponibles pour ce panier */}
        {step === "catalog" && availablePromoCount > 0 && (
          <button onClick={() => setShowPromoPanel(v => !v)} title="Remises disponibles pour ce panier"
            style={{ display: "flex", alignItems: "center", gap: 5, height: 36, padding: "0 10px", borderRadius: 10, background: showPromoPanel ? C.orangeSoft : C.orange, border: `1px solid ${C.orange}`, cursor: "pointer", fontFamily: "inherit", color: showPromoPanel ? C.orange : "#fff" }}>
            <Icon name="tag" size={14} />
            <span style={{ fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" as const }}>{availablePromoCount} remise{availablePromoCount > 1 ? "s" : ""}</span>
          </button>
        )}


        {/* Accès discret aux brouillons en attente — jamais affiché sans action volontaire */}
        {pendingDrafts.length > 0 && (
          <button onClick={() => setShowDraftsPanel(v => !v)} title="Brouillons : commandes commencées, pas encore validées"
            style={{ display: "flex", alignItems: "center", gap: 5, height: 36, padding: "0 10px", borderRadius: 10, flexShrink: 0, background: showDraftsPanel ? "#fef9c3" : C.bg, border: `1px solid ${showDraftsPanel ? "#fde047" : C.border}`, cursor: "pointer", fontFamily: "inherit", color: "#92400e" }}>
            <Icon name="note" size={14} />
            <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" as const }}>{pendingDrafts.length} brouillon{pendingDrafts.length > 1 ? "s" : ""}</span>
          </button>
        )}

        {HOMEMADE_RULES_ENABLED && (
          <button onClick={() => setShowRules(!showRules)} style={{ width: 36, height: 36, borderRadius: 10, background: showRules ? C.purpleSoft : C.bg, border: `1px solid ${showRules ? C.purple : C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
            ⚙️
          </button>
        )}

        {/* Déconnexion : sur tous les écrans, toujours le dernier bouton (à droite). */}
        <LogoutButton />
      </div>

      {/* ── Bandeau reprise — scopé UNIQUEMENT au client qu'on vient de sélectionner,
           jamais un autre client : pas de fuite d'info si on est en face d'un client. ── */}
      {/* Client « Bloqué compta » / « Redressement judiciaire » : la commande se
          saisit, mais le service client valide. */}
      {/* Complément d'une commande portail : rappel permanent + annulation */}
      {editOrder && client?.id === editOrder.partnerId && step === "catalog" && (
        <div className="reveal" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", background: "#f5f3ff", borderBottom: "1px solid #ddd6fe", color: "#6d28d9", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
          <span style={{ flex: 1 }}>Modification de la commande {editOrder.validate === false ? "" : "portail "}<strong>{editOrder.name}</strong> : ses articles sont dans le panier — modifie les quantités, retire ou ajoute, puis valide : la commande est mise à jour{editOrder.validate === false ? "" : " et validée DC"}.</span>
          <button onClick={() => { setEditOrder(null); setCart({}); }}
            style={{ height: 30, padding: "0 12px", borderRadius: 8, border: "1px solid #c4b5fd", background: "#fff", color: "#6d28d9", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
            Abandonner la modification
          </button>
        </div>
      )}
      {clientBlocked && (step === "hub" || step === "catalog" || step === "bon") && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", background: "#fef2f2", borderBottom: "1px solid #fecaca", color: "#b91c1c", fontSize: 13.5, fontWeight: 700, flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>
          </svg>
          <span>
            Client « {blockLabel} » — tu peux saisir la commande, mais elle devra être validée par le service client.
          </span>
        </div>
      )}

      {resumePrompt && step === "catalog" && client?.id === resumePrompt.client?.id && (
        <div style={{ background: "#fefce8", borderBottom: `1px solid #fde047`, padding: "10px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <Icon name="file" size={18} color="#a16207" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#713f12" }}>
              Brouillon en attente pour ce client
            </div>
            <div style={{ fontSize: 11, color: "#92400e" }}>
              {Object.keys(resumePrompt.cart).length} produit{Object.keys(resumePrompt.cart).length > 1 ? "s" : ""} · sauvegardé {fmtDate(resumePrompt.savedAt)}
            </div>
          </div>
          <button onClick={acceptResumePrompt}
            style={{ padding: "7px 16px", background: "#ca8a04", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Reprendre
          </button>
          <button onClick={discardResumePrompt}
            style={{ padding: "7px 12px", background: "transparent", color: "#92400e", border: `1px solid #fde047`, borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            Nouvelle commande
          </button>
        </div>
      )}

      {/* ── Panneau des remises additionnelles Odoo déclenchées par le panier en cours ── */}
      {showPromoPanel && (
        <div className="ov" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }} onClick={() => setShowPromoPanel(false)}>
          <div style={{ width: 360, maxHeight: "80vh", marginTop: 60, marginRight: 16, background: "#fff", borderRadius: 16, boxShadow: C.shadowXl, overflowY: "auto" as const }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, fontSize: 14, fontWeight: 800, color: C.text }}>
              Remises disponibles ({triggeredPromos.length})
            </div>
            {triggeredPromos.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center" as const, color: C.muted, fontSize: 13 }}>Aucune remise ne correspond au panier actuel</div>
            ) : triggeredPromos.map(program => {
              const applied = appliedPromos[program.id];
              const reward = program.rewards[0];
              const desc = !reward ? "" :
                reward.reward_type === "discount"
                  ? `-${reward.discount}% ${reward.discount_applicability === "order" ? "sur tout le panier" : reward.discount_applicability === "cheapest" ? "sur l'article le moins cher" : "sur les articles concernés"}`
                  : reward.reward_type === "product"
                    ? `${reward.reward_product_qty} produit${reward.reward_product_qty > 1 ? "s" : ""} offert${reward.reward_product_qty > 1 ? "s" : ""}`
                    : "Récompense non gérée par l'app";
              return (
                <div key={program.id} style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{program.name}</div>
                  <div style={{ fontSize: 12, color: C.orange, fontWeight: 600, marginTop: 2 }}>{desc}</div>
                  {applied ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>✓ Appliquée</span>
                      <button onClick={() => removePromo(program.id)} style={{ padding: "5px 10px", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Retirer</button>
                    </div>
                  ) : (
                    <button onClick={() => applyPromo(program)} style={{ marginTop: 8, padding: "6px 14px", background: C.orange, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Appliquer</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Panneau global des brouillons en attente (tous clients) — ouvert uniquement au clic ── */}
      {showDraftsPanel && (
        <div className="ov" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }} onClick={() => setShowDraftsPanel(false)}>
          <div style={{ width: 360, maxHeight: "80vh", marginTop: 60, marginRight: 16, background: "#fff", borderRadius: 16, boxShadow: C.shadowXl, overflowY: "auto" as const }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, fontSize: 14, fontWeight: 800, color: C.text }}>
              Commandes en attente ({pendingDrafts.length})
            </div>
            {pendingDrafts.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center" as const, color: C.muted, fontSize: 13 }}>Aucun brouillon</div>
            ) : pendingDrafts.map(({ clientId, draft: d }) => (
              <div key={clientId} style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{d.client?.name}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{Object.keys(d.cart).length} produit{Object.keys(d.cart).length > 1 ? "s" : ""} · {fmtDate(d.savedAt)}</div>
                </div>
                <button onClick={() => resumeDraftFromPanel(d)} style={{ padding: "6px 10px", background: C.teal, color: "#fff", border: "none", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>Reprendre</button>
                <button onClick={() => deleteDraftFromPanel(clientId)} style={{ padding: "6px 10px", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Panneau règles (overlay) ── */}
      {showRules && (
        <div className="ov ov-right" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }} onClick={() => setShowRules(false)}>
          <div style={{ width: 400, height: "100%", background: "#fff", boxShadow: C.shadowXl, overflowY: "auto" as const }} onClick={e => e.stopPropagation()}>
            <RulesPanel rules={rules} onChange={r => { setRules(r); saveRules(r); }} onClose={() => setShowRules(false)} />
          </div>
        </div>
      )}

      {/* ── Étapes ── (key = step : le conteneur est re-monté, l'animation rejoue) */}
      <div key={step} className={stepDirRef.current === "back" ? "scr scr-back" : "scr"}>
      {step === "home" && (
        <HomeScreen session={session} onNewOrder={() => setStep("client")} onOpenClient={(c) => selectClient(c, "planning")} onToast={onToast}
          initialDate={planningDate} />
      )}

      {step === "client" && <ClientStep session={session} onSelect={selectClient} onImportBon={() => pickBonFile("client")}
        onOpenPlanning={(d) => { setPlanningDate(d); setStep("home"); }} onToast={onToast}
        drafts={pendingDrafts} onResumeDraft={resumeDraftFromPanel}
        onOpenPartner={id => void openPartner(id, false)} onOrderPartner={id => void openPartner(id, true)}
        onCompletePortal={o => { void startPortalEdit(o); }}
        onEditOrder={o => { void startPortalEdit(o, false); }} />}

      {step === "hub" && client && (
        <ClientHub
          session={session}
          client={client}
          hasDraft={!!loadDraftForClient(client.id)}
          onPrep={() => setShowPrep(true)}
          onOrder={enterOrderMode}
          onHistory={() => setStep("history")}
          onAppointment={() => setShowAppointment(true)}
          onNote={() => { setNoteAutoRec(false); setShowClientNote(true); }}
          onNoteRec={() => { setNoteAutoRec(true); setShowClientNote(true); }}
          onPerime={() => setStep("perime")}
          onImportBon={() => pickBonFile("hub")}
        />
      )}

      {step === "history" && client && (
        <ClientHistory session={session} client={client} />
      )}


      {step === "perimesReport" && <PerimesReportScreen session={session} onToast={onToast} />}

      {step === "bon" && (bonOrigin !== "hub" || client) && (
        <BonCommandeScreen session={session} client={client} priceItems={priceItems}
          onApply={enterOrderModeWithLines} onToast={onToast}
          onSelectClient={bonOrigin !== "hub" ? selectClientForImport : undefined}
          initialFile={incomingFile} />
      )}

      {step === "perime" && client && (
        <PerimeScreen session={session} client={client} priceItems={priceItems}
          freeTypes={freeTypes} onToast={onToast} onDone={() => setStep("hub")}
          onOpenReport={() => { setReportOrigin("perime"); setStep("perimesReport"); }} />
      )}

      {step === "catalog" && client && (
        <CatalogStep session={session} loyaltyPrograms={loyaltyPrograms} cart={cart} onQtyChange={setQty} freeItems={freeItems}
          pendingQuote={pendingQuote} onPendingQuoteDone={() => setPendingQuote(null)}
          onClearCart={group => {
            // Vider le panier (ou une seule MEA) en une fois.
            setCart(prev => group ? Object.fromEntries(Object.entries(prev).filter(([, i]) => i.group !== group)) as Record<number, CartItem> : {});
            if (!group) setAppliedPromos({});
          }}
          onValidate={handleValidate} submitting={submitting}
          note={note} setNote={setNote} client={client} priceItems={priceItems} onToast={onToast}
          appliedPromos={appliedPromos}
          giftItems={giftItems} setGiftItems={setGiftItems} freeTypes={freeTypes}
          eventDiscount={eventDiscount} setEventDiscount={setEventDiscount}
          shipping={directLogistics ? shippingPlan : null} onChangeExpedition={setWantedExpedition}
          minShipDate={!directLogistics && offerShipDate ? shippingPlan?.expedition ?? null : null}
          onAddNote={addNote} onNoteText={setNoteText}
          groupDiscounts={groupDiscounts} setGroupDiscounts={setGroupDiscounts}
          orderType={orderType} setOrderType={setOrderType} offerIds={offerIds} setOfferIds={setOfferIds} autoOffers={autoOffers}
          onTemplateApplied={(name, info) => setTemplateInfo(prev => ({ ...prev, [name]: info }))}
          onRenameGroup={(from, to) => {
            // Variante de MEA changée : les lignes (et réglages) du groupe suivent le nouveau nom.
            setCart(prev => Object.fromEntries(Object.entries(prev).map(([k, i]) => [k, i.group === from ? { ...i, group: to } : i])) as Record<number, CartItem>);
            setGroupDiscounts(prev => from in prev ? (({ [from]: v, ...rest }) => ({ ...rest, [to]: v }))(prev) : prev);
            // … et la date de début d'expédition / note / code offre de la MEA aussi
            // (sinon la date d'expé disparaissait au changement de variante).
            setTemplateInfo(prev => from in prev && !(to in prev) ? (({ [from]: v, ...rest }) => ({ ...rest, [to]: v }))(prev) : prev);
          }} />
      )}
      </div>

      {/* Création du devis : produits qui sautent + barre de progression */}
      {submitting && client && (
        <OrderSubmitLoader step={submitStep} clientName={client.name}
          steps={["prep", "devis", ...(directLogistics ? ["logistique" as const] : []), ...(freeItems.length > 0 ? ["gratuit" as const] : []), "final"]} />
      )}

      {bigOrder && (
        <OrderDetailModal session={session} order={bigOrder}
          stateLabel={{ label: bigOrder.state === "draft" ? "Devis" : bigOrder.state === "sent" ? "Envoyé" : bigOrder.state === "sale" ? "Confirmée" : String(bigOrder.state || "En attente"), color: C.orange, bg: C.orangeSoft }}
          onClose={() => setBigOrder(null)} />
      )}

      {showPrep && client && (
        <RdvPrepModal session={session} client={client} onClose={() => setShowPrep(false)} onToast={onToast}
          onCreateQuote={(templateId, qtys) => {
            // Nouveau panier pour ce client, la MEA y est chargée avec les quantités proposées.
            setShowPrep(false); beginOrder(client); setResumePrompt(null);
            setPendingQuote({ templateId, qtys });
          }} />
      )}

      {showAppointment && client && (
        <AppointmentModal session={session} client={client} onClose={() => setShowAppointment(false)} onToast={onToast} />
      )}
      {showClientNote && client && (
        <ClientNoteModal session={session} client={client} onClose={() => setShowClientNote(false)} onToast={onToast} autoRecord={noteAutoRec} />
      )}
    </div>
  );
}

// Distance à vol d'oiseau entre deux points GPS (formule de Haversine), résultat en km.
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function fmtDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}
// Rayon de recherche du mode localisation — facile à ajuster si besoin.
const LOC_RADIUS_KM = 1;                       // rayon par défaut
const LOC_RADII_KM = [1, 2, 5, 10, 20, 50];   // choix proposés

// is_company sert au départage quand plusieurs fiches partagent le même code (ref).
// parent_id / type servent à écarter les adresses enfants (voir dedupeClients).
// customer_rank : sert à départager plusieurs fiches partageant le même ref
// (cf. pickClient) — c'est la fiche qui reçoit réellement les commandes.
const CLIENT_FIELDS = ["id", "name", "ref", "street", "zip", "city", "user_id", "country_id", "property_product_pricelist", "email", "phone", "is_company", "x_nbre_visites_realisees", "parent_id", "type", "customer_rank", "x_evolution_ca_n_n_1", "x_ca_n_1", "x_ca_a_date_n", "x_statut_client_id", "category_id", "x_type_de_compte_id"];

// Évolution du CA année N vs N-1 (onglet « Conditions commerciales » de la fiche
// client Odoo, champ x_evolution_ca_n_n_1).
//
// ATTENTION au facteur 100 : le champ porte le widget `percentage` côté Odoo, qui
// stocke un RATIO et multiplie par 100 à l'affichage. Vérifié sur les données de
// PHARMACIE AZUR — CA à date N-1 = 6 075,97 € et CA à date N = 5 389,33 €, soit
// -0,11301 en base, affiché « -11,3% » par Odoo. On applique donc le même ×100.
// Champs Odoo « CA à date N » / « CA à date N-1 » (res.partner), repérés à leur
// libellé : le CA à date se compare au CA à date N-1, pas au CA N-1 complet.
// Champs « CA à date N / N-1 » : détection partagée avec le tableau de bord.
const caDateFields = caDateFieldsShared;

function fmtEvolution(v: unknown): string | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  const pct = v * 100;
  // Le signe + n'est pas automatique en JS, et il porte l'information ici.
  return `${pct > 0 ? "+" : ""}${pct.toFixed(1).replace(".", ",")} %`;
}

// Types d'adresse Odoo qui ne sont PAS des clients commandables : ce sont des
// adresses rattachées à une société mère (livraison, facturation…).
// ═══════════════════════════════════════════════════════════════════════════
// ACCUEIL — planning de la semaine du commercial connecté
// ═══════════════════════════════════════════════════════════════════════════
const WEEKDAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

function startOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = dimanche
  const diff = day === 0 ? -6 : 1 - day; // lundi = début de semaine
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(d.getDate() + diff);
  return monday;
}
function toOdooDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}
function odooToLocalDate(s: string): Date {
  return new Date(s.replace(" ", "T") + "Z"); // Odoo renvoie de l'UTC naïf
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function HomeScreen({ session, onNewOrder, onOpenClient, onToast, initialDate }: {
  session: odoo.OdooSession; onNewOrder: () => void;
  initialDate?: Date | null;   // ouvert depuis l'agenda de l'accueil : cette semaine-là
  onOpenClient: (client: any) => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [events, setEvents] = useState<any[]>([]);
  // Couleur des étiquettes Odoo (calendar.event.type.color, index 1–11 de la
  // palette Odoo) : le planning reprend les couleurs du calendrier Odoo.
  const [tagColors, setTagColors] = useState<Map<number, number>>(new Map());
  useEffect(() => {
    odoo.searchRead(session, "calendar.event.type", [], ["id", "color"], 500)
      .then((rows: any[]) => setTagColors(new Map(rows.map(r => [r.id, Number(r.color) || 0]))))
      .catch(() => {});
  }, [session]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(() => initialDate
    ? Math.round((startOfWeek(initialDate).getTime() - startOfWeek(new Date()).getTime()) / (7 * 86400000))
    : 0); // 0 = semaine en cours, ±1 = semaine précédente/suivante
  // Vue Semaine (cartes par jour) ou Mois (grille compacte). Retenue sur l'appareil.
  const [view, setView] = useState<"week" | "month">(() => {
    // Arrivée depuis un jour de l'agenda de l'accueil : sa semaine, en détail.
    if (initialDate) return "week";
    try { return localStorage.getItem("wms_planning_view") === "month" ? "month" : "week"; } catch { return "week"; }
  });
  const [monthOffset, setMonthOffset] = useState(0);
  const chooseView = (v: "week" | "month") => {
    setView(v);
    try { localStorage.setItem("wms_planning_view", v); } catch {}
  };
  // Décale la période affichée (flèches et swipe), selon la vue.
  const shift = (delta: number) => view === "month" ? setMonthOffset(o => o + delta) : setWeekOffset(o => o + delta);
  const [selectedEvent, setSelectedEvent] = useState<any>(null); // RDV ouvert en aperçu
  // Adresse complète du client lié au RDV (lien Waze) : le champ « lieu » ne
  // contient souvent que la ville.
  const [eventAddress, setEventAddress] = useState("");
  useEffect(() => {
    setEventAddress("");
    const e = selectedEvent;
    if (!e || !linkedPartnerId(e)) return;
    odoo.searchRead(session, "res.partner", [["id", "=", e.res_id]], ["street", "zip", "city"], 1)
      .then(([p]: any[]) => { if (p?.street) setEventAddress([p.street, [p.zip, p.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")); })
      .catch(() => {});
  }, [selectedEvent, session]);
  const [openingClient, setOpeningClient] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any>(null); // RDV en cours de modification
  const [cancelling, setCancelling] = useState(false);
  const [reloadKey, setReloadKey] = useState(0); // force le rechargement du planning
  // Ouverture du planning : synchro Outlook, puis rechargement si Outlook a changé.
  useEffect(() => { odoo.syncOutlookNow(session).then(changed => { if (changed) setReloadKey(k => k + 1); }); }, [session]);
  const [newAdminRdv, setNewAdminRdv] = useState(false); // nouveau RDV sans client (administratif)

  // ── Swipe tactile gauche/droite pour changer de semaine ──────────────────
  // Perf : on manipule directement le transform du DOM (via gridRef) pendant le
  // glissement, sans setState → aucun re-render par frame = suivi du doigt fluide.
  const gridRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<{ x: number; y: number; dx: number; locked: null | "h" | "v" | "card" }>({ x: 0, y: 0, dx: 0, locked: null });
  // Glisser-déposer d'un RDV dans la grille horaire (souris : on glisse ; tactile :
  // appui long puis glisser). Pas de 15 min, durée conservée.
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<any>(null);
  const [drag, setDrag] = useState<{ id: number; col: number; startMin: number; durMin: number } | null>(null);
  const SWIPE_EASE = "transform 0.32s cubic-bezier(0.22,1,0.36,1)";

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    // Toucher une carte RDV ne change pas de semaine (elle peut être déplacée).
    const onCard = !!(e.target as HTMLElement).closest?.("[data-rdv]");
    touchRef.current = { x: t.clientX, y: t.clientY, dx: 0, locked: onCard ? "card" : null };
    if (gridRef.current) gridRef.current.style.transition = "none";
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    if (touchRef.current.locked === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      touchRef.current.locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
    }
    if (touchRef.current.locked === "h") {
      touchRef.current.dx = dx;
      if (gridRef.current) gridRef.current.style.transform = `translateX(${dx}px)`;
    }
  };
  const onTouchEnd = () => {
    const dx = touchRef.current.dx;
    const el = gridRef.current;
    const locked = touchRef.current.locked;
    touchRef.current.locked = null;
    touchRef.current.dx = 0;
    if (!el) return;
    const width = el.offsetWidth || 1;
    const threshold = Math.min(80, width * 0.18);

    if (locked === "h" && Math.abs(dx) > threshold) {
      const dir = dx > 0 ? 1 : -1; // 1 = vers la droite (semaine précédente)
      // 1) glisse la semaine courante complètement hors écran (transition douce)
      el.style.transition = SWIPE_EASE;
      el.style.transform = `translateX(${dir * width}px)`;
      // 2) après l'anim : change de semaine et réinjecte la grille depuis l'autre bord
      window.setTimeout(() => {
        shift(dir > 0 ? -1 : 1);
        if (gridRef.current) {
          gridRef.current.style.transition = "none";
          gridRef.current.style.transform = `translateX(${-dir * width}px)`;
          // force un reflow puis anime jusqu'au centre → la nouvelle semaine entre
          void gridRef.current.offsetWidth;
          gridRef.current.style.transition = SWIPE_EASE;
          gridRef.current.style.transform = "translateX(0px)";
        }
      }, 320);
    } else {
      // pas assez glissé → retour élastique au centre
      el.style.transition = SWIPE_EASE;
      el.style.transform = "translateX(0px)";
    }
  };

  const monday = useMemo(() => {
    const m = startOfWeek(new Date());
    m.setDate(m.getDate() + weekOffset * 7);
    return m;
  }, [weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  }), [monday]);
  const today = new Date();

  // Vue Mois : grille du lundi précédant le 1er au dimanche suivant la fin du mois.
  const monthStart = useMemo(() => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth() + monthOffset, 1);
  }, [monthOffset]);
  const monthDays = useMemo(() => {
    const first = startOfWeek(monthStart);
    const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    const out: Date[] = [];
    for (let d = new Date(first); out.length < 42 && (d <= end || out.length % 7 !== 0); d.setDate(d.getDate() + 1)) {
      out.push(new Date(d));
    }
    return out;
  }, [monthStart]);
  const rangeStart = view === "month" ? monthDays[0] : monday;
  const rangeEnd = useMemo(() => {
    const e = new Date(view === "month" ? monthDays[monthDays.length - 1] : days[6]);
    e.setDate(e.getDate() + 1);
    return e;
  }, [view, monthDays, days]);

  // Clic sur un jour de la vue Mois → sa semaine en vue Semaine.
  // Jour sélectionné dans la vue mois (ses RDV s'affichent sous la grille).
  const [monthSel, setMonthSel] = useState<Date | null>(null);
  const openWeekOf = (d: Date) => {
    const diff = startOfWeek(d).getTime() - startOfWeek(new Date()).getTime();
    setWeekOffset(Math.round(diff / (7 * 86400000)));
    chooseView("week");
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const sunday = rangeEnd;
        // ["active", "in", [true, false]] : un RDV annulé est ARCHIVÉ dans Odoo
        // (active = false) pour sortir du calendrier Odoo. Sans ce clause, le
        // domaine par défaut masquerait les archivés et le commercial perdrait
        // la trace de ses annulations dans l'app.
        const domain = [["user_id", "=", session.uid], ["start", "<", toOdooDateStr(sunday)], ["stop", ">=", toOdooDateStr(rangeStart)], ["active", "in", [true, false]]];
        // res_model / res_id = « document lié » natif d'Odoo sur calendar.event.
        // C'est là qu'on enregistre la fiche client EXACTE au moment de la prise
        // de RDV (cf. AppointmentModal) : plus besoin de la retrouver au code,
        // qui n'est pas unique. Repli sans ces champs s'ils n'existent pas sur
        // l'instance — sinon la semaine entière s'afficherait vide.
        const BASE_FIELDS = ["id", "name", "start", "stop", "categ_ids", ...ALLDAY_FIELDS, "location", "description", "x_studio_code_client_cli_calendar", "x_studio_annul", "active"];
        let rows: any[];
        try {
          rows = await odoo.searchRead(session, "calendar.event", domain, [...BASE_FIELDS, "res_model", "res_id"], 600, "start asc");
        } catch (e) {
          if (odoo.isNetworkError(e)) throw e;
          rows = await odoo.searchRead(session, "calendar.event", domain, BASE_FIELDS, 600, "start asc");
        }
        // Client lié (nom + ville) pour le titre affiché (cf. eventTitle).
        const pids = Array.from(new Set(rows.filter(r => linkedPartnerId(r)).map(r => linkedPartnerId(r)!)));
        if (pids.length) {
          try {
            const ps = await odoo.searchRead(session, "res.partner", [["id", "in", pids]], ["id", "name", "city"], pids.length);
            const byId = new Map(ps.map((p: any) => [p.id, p]));
            rows = rows.map(r => { const pid = linkedPartnerId(r); return pid && byId.has(pid) ? { ...r, _client: byId.get(pid) } : r; });
          } catch { /* titre sans ville */ }
        }
        setEvents(rows);
      } catch {
        setEvents([]);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, rangeStart.getTime(), rangeEnd.getTime(), reloadKey]);

  const DRAG_PXH = 52, DRAG_GUTTER = 44;
  const dragTarget = (clientX: number, clientY: number, d: any) => {
    const el = bodyRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const colW = (r.width - DRAG_GUTTER) / 7;
    const col = Math.max(0, Math.min(6, Math.floor((clientX - r.left - DRAG_GUTTER) / colW)));
    const raw = d.h0 * 60 + ((clientY - r.top - d.offsetY) / DRAG_PXH) * 60;
    const startMin = Math.max(0, Math.min(24 * 60 - d.durMin, Math.round(raw / 15) * 15));
    return { col, startMin };
  };
  const onCardPointerDown = (ev: React.PointerEvent, e: any, h0: number) => {
    if (isCancelled(e) || e.allday) return;
    const st = odooToLocalDate(e.start), en = odooToLocalDate(e.stop || e.start);
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const d: any = { e, h0, x0: ev.clientX, y0: ev.clientY, offsetY: ev.clientY - rect.top, durMin: Math.max(15, Math.round((en.getTime() - st.getTime()) / 60000)), active: false, touch: ev.pointerType !== "mouse" };
    try { (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); } catch {}
    if (d.touch) d.timer = setTimeout(() => { d.active = true; const t = dragTarget(d.x0, d.y0, d); if (t) setDrag({ id: e.id, durMin: d.durMin, ...t }); }, 300);
    dragRef.current = d;
  };
  const onCardPointerMove = (ev: React.PointerEvent) => {
    const d = dragRef.current; if (!d) return;
    const dist = Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0);
    if (!d.active) {
      if (d.touch) { if (dist > 8) { clearTimeout(d.timer); dragRef.current = null; } return; }
      if (dist < 5) return;
      d.active = true;
    }
    const t = dragTarget(ev.clientX, ev.clientY, d);
    if (t) setDrag({ id: d.e.id, durMin: d.durMin, ...t });
  };
  const onCardPointerUp = async (ev: React.PointerEvent) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d) return;
    clearTimeout(d.timer);
    if (!d.active) { setSelectedEvent(d.e); return; }   // simple tap : ouvre le RDV
    const t = dragTarget(ev.clientX, ev.clientY, d);
    setDrag(null);
    if (!t) return;
    const day = days[t.col];
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(t.startMin / 60), t.startMin % 60);
    const stop = new Date(start.getTime() + d.durMin * 60000);
    const utc = (x: Date) => x.toISOString().slice(0, 19).replace("T", " ");
    const vals = { start: utc(start), stop: utc(stop) };
    if (vals.start === d.e.start) return;
    setEvents(prev => prev.map(x => x.id === d.e.id ? { ...x, ...vals } : x));   // affichage immédiat
    const label = `${start.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })} ${hhmmFR(start)}`;
    try {
      await odoo.write(session, "calendar.event", [d.e.id], vals);
      onToast(`RDV déplacé : ${label}`, "success");
    } catch (err: any) {
      if (odoo.isNetworkError(err)) {
        await sync.queueAppointmentEdit(d.e.id, d.e.name, vals);
        onToast(`RDV déplacé hors ligne (${label}) — envoyé au retour du réseau`, "info");
      } else {
        onToast("Odoo a refusé le déplacement : " + (err?.message || err), "error");
        setReloadKey(k => k + 1);
      }
    }
  };

  // Un RDV est annulé s'il porte le flag Studio OU s'il est archivé dans Odoo.
  // Les deux, parce qu'il existe des RDV annulés AVANT l'archivage (l'app ne
  // posait alors que x_studio_annul) et des RDV archivés directement dans Odoo.
  const isCancelled = (e: any) => Boolean(e?.x_studio_annul) || e?.active === false;

  // Annule un RDV.
  //
  // active = false  → ARCHIVE l'événement : il sort des vues calendrier d'Odoo.
  //                   C'est le seul champ qu'Odoo regarde réellement.
  // x_studio_annul  → garde la raison, et reste lisible par l'app (qui, elle,
  //                   continue d'afficher les annulés, barrés).
  //
  // Avant, seul x_studio_annul était écrit : champ Studio qu'aucune vue Odoo ne
  // connaît, donc le RDV restait affiché tel quel dans le calendrier Odoo.
  const cancelEvent = async (e: any) => {
    setCancelling(true);
    try {
      try {
        try {
          await odoo.write(session, "calendar.event", [e.id], { x_studio_annul: true, active: false });
        } catch (inner: any) {
          if (odoo.isNetworkError(inner)) throw inner;
          // Repli si `active` n'est pas inscriptible sur cette instance (même
          // logique que le repli date_start/date_end du préchargement) : on pose
          // au moins le flag, et on dit clairement que le RDV reste dans Odoo.
          await odoo.write(session, "calendar.event", [e.id], { x_studio_annul: true });
          onToast("RDV marqué annulé, mais Odoo a refusé de l'archiver : " + (inner?.message || inner), "error");
          setSelectedEvent(null);
          setReloadKey(k => k + 1);
          return;
        }
        onToast("RDV annulé et retiré du calendrier Odoo", "success");
      } catch (err: any) {
        // Seul le RÉSEAU justifie la file de synchro. Une erreur métier rejouée
        // échouerait en boucle — on affiche la cause. (cf. lib/odoo.ts)
        if (!odoo.isNetworkError(err)) {
          onToast("Odoo a refusé l'annulation : " + (err?.message || err), "error");
          return;
        }
        await sync.queueAppointmentCancel(e.id, e.name || "RDV");
        onToast("Annulation enregistrée hors ligne — sera envoyée au retour du réseau", "info");
      }
      setSelectedEvent(null);
      setReloadKey(k => k + 1);
    } finally {
      setCancelling(false);
    }
  };

  const eventsByDay = days.map(d => events.filter(e => eventOnDay(e, d)));
  // En vue Mois, on ne compte que les RDV du mois (la grille déborde sur les mois voisins).
  const totalCount = view === "month"
    ? events.filter(e => odooToLocalDate(e.start).getMonth() === monthStart.getMonth()).length
    : events.length;

  // Les RDV créés depuis l'outil Commande indiquent le client dans la description
  // (le champ partner_ids n'est volontairement pas utilisé, cf. AppointmentModal — anti-invitation Outlook).
  // On retrouve donc le client en relisant cette description plutôt que via un lien structuré.
  const openEventClient = async (e: any) => {
    setOpeningClient(true);
    try {
      // 0) Source EXACTE : la fiche liée au RDV (res_model/res_id), enregistrée
      //    au moment de la prise de rendez-vous. C'est l'identifiant, pas un code
      //    à re-chercher : aucune ambiguïté possible, même si 160 fiches
      //    partagent le même ref. Les RDV créés avant ce correctif n'ont pas ce
      //    lien et retombent sur la recherche par code, plus bas.
      if (linkedPartnerId(e)) {
        const id = Number(e.res_id);
        try {
          const cached = await sync.getCachedClients();
          const hit = cached.find((c: any) => Number(c.id) === id);
          if (hit) { onOpenClient(hit); return; }
        } catch {}
        const rows = await odoo.searchRead(session, "res.partner", [["id", "=", id]], CLIENT_FIELDS, 1);
        if (rows.length) { onOpenClient(rows[0]); return; }
        // La fiche liée a été supprimée depuis : on continue en recherche par code.
      }
    } catch (err) {
      if (!odoo.isNetworkError(err)) { /* on tente quand même la recherche par code */ }
    } finally {
      setOpeningClient(false);
    }

    // 1) Repli : le code client stocké dans le champ Odoo dédié.
    const fieldCode = (typeof e.x_studio_code_client_cli_calendar === "string"
      ? e.x_studio_code_client_cli_calendar : "").trim();

    // 2) Repli sur la description "Client : NOM (CODE) — téléphone" (anciens RDV).
    const desc: string = descToText(e.description || "");
    const line = (desc.match(/Client\s*:\s*(.+)/i)?.[1]) || "";
    const descCode = line.match(/\(([^)]+)\)/)?.[1]?.trim() || "";
    const name = line.replace(/\(.*$/, "").replace(/—.*$/, "").trim();

    const code = fieldCode || descCode;   // le code (ref) prime toujours sur le nom
    if (!code && !name) { onToast("Aucun client associé à ce RDV", "info"); return; }

    // Compare deux codes de façon stricte (insensible casse/espaces).
    const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

    // Le départage vit dans lib/clients.ts (fonction pure, testable) : plusieurs
    // fiches au même ref est le cas NORMAL dans Odoo — société + adresses de
    // livraison/facturation héritant du ref.
    const pickClient = (rows: any[]) => pickClientAmong(rows, name);

    // Au-delà de ce seuil, un ref partagé n'identifie plus rien (cas réel : 160
    // fiches pour 75-004421). Ouvrir « la plus ancienne » afficherait alors une
    // fiche d'apparence normale mais probablement fausse — pire qu'un refus. On
    // le dit. Les RDV pris depuis ce correctif portent res_id et ne passent
    // jamais ici.
    const MAX_AMBIGU = 5;

    const openOrExplain = (hit: { row: any; ambiguous: boolean }, total: number): boolean => {
      if (!hit.row) return false;
      if (hit.ambiguous && total > MAX_AMBIGU) {
        onToast(`Le code ${code || name} désigne ${total} fiches dans Odoo — impossible de savoir laquelle. Ouvre-la via la recherche.`, "info");
        return true;
      }
      if (hit.ambiguous) onToast(`${total} fiches identiques pour ${code || name} — ouverture de la plus ancienne`, "info");
      onOpenClient(hit.row);
      return true;
    };

    setOpeningClient(true);
    try {
      // Cache local d'abord (offline + instantané). Le CODE prime ; le nom n'est
      // utilisé que s'il n'y a AUCUN code, et seulement en correspondance exacte.
      try {
        const cached = await sync.getCachedClients();
        let matches: any[] = [];
        if (code) matches = cached.filter((c: any) => c.ref && norm(c.ref) === norm(code));
        else if (name) matches = cached.filter((c: any) => (c.name || "").trim().toLowerCase() === name.toLowerCase());
        if (openOrExplain(pickClient(matches), matches.length)) return;
      } catch {}

      // Sinon Odoo : par CODE exact d'abord — les CLIENTS (customer_rank > 0) en
      // priorité, ce qui écarte fournisseurs/contacts au même ref ; repli sans ce
      // filtre si aucun résultat. Jamais de "ilike" approximatif.
      //
      // Limite 50 et non 5 : une société avec ses adresses de livraison dépasse
      // vite 5 fiches, et tronquer à 5 faussait le départage (on choisissait dans
      // un lot arbitrairement coupé). Le message « 5 fiches ont le code … »
      // affichait d'ailleurs la limite, pas le nombre réel.
      let rows: any[] = [];
      if (code) {
        rows = await odoo.searchRead(session, "res.partner",
          [["ref", "=", code], ["active", "=", true], ["customer_rank", ">", 0]], CLIENT_FIELDS, 50);
        if (!rows.length) {
          rows = await odoo.searchRead(session, "res.partner",
            [["ref", "=", code], ["active", "=", true]], CLIENT_FIELDS, 50);
        }
      } else if (name) {
        rows = await odoo.searchRead(session, "res.partner",
          [["name", "=", name], ["active", "=", true]], CLIENT_FIELDS, 50);
      }
      if (!openOrExplain(pickClient(rows), rows.length)) onToast("Client introuvable pour ce RDV", "info");
    } catch {
      onToast("Erreur lors de l'ouverture du client", "error");
    } finally {
      setOpeningClient(false);
    }
  };

  // Palette Odoo (o_color_1 … o_color_11) : fond clair + texte foncé de la teinte.
  const ODOO_COLORS: Record<number, string> = {
    1: "#F06050", 2: "#F4A460", 3: "#F7CD1F", 4: "#6CC1ED", 5: "#814968", 6: "#EB7E7F",
    7: "#2C8397", 8: "#475577", 9: "#D6145F", 10: "#30C381", 11: "#9365B8",
  };
  const eventColor = (e: any, idx: number) => {
    const c = ODOO_COLORS[tagColors.get((e.categ_ids || [])[0]) || 0];
    return c ? { bg: `${c}2e`, text: `color-mix(in srgb, ${c} 70%, #000)`, bar: c } : EVENT_COLORS[idx % EVENT_COLORS.length];
  };
  const EVENT_COLORS = [
    { bg: "#f0fdfa", text: C.tealDark },
    { bg: "#eff6ff", text: "#1d4ed8" },
    { bg: "#fff7ed", text: "#c2410c" },
    { bg: "#f1f5f9", text: "#334155" },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto" as const, padding: "32px 28px 40px", display: "flex", flexDirection: "column" as const, background: "#f8f9fc" }}>
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 16, marginBottom: 24 }}>
        <div>
          <div style={{ display: "inline-block", fontSize: 11, fontWeight: 700, color: C.tealDark, background: C.tealMid, borderRadius: 999, padding: "5px 14px", textTransform: "uppercase" as const, letterSpacing: "0.04em", marginBottom: 12 }}>
            {today.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.text }}>
            Salut {session.name?.split(" ")[0] || ""}, {loading ? "…" : <span style={{ color: C.teal }}>{totalCount} RDV</span>}{" "}
            {view === "month"
              ? (monthOffset === 0 ? "ce mois-ci" : `en ${monthStart.toLocaleDateString("fr-FR", { month: "long" })}`)
              : "cette semaine"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
          {/* Semaine / Mois */}
          <div style={{ display: "flex", background: C.white, border: `1px solid ${C.border}`, borderRadius: 999, padding: 3, boxShadow: C.shadow }}>
            {([["week", "Semaine"], ["month", "Mois"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => chooseView(v)}
                style={{ height: 28, padding: "0 12px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700,
                  background: view === v ? C.tealMid : "transparent", color: view === v ? C.tealDark : C.muted }}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => shift(-1)} title={view === "month" ? "Mois précédent" : "Semaine précédente"}
            style={{ width: 32, height: 32, borderRadius: "50%", background: C.white, border: `1px solid ${C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.textSec, boxShadow: C.shadow }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div onClick={() => view === "month" ? setMonthOffset(0) : setWeekOffset(0)}
            style={{ fontSize: 13, fontWeight: 800, color: "#fff", background: C.teal, borderRadius: 999, padding: "9px 18px", cursor: "pointer", whiteSpace: "nowrap" as const, boxShadow: "0 8px 18px rgba(13,148,136,0.25)", minWidth: 120, textAlign: "center" as const }}>
            {view === "month"
              ? monthStart.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase())
              : <>{monday.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} — {days[6].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</>}
          </div>
          <button onClick={() => shift(1)} title={view === "month" ? "Mois suivant" : "Semaine suivante"}
            style={{ width: 32, height: 32, borderRadius: "50%", background: C.white, border: `1px solid ${C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.textSec, boxShadow: C.shadow }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </button>

          <button onClick={() => setNewAdminRdv(true)} title="Nouveau rendez-vous"
            style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 999, background: C.teal, color: "#fff", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, boxShadow: "0 8px 18px rgba(13,148,136,0.25)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            RDV
          </button>
        </div>
      </div>

      {/* Vue mois — grille compacte (pastilles par RDV) ; un tap sur un jour affiche
          ses RDV en clair dessous, avec accès à sa semaine. */}
      {view === "month" && (() => {
        const sel = monthSel && monthDays.some(d => sameDay(d, monthSel)) ? monthSel
          : monthDays.find(d => sameDay(d, today)) || monthStart;
        const selEvents = events.filter(e => eventOnDay(e, sel))
          .sort((x, y) => (x.allday ? -1 : 0) - (y.allday ? -1 : 0) || odooToLocalDate(x.start).getTime() - odooToLocalDate(y.start).getTime());
        return (
        <div ref={gridRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" as const, transform: "translateX(0px)", willChange: "transform", touchAction: "pan-y" as const }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginBottom: 4 }}>
            {WEEKDAY_LABELS.map(l => (
              <div key={l} style={{ fontSize: 10.5, fontWeight: 700, color: C.textSec, textTransform: "uppercase" as const, letterSpacing: "0.04em", textAlign: "center" as const }}>{l.slice(0, 3)}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: 54, gap: 6 }}>
            {monthDays.map(d => {
              const inMonth = d.getMonth() === monthStart.getMonth();
              const isToday = sameDay(d, today);
              const isSel = sameDay(d, sel);
              const dayEvents = events.filter(e => eventOnDay(e, d));
              return (
                <button key={d.toISOString()} onClick={() => setMonthSel(d)}
                  style={{ background: isSel ? C.tealSoft : C.white, border: "none", borderRadius: 12, padding: "5px 6px", cursor: "pointer", fontFamily: "inherit", opacity: inMonth ? 1 : 0.4, overflow: "hidden",
                    boxShadow: isSel ? `0 0 0 2px ${C.teal}` : isToday ? `0 0 0 1.5px ${C.tealMid}` : "0 1px 4px rgba(15,23,42,0.05)", display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 5 }}>
                  <div style={{ minWidth: 24, height: 24, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px",
                    fontSize: 13, fontWeight: 800, background: isToday ? C.teal : "transparent", color: isToday ? "#fff" : C.text }}>
                    {d.getDate()}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 3, height: 8 }}>
                    {dayEvents.slice(0, 4).map((e, idx) => {
                      const col: any = eventColor(e, idx);
                      return <span key={e.id} style={{ width: e.allday ? 14 : 7, height: 7, borderRadius: 4, background: isCancelled(e) ? C.border : (col.bar || col.text) }} />;
                    })}
                    {dayEvents.length > 4 && <span style={{ fontSize: 9.5, fontWeight: 800, color: C.textSec }}>+{dayEvents.length - 4}</span>}
                  </div>
                </button>
              );
            })}
          </div>

          {/* RDV du jour sélectionné */}
          <div style={{ flex: 1, minHeight: 120, marginTop: 12, background: C.white, borderRadius: 14, boxShadow: "0 1px 4px rgba(15,23,42,0.06)", padding: "12px 14px", display: "flex", flexDirection: "column" as const, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, color: C.text }}>
                {sel.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }).replace(/^./, c => c.toUpperCase())}
                <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: C.textSec }}>{selEvents.length ? `${selEvents.length} RDV` : "Aucun RDV"}</span>
              </div>
              <button onClick={() => openWeekOf(sel)}
                style={{ height: 34, padding: "0 14px", borderRadius: 999, background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: C.tealDark, flexShrink: 0 }}>
                Voir la semaine →
              </button>
            </div>
            <div className="stagger" style={{ flex: 1, overflowY: "auto" as const, display: "flex", flexDirection: "column" as const, gap: 6 }}>
              {selEvents.map((e, idx) => {
                const col: any = eventColor(e, idx);
                const cancelled = isCancelled(e);
                return (
                  <button key={e.id} onClick={() => setSelectedEvent(e)}
                    style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 44, border: "none", borderLeft: `4px solid ${cancelled ? C.border : (col.bar || col.text)}`, borderRadius: 10, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const,
                      background: cancelled ? C.bg : col.bg, opacity: cancelled ? 0.6 : 1 }}>
                    <span style={{ width: 92, flexShrink: 0, fontSize: 12.5, fontWeight: 800, color: C.text }}>
                      {e.allday ? "Déplacement" : `${hhmmFR(odooToLocalDate(e.start))}${e.stop ? ` – ${hhmmFR(odooToLocalDate(e.stop))}` : ""}`}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, textDecoration: cancelled ? "line-through" : "none" }}>{eventTitle(e)}</span>
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6"/></svg>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        );
      })()}

      {/* Vue semaine — grille horaire façon Outlook : les RDV sont placés à leur
          heure, sur leur durée ; les déplacements (journée entière) en bandeau. */}
      {view === "week" && (() => {
        const PXH = 52;                                   // pixels par heure
        const hourOf = (x: Date) => x.getHours() + x.getMinutes() / 60;
        const timed = eventsByDay.map(list => list.filter(e => !e.allday));
        const allHours = timed.flat().flatMap(e => [hourOf(odooToLocalDate(e.start)), hourOf(odooToLocalDate(e.stop || e.start))]);
        const H0 = Math.min(8, ...allHours.map(Math.floor));
        const H1 = Math.max(20, ...allHours.map(Math.ceil));
        // RDV qui se chevauchent : côte à côte (colonnes attribuées au fil de l'eau).
        const lanes = (list: any[]) => {
          const ends: number[] = [];
          const out = new Map<number, { lane: number; of: number }>();
          const sorted = [...list].sort((x, y) => odooToLocalDate(x.start).getTime() - odooToLocalDate(y.start).getTime());
          const groups: any[][] = []; let cur: any[] = []; let curEnd = 0;
          for (const e of sorted) {
            const st = odooToLocalDate(e.start).getTime(), en = odooToLocalDate(e.stop || e.start).getTime();
            if (cur.length && st >= curEnd) { groups.push(cur); cur = []; ends.length = 0; }
            let lane = ends.findIndex(t => t <= st); if (lane < 0) { lane = ends.length; ends.push(en); } else ends[lane] = en;
            out.set(e.id, { lane, of: 0 }); cur.push(e); curEnd = Math.max(curEnd, en);
          }
          if (cur.length) groups.push(cur);
          for (const g of groups) { const n = Math.max(...g.map(e => out.get(e.id)!.lane)) + 1; g.forEach(e => out.get(e.id)!.of = n); }
          return out;
        };
        const hasTrips = eventsByDay.some(list => list.some(e => e.allday));
        const cols = "44px repeat(7, minmax(110px, 1fr))";
        return (
          <div ref={gridRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
            style={{ flex: 1, background: C.white, borderRadius: 18, boxShadow: "0 2px 8px rgba(15,23,42,0.05)", overflow: "hidden", touchAction: "pan-y" as const, display: "flex", flexDirection: "column" as const }}>
            {/* En-têtes des jours */}
            <div style={{ display: "grid", gridTemplateColumns: cols, borderBottom: `1px solid ${C.border}` }}>
              <div />
              {days.map((d, i) => {
                const isToday = sameDay(d, today);
                // Jour touché dans l'agenda de l'accueil : mis en avant.
                const isFocus = !!initialDate && sameDay(d, initialDate) && !isToday;
                return (
                  <div key={i} style={{ padding: "10px 4px 8px", textAlign: "center" as const, borderLeft: `1px solid ${C.border}`, background: isFocus ? "rgba(13,148,136,0.10)" : "transparent" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: isToday ? C.teal : C.muted, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>{WEEKDAY_LABELS[i].slice(0, 3)}</div>
                    <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 32, height: 32, borderRadius: 16, marginTop: 2, fontSize: 18, fontWeight: 800,
                      color: isToday ? "#fff" : C.text, background: isToday ? C.teal : "transparent" }}>{d.getDate()}</div>
                  </div>
                );
              })}
            </div>
            {/* Déplacements (journée entière) */}
            {hasTrips && (
              <div style={{ display: "grid", gridTemplateColumns: cols, borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 9, color: C.muted, padding: "6px 4px", textAlign: "right" as const }}>Journée</div>
                {eventsByDay.map((list, i) => (
                  <div key={i} style={{ borderLeft: `1px solid ${C.border}`, padding: 3, display: "flex", flexDirection: "column" as const, gap: 3 }}>
                    {list.filter(e => e.allday).map(e => (
                      <button key={e.id} onClick={() => setSelectedEvent(e)}
                        style={{ border: "none", borderRadius: 6, padding: "3px 6px", background: C.orangeSoft, color: C.orange, fontSize: 10.5, fontWeight: 800, textAlign: "left" as const, cursor: "pointer", fontFamily: "inherit", overflow: "hidden", whiteSpace: "nowrap" as const, textOverflow: "ellipsis", opacity: isCancelled(e) ? 0.5 : 1 }}>
                        {eventTitle(e)}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {/* Grille horaire — sans défilement propre : une barre de défilement
                ici décalait les colonnes par rapport aux en-têtes des jours. */}
            <div>
              <div ref={bodyRef} style={{ display: "grid", gridTemplateColumns: cols, position: "relative" as const, height: (H1 - H0) * PXH }}>
                <div style={{ position: "relative" as const }}>
                  {Array.from({ length: H1 - H0 }, (_, h) => (
                    <div key={h} style={{ position: "absolute" as const, top: h * PXH - 6, right: 6, fontSize: 10, color: C.muted }}>{h ? `${H0 + h}:00` : ""}</div>
                  ))}
                </div>
                {days.map((d, i) => {
                  const isToday = sameDay(d, today);
                  const lane = lanes(timed[i]);
                  return (
                    <div key={i} style={{ position: "relative" as const, borderLeft: `1px solid ${C.border}`, background: isToday || (!!initialDate && sameDay(d, initialDate)) ? "rgba(13,148,136,0.10)" : d < today ? "#fafbfc" : "transparent" }}>
                      {Array.from({ length: H1 - H0 }, (_, h) => (
                        <div key={h} style={{ position: "absolute" as const, left: 0, right: 0, top: h * PXH, borderTop: h ? `1px solid ${C.border}` : "none" }} />
                      ))}
                      {timed[i].map((e, idx) => {
                        const st = odooToLocalDate(e.start), en = odooToLocalDate(e.stop || e.start);
                        const top = (hourOf(st) - H0) * PXH;
                        const height = Math.max(22, (hourOf(en) - hourOf(st)) * PXH - 2);
                        const { lane: l, of } = lane.get(e.id) || { lane: 0, of: 1 };
                        const col = eventColor(e, idx);
                        const cancelled = isCancelled(e);
                        return (
                          <button key={e.id} data-rdv onClick={cancelled ? () => setSelectedEvent(e) : undefined} title={`${hhmmFR(st)}–${hhmmFR(en)} ${eventTitle(e)}`}
                            onPointerDown={ev => onCardPointerDown(ev, e, H0)} onPointerMove={onCardPointerMove} onPointerUp={onCardPointerUp}
                            onPointerCancel={() => { clearTimeout(dragRef.current?.timer); dragRef.current = null; setDrag(null); }}
                            onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") setSelectedEvent(e); }}
                            style={{ position: "absolute" as const, top, height, left: `calc(${(l / of) * 100}% + 2px)`, width: `calc(${100 / of}% - 4px)`,
                              touchAction: cancelled ? "auto" : "none", userSelect: "none" as const, visibility: drag?.id === e.id ? "hidden" as const : "visible" as const,
                              background: cancelled ? "#f8fafc" : col.bg, border: "none", borderLeft: `3px solid ${cancelled ? C.border : ("bar" in col ? col.bar : col.text)}`,
                              borderRadius: 6, padding: "2px 5px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const, overflow: "hidden", opacity: cancelled ? 0.6 : 1, zIndex: 1 }}>
                            <div style={{ fontSize: 9.5, fontWeight: 800, color: cancelled ? C.muted : col.text, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {hhmmFR(st)}{eventClient(e) && <span style={{ fontWeight: 600, opacity: 0.85 }}> · {e.name}</span>}{cancelled && " · Annulé"}
                            </div>
                            <div style={{ fontSize: 10.5, fontWeight: 700, color: C.text, lineHeight: 1.25, overflow: "hidden", textDecoration: cancelled ? "line-through" : "none" }}>{eventClient(e) || e.name}</div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {/* Fantôme du RDV en cours de déplacement */}
                {drag && (() => {
                  const e = events.find(x => x.id === drag.id);
                  if (!e) return null;
                  const end = drag.startMin + drag.durMin;
                  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
                  return (
                    <div style={{ position: "absolute" as const, pointerEvents: "none" as const, zIndex: 5,
                      left: `calc(${DRAG_GUTTER}px + (100% - ${DRAG_GUTTER}px) * ${drag.col} / 7 + 2px)`, width: `calc((100% - ${DRAG_GUTTER}px) / 7 - 4px)`,
                      top: (drag.startMin / 60 - H0) * PXH, height: Math.max(22, drag.durMin / 60 * PXH - 2),
                      background: "rgba(13,148,136,0.18)", border: `2px dashed ${C.teal}`, borderRadius: 6, padding: "2px 5px", boxShadow: "0 8px 20px rgba(15,23,42,0.15)" }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: C.tealDark }}>{hm(drag.startMin)} – {hm(end)}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: C.text, overflow: "hidden", whiteSpace: "nowrap" as const, textOverflow: "ellipsis" }}>{eventClient(e) || e.name}</div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Aperçu d'un RDV (heure, lieu, client, notes) avant d'ouvrir la fiche ── */}
      {selectedEvent && (() => {
        const e = selectedEvent;
        const start = odooToLocalDate(e.start);
        const stop = e.stop ? odooToLocalDate(e.stop) : null;
        // Liens d'itinéraire (Waze / Plans) écrits pour Outlook : retirés de l'affichage,
        // même quand Odoo a recollé toute la description sur une seule ligne.
        const desc: string = stripRouteLinks(descToText(e.description || ""));
        const clientLine = (desc.match(/Client\s*:\s*(.+)/i)?.[1]) || "";
        const clientName = clientLine.replace(/\(.*$/, "").replace(/—.*$/, "").trim();
        const clientRef = clientLine.match(/\(([^)]+)\)/)?.[1]?.trim() || "";
        const phone = clientLine.match(/—\s*(.+)$/)?.[1]?.trim() || "";
        const notes = (desc.split(/\n\n/).slice(1).join("\n\n")).trim();
        const fmtDay = (x: Date) => x.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
        const ymdDate = (v: string) => new Date(`${v}T12:00:00`);
        // Déplacement (journée entière) : du … au …, sans heure.
        const timeStr = e.allday ? "Journée entière"
          : start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
            + (stop ? ` – ${stop.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "");
        const dateStr = e.allday && e.start_date
          ? (e.stop_date && e.stop_date !== e.start_date ? `Du ${fmtDay(ymdDate(e.start_date))} au ${fmtDay(ymdDate(e.stop_date))}` : fmtDay(ymdDate(e.start_date)))
          : fmtDay(start);
        return (
          <div onClick={() => setSelectedEvent(null)} className="ov"
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={ev => ev.stopPropagation()}
              style={{ width: "100%", maxWidth: 420, background: C.white, borderRadius: 22, boxShadow: C.shadowXl, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>
              <div style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)", padding: "22px 24px", color: "#fff" }}>
                <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 6 }}>Rendez-vous</div>
                <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.25 }}>{eventTitle(e)}</div>
              </div>
              <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column" as const, gap: 14 }}>
                <Row icon="calendar" label={dateStr} />
                <Row icon="clock" label={timeStr} />
                {(eventAddress || e.location) && (() => {
                  const u = routeUrls(eventAddress || e.location);
                  const pill = (bg: string): React.CSSProperties => ({ padding: "7px 12px", borderRadius: 999, background: bg, color: "#fff", fontSize: 12.5, fontWeight: 800, flexShrink: 0, textDecoration: "none" });
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}><Row icon="pin" label={eventAddress || e.location} /></div>
                      <a href={u.waze} target="_blank" rel="noopener noreferrer" style={pill("#33ccff")}>Waze</a>
                      <a href={u.plans} target="_blank" rel="noopener noreferrer" style={pill("#0f172a")}>Plans</a>
                    </div>
                  );
                })()}
                {clientName && <Row icon="user" label={clientName + (clientRef ? `  ·  ${clientRef}` : "")} />}
                {phone && <Row icon="phone" label={phone} />}
                {notes && (
                  <div style={{ background: C.bg, borderRadius: 12, padding: "12px 14px", fontSize: 13, color: C.textSec, lineHeight: 1.5, whiteSpace: "pre-wrap" as const }}>{notes}</div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 10, padding: "0 24px 22px" }}>
                {(clientName || clientRef) && (
                  <button onClick={() => openEventClient(e)} disabled={openingClient}
                    style={{ padding: "13px 18px", background: openingClient ? C.muted : C.teal, color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: openingClient ? "default" : "pointer", fontFamily: "inherit" }}>
                    {openingClient ? "Ouverture…" : "Ouvrir la fiche client"}
                  </button>
                )}
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => { setEditingEvent(e); setSelectedEvent(null); }}
                    style={{ flex: 1, padding: "12px", background: C.white, color: C.tealDark, border: `1.5px solid ${C.tealMid}`, borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    Modifier
                  </button>
                  {isCancelled(e) ? (
                    <div style={{ flex: 1, padding: "12px", textAlign: "center" as const, color: C.muted, fontSize: 13, fontWeight: 600 }}>Déjà annulé</div>
                  ) : (
                    <button onClick={() => cancelEvent(e)} disabled={cancelling}
                      style={{ flex: 1, padding: "12px", background: cancelling ? C.muted : "#fef2f2", color: "#dc2626", border: "1.5px solid #fecaca", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: cancelling ? "default" : "pointer", fontFamily: "inherit" }}>
                      {cancelling ? "Annulation…" : "Annuler le RDV"}
                    </button>
                  )}
                </div>
                <button onClick={() => setSelectedEvent(null)}
                  style={{ padding: "11px", background: "transparent", color: C.muted, border: "none", borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                  Fermer
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modification d'un RDV (réutilise le modal de création en mode édition) */}
      {editingEvent && (
        <AppointmentModal
          session={session}
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onToast={(m, t) => { onToast(m, t); setReloadKey(k => k + 1); }}
        />
      )}

      {/* Nouveau RDV administratif (sans client, avec étiquette prédéfinie) */}
      {newAdminRdv && (
        <AppointmentModal
          session={session}
          adminMode
          onClose={() => setNewAdminRdv(false)}
          onToast={(m, t) => { onToast(m, t); setReloadKey(k => k + 1); }}
        />
      )}
    </div>
  );
}

// Petite ligne icône + texte pour l'aperçu RDV.
// Titre affiché d'un RDV : le titre Odoo est souvent réécrit avec le type
// (« Animation ») par l'automatisation Studio ; on y ajoute le client lié,
// lu dans la description (« Client : NOM (CODE) — tél. »).
const hhmmFR = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

// Client lié affiché (nom + ville), vide si le RDV n'a pas de client.
function eventClient(e: any): string {
  const line = descToText(e?.description || "").match(/Client\s*:\s*(.+)/i)?.[1] || "";
  const name = e?._client?.name || line.replace(/\(.*$/, "").replace(/—.*$/, "").trim();
  return name ? `${name}${e?._client?.city ? ` - ${e._client.city}` : ""}` : "";
}

function eventTitle(e: any): string {
  // Déplacement : Odoo remplace le titre par le type ; la destination est dans le lieu.
  if (e?.allday && e.location) return e.location;
  const line = descToText(e?.description || "").match(/Client\s*:\s*(.+)/i)?.[1] || "";
  const name = e?._client?.name || line.replace(/\(.*$/, "").replace(/—.*$/, "").trim();
  const client = name && `${name}${e?._client?.city ? ` - ${e._client.city}` : ""}`;
  return client && !String(e?.name || "").toLowerCase().includes(name.toLowerCase()) ? `${client} — ${e.name}` : e?.name;
}

// Étiquette « Offre produit » d'un article dans le panier.
// Code EAN : pastille bleue, pour le distinguer d'un coup d'œil de la référence
// (gris) pendant la saisie de commande.
function Ean({ code }: { code: string }) {
  return (
    <span title={`EAN ${code}`} style={{ display: "inline-block", fontFamily: "monospace", fontWeight: 400, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 5, padding: "0 4px", lineHeight: 1.35, verticalAlign: "baseline" }}>{code}</span>
  );
}

function OfferTag({ name }: { name: string }) {
  return (
    <span title={`Offre : ${name}`} style={{ flexShrink: 1, minWidth: 0, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontSize: 10, fontWeight: 800, color: "#fff", background: C.orange, borderRadius: 5, padding: "2px 6px" }}>
      {name}
    </span>
  );
}

function Row({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: "#f0fdfa", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon name={icon} size={16} />
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{label}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ÉTAPE 1 — Sélection client
// ═══════════════════════════════════════════════════════════════════════════
function ClientStep({ session, onSelect, onImportBon, onOpenPlanning, onToast, drafts, onResumeDraft, onOpenPartner, onOrderPartner, onCompletePortal, onEditOrder }: {
  session: odoo.OdooSession; onSelect: (c: any) => void; onImportBon: () => void; onOpenPlanning: (d: Date) => void;
  drafts: { clientId: string; draft: Draft }[]; onResumeDraft: (d: Draft) => void;
  onOpenPartner: (id: number) => void; onOrderPartner: (id: number) => void;
  onCompletePortal: (o: any) => void;
  onEditOrder: (o: any) => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<any>(null);
  const [recents] = useState<any[]>(loadRecentClients);

  // ── Mode localisation ──────────────────────────────────────────────────
  const [locMode, setLocMode] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState("");
  const [nearby, setNearby] = useState<any[]>([]);   // clients géolocalisés, triés par distance (tous rayons)
  const [radius, setRadius] = useState(LOC_RADIUS_KM);
  // Commerciaux (Ventes « mes documents seulement ») : Mes clients / Mes prospects.
  // Autres utilisateurs : Tous. Droit relu dans Odoo à chaque ouverture, dernière
  // valeur gardée pour l'affichage immédiat et le hors ligne.
  const [ownDocsOnly, setOwnDocsOnly] = useState<boolean>(() => cachedOwnDocsOnly() ?? false);
  // Pas mémorisé : chaque arrivée sur cet écran repart sur « Mes clients ».
  const [scopeChoice, setScopeChoiceState] = useState<"clients" | "prospects">("clients");
  const scope: ClientScope = ownDocsOnly ? scopeChoice : "all";
  useEffect(() => { fetchOwnDocsOnly(session).then(setOwnDocsOnly).catch(() => {}); }, [session]);
  const toggleScope = () => setScopeChoiceState(v => v === "clients" ? "prospects" : "clients");

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        // Nom, référence OU ville — aligné sur la recherche hors ligne (et sur le
        // sous-titre de l'écran, qui promettait déjà la ville).
        const r = await odoo.searchRead(session, "res.partner",
          ["|", "|", ["name", "ilike", q], ["ref", "ilike", q], ["city", "ilike", q], ["active", "=", true], ...scopeDomain(session.uid, scope)],
          CLIENT_FIELDS, 30);
        setResults(r);
      } catch {
        // Réseau indisponible → on cherche dans le cache local préchargé.
        try {
          const cached = await sync.searchCachedClients(q, 5000);
          setResults(cached.filter(c => matchesScope(c, session.uid, scope)).slice(0, 30));
        } catch { setResults([]); }
      }
      setLoading(false);
    }, 300);
  }, [q, session, scope]);

  // Taper dans la recherche désactive le mode localisation (évite la confusion entre les deux listes)
  useEffect(() => { if (q.length >= 2 && locMode) setLocMode(false); }, [q]); // eslint-disable-line

  const enableLocation = async () => {
    setLocError("");
    setLocLoading(true);
    try {
      // Helper qui gère natif (plugin Capacitor) ET web (navigator.geolocation).
      const { latitude, longitude } = await geo.getCurrentPosition();
      let rows: any[];
      try {
        rows = await odoo.searchRead(session, "res.partner",
          [["active", "=", true], ["partner_latitude", "!=", 0], ["partner_longitude", "!=", 0], ...scopeDomain(session.uid, scope)],
          [...CLIENT_FIELDS, "partner_latitude", "partner_longitude"], 3000);
      } catch {
        // Hors ligne → clients géolocalisés depuis le cache préchargé.
        rows = await sync.getCachedClients();
      }
      const withDist = rows
        .filter((r: any) => r.partner_latitude && r.partner_longitude)
        .map((r: any) => ({ ...r, _distKm: haversineKm(latitude, longitude, r.partner_latitude, r.partner_longitude) }))
        .filter((r: any) => r._distKm <= LOC_RADII_KM[LOC_RADII_KM.length - 1])
        .sort((a: any, b: any) => a._distKm - b._distKm);
      setNearby(withDist);
      setLocMode(true);
    } catch (e: any) {
      setLocError(e?.message || "Position indisponible — vérifie l'autorisation de localisation");
    } finally {
      setLocLoading(false);
    }
  };

  // Dédoublonnage à l'affichage : couvre d'un seul coup la recherche en ligne, le
  // repli sur le cache hors ligne et la liste « clients proches ».
  const nearbyShown = nearby.filter(r => r._distKm <= radius);
  const displayed = dedupeClients(q.length >= 2 ? results : (locMode ? nearbyShown : []), scope === "prospects")
    .filter(c => matchesScope(c, session.uid, scope));

  // Agenda + clients prioritaires : affichés tant qu'on ne cherche pas.
  const showWidgets = q.trim().length < 2 && !locMode;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "flex-start",
      padding: showWidgets ? "18px 24px 40px" : "24px 24px 40px", overflowY: "auto" as const,
      // Fond coloré doux : sans lui, l'effet verre des cartes ne se voit pas.
      background: "radial-gradient(circle at 12% 18%, rgba(45,212,191,0.30), transparent 42%), radial-gradient(circle at 88% 26%, rgba(125,211,252,0.28), transparent 44%), radial-gradient(circle at 55% 100%, rgba(253,186,116,0.22), transparent 50%), #eef3f6" }}>
      <div style={{ width: "100%", maxWidth: showWidgets ? 1040 : 640 }}>
        {/* Accueil : bandeau fin (logo + date), la recherche vient tout de suite. */}
        {showWidgets && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset("/logo-accueil.png")} alt="Dr. Hauschka" style={{ display: "block", height: 52, width: "auto" }} />
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 14, fontWeight: 700, color: C.textSec }}>
              {new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }).replace(/^./, c => c.toUpperCase())}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <div style={{ position: "relative" as const, flex: 1 }}>
            <svg style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Chercher un client : nom, référence ou ville"
              style={{ width: "100%", boxSizing: "border-box" as const, padding: "14px 14px 14px 44px", border: `1.5px solid ${C.border}`, borderRadius: 14, fontSize: 16, fontFamily: "inherit", background: C.white, color: C.text, boxShadow: C.shadowMd, outline: "none" }} />
          </div>
          {/* Commerciaux : Mes clients / Mes prospects. Autres : Tous (pas de bascule). */}
          {(() => {
            const prospects = scope === "prospects";
            const on = scope === "clients";
            return (
              <button onClick={ownDocsOnly ? toggleScope : undefined} disabled={!ownDocsOnly}
                title={!ownDocsOnly ? "Tous les clients"
                  : prospects ? "Mes prospects (réf. XX-…) — toucher pour mes clients" : "Mes clients — toucher pour mes prospects"}
                style={{ flexShrink: 0, padding: "0 12px", display: "flex", alignItems: "center", gap: 6, background: on ? C.teal : prospects ? C.orangeSoft : C.white, border: `1.5px solid ${on ? C.teal : prospects ? C.orange : C.border}`, borderRadius: 14, cursor: ownDocsOnly ? "pointer" : "default", boxShadow: C.shadowMd, color: on ? "#fff" : prospects ? C.orange : C.textSec, fontFamily: "inherit", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" as const }}>
                <Icon name="user" size={18} />{!ownDocsOnly ? "Tous" : prospects ? "Mes prospects" : "Mes clients"}
              </button>
            );
          })()}
          <button
            onClick={() => locMode ? setLocMode(false) : enableLocation()}
            title="Proposer les clients les plus proches de ma position"
            disabled={locLoading}
            style={{ flexShrink: 0, width: 50, display: "flex", alignItems: "center", justifyContent: "center", background: locMode ? C.teal : C.white, border: `1.5px solid ${locMode ? C.teal : C.border}`, borderRadius: 14, cursor: locLoading ? "default" : "pointer", boxShadow: C.shadowMd, color: locMode ? "#fff" : C.textSec }}>
            {locLoading ? "…" : <Icon name="pin" size={20} />}
          </button>
          {/* Bon reçu du client : le client est retrouvé d'après le document */}
          <button onClick={onImportBon}
            title="Importer un bon de commande (PDF ou photo)"
            aria-label="Importer un bon de commande"
            style={{ flexShrink: 0, width: 50, display: "flex", alignItems: "center", justifyContent: "center", background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 14, cursor: "pointer", boxShadow: C.shadowMd, color: C.textSec }}>
            <Icon name="file" size={20} />
          </button>
        </div>

        {locMode && !locLoading && !locError && (
          <div style={{ marginBottom: 10, textAlign: "center" as const }}>
            {/* Rayon de recherche : 1 km par défaut, élargissable */}
            <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" as const, justifyContent: "center", marginBottom: 6 }}>
              {LOC_RADII_KM.map(km => (
                <button key={km} onClick={() => setRadius(km)}
                  style={{ padding: "5px 11px", borderRadius: 999, border: `1.5px solid ${radius === km ? C.teal : C.border}`, background: radius === km ? C.teal : C.white, color: radius === km ? "#fff" : C.textSec, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  {km} km
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: nearbyShown.length ? C.teal : C.red, fontWeight: 600 }}>
              {nearbyShown.length
                ? <>Clients à moins de {fmtDistance(radius)} — {nearbyShown.length} résultat{nearbyShown.length > 1 ? "s" : ""}</>
                : <>Aucun client à moins de {fmtDistance(radius)} — élargis le rayon</>}
            </div>
          </div>
        )}
        {locError && (
          <div style={{ fontSize: 12, color: C.red, background: C.redSoft, borderRadius: 10, padding: "8px 12px", marginBottom: 10, textAlign: "center" as const }}>
            {locError}
          </div>
        )}

        {(loading || locLoading) && displayed.length === 0 && <ListSkeleton count={3} height={72} style={{ marginBottom: 8 }} />}
        {(loading || locLoading) && <div className="fade-in" style={{ textAlign: "center", color: C.muted, padding: "4px 12px 10px", fontSize: 13 }}>{locLoading ? "Localisation en cours…" : "Recherche en cours…"}</div>}

        <div className="stagger" style={{ display: "flex", flexDirection: "column" as const, gap: 8, maxHeight: "50vh", overflowY: "auto" as const }}>
          {displayed.map(c => (
            <button key={c.id} onClick={() => onSelect(c)}
              style={{ padding: "14px 16px", background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 14, cursor: "pointer", textAlign: "left" as const, fontFamily: "inherit", boxShadow: C.shadow, transition: "all 0.12s", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: `hsl(${c.id % 360}, 60%, 90%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, color: `hsl(${c.id % 360}, 60%, 35%)`, flexShrink: 0 }}>
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{c.name}</div>
                <div style={{ fontSize: 12, color: C.muted, marginTop: 2, display: "flex", gap: 10, flexWrap: "wrap" as const }}>
                  {c.ref && <span>Réf: {c.ref}</span>}
                  {c.city && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="pin" size={11} /> {c.city}</span>}
                  {c.phone && <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="phone" size={11} /> {c.phone}</span>}
                </div>
              </div>
              {typeof c._distKm === "number" && (
                <div style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: C.tealSoft, borderRadius: 8, padding: "3px 8px", flexShrink: 0 }}>
                  {fmtDistance(c._distKm)}
                </div>
              )}
              {c.property_product_pricelist && (
                <div style={{ fontSize: 11, fontWeight: 600, color: C.teal, background: C.tealSoft, borderRadius: 8, padding: "3px 8px", flexShrink: 0 }}>
                  {c.property_product_pricelist[1]}
                </div>
              )}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          ))}

          {/* Aucun résultat sur une recherche active → aide contextuelle (utile hors ligne) */}
          {q.length >= 2 && !loading && displayed.length === 0 && (
            <div style={{ textAlign: "center" as const, color: C.muted, padding: 16, fontSize: 13, lineHeight: 1.5 }}>
              Aucun client trouvé.
              {typeof navigator !== "undefined" && !navigator.onLine && (
                <><br />Tu es hors ligne : seuls les clients préchargés sont disponibles.
                Reconnecte-toi et lance « Préparer le hors-ligne » pour mettre le cache à jour.</>
              )}
            </div>
          )}
        </div>
      </div>

      {showWidgets && (
        <div className="stagger" style={{ width: "100%", maxWidth: 1040, marginTop: 2, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 18, alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 18, minWidth: 0 }}>
            <AgendaGlass session={session} onOpenPlanning={onOpenPlanning} onOpenClient={onOpenPartner} onOrder={onOrderPartner} />
            {/* Messages du service client sur mes commandes (chatter), en attente de réponse — sous l'agenda */}
            <OrderMessages session={session} onEdit={onEditOrder} />
            {/* Commandes portail (WALA) à valider — les miennes seulement */}
            <PortalOrders session={session} onToast={onToast} onComplete={onCompletePortal} />
          </div>
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 18, minWidth: 0 }}>
            {/* Reprendre : brouillons en cours + derniers clients ouverts, en un tap */}
            {(drafts.length > 0 || recents.length > 0) && (
              <div style={{ ...GLASS, padding: 18 }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: C.text, marginBottom: 10 }}>Reprendre</div>
                {drafts.slice(0, 3).map(({ clientId, draft: d }) => {
                  const lines = Object.values(d.cart).filter(i => !i.note);
                  const total = lines.reduce((t, i) => t + i.qty * i.unitPrice, 0);
                  return (
                    <button key={clientId} onClick={() => onResumeDraft(d)}
                      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 48, padding: "8px 12px", marginBottom: 6, borderRadius: 14, border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const, background: "rgba(255,255,255,0.75)" }}>
                      <span style={{ width: 34, height: 34, borderRadius: 10, background: "#fef9c3", color: "#92400e", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Icon name="cart" size={16} /></span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{d.client?.name}</span>
                        <span style={{ display: "block", fontSize: 11.5, color: C.textSec }}>Commande en cours · {lines.length} article{lines.length > 1 ? "s" : ""} · {fmtPrice(total)}</span>
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: C.tealDark, flexShrink: 0 }}>Reprendre →</span>
                    </button>
                  );
                })}
                {recents.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6, marginTop: drafts.length ? 6 : 0 }}>
                    {recents.slice(0, 6).map(c => (
                      <button key={c.id} onClick={() => onSelect(c)}
                        style={{ ...GLASS_PILL, maxWidth: "100%", height: 38, padding: "0 14px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700, color: C.text, background: "rgba(255,255,255,0.8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                        {c.name}{c.city ? <span style={{ fontWeight: 500, color: C.textSec }}> · {c.city}</span> : null}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <VisitPriority session={session} onOpenClient={onSelect} />
          </div>
        </div>
      )}
      {/* Version de l'app (un tap : journal des nouveautés) */}
      <VersionFooter style={{ marginTop: "auto", paddingTop: 24 }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HUB CLIENT — écran d'accueil une fois le client sélectionné
// ═══════════════════════════════════════════════════════════════════════════
function ClientHub({ session, client, hasDraft, onPrep, onOrder, onHistory, onAppointment, onNote, onNoteRec, onPerime, onImportBon }: {
  session: odoo.OdooSession; client: any; hasDraft: boolean;
  onPrep: () => void;
  onOrder: () => void; onHistory: () => void; onAppointment: () => void; onNote: () => void; onNoteRec: () => void;
  onPerime: () => void;
  onImportBon: () => void;
}) {
  const [stats, setStats] = useState<{ ca: number; count: number; lastDate: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    (async () => {
      try {
        const yearAgo = new Date();
        yearAgo.setFullYear(yearAgo.getFullYear() - 1);
        const yearAgoStr = toOdooDateStr(yearAgo);
        // Limite 0 = toutes les commandes (2 champs légers) — avant, le plafond de
        // 300 faussait le compteur et le CA des gros clients.
        const rows = await odoo.searchRead(session, "sale.order",
          [["partner_id", "=", client.id], ["state", "in", ["sale", "done"]]],
          ["amount_total", "date_order"], 0, "date_order desc");
        if (cancelled) return;
        const ca = rows
          .filter((r: any) => r.date_order && r.date_order >= yearAgoStr)
          .reduce((s: number, r: any) => s + (r.amount_total || 0), 0);
        const s = { ca, count: rows.length, lastDate: rows[0]?.date_order || null };
        setStats(s);
        sync.cacheClientData(client.id, { stats: s }).catch(() => {});
      } catch {
        // Hors ligne → stats CA préchargées pour ce client (si dispo)
        const cached = await sync.getCachedStats(client.id).catch(() => undefined);
        if (!cancelled) setStats(cached || { ca: 0, count: 0, lastDate: null });
      }
    })();
    return () => { cancelled = true; };
  }, [session, client.id]);

  const lastDateLabel = stats?.lastDate
    ? odooToLocalDate(stats.lastDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
    : "—";

  // Évolution CA N/N-1 : lue directement sur la fiche client, donc disponible hors
  // ligne sans appel supplémentaire (contrairement aux stats calculées sur sale.order).
  // CA à date N vs CA à date N-1 (champs Odoo, relus à l'ouverture de la fiche).
  // Odoo renvoie `false` — et non 0 — quand un champ n'est pas rempli.
  const [caDate, setCaDate] = useState<{ n: number | null; n1: number | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCaDate(null);
    (async () => {
      const f = await caDateFields(session);
      if (!f.n) return;
      const [r] = await odoo.searchRead(session, "res.partner", [["id", "=", client.id]], [f.n, ...(f.n1 ? [f.n1] : [])], 1).catch(() => []);
      if (!cancelled && r) setCaDate({ n: typeof r[f.n] === "number" ? r[f.n] : null, n1: f.n1 && typeof r[f.n1] === "number" ? r[f.n1] : null });
    })();
    return () => { cancelled = true; };
  }, [client.id, session]);
  const caDateN = caDate?.n ?? (typeof client.x_ca_a_date_n === "number" ? client.x_ca_a_date_n : null);
  const caDateN1 = caDate?.n1 ?? null;
  const evoRatio = caDateN != null && caDateN1 ? (caDateN - caDateN1) / caDateN1
    : typeof client.x_evolution_ca_n_n_1 === "number" ? client.x_evolution_ca_n_n_1 : null;
  const evolutionValue = evoRatio ?? 0;
  const evolution = fmtEvolution(evoRatio);
  // Montant de référence sous le pourcentage : CA à date N-1 (sinon CA N-1).
  const caN1 = caDateN1 != null ? fmtPrice(caDateN1) : typeof client.x_ca_n_1 === "number" ? fmtPrice(client.x_ca_n_1) : null;
  const evoLabel = caDateN1 != null ? "vs CA à date N-1" : "Évolution CA N-1";

  // Prospect : prise de commande, prise de RDV, note client et chargement de commande actifs.
  const prospect = isProspect(client);
  const PROSPECT_OK = new Set(["order", "rdv", "note", "bon"]);
  // Refonte : une seule carte accentuée (l'action principale), les autres en blanc.
  const cards = [
    { key: "order", icon: "cart", title: "Prise de commande", subtitle: hasDraft ? "Brouillon en attente" : "Nouveau devis", primary: true, badge: hasDraft, onClick: onOrder },
    { key: "prep", icon: "list", title: "Préparer le RDV", subtitle: "CA, offres du cycle, propositions", primary: false, badge: false, onClick: onPrep },
    { key: "bon", icon: "wand", title: "Charger la commande", subtitle: "PDF, Excel, Word, JPG, PNG, etc.", primary: false, badge: false, onClick: onImportBon },
    { key: "history", icon: "clock", title: "Historique", subtitle: "Commandes passées", primary: false, badge: false, onClick: onHistory },
    { key: "rdv", icon: "calendar", title: "Prendre un RDV", subtitle: "Agenda Odoo", primary: false, badge: false, onClick: onAppointment },
    { key: "note", icon: "note", title: "Note client", subtitle: "Compte rendu, vocal ou écrit", primary: false, badge: false, onClick: onNote },
    { key: "perime", icon: "package", title: "Retour périmés", subtitle: "Reprise + échange", primary: false, badge: false, onClick: onPerime },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", padding: "28px 24px", overflowY: "auto" as const }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        {/* Carte identité client */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 22 }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: C.teal, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800, color: "#fff", flexShrink: 0, boxShadow: "0 8px 20px rgba(13,148,136,0.3)" }}>
            {client.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: C.text, lineHeight: 1.2 }}>{client.name}</div>
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 10, marginTop: 6 }}>
              {client.ref && <span style={{ fontSize: 12, color: C.muted }}>Réf: {client.ref}</span>}
              {client.city && <span style={{ fontSize: 12, color: C.muted, display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="pin" size={11} /> {client.city}</span>}
              {client.phone && <span style={{ fontSize: 12, color: C.muted, display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="phone" size={11} /> {client.phone}</span>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 8, marginTop: 8 }}>
              {client.property_product_pricelist && (
                <div style={{ fontSize: 11, fontWeight: 700, color: C.teal, background: C.tealSoft, borderRadius: 8, padding: "3px 9px" }}>
                  {client.property_product_pricelist[1]}
                </div>
              )}
              {typeof client.x_nbre_visites_realisees === "number" && (
                <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", background: "#f5f3ff", borderRadius: 8, padding: "3px 9px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icon name="calendar" size={11} /> {client.x_nbre_visites_realisees} visite{client.x_nbre_visites_realisees > 1 ? "s" : ""} cette année
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Statistiques client */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 18 }}>
          <div style={{ background: "#0f766e", borderRadius: 16, padding: "14px 16px", color: "#fff", boxShadow: "0 8px 20px rgba(13,148,136,0.25)" }}>
            {/* CA à date N (champ Odoo, depuis le 1er janvier) ; repli sur le CA 12 mois calculé. */}
            <div style={{ fontSize: 19, fontWeight: 800 }}>{caDateN != null ? fmtPrice(caDateN) : stats ? fmtPrice(stats.ca) : "…"}</div>
            <div style={{ fontSize: 10.5, opacity: 0.85, fontWeight: 600, marginTop: 2, textTransform: "uppercase" as const, letterSpacing: "0.03em" }}>{caDateN != null ? "CA à date N" : "CA 12 mois"}</div>
          </div>
          <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: "14px 16px", boxShadow: C.shadow }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: evolution === null ? C.muted : (evolutionValue >= 0 ? C.green : C.red) }}>
              {evolution ?? "—"}
            </div>
            {caN1 && (
              <div style={{ fontSize: 12, fontWeight: 700, color: C.textSec, marginTop: 1 }}>{caN1}</div>
            )}
            <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 2, textTransform: "uppercase" as const, letterSpacing: "0.03em" }}>{evoLabel}</div>
          </div>
          <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: "14px 16px", boxShadow: C.shadow }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: C.text }}>{lastDateLabel}</div>
            <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 2, textTransform: "uppercase" as const, letterSpacing: "0.03em" }}>Dernière cmd</div>
          </div>
        </div>

        {/* Action principale en bandeau, les autres en tuiles compactes (tout tient à l'écran) */}
        {cards.filter(c => c.primary).map(c => (
          <button key={c.key} onClick={c.onClick}
            style={{ position: "relative" as const, width: "100%", display: "flex", alignItems: "center", gap: 16, textAlign: "left" as const, padding: "16px 20px", marginBottom: 12, borderRadius: 18,
              border: "none", background: C.teal, color: "#fff", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 10px 24px rgba(13,148,136,0.25)" }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name={c.icon} size={25} color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{c.title}</div>
              <div style={{ fontSize: 12.5, opacity: 0.88, marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
                {c.badge && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#fde047", flexShrink: 0 }} />}
                {c.subtitle}
              </div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" style={{ flexShrink: 0, opacity: 0.9 }}><path d="M9 18l6-6-6-6"/></svg>
          </button>
        ))}
        <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
          {cards.filter(c => !c.primary).map(c => {
            const off = prospect && !PROSPECT_OK.has(c.key);
            return (
            <button key={c.key} onClick={off ? undefined : c.onClick} disabled={off}
              title={off ? "Non disponible pour un prospect" : undefined}
              style={{ position: "relative" as const, textAlign: "left" as const, padding: "14px 14px", borderRadius: 16, border: `1.5px solid ${C.border}`, background: C.white, color: C.text,
                cursor: off ? "not-allowed" : "pointer", opacity: off ? 0.4 : 1, fontFamily: "inherit", boxShadow: C.shadow, minWidth: 0 }}>
              {/* Note client : bouton REC → dictée immédiate */}
              {c.key === "note" && !off && (
                <span role="button" tabIndex={0} aria-label="Dicter une note tout de suite" title="Dicter une note tout de suite"
                  onClick={e => { e.stopPropagation(); onNoteRec(); }}
                  style={{ position: "absolute" as const, top: 8, right: 8, height: 36, padding: "0 11px", borderRadius: 999, background: C.bg, border: `1px solid ${C.border}`, color: C.textSec, display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.red }} /> REC
                </span>
              )}
              <div style={{ width: 38, height: 38, borderRadius: 11, marginBottom: 10, background: C.tealSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name={c.icon} size={20} color={C.teal} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{c.title}</div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{c.subtitle}</div>
            </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Suivi des gratuités (onglet « Suivi Gratuité » de la fiche client Odoo) ───
// Champs Studio, en paires Quota / Restant. La CONSOMMATION n'est pas stockée :
// c'est Quota − Restant. Ces champs ne portent AUCUN historique (contrairement au
// CA qui a x_ca_n_1 / x_ca_n_2), ils reflètent donc uniquement l'état courant —
// d'où l'affichage réservé à l'année en cours.
const GIFT_QUOTAS: { label: string; quota: string; left: string }[] = [
  { label: "Testeurs VC",  quota: "x_studio_testeurs_quota",      left: "x_studio_testeurs_restant" },
  { label: "Testeurs MAQ", quota: "x_studio_testeurs_maq_quota",  left: "x_studio_testeurs_maq_restant" },
  { label: "Échantillons", quota: "x_studio_echantillons_quota",  left: "x_studio_echantillons_restant" },
  { label: "Travel Size",  quota: "x_studio_travel_size_quota",   left: "x_studio_travel_size_restant" },
  { label: "Miniatures",   quota: "x_studio_miniatures_quota",    left: "x_studio_miniatures_restant" },
  { label: "Sacs",         quota: "x_studio_sacs_quota",          left: "x_studio_sacs_restant" },
];

// Périmés : valeurs monétaires, pas des quantités — affichées à part.
const GIFT_EXPIRED = { asked: "x_valeurs_perimes_demandes", granted: "x_valeurs_perimes_accordes" };

const GIFT_FIELDS = [
  ...GIFT_QUOTAS.flatMap(g => [g.quota, g.left]),
  GIFT_EXPIRED.asked, GIFT_EXPIRED.granted,
];

// Odoo renvoie `false` pour un champ numérique vide — jamais 0.
function num(v: unknown): number { return typeof v === "number" && isFinite(v) ? v : 0; }

// ═══════════════════════════════════════════════════════════════════════════
// HISTORIQUE DES COMMANDES — devis/commandes passés de ce client
// ═══════════════════════════════════════════════════════════════════════════
function ClientHistory({ session, client }: { session: odoo.OdooSession; client: any }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);

  // Onglets : commandes / palmarès produits / MEA / gratuités — + année sélectionnée.
  const [mode, setMode] = useState<"orders" | "ranking" | "mea" | "gifts" | "invoices">("orders");
  const nowYear = new Date().getFullYear();
  const [year, setYear] = useState(nowYear);
  const YEARS = [nowYear, nowYear - 1, nowYear - 2];

  // Palmarès + MEA : chargés à la demande (lignes de commandes confirmées de l'année).
  const [ranking, setRanking] = useState<any[]>([]);
  // Palmarès : période libre (comparée à la même période N-1) et tri.
  const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const yearRange = (yy: number) => ({ from: `${yy}-01-01`, to: yy === new Date().getFullYear() ? ymdLocal(new Date()) : `${yy}-12-31` });
  const [rkRange, setRkRange] = useState(() => yearRange(new Date().getFullYear()));
  const [rkSort, setRkSort] = useState<"qty" | "n1" | "drop" | "rise">("qty");
  const [rkFilter, setRkFilter] = useState<"all" | "neg" | "pos">("all");   // tous / en baisse / en hausse
  const [rkSearch, setRkSearch] = useState("");                               // recherche d'un produit
  const [meaOrders, setMeaOrders] = useState<any[]>([]);
  // Devis d'implantation : séparés des MEA, devis non confirmés compris.
  const [implantOrders, setImplantOrders] = useState<any[]>([]);
  const [offerLabels, setOfferLabels] = useState<Map<number, string>>(new Map());
  const [meta, setMeta] = useState<OrderMeta | null>(null);
  const [analyLoading, setAnalyLoading] = useState(false);

  // Gratuités : quotas Studio (état courant, fiche client) + consommation de l'année
  // recalculée depuis les lignes de commande (seule source qui porte un historique).
  const [giftQuotas, setGiftQuotas] = useState<Record<string, number> | null>(null);
  const [giftYearLines, setGiftYearLines] = useState<{ label: string; qty: number; lines: number; detail: { product: string; qty: number; order: string; date: string }[] }[]>([]);
  const [giftOpen, setGiftOpen] = useState<string | null>(null);
  const [giftTypes, setGiftTypes] = useState<sync.FreeType[]>([]);

  useEffect(() => {
    if (mode !== "gifts") return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await odoo.searchRead(session, "res.partner", [["id", "=", client.id]], GIFT_FIELDS, 1);
        if (cancelled) return;
        const v = (rows && rows[0]) || {};
        const flat: Record<string, number> = {};
        for (const f of GIFT_FIELDS) flat[f] = num(v[f]);
        setGiftQuotas(flat);
        sync.cacheClientData(client.id, { gifts: flat }).catch(() => {});
      } catch {
        // Hors ligne → derniers quotas connus pour ce client.
        const cached = await sync.getCachedGifts(client.id).catch(() => undefined);
        if (!cancelled) setGiftQuotas(cached || null);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, session, client.id]);

  useEffect(() => {
    if (mode !== "gifts" || giftTypes.length) return;
    sync.loadFreeTypes(session).then(setGiftTypes).catch(() => {});
  }, [mode, session, giftTypes.length]);

  useEffect(() => {
    if (mode === "orders" || mode === "invoices") return;
    let cancelled = false;
    (async () => {
      setAnalyLoading(true);
      try {
        const start = `${year}-01-01 00:00:00`;
        const end = `${year}-12-31 23:59:59`;
        // TOUTES les fiches du client (société, adresses, doublons du même code) :
        // une MEA passée sur l'adresse de livraison n'apparaissait pas.
        const [m, family] = await Promise.all([
          orderMeta(session).catch(() => ({ implantValues: [], typeOptions: [] } as OrderMeta)),
          resolveClientFamily(session, client).catch(() => [client.id]),
        ]);
        if (cancelled) return;
        setMeta(m);
        const extra = [m.offersField, m.typeField].filter((f): f is string => !!f);
        const orderFields = ["id", "name", "date_order", "amount_total", "state", "sale_order_template_id", ...extra];
        const inYear = [["partner_id", "child_of", family], ["date_order", ">=", start], ["date_order", "<=", end]];
        const yearOrders = await odoo.searchRead(session, "sale.order",
          [...inYear, ["state", "in", ["sale", "done"]]], orderFields, 300, "date_order desc");
        if (cancelled) return;

        // MEA = commande portant des « Offres commandées » (ou un modèle de
        // devis), hors devis d'implantation, affichés à part.
        if (mode === "mea") {
          const mea = yearOrders.filter((o: any) => isMea(o, m) && !isImplantation(o, m));
          // Implantations : devis non confirmés compris (c'est souvent leur état).
          const allYear = await odoo.searchRead(session, "sale.order",
            [...inYear, ["state", "!=", "cancel"]], orderFields, 300, "date_order desc");
          if (cancelled) return;
          setImplantOrders(allYear.filter((o: any) => isImplantation(o, m)));
          setOfferLabels(await offerNames(session, mea, m));
          setMeaOrders(mea);
        }

        // Palmarès : quantités vendues sur la période choisie, comparées à la
        // même période N-1 (articles achetés en N-1 seulement compris : ce sont
        // les plus grosses baisses).
        if (mode === "ranking") {
          const shift = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
          // Quantités LIVRÉES : mouvements de stock terminés vers le client,
          // moins les retours, sans les gratuités (comme « Préparer le RDV »).
          const period = (from: string, to: string) => deliveredMoves(session, [["picking_id.partner_id", "child_of", family]], from, to);
          const [cur, prev] = await Promise.all([period(rkRange.from, rkRange.to), period(shift(rkRange.from), shift(rkRange.to))]);
          if (cancelled) return;
          const agg = new Map<number, { name: string; qty: number; times: number; total: number; qtyN1: number; totalN1: number; orders: Set<number> }>();
          const add = (l: DeliveredRow, n1: boolean) => {
            if (l.archived) return;   // produit archivé : sans intérêt dans les stats
            const c = agg.get(l.pid) || { name: l.label, qty: 0, times: 0, total: 0, qtyN1: 0, totalN1: 0, orders: new Set<number>() };
            if (n1) { c.qtyN1 += l.qty; c.totalN1 += l.amount; }
            else { c.qty += l.qty; c.total += l.amount; if (l.picking && l.qty > 0) c.orders.add(l.picking); c.times = c.orders.size; }
            agg.set(l.pid, c);
          };
          cur.forEach(l => add(l, false)); prev.forEach(l => add(l, true));
          setRanking(Array.from(agg.values()));
        }

        // Gratuités consommées sur l'année : lignes portant un type_gratuit.
        // Les quotas Odoo n'ont pas d'historique, c'est la seule façon d'avoir
        // les années précédentes.
        if (mode === "gifts") {
          if (!yearOrders.length) { setGiftYearLines([]); }
          else {
            const ids = yearOrders.map((o: any) => o.id);
            const lines = await odoo.searchRead(session, "sale.order.line",
              [["order_id", "in", ids], ["type_gratuit", "!=", false], ["display_type", "=", false]],
              ["product_uom_qty", "type_gratuit", "product_id", "order_id"], 2000);
            if (cancelled) return;
            const oDate = new Map<number, string>(yearOrders.map((o: any) => [o.id, String(o.date_order || "")]));
            const agg = new Map<string, { qty: number; lines: number; detail: { product: string; qty: number; order: string; date: string }[] }>();
            for (const l of lines) {
              const key = String(l.type_gratuit || "");
              if (!key) continue;
              const cur = agg.get(key) || { qty: 0, lines: 0, detail: [] };
              cur.qty += l.product_uom_qty || 0; cur.lines += 1;
              const oid = Array.isArray(l.order_id) ? l.order_id[0] : 0;
              cur.detail.push({ product: Array.isArray(l.product_id) ? String(l.product_id[1]) : "", qty: l.product_uom_qty || 0,
                order: Array.isArray(l.order_id) ? String(l.order_id[1]) : "", date: oDate.get(oid) || "" });
              agg.set(key, cur);
            }
            agg.forEach(v => v.detail.sort((a, b) => b.date.localeCompare(a.date)));
            setGiftYearLines(
              Array.from(agg.entries())
                .map(([value, v]) => ({ label: value, qty: v.qty, lines: v.lines, detail: v.detail }))
                .sort((a, b) => b.qty - a.qty)
            );
          }
        }
      } catch {
        setRanking([]); setMeaOrders([]); setImplantOrders([]); setGiftYearLines([]);
      }
      setAnalyLoading(false);
    })();
    return () => { cancelled = true; };
  }, [mode, year, session, client.id, rkRange.from, rkRange.to]);

  const openOrder = (o: any) => setSelectedOrder(o);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const rows = await odoo.searchRead(session, "sale.order",
          [["partner_id", "=", client.id]],
          ["id", "name", "date_order", "amount_total", "state"], 60, "date_order desc");
        setOrders(rows);
        sync.cacheClientData(client.id, { history: rows }).catch(() => {});
      } catch (e: any) {
        // Hors ligne → historique préchargé pour ce client (si dispo)
        const cached = await sync.getCachedHistory(client.id).catch(() => undefined);
        if (cached) setOrders(cached);
        else setError("Historique indisponible hors ligne pour ce client");
      }
      setLoading(false);
    })();
  }, [session, client.id]);

  const stateInfo: Record<string, { label: string; color: string; bg: string }> = {
    draft:    { label: "Devis",     color: C.muted,  bg: C.bg },
    sent:     { label: "Envoyé",    color: C.blue,   bg: C.blueSoft },
    sale:     { label: "Confirmée", color: C.green,  bg: C.greenSoft },
    done:     { label: "Terminée",  color: C.teal,   bg: C.tealSoft },
    cancel:   { label: "Annulée",   color: C.red,    bg: C.redSoft },
  };

  const TABS: { id: "orders" | "ranking" | "mea" | "gifts" | "invoices"; label: string }[] = [
    { id: "orders", label: "Commandes" },
    { id: "invoices", label: "Factures" },
    { id: "ranking", label: "Palmarès" },
    { id: "mea", label: "MEA" },
    { id: "gifts", label: "Gratuités" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", padding: "32px 24px", overflowY: "auto" as const }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>{client.name}</div>

        {/* Barre d'onglets */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16, background: C.bg, borderRadius: 12, padding: 4 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setMode(t.id)}
              style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                background: mode === t.id ? C.white : "transparent", color: mode === t.id ? C.tealDark : C.muted, boxShadow: mode === t.id ? C.shadow : "none" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Sélecteur d'année (palmarès + MEA) */}
        {mode !== "orders" && (
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {YEARS.map(y => (
              <button key={y} onClick={() => { setYear(y); setRkRange(yearRange(y)); }}
                style={{ padding: "6px 16px", borderRadius: 999, border: `1.5px solid ${year === y ? C.teal : C.border}`, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                  background: year === y ? C.teal : C.white, color: year === y ? "#fff" : C.textSec }}>
                {y}
              </button>
            ))}
          </div>
        )}

        {/* ── Onglet FACTURES (factures + avoirs, avoir → facture) ── */}
        {mode === "invoices" && <InvoiceHistory session={session} client={client} year={year} />}

        {/* ── Onglet PALMARÈS ── */}
        {mode === "ranking" && (() => {
          const sorted = [...ranking].filter(r => (r.qty > 0 || r.qtyN1 > 0)
            && (rkFilter === "all" || (rkFilter === "neg" ? r.qty < r.qtyN1 : r.qty > r.qtyN1))
            && (!rkSearch.trim() || rkSearch.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).every(w =>
              `${r.name || ""} ${r.code || ""} ${r.default_code || ""} ${r.label || ""}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(w)))).sort((a, b) =>
            rkSort === "qty" ? b.qty - a.qty || b.qtyN1 - a.qtyN1
            : rkSort === "n1" ? b.qtyN1 - a.qtyN1
            : rkSort === "drop" ? (a.qty - a.qtyN1) - (b.qty - b.qtyN1)
            : (b.qty - b.qtyN1) - (a.qty - a.qtyN1));
          const totQ = ranking.reduce((t, r) => t + r.qty, 0), totN1 = ranking.reduce((t, r) => t + r.qtyN1, 0);
          const fmtD = (d: string) => d.split("-").reverse().join("/");
          return (<>
            {/* Période + tri */}
            <div style={{ display: "flex", flexWrap: "wrap" as const, alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12.5, color: C.textSec }}>
              <span style={{ fontWeight: 700 }}>Du</span>
              <input type="date" value={rkRange.from} onChange={e => e.target.value && setRkRange(r => ({ ...r, from: e.target.value }))}
                style={{ height: 32, padding: "0 8px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12.5 }} />
              <span style={{ fontWeight: 700 }}>au</span>
              <input type="date" value={rkRange.to} onChange={e => e.target.value && setRkRange(r => ({ ...r, to: e.target.value }))}
                style={{ height: 32, padding: "0 8px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12.5 }} />
              {/* Filtre : écarts négatifs / positifs */}
              <div style={{ display: "flex", gap: 4 }}>
                {([["all", "Tous", C.tealDark], ["neg", "En baisse", C.red], ["pos", "En hausse", C.green]] as const).map(([v, l, col]) => {
                  const n = v === "all" ? ranking.filter(r => r.qty > 0 || r.qtyN1 > 0).length : ranking.filter(r => v === "neg" ? r.qty < r.qtyN1 : r.qty > r.qtyN1).length;
                  const on = rkFilter === v;
                  return (
                    <button key={v} onClick={() => { setRkFilter(v); if (v === "neg") setRkSort("drop"); else if (v === "pos") setRkSort("rise"); }}
                      style={{ height: 32, padding: "0 10px", borderRadius: 999, border: `1.5px solid ${on ? col : C.border}`, background: on ? col : C.white, color: on ? "#fff" : col, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                      {l} ({n})
                    </button>
                  );
                })}
              </div>
              <select value={rkSort} onChange={e => setRkSort(e.target.value as any)}
                style={{ marginLeft: "auto", height: 32, padding: "0 8px", borderRadius: 8, border: `1px solid ${C.border}`, fontFamily: "inherit", fontSize: 12.5, background: C.white }}>
                <option value="qty">Tri : quantités période</option>
                <option value="n1">Tri : quantités N-1</option>
                <option value="drop">Tri : plus grosses baisses</option>
                <option value="rise">Tri : plus grosses hausses</option>
              </select>
            </div>
            <div style={{ position: "relative" as const, marginBottom: 10 }}>
              <span style={{ position: "absolute" as const, left: 10, top: 8, color: C.muted, pointerEvents: "none" as const }}><Icon name="search" size={15} /></span>
              <input value={rkSearch} onChange={e => setRkSearch(e.target.value)} placeholder="Rechercher un produit (nom, référence)…"
                style={{ width: "100%", boxSizing: "border-box" as const, height: 34, padding: "0 32px 0 32px", borderRadius: 10, border: `1px solid ${rkSearch ? C.teal : C.border}`, fontFamily: "inherit", fontSize: 13, background: C.white }} />
              {rkSearch && <button onClick={() => setRkSearch("")} aria-label="Effacer" style={{ position: "absolute" as const, right: 6, top: 5, width: 24, height: 24, border: "none", background: "none", color: C.muted, cursor: "pointer", fontSize: 15 }}>×</button>}
            </div>
            {!analyLoading && ranking.length > 0 && (
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
                {Math.round(totQ)} unités livrées (retours déduits, hors gratuités) du {fmtD(rkRange.from)} au {fmtD(rkRange.to)} · {Math.round(totN1)} sur la même période N-1
                <span style={{ fontWeight: 800, color: totQ >= totN1 ? C.green : C.red }}> ({totQ >= totN1 ? "+" : ""}{Math.round(totQ - totN1)})</span>
              </div>
            )}
            {analyLoading ? <TubeLoader label="Calcul du palmarès…" />
            : sorted.length === 0 ? <div style={{ textAlign: "center" as const, color: C.muted, padding: 40 }}>Aucun produit livré sur la période ni sur la même période N-1</div>
            : (
              <div className="stagger" style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                <div style={{ display: "flex", gap: 12, padding: "0 14px", fontSize: 10.5, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const }}>
                  <span style={{ flex: 1 }}>Produit</span><span style={{ width: 54, textAlign: "right" as const }}>Période</span><span style={{ width: 54, textAlign: "right" as const }}>N-1</span><span style={{ width: 54, textAlign: "right" as const }}>Écart</span>
                </div>
                {sorted.map((r, i) => {
                  const diff = r.qty - r.qtyN1;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: C.white, border: `1px solid ${C.border}`, borderLeft: `4px solid ${diff < 0 ? C.red : diff > 0 ? C.green : C.border}`, borderRadius: 12, boxShadow: C.shadow }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{r.times ? `${r.times} livraison${r.times > 1 ? "s" : ""}` : "aucune livraison sur la période"}</div>
                      </div>
                      <div style={{ width: 54, textAlign: "right" as const, fontSize: 15, fontWeight: 800, color: C.tealDark }}>{Math.round(r.qty)}</div>
                      <div style={{ width: 54, textAlign: "right" as const, fontSize: 13.5, fontWeight: 700, color: C.textSec }}>{Math.round(r.qtyN1)}</div>
                      <div style={{ width: 54, textAlign: "right" as const, fontSize: 13.5, fontWeight: 800, color: diff < 0 ? C.red : diff > 0 ? C.green : C.muted }}>{diff > 0 ? "+" : ""}{Math.round(diff)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </>);
        })()}

        {/* ── Onglet MEA ── */}
        {mode === "mea" && (
          analyLoading ? <TubeLoader label="Chargement des offres…" />
          : (
            <div className="stagger" style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
              {meaOrders.length === 0 && <div style={{ textAlign: "center" as const, color: C.muted, padding: 24 }}>Aucune MEA commandée en {year}</div>}
              {meaOrders.map(o => (
                <button key={o.id} onClick={() => openOrder(o)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: C.shadow, cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const, width: "100%" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                      {(meta?.offersField && (o[meta.offersField] || []).map((id: number) => offerLabels.get(id)).filter(Boolean).join(" · "))
                        || o.sale_order_template_id?.[1] || "Offre"}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{o.name} · {o.date_order ? fmtDate(new Date(o.date_order.replace(" ", "T") + "Z").getTime()) : "—"}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.tealDark, flexShrink: 0 }}>{fmtPrice(o.amount_total)}</div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6"/></svg>
                </button>
              ))}

              {/* Devis d'implantation : à part des MEA, devis non confirmés compris */}
              <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginTop: 14 }}>
                Devis d&apos;implantation
              </div>
              {implantOrders.length === 0 ? (
                <div style={{ fontSize: 13, color: C.muted, padding: "4px 2px" }}>
                  {meta && !meta.typeField
                    ? "Champ « Type de commande » introuvable dans Odoo — implantations non repérables."
                    : `Aucun devis d'implantation en ${year}`}
                </div>
              ) : implantOrders.map(o => (
                <button key={o.id} onClick={() => openOrder(o)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: C.white, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.teal}`, borderRadius: 14, boxShadow: C.shadow, cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const, width: "100%" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                      {o.sale_order_template_id?.[1] || (meta?.typeField && Array.isArray(o[meta.typeField]) ? o[meta.typeField][1] : "Implantation")}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {o.name} · {o.date_order ? fmtDate(new Date(o.date_order.replace(" ", "T") + "Z").getTime()) : "—"}
                      {" · "}{o.state === "draft" || o.state === "sent" ? "Devis" : "Confirmé"}
                    </div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.tealDark, flexShrink: 0 }}>{fmtPrice(o.amount_total)}</div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6"/></svg>
                </button>
              ))}
            </div>
          )
        )}

        {/* ── Onglet GRATUITÉS ── */}
        {mode === "gifts" && (
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 18 }}>

            {/* Quotas : état courant seulement — les champs Odoo n'ont pas d'historique */}
            {year === nowYear ? (
              giftQuotas === null ? (
                <div style={{ textAlign: "center" as const, color: C.muted, padding: 24, fontSize: 13 }}>Quotas indisponibles hors ligne pour ce client</div>
              ) : (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 8 }}>Quotas {nowYear} — consommé / alloué</div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                    {GIFT_QUOTAS.map(g => {
                      const quota = num(giftQuotas[g.quota]);
                      const left = num(giftQuotas[g.left]);
                      const used = Math.max(0, quota - left);
                      const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
                      return (
                        <div key={g.quota} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", boxShadow: C.shadow }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: quota > 0 ? C.text : C.muted }}>{g.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: quota > 0 ? C.tealDark : C.muted }}>
                              {quota > 0 ? `${used} / ${quota}` : "Pas de quota"}
                            </span>
                          </div>
                          {quota > 0 && (
                            <div style={{ height: 6, background: C.bg, borderRadius: 999, overflow: "hidden" }}>
                              <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? C.red : pct >= 80 ? C.orange : C.teal, borderRadius: 999 }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <div style={{ flex: 1, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", boxShadow: C.shadow }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{fmtPrice(num(giftQuotas[GIFT_EXPIRED.asked]))}</div>
                      <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 2, textTransform: "uppercase" as const }}>Périmés demandés</div>
                    </div>
                    <div style={{ flex: 1, background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", boxShadow: C.shadow }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{fmtPrice(num(giftQuotas[GIFT_EXPIRED.granted]))}</div>
                      <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 2, textTransform: "uppercase" as const }}>Périmés accordés</div>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div style={{ fontSize: 12, color: C.muted, background: C.bg, borderRadius: 10, padding: "10px 12px", lineHeight: 1.5 }}>
                Les quotas Odoo ne conservent pas d'historique : ils ne sont affichés que pour {nowYear}.
                Ci-dessous, la consommation {year} recalculée depuis les commandes.
              </div>
            )}

            {/* Consommation réelle de l'année, depuis les lignes de commande */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 8 }}>Gratuités commandées en {year}</div>
              {analyLoading ? (
                <ListSkeleton count={3} height={38} />
              ) : giftYearLines.length === 0 ? (
                <div style={{ textAlign: "center" as const, color: C.muted, padding: 24, fontSize: 13 }}>Aucune gratuité sur des commandes confirmées en {year}</div>
              ) : (
                <div className="stagger" style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
                  {giftYearLines.map(g => {
                    const isOpen = giftOpen === g.label;
                    return (
                      <div key={g.label} style={{ background: C.greenSoft, border: `1px solid ${C.green}33`, borderRadius: 10, overflow: "hidden" }}>
                        <button onClick={() => setGiftOpen(isOpen ? null : g.label)}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const }}>
                          <Icon name="gift" size={13} color={C.green} />
                          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.text }}>
                            {giftTypes.find(t => t.value === g.label)?.label || g.label}
                          </span>
                          <span style={{ fontSize: 11, color: C.muted }}>{g.lines} ligne{g.lines > 1 ? "s" : ""}</span>
                          <span style={{ fontSize: 14, fontWeight: 800, color: C.green }}>{Math.round(g.qty)}</span>
                          <span style={{ color: C.muted, fontSize: 14, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>›</span>
                        </button>
                        {isOpen && (
                          <div className="reveal" style={{ background: C.white, borderTop: `1px solid ${C.green}33` }}>
                            {g.detail.map((d, i) => (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderTop: i ? `1px solid ${C.border}` : "none", fontSize: 12.5 }}>
                                <span style={{ flex: 1, minWidth: 0, color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{d.product}</span>
                                <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" as const }}>{d.order}{d.date ? ` · ${d.date.slice(0, 10).split("-").reverse().join("/")}` : ""}</span>
                                <span style={{ width: 36, textAlign: "right" as const, fontWeight: 800, color: C.green }}>{Math.round(d.qty)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Onglet COMMANDES (existant) ── */}
        {mode === "orders" && (loading ? (
          <ListSkeleton count={5} height={74} />
        ) : error ? (
          <div style={{ background: C.redSoft, color: C.red, borderRadius: 12, padding: "12px 16px", fontSize: 13 }}>{error}</div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: "center" as const, color: C.muted, padding: 60 }}>
            <div style={{ marginBottom: 12 }}><Icon name="inbox" size={40} color={C.border} /></div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Aucune commande pour ce client</div>
          </div>
        ) : (
          <div className="stagger" style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
            {orders.map(o => {
              const info = stateInfo[o.state] || { label: o.state, color: C.muted, bg: C.bg };
              return (
                <button key={o.id} onClick={() => openOrder(o)}
                  style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, boxShadow: C.shadow, cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const, width: "100%" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{o.name}</div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{o.date_order ? fmtDate(new Date(o.date_order.replace(" ", "T") + "Z").getTime()) : "—"}</div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: info.color, background: info.bg, borderRadius: 8, padding: "4px 10px", flexShrink: 0 }}>{info.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: C.tealDark, minWidth: 80, textAlign: "right" as const }}>{fmtPrice(o.amount_total)}</div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6"/></svg>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Détail d'une commande : livraison, suivi, lots, remises ── */}
      {selectedOrder && (
        <OrderDetailModal session={session} order={selectedOrder}
          stateLabel={stateInfo[selectedOrder.state] || { label: selectedOrder.state, color: C.muted, bg: C.bg }}
          onClose={() => setSelectedOrder(null)} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ÉTAPE 2 — Catalogue + Panier persistant
// ═══════════════════════════════════════════════════════════════════════════
// Vue liste du panier : largeurs des colonnes, partagées par l'en-tête et les lignes.
const LV = { code: 66, ean: 104, qty: 100, brut: 66, remise: 54, net: 66, total: 74, x: 30 };
function CatalogStep({ session, loyaltyPrograms, cart, onQtyChange, freeItems, onValidate, submitting, note, setNote, client, priceItems, onToast, appliedPromos, giftItems, setGiftItems, freeTypes, eventDiscount, setEventDiscount, shipping, minShipDate, onChangeExpedition, onAddNote, onNoteText, groupDiscounts, setGroupDiscounts, orderType, setOrderType, offerIds, setOfferIds, autoOffers, onTemplateApplied, onRenameGroup, onClearCart, pendingQuote, onPendingQuoteDone }: {
  loyaltyPrograms: loyalty.LoyaltyProgram[];
  onAddNote: (text: string, kind?: "line_note" | "line_section", group?: string) => void;
  onNoteText: (id: number, text: string) => void;
  groupDiscounts: Record<string, number>; setGroupDiscounts: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  orderType: string | number | ""; setOrderType: (v: string | number | "") => void;
  offerIds: number[]; setOfferIds: React.Dispatch<React.SetStateAction<number[]>>;
  autoOffers: { id: number; name: string }[];
  pendingQuote?: { templateId: number; qtys: Record<number, number> } | null;   // proposition du RDV à charger
  onPendingQuoteDone?: () => void;
  onTemplateApplied: (name: string, info: { note?: string; shipDate?: string; code?: string }) => void;
  onRenameGroup: (from: string, to: string) => void;
  onClearCart: (group?: string) => void;
  // Commande transmise directement à la logistique : dates prévues (sinon null).
  shipping?: ShippingPlan | null;
  minShipDate?: Date | null;   // hors logistique directe : expédition au plus tôt (date des MEA)
  onChangeExpedition?: (d: Date | null) => void;
  session: odoo.OdooSession; cart: Record<number, CartItem>;
  onQtyChange: (p: any, q: number, price?: number, group?: string, keepZero?: boolean, regroup?: boolean, extra?: Partial<CartItem>) => void; freeItems: FreeItem[];
  onValidate: () => void; submitting: boolean;
  note: string; setNote: (n: string) => void; client: any;
  priceItems: PriceItem[];
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
  appliedPromos: Record<number, loyalty.AppliedPromo>;
  giftItems: GiftItem[]; setGiftItems: React.Dispatch<React.SetStateAction<GiftItem[]>>;
  freeTypes: sync.FreeType[];
  eventDiscount: number; setEventDiscount: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [smartCats, setSmartCats] = useState<SmartCat[]>([]);
  const [activeCatId, setActiveCatId] = useState<string | null>(VENTE_CAT_ID);
  const [allProducts, setAllProducts] = useState<any[]>([]); // cache complet des produits en stock
  const [loading, setProdLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [stockOnly, setStockOnly] = useState(true); // n'afficher que les articles avec du stock prévisionnel
  // Catalogue en vue dense (une ligne par produit), retenu sur l'appareil.
  const [dense, setDense] = useState<boolean>(() => { try { return localStorage.getItem("wms_catalog_dense") === "1"; } catch { return false; } });
  const searchInput = useRef<HTMLInputElement>(null);

  // Pavé numérique quantité : tap sur le chiffre d'un produit (grille ou panier).
  // price fourni depuis la grille (prix client calculé) ; absent depuis le panier
  // (on garde alors le prix déjà enregistré sur la ligne).
  const [pad, setPad] = useState<{ product: any; price?: number } | null>(null);
  // Panneau remise événement Co : masqué par défaut, ouvert au clic sur le bouton.
  const [showEventDisc, setShowEventDisc] = useState(false);
  // Devis d'implantation dans le panier → pas de remise événement (retirée si choisie).
  const hasImplant = Object.values(cart).some(isImplantLine);
  useEffect(() => { if (hasImplant && eventDiscount) setEventDiscount(0); }, [hasImplant, eventDiscount, setEventDiscount]);

  // État réseau léger (événements navigateur, sans ping) : sert uniquement à
  // annoncer AVANT validation que la commande partira en file hors ligne.
  const [navOnline, setNavOnline] = useState(true);
  useEffect(() => {
    const upd = () => setNavOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    upd();
    window.addEventListener("online", upd);
    window.addEventListener("offline", upd);
    return () => { window.removeEventListener("online", upd); window.removeEventListener("offline", upd); };
  }, []);

  // URL vignette via proxy (chargée en lazy + cache navigateur 1h) — évite de charger 500 base64 d'un coup
  const imgUrl = (id: number) => apiUrl(`/api/odoo/image?odooUrl=${encodeURIComponent(session.config.url)}&id=${id}&s=${session.sessionId}`);

  // ── Zoom image produit ─────────────────────────────────────────────────────
  const [zoom, setZoom] = useState<any>(null);          // produit affiché en grand
  const [zoomImg, setZoomImg] = useState<string>("");   // base64 image_1024
  const [zoomLoading, setZoomLoading] = useState(false);

  const openZoom = async (p: any) => {
    setZoom(p);
    setZoomImg("");
    if (!SHOW_PRODUCT_IMAGES) return;   // fiche article sans photo : rien à charger
    setZoomLoading(true);
    try {
      const r = await odoo.searchRead(session, "product.product", [["id", "=", p.id]], ["image_1024"], 1);
      setZoomImg(r?.[0]?.image_1024 || "");
    } catch {}
    setZoomLoading(false);
  };

  // ── MEA / Offres ─────────────────────────────────────────────────────────
  const MEA_CAT_ID = "__mea__";
  // Devis d'implantation : mêmes modèles de devis Odoo que les MEA, séparés par
  // leur nom (« Devis d'implantation - INSTITUT », « … - RETAIL »…).
  const DEVIS_CAT_ID = "__devis__";
  const isImplantTemplate = (t: any) => /implantation/i.test(String(t?.name || ""));

  const [meaTemplates, setMeaTemplates] = useState<any[]>([]);
  const isOfferView = activeCatId === MEA_CAT_ID || activeCatId === DEVIS_CAT_ID;
  // Période de l'offre : pas affichée avant sa date de début, retirée après sa date de fin.
  const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const inPeriod = (t: any) => (!t.startDate || t.startDate <= todayIso) && (!t.endDate || t.endDate >= todayIso);
  const shownTemplates = meaTemplates.filter((t: any) => inPeriod(t) && isImplantTemplate(t) === (activeCatId === DEVIS_CAT_ID)
    && fold(String(t.name || "")).includes(fold(search).trim()));
  const [meaLoading, setMeaLoading] = useState(false);
  // Champs « Type de commande » / « Offres commandées » de cette base Odoo.
  const [meta, setMeta] = useState<OrderMeta | null>(null);
  const [offers, setOffers] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    orderMeta(session).then(async m => { setMeta(m); setOffers(await offerOptions(session, m)); }).catch(() => {});
  }, [session]);
  // Offres sans nom cochées par erreur (ancienne règle de rapprochement) : retirées.
  useEffect(() => {
    const bad = offerIds.filter(id => offers.some(o => o.id === id && squash(o.name).length < 4));
    if (bad.length) setOfferIds(prev => prev.filter(id => !bad.includes(id)));
  }, [offers, offerIds, setOfferIds]);
  // Offres cochées dont le nom est inconnu (archivées…) : nom réel récupéré.
  useEffect(() => {
    if (!meta) return;
    const missing = offerIds.filter(id => !offers.some(o => o.id === id));
    if (!missing.length) return;
    offerNamesByIds(session, meta, missing).then(found => {
      if (found.length) setOffers(prev => [...prev, ...found.filter(f => !prev.some(p => p.id === f.id))]);
      // Offre illisible ou sans nom (ex. n° 208) alors que la liste des offres est
      // chargée : retirée, elle ne doit pas partir sur la commande.
      const named = new Set(found.filter(f => squash(f.name).length >= 4).map(f => f.id));
      const drop = missing.filter(id => !named.has(id));
      if (offers.length && drop.length) setOfferIds(prev => prev.filter(id => !drop.includes(id)));
    });
  }, [offerIds, offers, meta, session]);
  // Vue liste : une ligne par article, le panier prend toute la largeur.
  const [listView, setListView] = useState(false);
  // Récap du panier replié par défaut (expédition, type, offres, note, détail
  // du total) : il mangeait la moitié de la hauteur du panier. Choix mémorisé.
  const allOffers = Array.from(new Set([...autoOffers.map(o => o.id), ...offerIds])).map(id => ({ id }));
  const [recapOpen, setRecapOpen] = useState(() => { try { return localStorage.getItem("wms_recap_open") === "1"; } catch { return false; } });
  const slim = listView && !recapOpen;   // vue liste, récap replié : bloc Total sur une ligne
  // Retrait d'une ligne du panier : elle se replie, puis disparaît vraiment.
  const [removing, setRemoving] = useState<Set<number>>(new Set());
  const removeLine = (product: any) => {
    setRemoving(prev => new Set(prev).add(product.id));
    setTimeout(() => {
      onQtyChange(product, 0);
      setRemoving(prev => { const n = new Set(prev); n.delete(product.id); return n; });
    }, 190);
  };
  // Tout vider, ou retirer une MEA entière (ses lignes, rubriques, gratuités,
  // remise et offre cochée). Confirmation : un tap de trop coûte tout le panier.
  const clearCart = () => {
    if (!window.confirm("Vider tout le panier ?\n\nTous les articles, gratuités et MEA seront retirés.")) return;
    onClearCart();
    setGiftItems([]); setGroupDiscounts({}); setOfferIds([]); setMeaVariants({}); setEventDiscount(0);
    onToast("Panier vidé", "info");
  };
  const removeGroup = (group: string, silent = false) => {
    if (!silent && !window.confirm(`Retirer « ${group} » du panier ?\n\nSes articles, rubriques et gratuités seront retirés.`)) return;
    onClearCart(group);
    setGiftItems(prev => prev.filter(g => g.cond?.label !== group));
    setGroupDiscounts(prev => { const n = { ...prev }; delete n[group]; return n; });
    const offer = offerFor(group);
    if (offer) setOfferIds(prev => prev.filter(id => id !== offer.id));
    setMeaVariants(prev => Object.fromEntries(Object.entries(prev).filter(([, g]) => !g.variants.some(v => v.name === group))));
    if (!silent) onToast(`${group} retiré du panier`, "info");
  };
  // Changer de variante depuis le panier : la MEA est retirée puis la variante
  // choisie est ajoutée (une fois le panier mis à jour, pour repartir de zéro).
  const [pendingVariant, setPendingVariant] = useState<{ from: string; template: any } | null>(null);
  const switchVariant = (group: string, template: any) => {
    if (template.name === group) return;
    removeGroup(group, true);
    setPendingVariant({ from: group, template });
  };
  useEffect(() => {
    if (!pendingVariant || Object.values(cart).some(i => i.group === pendingVariant.from)) return;
    const t = pendingVariant.template; setPendingVariant(null);
    void applyMeaTemplate(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, pendingVariant]);
  // MEA au panier (brouillon repris…) : modèles chargés pour proposer les variantes.
  const hasMeaGroup = Object.values(cart).some(i => i.group && !/implantation/i.test(i.group));
  useEffect(() => { if (hasMeaGroup && !meaTemplates.length && !meaLoading) void loadMeaTemplates(); }, [hasMeaGroup]); // eslint-disable-line react-hooks/exhaustive-deps
  // « Préparer le RDV » → « Créer le devis » : la variante choisie est ajoutée
  // au panier avec les quantités proposées (gratuités, remise, offre comprises).
  useEffect(() => {
    if (!pendingQuote) return;
    if (!meaTemplates.length) { if (!meaLoading) void loadMeaTemplates(); return; }
    const t = meaTemplates.find((x: any) => x.id === pendingQuote.templateId);
    onPendingQuoteDone?.();
    if (!t) { onToast("Modèle de la MEA introuvable (archivé ?)", "error"); return; }
    void applyMeaTemplate(t, pendingQuote.qtys);
  }, [pendingQuote, meaTemplates.length, meaLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  // Variantes disponibles d'une MEA du panier (même campagne, dans leur période).
  const variantsOfGroup = (group: string) => {
    // Paliers suivis de cette MEA (mêmes articles de vente), sinon même nom avant le 1er « - ».
    const tracked = Object.values(meaVariants).find(g => g.variants.some(x => x.name === group));
    if (tracked) { const ids = new Set(tracked.variants.map(x => x.id)); return meaTemplates.filter((t: any) => ids.has(t.id) && inPeriod(t)); }
    const k = meaPrefix(group);
    return meaTemplates.filter((t: any) => !isImplantTemplate(t) && inPeriod(t) && meaPrefix(String(t.name || "")) === k);
  };
  const toggleRecap = () => setRecapOpen(o => { try { localStorage.setItem("wms_recap_open", o ? "0" : "1"); } catch {} return !o; });
  // Type de gratuité appliqué à toutes les gratuités (Coffre DC par défaut).
  const [giftType, setGiftType] = useState(DEFAULT_FREE_TYPE);
  const offerGift = (p: any) => {
    setGiftItems(prev => {
      const i = prev.findIndex(g => g.product.id === p.id);
      if (i >= 0) return prev.map((g, j) => j === i ? { ...g, qty: g.qty + 1 } : g);
      return [...prev, { product: p, qty: 1, type: freeTypes.some(t => t.value === giftType) || !freeTypes.length ? giftType : "" }];
    });
  };
  const [applyingMea, setApplyingMea] = useState<number | null>(null);
  // Contenu d'une MEA (flèche ▾) : lignes du modèle chargées à la demande.
  const [meaOpen, setMeaOpen] = useState<number | null>(null);
  const [meaLines, setMeaLines] = useState<Record<number, any[] | "loading" | "error">>({});
  const toggleMeaContent = async (t: any) => {
    if (meaOpen === t.id) { setMeaOpen(null); return; }
    setMeaOpen(t.id);
    if (Array.isArray(meaLines[t.id])) return;
    setMeaLines(m => ({ ...m, [t.id]: "loading" }));
    const ids: number[] = t.sale_order_template_line_ids || [];
    try {
      const tlm = await templateLineMeta(session);
      let lines: any[];
      try {
        lines = await odoo.searchRead(session, "sale.order.template.line", [["id", "in", ids]],
          ["id", "product_id", "name", "product_uom_qty", "display_type", "sequence", ...(tlm.discount ? [tlm.discount] : []), ...(tlm.freeType ? [tlm.freeType] : [])], 0, "sequence, id");
      } catch (e) {
        if (!odoo.isNetworkError(e)) throw e;
        lines = (await sync.getCachedMeaLines(ids)).sort((x: any, y: any) => (x.sequence || 0) - (y.sequence || 0) || x.id - y.id);
      }
      setMeaLines(m => ({ ...m, [t.id]: lines.map((l: any) => ({
        section: l.display_type === "line_section" || l.display_type === "line_note" ? l.display_type : null,
        name: l.product_id ? String(l.product_id[1]) : String(l.name || ""),
        qty: Number(l.product_uom_qty) || 0,
        discount: tlm.discount ? Number(l[tlm.discount]) || 0 : 0,
        freeType: tlm.freeType && l[tlm.freeType] ? (Array.isArray(l[tlm.freeType]) ? l[tlm.freeType][1] : String(l[tlm.freeType])) : "",
      })) }));
    } catch { setMeaLines(m => ({ ...m, [t.id]: "error" })); }
  };
  const meaContent = (id: number) => {
    const lines = meaLines[id];
    if (!lines || lines === "loading") return <div style={{ padding: "8px 2px", fontSize: 12, color: C.muted }}>Chargement du contenu…</div>;
    if (lines === "error") return <div style={{ padding: "8px 2px", fontSize: 12, color: C.red }}>Contenu indisponible</div>;
    return (
      <div className="reveal" style={{ display: "flex", flexDirection: "column" as const, gap: 2, padding: "6px 0 2px" }}>
        {lines.map((l: any, i: number) => l.section ? (
          <div key={i} style={{ fontSize: 10.5, fontWeight: 800, color: C.tealDark, textTransform: "uppercase" as const, letterSpacing: "0.04em", padding: "6px 0 2px" }}>{l.name}</div>
        ) : (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0", borderBottom: `1px dashed ${C.border}` }}>
            <span style={{ width: 34, flexShrink: 0, textAlign: "right" as const, fontWeight: 800, color: l.qty ? C.text : C.muted }}>{l.qty ? `×${l.qty}` : "—"}</span>
            <span style={{ flex: 1, minWidth: 0, color: C.textSec, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }} title={l.name}>{l.name}</span>
            {l.discount >= 99.99 ? <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, color: C.green, background: C.greenSoft, borderRadius: 999, padding: "1px 7px" }}>Offert</span>
              : l.discount > 0 ? <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, color: C.orange, background: C.orangeSoft, borderRadius: 999, padding: "1px 7px" }}>−{l.discount} %</span> : null}
            {l.freeType && l.discount < 99.99 && <span style={{ flexShrink: 0, fontSize: 10, color: C.muted }}>{l.freeType}</span>}
          </div>
        ))}
        {lines.length === 0 && <div style={{ fontSize: 12, color: C.muted }}>Modèle vide</div>}
      </div>
    );
  };
  const chevron = (t: any) => (
    <button onClick={() => toggleMeaContent(t)} title={meaOpen === t.id ? "Masquer le contenu" : "Voir le contenu de l'offre"} aria-label="Voir le contenu"
      style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.border}`, background: meaOpen === t.id ? C.tealSoft : C.white, color: C.tealDark, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
        style={{ transform: meaOpen === t.id ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><path d="M6 9l6 6 6-6" /></svg>
    </button>
  );

  // ── Top 40 (ex-Favoris) : top 40 des articles de vente (code « 10… ») LIVRÉS au client ──
  // Source : transferts de stock sortants (OUT) validés, pas les commandes ni les
  // factures — c'est ce que le client a réellement reçu. 18 derniers mois.
  // Tri : quantité décroissante, articles Maquillage (code « 106… ») en fin de liste.
  const FAV_CAT_ID = "__fav__";
  const FAV_MAX = 40;
  const [favProducts, setFavProducts] = useState<any[]>([]);
  const [favLoading, setFavLoading] = useState(false);
  const [favLoaded, setFavLoaded] = useState(false);

  const loadFavorites = async () => {
    if (favLoaded || !client?.id) return;
    setFavLoading(true);
    try {
      const since = new Date();
      since.setMonth(since.getMonth() - 18);
      const sinceStr = since.toISOString().slice(0, 10);
      const domain = [
        ["state", "=", "done"],
        ["picking_id.picking_type_id.code", "=", "outgoing"],
        ["picking_id.partner_id", "child_of", client.id],
        ["product_id.default_code", "=like", "10%"],
        ["date", ">=", sinceStr],
      ];
      // Quantité livrée : `quantity` (Odoo 17+) ou `quantity_done` (16) — un champ
      // inconnu fait échouer toute la requête, d'où le repli.
      let moves: any[];
      try {
        moves = (await odoo.searchRead(session, "stock.move", domain,
          ["product_id", "quantity", "picking_id", "date"], 5000, "date desc"))
          .map((m: any) => ({ ...m, _qty: Number(m.quantity) || 0 }));
      } catch (e) {
        if (odoo.isNetworkError(e)) throw e;
        moves = (await odoo.searchRead(session, "stock.move", domain,
          ["product_id", "quantity_done", "picking_id", "date"], 5000, "date desc"))
          .map((m: any) => ({ ...m, _qty: Number(m.quantity_done) || 0 }));
      }
      // Agrégation par produit : quantité livrée, nb de livraisons, dernière date
      const agg = new Map<number, { totalQty: number; times: number; lastDate: string; pickings: Set<number> }>();
      for (const m of moves) {
        const pid = m.product_id?.[0];
        if (!pid) continue;
        const cur = agg.get(pid) || { totalQty: 0, times: 0, lastDate: "", pickings: new Set<number>() };
        cur.totalQty += m._qty;
        const pk = m.picking_id?.[0];
        if (pk && !cur.pickings.has(pk)) { cur.pickings.add(pk); cur.times += 1; }
        if ((m.date || "") > cur.lastDate) cur.lastDate = m.date || "";
        agg.set(pid, cur);
      }
      for (const [pid, a] of Array.from(agg.entries())) if (a.totalQty <= 0) agg.delete(pid);
      // Top 40 par quantité livrée
      const ids = Array.from(agg.entries())
        .sort((a, b) => b[1].totalQty - a[1].totalQty)
        .slice(0, FAV_MAX)
        .map(([pid]) => pid);
      if (ids.length) {
        const prods = await odoo.searchRead(session, "product.product",
          [["id", "in", ids]],
          ["id", "name", "default_code", "barcode", "lst_price", "product_tmpl_id", "virtual_available", ...await optionalProductFields(session)],
          ids.length);
        const enriched = prods.map((p: any) => {
          const a = agg.get(p.id)!;
          return { ...p, totalQty: a.totalQty, times: a.times, lastDate: a.lastDate };
        });
        const isMaq = (p: any) => String(p.default_code || "").trim().startsWith("106");
        enriched.sort((a: any, b: any) =>
          (Number(isMaq(a)) - Number(isMaq(b))) || ((b.totalQty || 0) - (a.totalQty || 0)));
        setFavProducts(enriched);
        sync.cacheClientData(client.id, { favorites: enriched }).catch(() => {});
      } else {
        setFavProducts([]);
        sync.cacheClientData(client.id, { favorites: [] }).catch(() => {});
      }
      setFavLoaded(true);
    } catch (e: any) {
      // Hors ligne → favoris préchargés pour ce client (si dispo)
      const cached = await sync.getCachedFavorites(client.id).catch(() => undefined);
      if (cached) { setFavProducts(cached); setFavLoaded(true); }
      else onToast("Top 40 indisponible hors ligne pour ce client", "info");
    }
    setFavLoading(false);
  };

  const loadMeaTemplates = async () => {
    if (meaTemplates.length > 0) return;
    setMeaLoading(true);
    try {
      const tm = await templateMeta(session);
      const templates = await odoo.searchRead(session, "sale.order.template",
        [["active", "=", true]],
        ["id", "name", "sale_order_template_line_ids", ...[tm.noteField, tm.shipField, tm.startField, tm.endField, tm.codeField].filter((f): f is string => !!f)],
        200, "name");
      // Champs Studio normalisés : la commande n'a pas à connaître leurs noms techniques.
      for (const t of templates) {
        if (tm.noteField) t.internalNote = descToText(String(t[tm.noteField] || "")).trim() || undefined;
        if (tm.shipField && t[tm.shipField]) t.shipDate = String(t[tm.shipField]).slice(0, 10);
        if (tm.startField && t[tm.startField]) t.startDate = String(t[tm.startField]).slice(0, 10);
        if (tm.endField && t[tm.endField]) t.endDate = String(t[tm.endField]).slice(0, 10);
        if (tm.codeField && t[tm.codeField]) t.offerCode = String(t[tm.codeField]).trim() || undefined;
      }
      setMeaTemplates(templates);
      sync.cacheMea(templates).catch(() => {});
    } catch {
      // Hors ligne → modèles MEA préchargés
      try { setMeaTemplates(await sync.getCachedMea()); } catch {}
    }
    setMeaLoading(false);
  };

  // Type de gratuité d'une ligne offerte de MEA : celui du modèle (valeur de
  // sélection, ou libellé si c'est un many2one), sinon « Gratuités des offres ».
  const meaGiftType = (raw: any): string => {
    const byLabel = (l: string) => freeTypes.find(f => fold(f.label) === fold(l))?.value;
    if (Array.isArray(raw)) { const v = byLabel(String(raw[1] || "")); if (v) return v; }
    else if (raw && freeTypes.some(f => f.value === raw)) return String(raw);
    else if (raw && byLabel(String(raw))) return byLabel(String(raw))!;
    return freeTypes.find(f => f.value === "gratuites_des_offres")?.value
      || freeTypes.find(f => /gratuit.*offre/i.test(fold(f.label)))?.value
      || (freeTypes.length ? giftType : "gratuites_des_offres");
  };

  // ── Lecture des modèles MEA ─────────────────────────────────────────────
  // Règles (modèles de devis « MEA … ») :
  //   • l'article code 7 (souvent 1re ligne) est l'article MEA ; la promo Odoo liée
  //     (« Réductions & fidélité ») est celle dont le nom commence par ce code ;
  //   • ligne avec un « Type de gratuité » (PLV, Gratuités des offres…) ou remisée
  //     à 100 % → GRATUITÉ (ligne offerte, type repris), y compris l'article code 7 ;
  //   • autre article → article payant, au prix de la liste de prix du client ; la
  //     remise de la MEA vient de la promo liée (jamais du nom du modèle) ;
  //   • rubriques / notes / séparateurs → lignes de commentaire.
  type MeaLine = { product: any; qty: number; price: number; kind: "paid" | "tester" | "other" | "code"; freeType?: string };
  type MeaParsed = {
    id: number; name: string; notes: { name: string; type: "line_note" | "line_section" }[];
    items: MeaLine[]; gifts: { product: any; qty: number; type: string; afterIdx: number }[]; paid: Record<number, number>;
    rows: ({ note: { name: string; type: "line_note" | "line_section" } } | { item: MeaLine })[];
    code?: string;            // code de l'article MEA (7…)
    programId?: number;       // promo Odoo liée
    paidSet: string;          // articles de vente du modèle (pour regrouper les paliers)
    prefix: string;           // nom avant le 1er « - » (« MEA Essentiels du quotidien 2026 »)
  };
  const meaPrefix = (name: string) => { const f = fold(String(name || "")).trim(); const i = f.indexOf(" - "); return (i > 0 ? f.slice(0, i) : f).trim(); };
  const parseTemplates = async (templates: any[]): Promise<MeaParsed[]> => {
    const tlm = await templateLineMeta(session);
    const lineIds: number[] = templates.flatMap(t => t.sale_order_template_line_ids || []);
    let lines: any[];
    try {
      lines = await odoo.searchRead(session, "sale.order.template.line",
        [["id", "in", lineIds]],
        ["id", "product_id", "product_uom_qty", "display_type", "name", "sequence", ...Object.values(tlm).filter(Boolean) as string[]],
        0, "sequence, id");
    } catch {
      lines = (await sync.getCachedMeaLines(lineIds)).sort((x: any, y: any) => (x.sequence || 0) - (y.sequence || 0) || x.id - y.id);
    }
    const productIds = Array.from(new Set(lines.filter((l: any) => l.product_id).map((l: any) => l.product_id[0] as number)));
    let products: any[] = [];
    if (productIds.length) {
      try {
        products = await odoo.searchRead(session, "product.product",
          [["id", "in", productIds]],
          ["id", "name", "default_code", "barcode", "lst_price", "product_tmpl_id", "virtual_available", ...await optionalProductFields(session)],
          productIds.length);
      } catch {
        const set = new Set(productIds);
        products = (await sync.getCachedProducts()).filter((p: any) => set.has(p.id));
      }
    }
    const productMap = new Map<number, any>(products.map((p: any) => [p.id as number, p]));
    return templates.map(t => {
      const ids = new Set<number>(t.sale_order_template_line_ids || []);
      const out: MeaParsed = { id: t.id, name: t.name, notes: [], items: [], gifts: [], paid: {}, rows: [], paidSet: "", prefix: meaPrefix(t.name) };
      const pushNote = (n: { name: string; type: "line_note" | "line_section" }) => { out.notes.push(n); out.rows.push({ note: n }); };
      const tLines = lines.filter((l: any) => ids.has(l.id));
      // Article MEA : 1er article dont le code commence par 7 (hors présentoirs 7000…
      // marqués comme gratuité plus bas : on prend le premier code 7 du modèle).
      const codeLine = tLines.find((l: any) => l.product_id && /^7/.test(String(productMap.get(l.product_id[0])?.default_code || "").trim()));
      out.code = codeLine ? String(productMap.get(codeLine.product_id[0])?.default_code || "").trim() : undefined;
      const program = out.code ? loyaltyPrograms.find(p => p.meaCode === out.code) : undefined;
      out.programId = program?.id;
      // Produits offerts par la promo elle-même : pas ajoutés une 2e fois depuis le modèle.
      const promoGifts = new Set((program?.rewards || []).filter(r => r.reward_type === "product" && r.reward_product_id).map(r => r.reward_product_id as number));
      for (const line of tLines) {
        if (line.display_type === "line_section" || line.display_type === "line_note") {
          if (line.name) pushNote({ name: String(line.name), type: line.display_type });
          continue;
        }
        if (!line.product_id) continue;
        const product: any = productMap.get(line.product_id[0]);
        if (!product) continue;
        if (isSeparatorProduct(product)) { pushNote({ name: String(line.name || product.name), type: "line_note" }); continue; }
        const qty = Math.max(0, Math.round(line.product_uom_qty || 0));
        const discount = tlm.discount ? Number(line[tlm.discount]) || 0 : 0;
        const freeRaw = tlm.freeType ? line[tlm.freeType] : null;
        // Article MEA (code 7) : 1re ligne de la MEA dans le panier (pas une gratuité
        // de la zone Gratuités), à 0 €, avec son Type de gratuité.
        if (line === codeLine) {
          const item: MeaLine = { product, qty: Math.max(1, qty), price: 0, kind: "code", freeType: meaGiftType(freeRaw) };
          out.items.push(item); out.rows.push({ item });
          continue;
        }
        if (freeRaw || discount >= 99.99) {
          if (promoGifts.has(product.id)) continue;
          out.gifts.push({ product, qty, type: meaGiftType(freeRaw), afterIdx: out.rows.length });
          continue;
        }
        const tester = String(product.default_code || "").startsWith("3");
        const price = tester ? 0 : applyPricelist(product.lst_price || 0, product.id, product.product_tmpl_id?.[0] || 0, priceItems, Math.max(1, qty));
        // Article payant de la MEA = Type de produit « Produit vente » (cf. isSaleProduct).
        const sale = !tester && isSaleProduct(product);
        const item: MeaLine = { product, qty, price, kind: tester ? "tester" : sale ? "paid" : "other" };
        out.items.push(item); out.rows.push({ item });
        if (sale) out.paid[product.id] = (out.paid[product.id] || 0) + qty;
      }
      out.paidSet = Object.keys(out.paid).map(Number).sort((x, y) => x - y).join(",");
      return out;
    });
  };
  const squash = (t: string) => fold(t).replace(/[^a-z0-9]/g, "");
  // Offre du même nom que le modèle. Les offres au nom vide ou trop court sont
  // ignorées : « "" » est contenu dans tous les noms, et l'offre n° 208 (sans
  // nom) était cochée sur toutes les MEA. Sinon : le nom d'offre le plus long
  // contenu dans celui du modèle, puis le plus court qui le contient.
  const offerFor = (name: string) => {
    const n = squash(name); if (n.length < 4) return undefined;
    const named = offers.filter(o => squash(o.name).length >= 4);
    return named.find(o => squash(o.name) === n)
      || named.filter(o => n.includes(squash(o.name))).sort((a, b) => squash(b.name).length - squash(a.name).length)[0]
      || named.filter(o => squash(o.name).includes(n)).sort((a, b) => squash(a.name).length - squash(b.name).length)[0];
  };
  // MEA ajoutées ayant plusieurs paliers : palier en cours, suivi en continu.
  // Paliers d'une même MEA = modèles de même nom avant le 1er « - » ET mêmes
  // articles de vente (ils ne diffèrent que par l'article code 7 et les gratuités).
  const [meaVariants, setMeaVariants] = useState<Record<string, { current: number; variants: MeaParsed[] }>>({});
  const meaCond = (v: MeaParsed) => ({ label: v.name, required: {} as Record<number, number>, mea: { code: v.code, programId: v.programId } });

  // qtys : quantités imposées (proposition de « Préparer le RDV ») au lieu de celles du modèle.
  const applyMeaTemplate = async (template: any, qtys?: Record<number, number>) => {
    setApplyingMea(template.id);
    try {
      if (!(template.sale_order_template_line_ids || []).length) { onToast("Aucun produit dans cette offre", "error"); setApplyingMea(null); return; }
      const implant = isImplantTemplate(template);
      const prefix = meaPrefix(String(template.name || ""));
      const siblings = implant ? [template]
        : [template, ...meaTemplates.filter(t => t.id !== template.id && !isImplantTemplate(t) && inPeriod(t) && meaPrefix(String(t.name || "")) === prefix)];
      const parsedAll = await parseTemplates(siblings);
      const v = parsedAll[0];
      if (!v.items.length && !v.gifts.length) { onToast("Aucun produit dans cette offre", "error"); setApplyingMea(null); return; }
      const family = parsedAll.filter(x => x.id === v.id || (x.paidSet && x.paidSet === v.paidSet));

      let added = 0;
      const required: Record<number, number> = {};
      for (const row of v.rows) {
        if ("note" in row) { onAddNote(row.note.name, row.note.type, template.name); continue; }
        const it0 = row.item;
        const it = qtys && it0.kind === "paid" ? { ...it0, qty: Math.max(0, qtys[it0.product.id] ?? 0) } : it0;
        const have = cart[it.product.id]?.qty || 0;
        if (it.kind === "paid") required[it.product.id] = (required[it.product.id] ?? have) + it.qty;
        // Article déjà au panier hors offre (ajouté avant la MEA) ou dans un devis
        // d'implantation : il passe dans la MEA, à sa place du modèle.
        const curGroup = cart[it.product.id]?.group || "";
        const moveIn = !!cart[it.product.id] && (!curGroup || (!implant && /implantation/i.test(curGroup)));
        if (it.qty === 0 && cart[it.product.id]) {
          if (moveIn) { onQtyChange(it.product, have, it.price, template.name, true, true); added++; }
          continue;
        }
        onQtyChange(it.product, have + it.qty, it.price, template.name, true, moveIn, it.kind === "code" ? { freeType: it.freeType } : undefined);
        added++;
      }
      const gifts = v.gifts.reduce((s, g) => s + g.qty, 0);
      if (v.gifts.length) {
        // MEA avec promo Odoo liée : gratuités soumises à l'éligibilité de la MEA.
        // Devis d'implantation, ou MEA dont la promo est introuvable (ou sans article
        // code 7) : toutes les lignes du modèle sont ajoutées telles quelles, sans condition.
        const cond = !implant && v.programId ? meaCond(v) : { label: template.name, required: {} };
        setGiftItems(prev => [...prev, ...v.gifts.map(g => ({ ...g, cond }))]);
      }
      if (template.internalNote || template.shipDate || template.offerCode) onTemplateApplied(template.name, { note: template.internalNote, shipDate: template.shipDate, code: template.offerCode });
      if (implant) {
        if (orderType === "" && meta?.implantValues.length) setOrderType(meta.implantValues[0]);
      } else {
        const ownOffer = [...v.items, ...v.gifts].some(i => Array.isArray(i.product?.x_offre_produit_id));
        const offer = ownOffer ? undefined : offerFor(template.name);
        if (offer) setOfferIds(prev => prev.includes(offer.id) ? prev : [...prev, offer.id]);
        if (family.length > 1) setMeaVariants(prev => ({ ...prev, [prefix + "|" + v.paidSet]: { current: v.id, variants: family } }));
      }
      onToast(`${template.name} — ${added} produit${added > 1 ? "s" : ""} ajouté${added > 1 ? "s" : ""}${gifts ? ` + ${gifts} offert${gifts > 1 ? "s" : ""}` : ""}`, "success");
    } catch (e: any) { onToast("Erreur: " + e.message, "error"); }
    setApplyingMea(null);
  };

  // MEA déjà au panier mais pas suivie (brouillon repris, retour depuis l'accueil) :
  // ses paliers sont relus pour que le changement automatique de palier reprenne.
  const meaTrackPending = useRef<Set<string>>(new Set());
  const meaTrackDone = useRef<Set<string>>(new Set());   // MEA déjà relues (une seule fois par panier)
  const cartGroupsKey = Array.from(new Set(Object.values(cart).map(i => i.group).filter((g): g is string => !!g && !/implantation/i.test(g)))).sort().join("|");
  useEffect(() => {
    // Promos chargées d'abord : sans elles, les paliers seraient lus sans leur promo liée.
    if (!meaTemplates.length || !cartGroupsKey || !loyaltyPrograms.length) return;
    for (const group of cartGroupsKey.split("|")) {
      if (Object.values(meaVariants).some(v => v.variants.some(x => x.name === group))) continue;
      if (meaTrackPending.current.has(group) || meaTrackDone.current.has(group)) continue;
      const t = meaTemplates.find((x: any) => x.name === group && !isImplantTemplate(x));
      if (!t) continue;
      meaTrackPending.current.add(group);
      const prefix = meaPrefix(String(t.name || ""));
      const siblings = [t, ...meaTemplates.filter((x: any) => x.id !== t.id && !isImplantTemplate(x) && inPeriod(x) && meaPrefix(String(x.name || "")) === prefix)];
      parseTemplates(siblings).then(parsed => {
        const v = parsed[0];
        const family = parsed.filter(x => x.id === v.id || (x.paidSet && x.paidSet === v.paidSet));
        if (family.length > 1) setMeaVariants(prev => ({ ...prev, [prefix + "|" + v.paidSet]: { current: v.id, variants: family } }));
        // Brouillon d'une version précédente : article MEA code 7 absent du panier (ou
        // rangé dans les gratuités) → remis en 1re ligne de la MEA ; gratuités du
        // modèle remises si le brouillon n'en avait pas.
        const code = v.items.find(i => i.kind === "code");
        if (code && !cart[code.product.id]) {
          const seqs = Object.values(cart).filter(i => i.group === v.name).map(i => i.seq || 0);
          const asGift = giftItems.find(g => g.product.id === code.product.id)?.qty;
          onQtyChange(code.product, Math.max(1, asGift ?? code.qty), 0, v.name, true, false,
            { freeType: code.freeType, seq: (seqs.length ? Math.min(...seqs) : 0) - 0.5 });
        }
        setGiftItems(prev => {
          let n = code ? prev.filter(g => g.product.id !== code.product.id) : prev;
          if (v.gifts.length && !n.some(g => g.cond?.label === v.name))
            n = [...n, ...v.gifts.map(g => ({ ...g, cond: v.programId ? meaCond(v) : { label: v.name, required: {} } }))];
          return n.length === prev.length && n.every((g, i) => g === prev[i]) ? prev : n;
        });
        meaTrackDone.current.add(group);
      }).catch(() => {}).finally(() => meaTrackPending.current.delete(group));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meaTemplates, cartGroupsKey, loyaltyPrograms]);

  // Changement automatique de palier : parmi les paliers de la MEA, le plus haut
  // dont la promo Odoo est éligible avec le panier (ex. Essentiel 18 unités choisi,
  // 36 unités atteintes → Standard). L'article code 7, les gratuités et l'offre
  // cochée suivent le nouveau palier ; les quantités saisies sont gardées.
  useEffect(() => {
    const pc = promoCart(cart);
    const pricelistId = client?.property_product_pricelist?.[0] ?? null;
    for (const [key, g] of Object.entries(meaVariants)) {
      const cur = g.variants.find(x => x.id === g.current);
      if (!cur) continue;
      const allPaid = Object.keys(cur.paid).map(Number);
      if (!allPaid.some(id => cart[id] !== undefined)) {
        setMeaVariants(prev => { const n = { ...prev }; delete n[key]; return n; });
        continue;
      }
      const prog = (x: MeaParsed) => x.programId ? loyaltyPrograms.find(p => p.id === x.programId) : undefined;
      const eligible = g.variants.filter(x => { const p = prog(x); return !!p && loyalty.isProgramTriggered(p, pc, pricelistId); });
      if (!eligible.length) continue;
      const best = [...eligible].sort((a, b) => loyalty.programThreshold(prog(b)!) - loyalty.programThreshold(prog(a)!))[0];
      if (best.id === cur.id) continue;

      // Article MEA (code 7) du nouveau palier, à la place de l'ancien, en tête de la MEA.
      const curCode = cur.items.find(i => i.kind === "code"), bestCode = best.items.find(i => i.kind === "code");
      if (curCode && bestCode && curCode.product.id !== bestCode.product.id) {
        const old = cart[curCode.product.id];
        onQtyChange(curCode.product, 0);
        onQtyChange(bestCode.product, Math.max(1, old?.qty ?? bestCode.qty), 0, best.name, true, false, { freeType: bestCode.freeType, seq: old?.seq });
      }
      // Gratuités du nouveau palier, à la place des anciennes.
      setGiftItems(prev => [...prev.filter(x => x.cond?.label !== cur.name), ...best.gifts.map(x => ({ ...x, cond: meaCond(best) }))]);
      const own = (pm: MeaParsed) => [...pm.items, ...pm.gifts].some(i => Array.isArray(i.product?.x_offre_produit_id));
      const oldOffer = offerFor(cur.name), newOffer = own(best) ? undefined : offerFor(best.name);
      setOfferIds(prev => {
        const n = prev.filter(id => id !== oldOffer?.id);
        return newOffer && !n.includes(newOffer.id) ? [...n, newOffer.id] : n;
      });
      onRenameGroup(cur.name, best.name);
      const bt = meaTemplates.find((t: any) => t.id === best.id);
      if (bt && (bt.internalNote || bt.shipDate || bt.offerCode)) onTemplateApplied(best.name, { note: bt.internalNote, shipDate: bt.shipDate, code: bt.offerCode });
      setMeaVariants(prev => ({ ...prev, [key]: { ...g, current: best.id } }));
      const units = allPaid.reduce((s, id) => s + (cart[id]?.qty || 0), 0);
      onToast(`MEA passée en « ${best.name} » (${units} articles)`, "info");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, meaVariants, loyaltyPrograms]);

  // Gratuités d'une MEA / d'un devis d'implantation dont plus aucune ligne n'est
  // au panier (lignes supprimées une à une) : retirées aussi, au lieu de rester
  // à supprimer une par une.
  useEffect(() => {
    const groups = new Set(Object.values(cart).map(i => i.group).filter(Boolean) as string[]);
    if (giftItems.some(g => g.cond?.label && !groups.has(g.cond.label)))
      setGiftItems(prev => prev.filter(g => !g.cond?.label || groups.has(g.cond.label)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);

  useEffect(() => { setSmartCats(loadSmartCats()); }, []);

  // Chargement initial : tous les produits vendables actifs
  const loadAll = useCallback(async (q: string) => {
    const byStock = (list: any[]) => [...list].sort((a: any, b: any) => (b.virtual_available || 0) - (a.virtual_available || 0));
    // Catalogue complet : affiché TOUT DE SUITE depuis la copie gardée sur l'appareil
    // (préchargement hors ligne), puis remplacé par la version fraîche d'Odoo dès
    // qu'elle arrive (stocks à jour). Avant, l'écran attendait Odoo : ~3,5 s.
    let shown = false;
    if (!q) {
      const cached = await sync.getCachedProducts().catch(() => [] as any[]);
      if (cached.length) { setAllProducts(byStock(cached)); shown = true; }
    }
    setProdLoading(!shown);
    // Vendables + testeurs (réf. en 3), même si « Peut être vendu » est décoché :
    // on les commande souvent en gratuité.
    const domain: any[] = [
      "|", ["sale_ok", "=", true], ["default_code", "=like", "3%"],
      ["active", "=", true],
    ];
    if (q.trim().length >= 2) {
      domain.push("|");
      domain.push(["name", "ilike", q.trim()]);
      domain.push(["default_code", "ilike", q.trim()]);
    }
    const BASE_FIELDS = ["id", "name", "default_code", "barcode", "lst_price", "product_tmpl_id", "virtual_available"];
    try {
      let p: any[];
      try {
        // Limite 0 = TOUT le catalogue. Avant : 500 par ordre alphabétique, donc
        // les produits en fin d'alphabet (« Testeur… », « Sérum… ») manquaient.
        p = await odoo.searchRead(session, "product.product", domain,
          [...BASE_FIELDS, ...await optionalProductFields(session)], q.trim().length >= 2 ? 500 : 0, "name");
      } catch (e) {
        // Filet de sécurité : un champ personnalisé absent de l'instance fait planter
        // TOUTE la requête (cf. l'incident `sequence` sur pricelist). Plutôt que de
        // vider le catalogue, on retente sans le champ — on perd juste le regroupement.
        if (odoo.isNetworkError(e) || odoo.isSessionExpired(e)) throw e;
        p = await odoo.searchRead(session, "product.product", domain, BASE_FIELDS, q.trim().length >= 2 ? 500 : 0, "name");
      }
      // Produits en stock en premier, puis les autres
      p = byStock(p);
      if (!q) { setAllProducts(p); void sync.cacheProducts(p).catch(() => {}); }
      else { setProdLoading(false); return p; } // pour la recherche, retourner sans stocker
    } catch {
      // Réseau indisponible → on lit le catalogue préchargé en local (déjà
      // affiché pour le catalogue complet).
      if (shown) { setProdLoading(false); return; }
      try {
        const cached = q.trim().length >= 2
          ? await sync.searchCachedProducts(q.trim(), 500)
          : await sync.getCachedProducts();
        const sorted = [...cached].sort((a: any, b: any) => (b.virtual_available || 0) - (a.virtual_available || 0));
        if (!q) setAllProducts(sorted);
        else { setProdLoading(false); return sorted; }
      } catch {}
    }
    setProdLoading(false);
  }, [session]);

  useEffect(() => { loadAll(""); }, [loadAll]);

  // Recherche instantanée, dès la 1ʳᵉ lettre, DANS la vue en cours (testeurs,
  // PLV, favoris…) ; sans catégorie, dans tout le catalogue. Filtre local sur le
  // catalogue complet déjà chargé : chaque lettre affine, sans appel réseau.
  const searchWords = fold(search).split(/\s+/).filter(Boolean);
  const isSearching = searchWords.length > 0;

  const inStock = (p: any) => (p.virtual_available || 0) > 0;

  const viewProducts = activeCatId === FAV_CAT_ID
      ? favProducts
      // « Produit vente » (vue par défaut) : comme les autres gammes, la recherche
      // reste dans la gamme affichée.
      : activeCatId === VENTE_CAT_ID
        ? allProducts.filter(isVenteProduct)
      : activeCatId?.startsWith(TYPE_CAT_PREFIX)
        ? allProducts.filter(p => matchesTypeGroup(p, activeCatId.slice(TYPE_CAT_PREFIX.length)))
      : activeCatId
        ? allProducts.filter(p => {
            const cat = smartCats.find(c => c.id === activeCatId);
            return cat ? matchesCat(p, cat) && isSaleProduct(p) : true;
          })
        : allProducts;
  const baseProducts = isSearching ? viewProducts.filter(p => matchesSearch(p, searchWords)) : viewProducts;
  const stockFiltered = stockOnly ? baseProducts.filter(inStock) : baseProducts;
  // Tri par référence croissante — sauf les Favoris, classés par quantités commandées.
  const displayedProducts = activeCatId === FAV_CAT_ID ? stockFiltered : [...stockFiltered].sort(byRef);

  // Les catégories de type, avec leur nombre d'articles. Une catégorie sans
  // aucun produit n'est pas affichée (inutile de proposer un filtre vide).
  const productTypes = useMemo(() => {
    return PRODUCT_TYPE_GROUPS.map(g => ({
      id: g.id,
      label: g.label,
      count: allProducts.filter(p => matchesTypeGroup(p, g.id) && (!stockOnly || inStock(p))).length,
    })).filter(g => g.count > 0);
  }, [allProducts, stockOnly]);

  const freeProductIds = new Set(freeItems.map(f => f.product.id));
  // Largeur du panier : glisser la poignée (souris ou doigt), retenue sur l'appareil.
  const [cartW, setCartW] = useState<number>(() => {
    try { return Math.max(260, Number(localStorage.getItem("wms_cart_width")) || 310); } catch { return 310; }
  });
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = cartW;
    const max = Math.max(320, Math.round(window.innerWidth * 0.6));
    let w = startW;
    const move = (ev: PointerEvent) => { w = Math.min(max, Math.max(260, startW + (startX - ev.clientX))); setCartW(w); };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      try { localStorage.setItem("wms_cart_width", String(Math.round(w))); } catch {}
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  // Panier élargi à la poignée : assez de place pour tout mettre sur une ligne.
  const wideCart = cartW >= 470;
  const cartItems = orderedCart(cart);
  // Loupe du panier : filtre les lignes (nom, réf., EAN) sans toucher au panier.
  const [cartSearch, setCartSearch] = useState<string | null>(null);
  const cartWords = fold(cartSearch || "").split(/\s+/).filter(Boolean);
  // Filtre « Ruptures » (ON/OFF) : seulement les lignes dont la quantité dépasse le stock.
  const [onlyRuptures, setOnlyRuptures] = useState(false);
  const isOverStock = (i: CartItem) => !i.note && !noStockCheck(i) && i.qty > Math.floor(i.product.virtual_available || 0);
  const shownCartItems = onlyRuptures ? cartItems.filter(isOverStock)
    : cartWords.length ? cartItems.filter(i => !i.note && matchesSearch(i.product, cartWords)) : cartItems;
  // Ligne d'une gratuité (zone « Gratuités », ou sous sa MEA / son article : inline).
  const giftRow = (g: GiftItem, inline: boolean) => {
    const i = giftItems.indexOf(g);
    if (listView) return giftListRow(g, i);
    return (
                <div key={`gift-${i}`} title={!giftActive(g, cart) ? (g.cond?.mea ? `MEA « ${g.cond?.label} » non éligible : promo Odoo non atteinte ou article MEA (code 7) absent` : `Offre suspendue : total d'articles de « ${g.cond?.label} » non atteint`) : undefined}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", borderBottom: inline ? "none" : `1px solid ${C.green}22`, ...(inline ? { background: C.greenSoft, borderRadius: 8, padding: "3px 6px", margin: "2px 0 4px 14px" } : {}), flexWrap: inline || !g.type ? "wrap" as const : "nowrap" as const, opacity: !giftActive(g, cart) ? 0.45 : g.qty === 0 ? 0.7 : 1 }}>
                  <span title={g.product.default_code || ""} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontSize: 11.5, fontWeight: 600, color: C.text, textDecoration: giftActive(g, cart) ? "none" : "line-through", ...(inline ? { flexBasis: "calc(100% - 44px)", order: -2, display: "flex", alignItems: "center", gap: 5 } : {}) }}>
                    {inline && <span style={{ color: C.green, display: "inline-flex", flexShrink: 0 }}><Icon name="gift" size={12} /></span>}
                    {inline ? <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{g.product.name}</span> : g.product.name}
                    {g.product.default_code && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 500, fontFamily: "monospace", color: C.muted }}>{g.product.default_code}</span>}
                  </span>
                  {inline && <span style={{ flex: 1 }} />}
                  <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                    <button onClick={() => setGiftItems(prev => prev.map((x, j) => j === i ? { ...x, qty: Math.max(0, x.qty - 1) } : x))}
                      style={{ width: 34, height: 34, borderRadius: 8, background: C.redSoft, border: "none", cursor: "pointer", color: C.red, fontSize: 16, fontWeight: 700, lineHeight: 1, padding: 0 }}>−</button>
                    <span key={g.qty} className="qty-pop" style={{ minWidth: 24, textAlign: "center" as const, fontSize: 12, fontWeight: 800, color: C.text }}>{g.qty}</span>
                    <button onClick={() => setGiftItems(prev => prev.map((x, j) => j === i ? { ...x, qty: x.qty + 1 } : x))}
                      style={{ width: 34, height: 34, borderRadius: 8, background: "#fff", border: `1px solid ${C.green}44`, cursor: "pointer", color: C.green, fontSize: 16, fontWeight: 700, lineHeight: 1, padding: 0 }}>+</button>
                  </div>
                  <button onClick={() => setGiftItems(prev => prev.filter((_, j) => j !== i))} title="Retirer"
                    style={{ flexShrink: 0, width: 32, height: 32, marginLeft: 4, background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 12, padding: 0, ...(inline ? { order: -2 } : {}) }}>✕</button>
                  {giftActive(g, cart) && g.qty > 0 && giftShortage(g, cart) > 0 && (
                    <span title="Stock prévisionnel insuffisant : quantité totale saisie sur le devis, rupture signalée dans la note interne"
                      style={{ flexBasis: "100%", order: 5, fontSize: 10.5, fontWeight: 700, color: C.red }}>
                      Rupture : {giftShortage(g, cart)} manquant{giftShortage(g, cart) > 1 ? "s" : ""} (stock {Math.max(0, Math.floor(g.product.virtual_available || 0))})
                    </span>
                  )}
                  {/* Type de gratuité PAR LIGNE (Coffre DC par défaut, Gratuités des offres pour une MEA) */}
                  <select value={g.type} title="Type de gratuité de cette ligne"
                    onChange={e => setGiftItems(prev => prev.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
                    style={{ order: -1, flexShrink: 0, width: g.type ? 96 : "100%", padding: "2px 4px", fontSize: 10, fontWeight: 700, borderRadius: 6, border: `1px solid ${g.type ? C.green + "66" : C.red}`, background: "#fff", color: g.type ? C.green : C.text, fontFamily: "inherit" }}>
                    <option value="">— Type —</option>
                    {freeTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
    );
  };
  // Vue liste : gratuité sur UNE ligne, mêmes colonnes et même hauteur qu'un article
  // payant ; le Type de gratuité prend la place de l'EAN, à droite du code article.
  const giftListRow = (g: GiftItem, i: number) => {
    const active = giftActive(g, cart);
    const short = active && g.qty > 0 ? giftShortage(g, cart) : 0;
    const setGiftQty = (n: number) => setGiftItems(prev => prev.map((x, j) => j === i ? { ...x, qty: Math.max(0, n) } : x));
    const brut = g.fullDiscountPrice ?? (g.product.lst_price || 0);
    return (
      <div key={`gift-${i}`} title={!active ? (g.cond?.mea ? `MEA « ${g.cond?.label} » non éligible : promo Odoo non atteinte ou article MEA (code 7) absent` : `Offre suspendue : total d'articles de « ${g.cond?.label} » non atteint`) : short > 0 ? `Rupture : ${short} manquant${short > 1 ? "s" : ""} — quantité totale saisie, rupture signalée dans la note interne` : undefined}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "1px 6px", minHeight: 26, borderBottom: `1px solid ${C.border}`, background: C.greenSoft, opacity: !active ? 0.45 : g.qty === 0 ? 0.7 : 1 }}>
        <span style={{ width: 8, flexShrink: 0, display: "inline-flex", justifyContent: "center", color: short > 0 ? C.red : C.green }}><Icon name="gift" size={10} /></span>
        <span style={{ width: LV.code, flexShrink: 0, fontSize: 10.5, fontFamily: "monospace", color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{g.product.default_code || ""}</span>
        <select value={g.type} title="Type de gratuité de cette ligne"
          onChange={e => setGiftItems(prev => prev.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
          style={{ width: LV.ean, flexShrink: 0, height: 22, padding: "0 2px", fontSize: 10.5, fontWeight: 700, borderRadius: 5, border: `1px solid ${g.type ? C.green + "66" : C.red}`, background: "#fff", color: g.type ? C.green : C.red, fontFamily: "inherit" }}>
          <option value="">— Type —</option>
          {freeTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, textDecoration: active ? "none" : "line-through" }}>
          {g.product.name}
          {short > 0 && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: C.red }}>Rupture : {short} manquant{short > 1 ? "s" : ""}</span>}
        </span>
        <div style={{ width: LV.qty, justifyContent: "center", display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
          <button onClick={() => setGiftQty(g.qty - 1)} style={{ width: 26, height: 24, borderRadius: 6, padding: 0, lineHeight: 1, background: C.redSoft, border: "none", cursor: "pointer", color: C.red, fontSize: 17, fontWeight: 700 }}>−</button>
          <span key={g.qty} className="qty-pop" style={{ minWidth: 38, height: 24, boxSizing: "border-box" as const, borderRadius: 6, border: `1px solid ${C.border}`, background: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: C.text }}>{g.qty}</span>
          <button onClick={() => setGiftQty(g.qty + 1)} style={{ width: 26, height: 24, borderRadius: 6, padding: 0, lineHeight: 1, background: C.tealSoft, border: "none", cursor: "pointer", color: C.teal, fontSize: 17, fontWeight: 700 }}>+</button>
        </div>
        <span style={{ width: LV.brut, flexShrink: 0, textAlign: "right" as const, fontSize: 11.5, color: C.textSec }}>{brut > 0 ? fmtPrice(brut) : "—"}</span>
        <span style={{ width: LV.remise, flexShrink: 0, textAlign: "right" as const, fontSize: 11.5, fontWeight: 700, color: C.green }}>100 %</span>
        <span style={{ width: LV.net, flexShrink: 0, textAlign: "right" as const, fontSize: 11.5, fontWeight: 700, color: C.text }}>{fmtPrice(0)}</span>
        <span style={{ width: LV.total, flexShrink: 0, textAlign: "right" as const, fontSize: 12, fontWeight: 800, color: C.green }}>Offert</span>
        <button onClick={() => setGiftItems(prev => prev.filter((_, j) => j !== i))} title="Retirer"
          style={{ flexShrink: 0, width: LV.x, height: 24, padding: 0, background: "transparent", border: "none", cursor: "pointer", color: C.muted, fontSize: 14 }}>✕</button>
      </div>
    );
  };
  // Gratuités sous leur MEA / après leur article (pas pendant une recherche dans le panier).
  const giftPlacement = placeGifts(shownCartItems, cartWords.length ? []
    : onlyRuptures ? giftItems.filter(g => giftActive(g, cart) && g.qty > 0 && giftShortage(g, cart) > 0) : giftItems);
  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cartItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const freeCount = freeItems.reduce((s, i) => s + i.qty, 0);
  const lineDiscounts = loyalty.computeLineDiscounts(appliedPromos, promoCart(cart));
  const effectivePromos = loyalty.effectivePromoIds(appliedPromos, promoCart(cart));
  const discountTotal = cartItems.reduce((s, i) => {
    if (i.note) return s;
    // Promo Odoo additionnée au tarif client, puis événement / implantation (linePricing).
    const lp = linePricing(i, addPctOf(i, lineDiscounts, eventDiscount), otherPctOf(i, groupDiscounts));
    return s + i.qty * (i.unitPrice - lp.net);
  }, 0);
  const netTotal = cartTotal - discountTotal;
  const shippingFee = needsShippingFee(netTotal);
  const [showCheck, setShowCheck] = useState<boolean | "validate">(false);

  // Ruptures de stock : produits dont la quantité commandée dépasse le stock
  // prévisionnel (virtual_available). AVERTISSEMENT seulement — le devis reste
  // créable : le stock bouge entre la visite et la livraison, et un devis n'est pas
  // une expédition. Les faux séparateurs (stock nul par nature) sont ignorés.
  const overStockItems = cartItems.filter(isOverStock);
  const giftRuptures = giftItems.filter(g => giftActive(g, cart) && g.qty > 0 && giftShortage(g, cart) > 0).length;
  const hasStockIssue = overStockItems.length + giftRuptures > 0;
  // Filtre coupé quand il n'y a plus de rupture ou que le panier repasse en petit.
  useEffect(() => { if ((!hasStockIssue || !listView) && onlyRuptures) setOnlyRuptures(false); }, [hasStockIssue, listView, onlyRuptures]);
  // Produits de vente (réf. en 1) : nombre de références et quantité totale — suivis par les DC.
  // Compteurs par famille de référence (1 vente, 3 testeur, 5 échantillon, 7 MEA) :
  // lignes du panier + gratuités (un testeur offert reste un testeur).
  const refCounts = (prefix: string, withGifts: boolean) => {
    const lines = [...cartItems.filter(i => !i.note && i.qty > 0), ...(withGifts ? giftItems : [])]
      .filter(i => String(i.product.default_code || "").startsWith(prefix));
    return { refs: new Set(lines.map(i => i.product.id)).size, qty: lines.reduce((s, i) => s + i.qty, 0) };
  };
  const familyCounts = ([["vente", "1", false], ["testeurs", "3", true], ["éch.", "5", true], ["MEA", "7", true]] as const)
    .map(([label, prefix, gifts]) => ({ label, ...refCounts(prefix, gifts) }))
    .filter(c => c.refs > 0);
  const giftQtyById = new Map<number, number>(giftItems.filter(g => g.qty > 0).map(g => [g.product.id, g.qty]));

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

      {/* ── Sidebar catégories par mots-clés ── */}
      <div style={{ width: 160, background: C.white, borderRight: `1px solid ${C.border}`, overflowY: "auto" as const, flexShrink: 0, display: listView ? "none" : "block" }}>
        <div style={{ padding: "8px 10px 3px", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Gammes</div>

        {/* « Tous » retiré de la liste des gammes (demande 2026-11-24). */}
        {/* Produit vente (défaut) : les six gammes de vente réunies */}
        {(() => {
          const active = activeCatId === VENTE_CAT_ID;
          const count = allProducts.filter(p => isVenteProduct(p) && (!stockOnly || inStock(p))).length;
          return (
            <button onClick={() => setActiveCatId(VENTE_CAT_ID)}
              style={{ width: "100%", padding: "6px 10px", background: active ? C.tealSoft : "transparent", border: "none", borderLeft: `3px solid ${active ? C.teal : "transparent"}`, cursor: "pointer", textAlign: "left" as const, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, transition: "all 0.1s" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: active ? 700 : 400, color: active ? C.tealDark : C.textSec }}>
                Produit vente
              </span>
              {count > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: active ? C.teal : C.muted, background: active ? C.tealMid : C.bg, borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>{count}</span>}
            </button>
          );
        })()}

        {/* « Top 40 » retiré de la liste des gammes (demande 2026-11-24) — le
             chargement (loadFavorites) reste en place pour un autre accès. */}
        {/* Catégories configurées */}
        {smartCats.map(cat => {
          const count = allProducts.filter(p => matchesCat(p, cat) && isSaleProduct(p) && (!stockOnly || inStock(p))).length;
          const active = activeCatId === cat.id;
          const hero = gammeHero(allProducts, cat);
          return (
            <button key={cat.id} onClick={() => setActiveCatId(cat.id)}
              style={{ width: "100%", padding: "6px 10px", background: active ? C.tealSoft : "transparent", border: "none", borderLeft: `3px solid ${active ? C.teal : "transparent"}`, cursor: "pointer", textAlign: "left" as const, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, transition: "all 0.1s" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: active ? 700 : 400, color: active ? C.tealDark : C.textSec }}>
                {SHOW_PRODUCT_IMAGES && <span style={{ position: "relative" as const, width: 34, height: 34, borderRadius: 9, background: "#fff", border: `1px solid ${active ? C.tealMid : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                  {/* Initiale de la gamme en fond : visible tant que l'image manque */}
                  <span style={{ position: "absolute" as const, fontSize: 14, fontWeight: 800, color: active ? C.teal : C.muted }}>{String(cat.label || "").charAt(0).toUpperCase()}</span>
                  {hero && <ProductImage id={hero.id} networkUrl={imgUrl(hero.id)} style={{ width: 30, height: 30, objectFit: "contain", position: "relative" as const, background: "#fff" }} />}
                </span>}
                {cat.label}
              </span>
              {count > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: active ? C.teal : C.muted, background: active ? C.tealMid : C.bg, borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>{count}</span>}
            </button>
          );
        })}

        {/* ── Types de produit (x_type_de_produit_id) ── */}
        {productTypes.length > 0 && (
          <div style={{ marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 3 }}>
            <div style={{ padding: "3px 10px 2px", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Type de produit</div>
            {productTypes.map(t => {
              const id = TYPE_CAT_PREFIX + t.id;
              const active = activeCatId === id;
              return (
                <button key={t.id} onClick={() => setActiveCatId(id)} title={t.label}
                  style={{ width: "100%", padding: "6px 10px", background: active ? C.tealSoft : "transparent", border: "none", borderLeft: `3px solid ${active ? C.teal : "transparent"}`, cursor: "pointer", textAlign: "left" as const, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, transition: "all 0.1s" }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontSize: 12, fontWeight: active ? 700 : 400, color: active ? C.tealDark : C.textSec }}>
                    {t.label}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: active ? C.teal : C.muted, background: active ? C.tealMid : C.bg, borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>{t.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Offres MEA ── */}
        <div style={{ marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 3 }}>
          <div style={{ padding: "3px 10px 2px", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Offres</div>
          <button
            onClick={() => { setActiveCatId(MEA_CAT_ID); loadMeaTemplates(); }}
            style={{ width: "100%", padding: "6px 10px", background: activeCatId === MEA_CAT_ID ? C.orangeSoft : "transparent", border: "none", borderLeft: `3px solid ${activeCatId === MEA_CAT_ID ? C.orange : "transparent"}`, cursor: "pointer", textAlign: "left" as const, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 7, transition: "all 0.1s" }}>
            <span style={{ fontSize: 12, fontWeight: activeCatId === MEA_CAT_ID ? 700 : 400, color: activeCatId === MEA_CAT_ID ? C.orange : C.textSec, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="gift" size={13} /> MEA
            </span>
          </button>
          <button
            onClick={() => { setActiveCatId(DEVIS_CAT_ID); loadMeaTemplates(); }}
            style={{ width: "100%", padding: "6px 10px", background: activeCatId === DEVIS_CAT_ID ? C.orangeSoft : "transparent", border: "none", borderLeft: `3px solid ${activeCatId === DEVIS_CAT_ID ? C.orange : "transparent"}`, cursor: "pointer", textAlign: "left" as const, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 7, transition: "all 0.1s" }}>
            <span style={{ fontSize: 12, fontWeight: activeCatId === DEVIS_CAT_ID ? 700 : 400, color: activeCatId === DEVIS_CAT_ID ? C.orange : C.textSec, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="file" size={13} /> Devis d&apos;implantation
            </span>
          </button>
          {/* Remise événement Co : % appliqué à tout le panier ; panneau ouvert au clic.
              Désactivée pour un devis d'implantation. */}
          <button onClick={() => !hasImplant && setShowEventDisc(v => !v)} disabled={hasImplant}
            title={hasImplant ? "Pas de remise événement sur un devis d'implantation" : undefined}
            style={{ width: "100%", padding: "6px 10px", opacity: hasImplant ? 0.4 : 1, background: eventDiscount > 0 || showEventDisc ? "#f5f3ff" : "transparent", border: "none", borderLeft: `3px solid ${eventDiscount > 0 ? "#7c3aed" : "transparent"}`, cursor: hasImplant ? "not-allowed" : "pointer", textAlign: "left" as const, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, transition: "all 0.1s" }}>
            <span style={{ fontSize: 12, fontWeight: eventDiscount > 0 ? 700 : 400, color: eventDiscount > 0 ? "#7c3aed" : C.textSec, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="tag" size={13} /> Remise événement
            </span>
            {eventDiscount > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "#7c3aed", borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>{eventDiscount}%</span>}
          </button>
          {showEventDisc && !hasImplant && (
            <div className="reveal" style={{ padding: "4px 10px 8px", display: "flex", flexDirection: "column" as const, gap: 6 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {[10, 15].map(v => (
                  <button key={v} onClick={() => setEventDiscount(d => d === v ? 0 : v)}
                    style={{ flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                      background: eventDiscount === v ? "#7c3aed" : "#fff", color: eventDiscount === v ? "#fff" : "#7c3aed", border: "1.5px solid #c4b5fd" }}>
                    {v}%
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Zone produits ── (masquée en vue liste) */}
      <div style={{ flex: 1, display: listView ? "none" : "flex", flexDirection: "column" as const, overflow: "hidden", minWidth: 0 }}>
        {/* Barre recherche avec croix */}
        <div style={{ padding: "10px 14px", background: C.white, borderBottom: `1px solid ${C.border}`, display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative" as const, flex: 1 }}>
            <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              ref={searchInput}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher par nom ou référence..."
              style={{ width: "100%", boxSizing: "border-box" as const, padding: "9px 34px 9px 34px", border: `1.5px solid ${search ? C.teal : C.border}`, borderRadius: 10, fontSize: 13, fontFamily: "inherit", background: C.bg, outline: "none", transition: "border-color 0.15s" }}
            />
            {search && (
              <button onClick={() => { setSearch(""); searchInput.current?.focus(); }}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: C.muted, border: "none", borderRadius: "50%", width: 18, height: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          {/* Toggle stock dispo */}
          <button
            onClick={() => setStockOnly(v => !v)}
            title={stockOnly ? "Afficher aussi les articles en rupture" : "N'afficher que les articles en stock"}
            style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, background: stockOnly ? C.tealSoft : C.bg, border: `1.5px solid ${stockOnly ? C.teal : C.border}`, borderRadius: 10, padding: "7px 11px", cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ width: 30, height: 17, borderRadius: 10, background: stockOnly ? C.teal : C.muted, position: "relative" as const, transition: "background 0.15s", flexShrink: 0 }}>
              <span style={{ position: "absolute", top: 2, left: stockOnly ? 15 : 2, width: 13, height: 13, borderRadius: "50%", background: "#fff", transition: "left 0.15s" }} />
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: stockOnly ? C.tealDark : C.textSec, whiteSpace: "nowrap" as const }}>Stock dispo</span>
          </button>
          {/* Vue dense : une ligne par produit (3 fois plus d'articles à l'écran) */}
          <button onClick={() => setDense(v => { try { localStorage.setItem("wms_catalog_dense", v ? "0" : "1"); } catch {} return !v; })}
            title={dense ? "Vue cartes (avec images)" : "Vue dense : une ligne par produit"} aria-label="Changer la vue du catalogue"
            style={{ height: 36, padding: "0 11px", gap: 6, flexShrink: 0, borderRadius: 10, background: C.bg, border: `1.5px solid ${C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.textSec, fontFamily: "inherit", fontSize: 12, fontWeight: 600 }}>
            {dense
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
              : <Icon name="list" size={16} />}
            {dense ? "Cartes" : "Liste"}
          </button>
          {/* Compteur résultats */}
          {(activeCatId || isSearching) && (
            <div style={{ fontSize: 12, color: C.muted, flexShrink: 0 }}>
              {displayedProducts.length} produit{displayedProducts.length > 1 ? "s" : ""}
            </div>
          )}
        </div>

        {/* Grille */}
        <div style={{ flex: 1, overflowY: "auto" as const, padding: 14 }}>

          {/* ── Vue MEA ── */}
          {isOfferView ? (
            meaLoading ? (
              <TubeLoader label="Chargement des offres…" />
            ) : shownTemplates.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: C.muted }}>
                <div style={{ marginBottom: 10 }}><Icon name="file" size={32} color={C.border} /></div>
                <div>{activeCatId === DEVIS_CAT_ID ? "Aucun devis d'implantation" : "Aucune MEA trouvée"}</div>
              </div>
            ) : (
              /* Vue groupée (Liste ET Cartes) : un bloc par MEA (couleur, titre), ses variantes dedans */
              (() => {
                // Groupe = nom avant le premier « - » (« MEA Cures 2026 - Standard… » → « MEA Cures 2026 »).
                const groupOf = (n: string) => { const i = n.indexOf(" - "); return (i > 0 ? n.slice(0, i) : n).trim(); };
                const variantOf = (n: string) => { const i = n.indexOf(" - "); return i > 0 ? n.slice(i + 3).trim() : n; };
                const groups: { key: string; items: any[] }[] = [];
                for (const t of shownTemplates) {
                  const k = groupOf(String(t.name || ""));
                  const g = groups.find(x => x.key === k);
                  if (g) g.items.push(t); else groups.push({ key: k, items: [t] });
                }
                const HUES = [172, 24, 262, 340, 205, 142, 45, 290];
                return (
                  <div className="stagger" style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
                    {groups.map((g, gi) => {
                      const h = HUES[gi % HUES.length];
                      const accent = `hsl(${h} 65% 38%)`, soft = `hsl(${h} 70% 96%)`, mid = `hsl(${h} 55% 85%)`;
                      return (
                        <div key={g.key} style={{ background: C.white, borderRadius: 16, border: `1px solid ${mid}`, overflow: "hidden", boxShadow: C.shadow }}>
                          {/* En-tête du groupe */}
                          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: soft, borderBottom: `1px solid ${mid}` }}>
                            <span style={{ width: 10, height: 10, borderRadius: "50%", background: accent, flexShrink: 0 }} />
                            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, color: accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{g.key}</span>
                            <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: accent, background: "#fff", border: `1px solid ${mid}`, borderRadius: 999, padding: "2px 9px" }}>
                              {g.items.length} variante{g.items.length > 1 ? "s" : ""}
                            </span>
                          </div>
                          {/* Variantes : cartes (mode Cartes) ou lignes (mode Liste) */}
                          {!dense && (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10, padding: 12 }}>
                              {g.items.map(t => {
                                const isApplying = applyingMea === t.id;
                                const lineCount = t.sale_order_template_line_ids?.length || 0;
                                const open = meaOpen === t.id;
                                return (
                                  <div key={t.id} style={{ background: C.white, borderRadius: 12, border: `1.5px solid ${open || isApplying ? accent : mid}`, padding: "12px 14px", display: "flex", flexWrap: "wrap" as const, alignItems: "center", gap: 10, ...(open ? { gridColumn: "1 / -1" } : {}) }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>{lineCount} produit{lineCount > 1 ? "s" : ""}</div>
                                      <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text, lineHeight: 1.3, overflowWrap: "anywhere" as const }} title={t.name}>{variantOf(String(t.name || ""))}</div>
                                    </div>
                                    {chevron(t)}
                                    <button onClick={() => applyMeaTemplate(t)} disabled={isApplying}
                                      style={{ flexShrink: 0, height: 36, padding: "0 14px", background: isApplying ? C.bg : accent, color: isApplying ? C.muted : "#fff", border: "none", borderRadius: 9, fontSize: 12.5, fontWeight: 800, cursor: isApplying ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" as const }}>
                                      {isApplying ? "…" : "+ Ajouter"}
                                    </button>
                                    {open && <div style={{ flexBasis: "100%" }}>{meaContent(t.id)}</div>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {dense && g.items.map((t, i) => {
                            const isApplying = applyingMea === t.id;
                            const lineCount = t.sale_order_template_line_ids?.length || 0;
                            return (
                              <div key={t.id} style={{ borderTop: i ? `1px solid ${C.border}` : "none", borderLeft: `4px solid ${meaOpen === t.id || isApplying ? accent : "transparent"}`, background: isApplying ? soft : C.white, padding: "8px 12px 8px 10px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                  {chevron(t)}
                                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }} title={t.name}>{variantOf(String(t.name || ""))}</div>
                                  <span style={{ flexShrink: 0, fontSize: 11, color: C.muted, width: 74, textAlign: "right" as const }}>{lineCount} produit{lineCount > 1 ? "s" : ""}</span>
                                  <button onClick={() => applyMeaTemplate(t)} disabled={isApplying}
                                    style={{ flexShrink: 0, height: 34, padding: "0 12px", background: isApplying ? C.bg : accent, color: isApplying ? C.muted : "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: isApplying ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" as const }}>
                                    {isApplying ? "…" : "+ Ajouter"}
                                  </button>
                                </div>
                                {meaOpen === t.id && <div style={{ paddingLeft: 44 }}>{meaContent(t.id)}</div>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })()
            )
          ) : activeCatId === FAV_CAT_ID && favLoading ? (
            <CatalogSkeleton dense={dense} count={8} />
          ) : activeCatId === FAV_CAT_ID && favLoaded && displayedProducts.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: C.muted }}>
              <div style={{ marginBottom: 10 }}><Icon name="star" size={32} color={C.border} /></div>
              <div>{favProducts.length === 0 ? "Aucun article de vente (code 10…) acheté par ce client sur les 18 derniers mois" : "Aucun article du Top 40 en stock — désactive « Stock dispo » pour tout voir"}</div>
            </div>
          ) : loading && allProducts.length === 0 ? (
            <CatalogSkeleton dense={dense} />
          ) : !activeCatId && !isSearching && allProducts.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60%", flexDirection: "column" as const, gap: 12, color: C.muted }}>
              <Icon name="package" size={48} color={C.border} />
              <div style={{ fontSize: 15, fontWeight: 600 }}>Aucun produit en stock</div>
            </div>
          ) : displayedProducts.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: C.muted }}>
              <div style={{ marginBottom: 10 }}><Icon name="search" size={32} color={C.border} /></div>
              <div>Aucun résultat</div>
            </div>
          ) : dense ? (
            <div className="stagger" style={{ background: C.white, borderRadius: 14, border: `1px solid ${C.border}`, overflow: "hidden" }}>
              {displayedProducts.map((p, i) => {
                const qty = cart[p.id]?.qty || 0;
                const stock = Math.max(0, Math.round(p.virtual_available || 0));
                const clientPrice = applyPricelist(p.lst_price || 0, p.id, p.product_tmpl_id?.[0] || 0, priceItems, qty || 1);
                const hasDiscount = priceItems.length > 0 && Math.abs(clientPrice - (p.lst_price || 0)) > 0.01;
                const gifted = giftQtyById.get(p.id);
                return (
                  <div key={p.id} style={{ display: "flex", flexWrap: "wrap" as const, rowGap: 4, alignItems: "center", gap: 10, padding: "6px 10px 6px 8px", borderTop: i ? `1px solid ${C.border}` : "none", borderLeft: `4px solid ${qty > 0 ? C.teal : "transparent"}`, background: qty > 0 ? C.tealSoft : C.white, transition: "background-color 0.25s ease, border-color 0.25s ease" }}>
                    {SHOW_PRODUCT_IMAGES && <div onClick={() => openZoom(p)} title="Agrandir l'image" style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 9, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-in", position: "relative" as const, overflow: "hidden" }}>
                      <div style={{ position: "absolute" }}><Icon name="package" size={18} color={C.border} /></div>
                      <ProductImage id={p.id} networkUrl={imgUrl(p.id)} style={{ height: 38, objectFit: "contain", position: "relative" as const, zIndex: 1 }} />
                    </div>}
                    {/* Catalogue étroit (portrait) : le nom garde sa ligne, prix et quantité passent dessous */}
                    <div style={{ flex: "1 1 190px", minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 10.5, color: C.textSec, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.default_code}{p.barcode ? <>{p.default_code ? " " : ""}<Ean code={p.barcode} /></> : null}</span>
                        {saleStep(p) > 1 && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: C.tealDark, background: C.tealMid, borderRadius: 5, padding: "0 5px" }}>min {saleStep(p)}</span>}
                        {Array.isArray(p.x_offre_produit_id) && <OfferTag name={p.x_offre_produit_id[1]} />}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
                    <div style={{ width: 64, flexShrink: 0, textAlign: "right" as const }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: hasDiscount ? C.green : C.tealDark }}>{clientPrice > 0 ? fmtPrice(clientPrice) : "—"}</div>
                      {hasDiscount && <div style={{ fontSize: 10, color: C.muted, textDecoration: "line-through" }}>{fmtPrice(p.lst_price)}</div>}
                    </div>
                    <span style={{ width: 46, flexShrink: 0, textAlign: "center" as const, fontSize: 10.5, fontWeight: 700, color: stock > 0 ? C.green : C.red, background: stock > 0 ? C.greenSoft : C.redSoft, borderRadius: 5, padding: "2px 0" }}>{stock > 0 ? stock : "Rupture"}</span>
                    <button onClick={() => offerGift(p)} title="Offrir une unité" aria-label={`Offrir ${p.name}`}
                      style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 9, background: gifted ? C.green : C.greenSoft, color: gifted ? "#fff" : C.green, border: `1px solid ${C.green}44`, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                      {gifted ? `×${gifted}` : <Icon name="gift" size={15} />}
                    </button>
                    <div style={{ display: "flex", flexShrink: 0, background: "#fff", borderRadius: 10, overflow: "hidden", border: `1px solid ${qty > 0 ? C.teal : C.border}` }}>
                      <button onClick={() => onQtyChange(p, qty - 1, clientPrice)} aria-label="Moins" style={{ width: 36, height: 38, background: "transparent", border: "none", cursor: "pointer", fontSize: 19, fontWeight: 700, color: qty > 0 ? C.red : C.muted, lineHeight: 1 }}>−</button>
                      <button onClick={() => setPad({ product: p, price: clientPrice })} title="Saisir une quantité"
                        style={{ width: 40, height: 38, background: "transparent", border: "none", borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}`, cursor: "pointer", fontSize: 15, fontWeight: 800, color: qty > 0 ? C.tealDark : C.muted, fontFamily: "inherit" }}>
                        <span key={qty} className="qty-pop">{qty}</span>
                      </button>
                      <button onClick={() => onQtyChange(p, qty + 1, clientPrice)} aria-label="Plus" style={{ width: 36, height: 38, background: "transparent", border: "none", cursor: "pointer", fontSize: 19, fontWeight: 700, color: C.teal, lineHeight: 1 }}>+</button>
                    </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(172px, 1fr))", gap: 8 }}>
              {displayedProducts.map(p => {
                const qty = cart[p.id]?.qty || 0;
                const isFree = freeProductIds.has(p.id);
                const stock = Math.max(0, Math.round(p.virtual_available || 0));
                // Prix client calculé côté client à partir des items pricelist (0 appel supplémentaire)
                const clientPrice = applyPricelist(p.lst_price || 0, p.id, p.product_tmpl_id?.[0] || 0, priceItems, qty || 1);
                const hasDiscount = priceItems.length > 0 && Math.abs(clientPrice - (p.lst_price || 0)) > 0.01;
                return (
                  <div key={p.id} style={{ background: C.white, borderRadius: 14, overflow: "hidden", border: `2px solid ${qty > 0 ? C.teal : isFree ? C.green : C.border}`, boxShadow: qty > 0 ? `0 0 0 3px ${C.tealMid}` : C.shadow, transition: "border-color 0.25s ease, box-shadow 0.25s ease" }}>
                    {SHOW_PRODUCT_IMAGES ? (
                    <div onClick={() => openZoom(p)} title="Agrandir l'image" style={{ height: 80, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" as const, cursor: "zoom-in" }}>
                      <div style={{ position: "absolute" }}><Icon name="package" size={30} color={C.border} /></div>
                      <ProductImage id={p.id} networkUrl={imgUrl(p.id)} style={{ height: 72, objectFit: "contain", position: "relative" as const, zIndex: 1 }} />
                      <div style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(255,255,255,0.85)", borderRadius: 6, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.5"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
                      </div>
                      {isFree && <div className="badge-in" style={{ position: "absolute", top: 5, right: 5, background: C.green, color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 5, padding: "2px 5px" }}>OFFERT</div>}
                      {qty > 0 && <div key={qty} className="qty-pop" style={{ position: "absolute", top: 5, left: 5, background: C.teal, color: "#fff", fontSize: 12, fontWeight: 800, borderRadius: 7, padding: "2px 8px" }}>{qty}</div>}
                      {/* Offre de l'article (champ « Offre produit ») : visible dès la saisie */}
                      {Array.isArray(p.x_offre_produit_id) && (
                        <div title={`Offre : ${p.x_offre_produit_id[1]}`} style={{ position: "absolute", left: 5, right: 5, bottom: 5, background: C.orange, color: "#fff", fontSize: 9.5, fontWeight: 800, borderRadius: 5, padding: "2px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, textAlign: "center" as const }}>
                          {p.x_offre_produit_id[1]}
                        </div>
                      )}
                    </div>
                    ) : (isFree || Array.isArray(p.x_offre_produit_id)) && (
                      // Sans photo : seuls les badges « OFFERT » et offre restent, en tête de carte.
                      // (La quantité est déjà dans le stepper et la bordure de la carte.)
                      <div style={{ display: "flex", gap: 4, padding: "6px 8px 0", minWidth: 0 }}>
                        {isFree && <div className="badge-in" style={{ flexShrink: 0, background: C.green, color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 5, padding: "2px 5px" }}>OFFERT</div>}
                        {Array.isArray(p.x_offre_produit_id) && (
                          <div title={`Offre : ${p.x_offre_produit_id[1]}`} style={{ flex: 1, minWidth: 0, background: C.orange, color: "#fff", fontSize: 9.5, fontWeight: 800, borderRadius: 5, padding: "2px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, textAlign: "center" as const }}>
                            {p.x_offre_produit_id[1]}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Carte compacte : 12 articles et plus visibles sur un écran d'iPad / PC */}
                    <div style={{ padding: "6px 8px 8px" }}>
                      <div style={{ fontSize: 10, color: C.textSec, fontFamily: "monospace", marginBottom: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.default_code}{p.barcode ? <>{p.default_code ? " " : ""}<Ean code={p.barcode} /></> : null}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.25, height: 30, overflow: "hidden" }}>{p.name}</div>
                      {/* Pas de pastille « min N » en mode carte (place) : le pas de vente
                           reste appliqué par les boutons − / + et le pavé numérique. */}
                      {activeCatId === FAV_CAT_ID && p.totalQty != null && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.orange, background: C.orangeSoft, borderRadius: 5, padding: "2px 6px", marginTop: 3, display: "inline-block" }}>
                          {Math.round(p.totalQty)} acheté{Math.round(p.totalQty) > 1 ? "s" : ""}
                        </div>
                      )}
                      {/* Prix client + prix barré sur une seule ligne */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4, marginTop: 3, marginBottom: 4 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "baseline", gap: 5, whiteSpace: "nowrap" as const }}>
                            <span style={{ fontSize: 12, fontWeight: 800, color: hasDiscount ? C.green : C.tealDark }}>{clientPrice > 0 ? fmtPrice(clientPrice) : "—"}</span>
                            {hasDiscount && <span style={{ fontSize: 9.5, color: C.muted, textDecoration: "line-through" }}>{fmtPrice(p.lst_price)}</span>}
                          </div>
                          {ppcOf(p) > 0 && <div title="Prix public conseillé" style={{ fontSize: 9.5, color: C.muted, lineHeight: 1.2 }}>PPC {fmtPrice(ppcOf(p))}</div>}
                        </div>
                        <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 600, color: stock > 0 ? C.green : C.red, background: stock > 0 ? C.greenSoft : C.redSoft, borderRadius: 5, padding: "2px 6px" }}>{stock > 0 ? stock : "Rupture"}</span>
                      </div>
                      {/* Stepper (36 px) + bouton Offrir sur la même ligne. Chiffre TAPABLE → pavé numérique */}
                      <div style={{ display: "flex", gap: 5 }}>
                        <div style={{ flex: 1, minWidth: 0, display: "flex", background: qty > 0 ? C.tealSoft : C.bg, borderRadius: 9, overflow: "hidden", border: `1px solid ${qty > 0 ? C.tealMid : C.border}` }}>
                          <button onClick={() => onQtyChange(p, qty - 1, clientPrice)} aria-label="Moins" style={{ flex: 1, height: 36, background: "transparent", border: "none", cursor: "pointer", fontSize: 18, fontWeight: 700, color: qty > 0 ? C.red : C.muted, lineHeight: 1, padding: 0 }}>−</button>
                          <button onClick={() => setPad({ product: p, price: clientPrice })} title="Saisir une quantité"
                            style={{ flex: 1.2, height: 36, background: "transparent", border: "none", borderLeft: `1px solid ${qty > 0 ? C.tealMid : C.border}`, borderRight: `1px solid ${qty > 0 ? C.tealMid : C.border}`, cursor: "pointer", fontSize: 15, fontWeight: 800, color: qty > 0 ? C.tealDark : C.muted, fontFamily: "inherit", padding: 0 }}>
                            <span key={qty} className="qty-pop">{qty}</span>
                          </button>
                          <button onClick={() => onQtyChange(p, qty + 1, clientPrice)} aria-label="Plus" style={{ flex: 1, height: 36, background: "transparent", border: "none", cursor: "pointer", fontSize: 18, fontWeight: 700, color: C.teal, lineHeight: 1, padding: 0 }}>+</button>
                        </div>
                        <button onClick={() => offerGift(p)} title={giftQtyById.has(p.id) ? `Offert ×${giftQtyById.get(p.id)} — offrir une unité de plus` : "Offrir une unité (type de gratuité choisi dans le panier)"}
                          aria-label="Offrir"
                          style={{ flexShrink: 0, minWidth: 36, height: 38, padding: "0 6px", background: giftQtyById.has(p.id) ? C.green : C.greenSoft, color: giftQtyById.has(p.id) ? "#fff" : C.green, border: `1px solid ${C.green}44`, borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                          <Icon name="gift" size={15} />{giftQtyById.has(p.id) && <span>×{giftQtyById.get(p.id)}</span>}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Panier persistant (droite), largeur réglable par la poignée ── */}
      <div style={{ width: listView ? undefined : cartW, maxWidth: listView ? undefined : "52%", flex: listView ? 1 : undefined, minWidth: 0, position: "relative" as const, background: C.white, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column" as const, flexShrink: 0 }}>
        {!listView && <div onPointerDown={startResize} title="Glisser pour élargir ou réduire le panier"
          style={{ position: "absolute" as const, left: -12, top: 0, bottom: 0, width: 24, cursor: "col-resize", zIndex: 5, touchAction: "none" as const, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 5, height: 44, borderRadius: 3, background: C.border, boxShadow: "0 0 0 2px #fff" }} />
        </div>}
        {/* Header panier */}
        <div style={{ padding: listView ? "5px 12px" : "12px 14px", background: "#0f766e", color: "#fff", ...(listView ? { display: "flex", alignItems: "center", gap: 14 } : {}) }}>
          <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7, ...(listView ? { order: 2, flexShrink: 0 } : {}) }}>
            {/* Filtre ON/OFF « Articles en rupture » : panier en grand (vue liste) seulement */}
            {listView && hasStockIssue && (
              <button onClick={() => setOnlyRuptures(v => !v)} role="switch" aria-checked={onlyRuptures}
                title={onlyRuptures ? "Afficher toutes les lignes" : "N'afficher que les articles en rupture"}
                style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 7, height: 28, padding: "0 5px 0 10px", marginRight: 4, borderRadius: 999, border: "none", background: onlyRuptures ? "#fff" : "rgba(255,255,255,0.15)", color: onlyRuptures ? C.red : "#fff", fontSize: 11.5, fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>
                Articles en rupture
                <span style={{ width: 30, height: 17, borderRadius: 999, background: onlyRuptures ? C.red : "rgba(255,255,255,0.35)", position: "relative" as const, transition: "background 0.15s" }}>
                  <span style={{ position: "absolute" as const, top: 2, left: onlyRuptures ? 15 : 2, width: 13, height: 13, borderRadius: "50%", background: "#fff", transition: "left 0.15s" }} />
                </span>
              </button>
            )}
            <Icon name="cart" size={14} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, ...(listView ? { display: "none" } : {}) }}>Panier — {client.name}</span>
            {/* Loupe : chercher dans le panier */}
            <button onClick={() => setCartSearch(v => v === null ? "" : null)} title="Chercher dans le panier"
              style={{ width: 30, height: 30, borderRadius: 8, background: cartSearch !== null ? "#fff" : "rgba(255,255,255,0.15)", border: "none", color: cartSearch !== null ? "#0f766e" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="search" size={15} />
            </button>
            {/* Ligne de commentaire */}
            <button onClick={() => onAddNote("")} title="Ajouter une ligne de commentaire"
              style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="note" size={15} />
            </button>
            {/* Vider le panier */}
            {cartItems.length + giftItems.length > 0 && (
              <button onClick={clearCart} title="Vider tout le panier" aria-label="Vider tout le panier"
                style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon name="trash" size={15} />
              </button>
            )}
            {/* Vue liste plein écran */}
            <button onClick={() => setListView(v => !v)} title={listView ? "Revenir au catalogue" : "Vue liste : une ligne par article"}
              style={{ width: 30, height: 30, borderRadius: 8, background: listView ? "#fff" : "rgba(255,255,255,0.15)", border: "none", color: listView ? "#0f766e" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon name="list" size={15} />
            </button>
          </div>
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: listView ? 0 : 2, ...(listView ? { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const } : {}) }}>
            {listView && <strong style={{ fontSize: 12.5, opacity: 1, marginRight: 8 }}>Panier — {client.name}</strong>}
            <span key={cartCount} className="qty-pop" style={{ fontWeight: 800, marginRight: 2 }}>{cartCount}</span> article{cartCount > 1 ? "s" : ""} · <CountUp value={cartTotal} format={fmtPrice} />
            {familyCounts.map(c => <span key={c.label} style={{ marginLeft: 6 }}>· {c.label} : {c.refs} réf. / {c.qty} pcs</span>)}
            {freeCount > 0 && <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.2)", borderRadius: 5, padding: "1px 6px" }}>+{freeCount} offerts</span>}
          </div>
        </div>

        {cartSearch !== null && (
          <div className="reveal" style={{ padding: "8px 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
            <input autoFocus value={cartSearch} onChange={e => setCartSearch(e.target.value)} placeholder="Chercher dans le panier (nom, réf., EAN)…"
              onKeyDown={e => { if (e.key === "Escape") setCartSearch(null); }}
              style={{ flex: 1, minWidth: 0, height: 34, padding: "0 10px", borderRadius: 9, border: `1.5px solid ${C.tealMid}`, fontSize: 13, fontFamily: "inherit", color: C.text, outline: "none" }} />
            {cartWords.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, flexShrink: 0 }}>{shownCartItems.length} / {cartItems.filter(i => !i.note).length}</span>}
          </div>
        )}
        {/* Liste articles */}
        <div style={{ flex: 1, overflowY: "auto" as const, padding: listView ? "2px 10px 4px" : "10px 12px" }}>
          {cartItems.length === 0 ? (
            <div className="fade-in" style={{ textAlign: "center", padding: "32px 12px", color: C.muted }}>
              <div style={{ marginBottom: 8 }}><Icon name="cart" size={28} color={C.border} /></div>
              <div style={{ fontSize: 12 }}>Ajoute des produits</div>
            </div>
          ) : (<>
            {/* Vue liste : intitulés des colonnes */}
            {listView && (() => {
              const h = (w: number | undefined, label: string, right = false) => (
                <span style={{ width: w, flex: w ? undefined : 1, minWidth: 0, flexShrink: 0, textAlign: right ? "right" as const : "left" as const, fontSize: 10.5, fontWeight: 800, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.04em", whiteSpace: "nowrap" as const }}>{label}</span>
              );
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 6px 3px", borderBottom: `1.5px solid ${C.border}`, position: "sticky" as const, top: -2, background: C.white, zIndex: 1 }}>
                  <span style={{ width: 8, flexShrink: 0 }} />
                  {h(LV.code, "Code")}
                  {h(LV.ean, "EAN")}
                  {h(undefined, "Article")}
                  <span style={{ width: LV.qty, flexShrink: 0, textAlign: "center" as const, fontSize: 10.5, fontWeight: 800, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>Qté</span>
                  {h(LV.brut, "PU brut", true)}
                  {h(LV.remise, "Remise", true)}
                  {h(LV.net, "PU net", true)}
                  {h(LV.total, "Total", true)}
                  <span style={{ width: LV.x, flexShrink: 0 }} />
                </div>
              );
            })()}
            {shownCartItems.map((item, idx) => {
              const prevGroup = idx > 0 ? shownCartItems[idx - 1].group : undefined;
              // Séparateur quand on change de MEA ; « Autres articles » après une MEA.
              const sepLabel = item.group !== prevGroup && (idx > 0 || item.group)
                ? (item.group || "Autres articles") : null;
              // Pastille stock : rouge si la quantité dépasse le stock prévisionnel.
              const stockOk = noStockCheck(item) || item.qty <= Math.floor(item.product.virtual_available || 0);
              const pct = addPctOf(item, lineDiscounts, eventDiscount);
              const groupPct = otherPctOf(item, groupDiscounts);
              // Article MEA code 7 : verrouillé (ni quantité ni suppression) — sans lui,
              // l'étiquette de l'offre ne part pas dans Odoo. Retiré avec « Retirer » de la MEA.
              const codeLocked = !!item.freeType && !!item.group && /^7/.test(String(item.product.default_code || "").trim());
              const lockedMark = <span title="Article de la MEA : retiré uniquement avec « Retirer » de la MEA" style={{ flexShrink: 0, width: 32, textAlign: "center" as const, fontSize: 12, color: C.muted }}>🔒</span>;
              const net = item.qty * linePricing(item, pct, groupPct).net;
              // Prix catalogue d'origine (avant pricelist client) pour affichage barré.
              const catalog = item.product.lst_price || 0;
              const hasPricelistDiscount = catalog > 0 && catalog - item.unitPrice > 0.01;
              const pricelistPct = hasPricelistDiscount ? (1 - item.unitPrice / catalog) * 100 : 0;
              // Remise totale affichée = sur le prix catalogue, tarif client + promos (additionnés,
              // cf. linePricing), à 0,1 % près — même pour une ligne à quantité 0.
              const lpUnit = linePricing(item, pct, groupPct);
              const refBrut = catalog > 0 ? Math.max(catalog, item.unitPrice) : item.unitPrice;
              const totalPct = refBrut > 0 ? Math.round((1 - lpUnit.net / refBrut) * 1000) / 10 : 0;
              const fmtPct = (n: number) => String(n).replace(".", ",");
              return (
                <div key={item.product.id} className={removing.has(item.product.id) ? "cart-line removing" : "cart-line"}>
                {sepLabel && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: idx === 0 ? "0 0 8px" : "14px 0 8px" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: item.group ? C.tealDark : C.muted, textTransform: "uppercase" as const, letterSpacing: "0.04em", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis", maxWidth: "85%" }}>
                      {sepLabel}
                    </span>
                    <span style={{ flex: 1, height: 1, background: item.group ? C.tealMid : C.border }} />
                    {/* Plusieurs variantes pour cette MEA : liste pour en changer */}
                    {item.group && !/implantation/i.test(item.group) && (() => {
                      const vs = variantsOfGroup(item.group);
                      if (vs.length < 2) return null;
                      return (
                        <select value={vs.find((t: any) => t.name === item.group)?.id ?? ""} title="Changer de variante"
                          onChange={e => { const t = vs.find((x: any) => x.id === Number(e.target.value)); if (t) switchVariant(item.group!, t); }}
                          style={{ flexShrink: 0, maxWidth: 170, height: 26, padding: "0 6px", borderRadius: 999, border: `1px solid ${C.teal}55`, background: C.tealSoft, color: C.tealDark, fontSize: 11, fontWeight: 700, fontFamily: "inherit", cursor: "pointer" }}>
                          {!vs.some((t: any) => t.name === item.group) && <option value="">Variante…</option>}
                          {vs.map((t: any) => <option key={t.id} value={t.id}>{String(t.name).includes(" - ") ? String(t.name).slice(String(t.name).lastIndexOf(" - ") + 3) || t.name : t.name}</option>)}
                        </select>
                      );
                    })()}
                    {/* Retirer toute la MEA en un tap */}
                    {item.group && (
                      <button onClick={() => removeGroup(item.group!)} title={`Retirer « ${item.group} » du panier`}
                        style={{ flexShrink: 0, height: 26, padding: "0 9px", borderRadius: 999, border: `1px solid ${C.red}33`, background: C.redSoft, color: C.red, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}>
                        <Icon name="trash" size={12} /> Retirer
                      </button>
                    )}
                    {/* Devis d'implantation : remise modifiable, appliquée à toutes ses lignes */}
                    {item.group && /implantation/i.test(item.group) && (
                      <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 700, color: C.orange, flexShrink: 0 }}>
                        Remise
                        <input type="number" inputMode="decimal" min={0} max={100} placeholder="0"
                          value={groupDiscounts[item.group] || ""}
                          onChange={e => { const g = item.group!; const n = Math.max(0, Math.min(100, Number(e.target.value) || 0)); setGroupDiscounts(prev => ({ ...prev, [g]: n })); }}
                          style={{ width: 44, height: 24, padding: "0 4px", borderRadius: 6, border: `1px solid ${C.orange}66`, fontSize: 11.5, fontWeight: 700, fontFamily: "inherit", color: C.text, textAlign: "right" as const }} />
                        %
                      </label>
                    )}
                  </div>
                )}
                {(giftPlacement.before.get(idx) || []).map(g => giftRow(g, true))}
                {item.note ? (
                  /* Ligne de commentaire : texte libre, repris tel quel dans le devis */
                  <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 6, padding: "4px 6px 4px 10px", borderLeft: `3px solid ${item.note === "line_section" ? C.tealDark : C.muted}`, background: C.bg, borderRadius: 6 }}>
                    <input value={item.product.name} onChange={e => onNoteText(item.product.id, e.target.value)}
                      autoFocus={!item.product.name} placeholder="Commentaire…"
                      style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none", fontFamily: "inherit", fontSize: 12, fontStyle: item.note === "line_note" ? "italic" : "normal", fontWeight: item.note === "line_section" ? 800 : 500, color: C.textSec }} />
                    <button onClick={() => removeLine(item.product)} title="Supprimer le commentaire"
                      style={{ flexShrink: 0, width: 24, height: 24, background: "transparent", border: "none", cursor: "pointer", color: C.muted, fontSize: 13 }}>✕</button>
                  </div>
                ) : listView ? (
                  /* Vue liste : une ligne par article */
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "1px 6px", minHeight: 26, borderBottom: `1px solid ${C.border}` }}>
                    <span title={stockOk ? "En stock" : `Stock insuffisant : ${Math.floor(item.product.virtual_available || 0)} dispo`}
                      style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: stockOk ? C.green : C.red }} />
                    <span style={{ width: LV.code, flexShrink: 0, fontSize: 10.5, fontFamily: "monospace", color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{item.product.default_code}</span>
                    <span style={{ width: LV.ean, flexShrink: 0, fontSize: 10.5, fontFamily: "monospace", color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{item.product.barcode ? <Ean code={item.product.barcode} /> : ""}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{item.product.name}</span>
                    {Array.isArray(item.product.x_offre_produit_id) && <OfferTag name={item.product.x_offre_produit_id[1]} />}
                    <div style={{ width: LV.qty, justifyContent: "center", display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                      <button onClick={() => onQtyChange(item.product, item.qty - 1)} disabled={codeLocked} style={{ width: 26, height: 24, borderRadius: 6, padding: 0, lineHeight: 1, background: C.redSoft, border: "none", cursor: codeLocked ? "default" : "pointer", color: C.red, fontSize: 17, fontWeight: 700, visibility: codeLocked ? "hidden" : "visible" }}>−</button>
                      <button onClick={() => !codeLocked && setPad({ product: item.product })} style={{ minWidth: 38, height: 24, borderRadius: 6, padding: "0 4px", background: "#fff", border: `1px solid ${C.border}`, cursor: "pointer", fontSize: 12, fontWeight: 800, color: C.text, fontFamily: "inherit" }}><span key={item.qty} className="qty-pop">{item.qty}</span></button>
                      <button onClick={() => onQtyChange(item.product, item.qty + 1)} disabled={codeLocked} style={{ width: 26, height: 24, borderRadius: 6, padding: 0, lineHeight: 1, background: C.tealSoft, border: "none", cursor: codeLocked ? "default" : "pointer", color: C.teal, fontSize: 17, fontWeight: 700, visibility: codeLocked ? "hidden" : "visible" }}>+</button>
                    </div>
                    {(() => {
                      // PU brut = prix catalogue (avant liste de prix du client) ;
                      // remise = liste de prix + promos + remises de groupe, cumulées ;
                      // PU net = prix réellement facturé à l'unité.
                      const unitNet = lpUnit.net;
                      const brut = catalog > 0 ? Math.max(catalog, item.unitPrice) : item.unitPrice;
                      const remise = brut > 0 ? Math.round((1 - unitNet / brut) * 1000) / 10 : 0;
                      return <>
                        <span style={{ width: LV.brut, flexShrink: 0, textAlign: "right" as const, fontSize: 11.5, color: C.textSec }}>{fmtPrice(brut)}</span>
                        <span style={{ width: LV.remise, flexShrink: 0, textAlign: "right" as const, fontSize: 11.5, fontWeight: 700, color: remise > 0.04 ? C.orange : C.muted }}>{remise > 0.04 ? `${String(remise).replace(".", ",")} %` : "—"}</span>
                        <span style={{ width: LV.net, flexShrink: 0, textAlign: "right" as const, fontSize: 11.5, fontWeight: 700, color: C.text }}>{fmtPrice(unitNet)}</span>
                      </>;
                    })()}
                    <span style={{ width: LV.total, flexShrink: 0, textAlign: "right" as const, fontSize: 12, fontWeight: 800, color: C.text }}>{fmtPrice(net)}</span>
                    {codeLocked ? lockedMark : <button onClick={() => removeLine(item.product)} title="Retirer" style={{ flexShrink: 0, width: LV.x, height: 24, padding: 0, background: "transparent", border: "none", cursor: "pointer", color: C.muted, fontSize: 14 }}>✕</button>}
                  </div>
                ) : (
                /* Vue compacte : panier étroit → nom sur toute la largeur, détails et
                   quantité dessous ; panier élargi → tout sur une ligne. Boutons au doigt (36 px). */
                (() => {
                  const dot = <span title={stockOk ? "En stock" : `Stock insuffisant : ${Math.floor(item.product.virtual_available || 0)} dispo`}
                    style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: stockOk ? C.green : C.red }} />;
                  const refs = (item.product.default_code || item.product.barcode)
                    ? <>{item.product.default_code}{item.product.barcode ? <>{item.product.default_code ? " " : ""}<Ean code={item.product.barcode} /></> : null}</>
                    : null;
                  const disc = (pricelistPct > 0 || pct + groupPct > 0) && (
                    <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: C.orange }}>−{fmtPct(totalPct)} %</span>
                  );
                  const offer = Array.isArray(item.product.x_offre_produit_id) && <OfferTag name={item.product.x_offre_produit_id[1]} />;
                  const qtyCtl = (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <button onClick={() => onQtyChange(item.product, item.qty - 1)} aria-label="Moins" disabled={codeLocked}
                        style={{ visibility: codeLocked ? "hidden" : "visible", width: 36, height: 36, borderRadius: 9, background: C.redSoft, border: "none", cursor: "pointer", color: C.red, fontSize: 18, fontWeight: 700, lineHeight: 1, padding: 0 }}>−</button>
                      <button onClick={() => !codeLocked && setPad({ product: item.product })} title={saleStep(item.product) > 1 ? `Saisir une quantité (min ${saleStep(item.product)})` : "Saisir une quantité"}
                        style={{ minWidth: 42, height: 36, borderRadius: 9, background: "#fff", border: `1px solid ${saleStep(item.product) > 1 ? C.tealMid : C.border}`, cursor: "pointer", fontSize: 14, fontWeight: 800, color: C.text, fontFamily: "inherit", padding: "0 6px" }}>
                        <span key={item.qty} className="qty-pop">{item.qty}</span>
                      </button>
                      <button onClick={() => onQtyChange(item.product, item.qty + 1)} aria-label="Plus" disabled={codeLocked}
                        style={{ visibility: codeLocked ? "hidden" : "visible", width: 36, height: 36, borderRadius: 9, background: C.tealSoft, border: "none", cursor: "pointer", color: C.teal, fontSize: 18, fontWeight: 700, lineHeight: 1, padding: 0 }}>+</button>
                    </div>
                  );
                  const total = <span style={{ width: 68, flexShrink: 0, textAlign: "right" as const, fontSize: 12.5, fontWeight: 800, color: pct + groupPct > 0 ? C.orange : C.text }}>{fmtPrice(net)}</span>;
                  // Croix éloignée du « + » (pas de suppression en voulant ajouter).
                  const remove = codeLocked ? lockedMark : (
                    <button onClick={() => removeLine(item.product)} title="Retirer" aria-label={`Retirer ${item.product.name} du panier`}
                      style={{ flexShrink: 0, width: 32, height: 32, marginLeft: 4, background: "transparent", border: "none", cursor: "pointer", color: C.muted, fontSize: 13, padding: 0 }}>✕</button>
                  );
                  const tip = [item.product.default_code, `${item.qty} × ${fmtPrice(item.unitPrice)}`, item.priceLocked && "prix fixé"].filter(Boolean).join(" · ");
                  return wideCart ? (
                    <div title={tip} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0 3px 4px", borderBottom: `1px solid ${C.border}` }}>
                      {dot}
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontSize: 12.5, fontWeight: 600, color: C.text }}>
                        {item.product.name}
                        {refs && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 500, fontFamily: "monospace", color: C.muted }}>{refs}</span>}
                      </span>
                      {offer}{disc}{qtyCtl}{total}{remove}
                    </div>
                  ) : (
                    <div title={tip} style={{ padding: "5px 0 5px 4px", borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {dot}
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontSize: 13, fontWeight: 600, color: C.text }}>{item.product.name}</span>
                        {offer}
                        {remove}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 14 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontSize: 10, fontFamily: "monospace", color: C.muted }}>{refs}</span>
                        {disc}{qtyCtl}{total}
                      </div>
                    </div>
                  );
                })()
                )}
                {(giftPlacement.after.get(idx) || []).map(g => giftRow(g, true))}
                </div>
              );
            })}
          </>)}

          {/* Gratuités placées sous leur MEA / après leur article (placeGifts) : message
               de suspension sous la liste ; zone « Gratuités » pour les autres seulement. */}
          {giftPlacement.rest.length === 0 && giftItems.some(g => !giftActive(g, cart) && g.cond?.mea) && (
            <div style={{ margin: "6px 0", fontSize: 11, fontWeight: 700, color: C.orange }}>
              Gratuités de MEA suspendues (barrées) : la promo Odoo liée n'est pas atteinte ou l'article MEA (code 7) est absent ; elles reviennent dès que la MEA est éligible.
            </div>
          )}
          {/* Gratuités hors MEA (bouton Offrir…) : produit à 0 € + type de gratuité */}
          {giftPlacement.rest.length > 0 && (
            <div className="reveal" style={{ margin: "8px 0", padding: "8px 10px", background: C.greenSoft, border: `1px solid ${C.green}44`, borderRadius: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.green, textTransform: "uppercase" as const, letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 5 }}><Icon name="gift" size={11} /> Gratuités</span>
              </div>
              {giftPlacement.rest.map(g => giftRow(g, false))}
              {giftItems.some(g => !giftActive(g, cart)) && (
                <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: C.orange }}>
                  {giftItems.some(g => !giftActive(g, cart) && g.cond?.mea)
                    ? "Gratuités de MEA suspendues : la promo Odoo liée n'est pas atteinte ou l'article MEA (code 7) est absent ; elles reviennent dès que la MEA est éligible."
                    : "Offre gratuite suspendue : total d'articles de l'offre non atteint (elle revient dès qu'il l'est)."}
                </div>
              )}
              {/* Récap gratuités */}
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.green}33`, fontSize: 11, fontWeight: 700, color: C.green, display: "flex", justifyContent: "space-between" }}>
                <span>{(() => { const n = giftItems.filter(g => giftActive(g, cart)).reduce((s, g) => s + g.qty, 0); return `${n} article${n > 1 ? "s" : ""} offert${n > 1 ? "s" : ""}`; })()}</span>
                <span>0,00 €</span>
              </div>
            </div>
          )}

          {/* Articles gratuits (règles maison — inchangé) */}
          {freeItems.length > 0 && (
            <div style={{ margin: "8px 0", padding: "8px 10px", background: C.greenSoft, border: `1px solid ${C.green}33`, borderRadius: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.green, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5, display: "flex", alignItems: "center", gap: 5 }}><Icon name="gift" size={11} /> BC Gratuit (séparé)</div>
              {freeItems.map((fi, i) => (
                <div key={i} style={{ fontSize: 11, color: C.green, marginBottom: 2 }}>
                  <strong>{fi.qty}×</strong> {fi.product.name}
                  <div style={{ fontSize: 10, opacity: 0.7 }}>{fi.ruleName}</div>
                </div>
              ))}
            </div>
          )}

          {/* Remises additionnelles appliquées : seul le palier retenu est affiché */}
          {Object.keys(appliedPromos).length > 0 && (
            <div style={{ margin: "8px 0", padding: "8px 10px", background: C.orangeSoft, border: `1px solid ${C.orange}33`, borderRadius: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.orange, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5, display: "flex", alignItems: "center", gap: 5 }}><Icon name="tag" size={11} /> Remises appliquées</div>
              {Object.values(appliedPromos).filter(p => effectivePromos.has(p.program.id)).map(p => (
                <div key={p.program.id} style={{ fontSize: 11, color: C.orange, marginBottom: 2 }}>
                  <strong>{p.program.name}</strong>
                  <div style={{ fontSize: 10, opacity: 0.8 }}>
                    {p.type === "discount" ? `-${p.reward.discount}%` : `${p.productName} offert`}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>

        {/* Rupture de stock : le détail est porté par la pastille rouge de chaque
            ligne ; ici un simple rappel. Informatif — le devis reste créable. */}
        {hasStockIssue && (
          <div style={{ margin: "0 12px 8px", display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: C.red }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.red, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              {overStockItems.length + giftRuptures} rupture{overStockItems.length + giftRuptures > 1 ? "s" : ""} : signalée{overStockItems.length + giftRuptures > 1 ? "s" : ""} dans la note interne du devis (quantité totale saisie)
            </span>
          </div>
        )}

        {/* Bloc récap sombre — note + total + validation */}
        {/* Vue liste, récap replié : tout sur UNE ligne (plus de lignes d'articles visibles). */}
        <div style={{ padding: slim ? "0 10px 6px" : "0 12px 12px" }}>
          <div style={{ background: "#0f172a", borderRadius: slim ? 14 : 18, padding: recapOpen ? "14px 14px 16px" : slim ? "6px 8px 6px 12px" : "10px 12px 12px", boxShadow: "0 12px 28px rgba(15,23,42,0.35)", ...(slim ? { display: "flex", alignItems: "center", gap: 16 } : {}) }}>
            {/* Résumé cliquable : ouvre / replie le détail */}
            <button onClick={toggleRecap} title={recapOpen ? "Replier" : "Expédition, type, offres, note"}
              style={{ width: slim ? undefined : "100%", flex: slim ? "1 1 0" : undefined, display: "flex", alignItems: "center", gap: 6, padding: "4px 2px", marginBottom: recapOpen ? 10 : slim ? 0 : 8, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", color: "rgba(255,255,255,0.7)", fontSize: 11.5, fontWeight: 700, textAlign: "left" as const, minWidth: 0 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                {[
                  shipping ? `Expé. ${shipping.expedition.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`
                    : minShipDate && `Expé. à partir du ${minShipDate.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`,
                  meta?.typeField && (meta.typeOptions.find(o => o.value === orderType)?.label || "Type ?"),
                  allOffers.length > 0 && `${allOffers.length} offre${allOffers.length > 1 ? "s" : ""}`,
                  note.trim() && "Note",
                  shippingFee && `+${fmtPrice(SHIPPING_FEE_HT)} port`,
                ].filter(Boolean).join(" · ") || "Détails de la commande"}
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" style={{ flexShrink: 0, transform: recapOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><path d="M6 15l6-6 6 6"/></svg>
            </button>
            {recapOpen && <div className="reveal">
            {!shipping && minShipDate && (
              <div style={{ marginBottom: 10, padding: "9px 10px", borderRadius: 10, background: "rgba(45,212,191,0.12)", color: "#5eead4", fontSize: 11.5, fontWeight: 700 }}>
                Expédition à partir du {minShipDate.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} (date de début d'expédition de la MEA)
              </div>
            )}
            {shipping && (() => {
              const d = (x: Date) => x.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
              return (
                <div style={{ marginBottom: 10, padding: "9px 10px", borderRadius: 10, background: "rgba(45,212,191,0.12)", color: "#5eead4", fontSize: 11.5, fontWeight: 700, lineHeight: 1.5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
                    <Icon name="package" size={14} />
                    <span>Transmise à la logistique · expédition</span>
                    {/* Date d'expédition modifiable (jamais avant la première date possible) */}
                    <input type="date" value={toOdooDate(shipping.expedition)} min={toOdooDate(shipping.earliest)}
                      onChange={e => {
                        const v = e.target.value;
                        onChangeExpedition?.(v ? new Date(`${v}T12:00:00`) : null);
                      }}
                      style={{ height: 30, padding: "0 6px", borderRadius: 8, border: "1px solid rgba(94,234,212,0.5)", background: "rgba(255,255,255,0.08)", color: "#fff", fontFamily: "inherit", fontSize: 12, fontWeight: 700, colorScheme: "dark" as const }} />
                    {shipping.chosen && (
                      <button onClick={() => onChangeExpedition?.(null)}
                        style={{ background: "none", border: "none", padding: 0, color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>
                        date auto
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(255,255,255,0.6)", marginTop: 3 }}>
                    Livraison prévue {d(shipping.delivery)}
                  </div>
                </div>
              );
            })()}
            {(meta?.typeField || (meta?.offersField && offers.length > 0)) && (
              <div style={{ marginBottom: 10, display: "flex", flexDirection: "column" as const, gap: 6 }}>
                {meta?.typeField && (
                  <select value={String(orderType)} title="Type de commande"
                    onChange={e => { const o = meta.typeOptions.find(x => String(x.value) === e.target.value); setOrderType(o ? o.value : ""); }}
                    style={{ width: "100%", height: 34, padding: "0 8px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 12, fontFamily: "inherit", colorScheme: "dark" as const }}>
                    <option value="">Type de commande…</option>
                    {meta.typeOptions.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
                  </select>
                )}
                {meta?.offersField && (offers.length > 0 || autoOffers.length > 0) && (
                  <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5, alignItems: "center" }}>
                    {/* Offres des articles du panier : automatiques, sans croix */}
                    {autoOffers.filter(o => !offerIds.includes(o.id)).map(o => (
                      <span key={`auto-${o.id}`} title="Offre d'un article du panier" style={{ display: "inline-flex", alignItems: "center", padding: "3px 8px", borderRadius: 999, background: "rgba(251,146,60,0.18)", color: "#fdba74", fontSize: 11, fontWeight: 700 }}>
                        {o.name}
                      </span>
                    ))}
                    {offerIds.map(id => (
                      <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 4px 3px 8px", borderRadius: 999, background: "rgba(251,146,60,0.18)", color: "#fdba74", fontSize: 11, fontWeight: 700 }}>
                        {offers.find(o => o.id === id)?.name || `Offre n° ${id} (archivée ou non lisible)`}
                        <button onClick={() => setOfferIds(prev => prev.filter(x => x !== id))} style={{ background: "none", border: "none", color: "#fdba74", cursor: "pointer", fontSize: 11, padding: "0 2px" }}>✕</button>
                      </span>
                    ))}
                    <select value="" title="Offres commandées"
                      onChange={e => { const id = Number(e.target.value); if (id) setOfferIds(prev => prev.includes(id) ? prev : [...prev, id]); }}
                      style={{ flex: 1, minWidth: 120, height: 30, padding: "0 6px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.75)", fontSize: 11.5, fontFamily: "inherit", colorScheme: "dark" as const }}>
                      <option value="">+ Offre commandée…</option>
                      {offers.filter(o => o.name.trim() && !allOffers.some(a => a.id === o.id)).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note pour la commande..."
              rows={2} style={{ width: "100%", boxSizing: "border-box" as const, marginBottom: 12, padding: "9px 11px", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, fontSize: 12, fontFamily: "inherit", resize: "none" as const, background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none" }} />
            </div>}

            <div style={{ borderTop: recapOpen ? "1px solid rgba(255,255,255,0.1)" : "none", paddingTop: recapOpen ? 10 : 0, display: "flex", flexDirection: "column" as const, gap: slim ? 2 : 5, marginBottom: recapOpen ? 12 : slim ? 0 : 8, ...(slim ? { width: 340, flexShrink: 0 } : {}) }}>
              {recapOpen && <div className="reveal" style={{ display: "flex", flexDirection: "column" as const, gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>Sous-total</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}><CountUp value={cartTotal} format={fmtPrice} /></span>
              </div>
              {discountTotal > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#fb923c" }}>Remise appliquée</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fb923c" }}>−{fmtPrice(discountTotal)}</span>
                </div>
              )}
              {shippingFee && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#fbbf24" }}>Frais de livraison <span style={{ opacity: 0.75 }}>(franco {FRANCO_HT} € : il manque {fmtPrice(FRANCO_HT - netTotal)})</span></span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fbbf24" }}>+{fmtPrice(SHIPPING_FEE_HT)}</span>
                </div>
              )}
              </div>}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: recapOpen ? 4 : 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
                  Total HT
                  {cartCount > 0 && (
                    <button onClick={() => setShowCheck(true)} title="Contrôle de cohérence"
                      style={{ height: 24, padding: "0 9px", borderRadius: 999, background: "rgba(94,234,212,0.15)", border: "1px solid rgba(94,234,212,0.4)", color: "#5eead4", fontSize: 11, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon name="check" size={12} /> Check
                    </button>
                  )}
                </span>
                <span style={{ fontSize: slim ? 17 : 20, fontWeight: 800, color: "#5eead4", fontVariantNumeric: "tabular-nums" as const }}><CountUp value={netTotal + (shippingFee ? SHIPPING_FEE_HT : 0)} format={fmtPrice} /></span>
              </div>
              {/* Franco de port : la barre se remplit, et s'illumine au seuil */}
              {netTotal > 0 && (() => {
                const reached = !shippingFee;
                return (
                  <div title={`Franco de port : ${FRANCO_HT} € HT`} style={{ marginTop: slim ? 0 : 3 }}>
                    <div style={{ height: 4, borderRadius: 999, background: "rgba(255,255,255,0.12)" }}>
                      <div key={reached ? "hit" : "fill"} className={reached ? "franco-fill hit" : "franco-fill"}
                        style={{ width: `${Math.min(100, (netTotal / FRANCO_HT) * 100)}%`, background: reached ? "#2dd4bf" : "#fbbf24" }} />
                    </div>
                    <div style={{ marginTop: slim ? 2 : 4, fontSize: 10.5, fontWeight: 700, color: reached ? "#5eead4" : "#fbbf24" }}>
                      {reached ? "✓ Franco de port atteint" : `Franco : encore ${fmtPrice(FRANCO_HT - netTotal)}`}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Le bouton annonce la mise en file AVANT la validation quand on est hors
                 ligne — pas de surprise après coup. */}
            {/* Le check s'ouvre d'office : la création se confirme depuis le check */}
            <button onClick={() => setShowCheck("validate")} disabled={submitting || cartCount === 0}
              style={{ width: slim ? 240 : "100%", flexShrink: 0, padding: recapOpen ? "14px 0" : slim ? "10px 0" : "11px 0", background: cartCount === 0 ? "rgba(255,255,255,0.12)" : submitting ? "rgba(94,234,212,0.4)" : "#2dd4bf", color: cartCount === 0 ? "rgba(255,255,255,0.4)" : "#0f172a", border: "none", borderRadius: 999, fontSize: 14, fontWeight: 800, cursor: cartCount === 0 ? "default" : "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
              {submitting ? "Création…"
                : cartCount === 0 ? "Panier vide"
                : !navOnline ? "Enregistrer hors ligne · envoi auto"
                : `Créer le devis${freeItems.length > 0 ? " + BC gratuit" : ""} →`}
            </button>
            {(recapOpen || !navOnline) && (
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textAlign: "center" as const, marginTop: 8 }}>
                {navOnline ? "Prix Odoo appliqués à la création" : "Hors ligne — la commande partira au retour du réseau"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Pavé numérique quantité (tap sur le chiffre d'un stepper) ── */}
      {pad && (
        <QtyPad
          name={pad.product.name}
          initial={cart[pad.product.id]?.qty || 0}
          onSet={n => onQtyChange(pad.product, n, pad.price)}
          onClose={() => setPad(null)}
        />
      )}

      {showCheck && (
        <OrderCheck session={session} client={client} netTotal={netTotal}
          giftValue={giftItems.filter(g => giftActive(g, cart)).reduce((s, g) => s + g.qty * (g.product.lst_price || 0), 0)}
          giftCount={giftItems.filter(g => giftActive(g, cart)).reduce((s, g) => s + g.qty, 0)}
          ruptures={cartRuptures(cart)} shippingFee={shippingFee}
          onClose={() => setShowCheck(false)}
          onConfirm={showCheck === "validate" ? () => { setShowCheck(false); onValidate(); } : undefined}
          confirmLabel={!navOnline ? "Enregistrer hors ligne" : `Créer le devis${freeItems.length > 0 ? " + BC gratuit" : ""}`} />
      )}

      {/* ── Modale zoom image ── */}
      {zoom && (
        <div onClick={() => setZoom(null)} className="ov"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: C.white, borderRadius: 16, maxWidth: 480, width: "100%", maxHeight: "90vh", overflow: "auto" as const, boxShadow: C.shadowXl, position: "relative" as const }}>
            {/* Bouton retour (gauche) */}
            <button onClick={() => setZoom(null)} title="Retour"
              style={{ position: "absolute", top: 12, left: 12, width: 32, height: 32, borderRadius: "50%", background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            </button>
            {/* Bouton fermer */}
            <button onClick={() => setZoom(null)}
              style={{ position: "absolute", top: 12, right: 12, width: 32, height: 32, borderRadius: "50%", background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            {/* Image (masquée quand les photos sont désactivées) */}
            {SHOW_PRODUCT_IMAGES && <div style={{ height: 340, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "16px 16px 0 0" }}>
              {zoomLoading ? (
                <TubeLoader size={72} />
              ) : zoomImg ? (
                <img className="fade-in" src={`data:image/png;base64,${zoomImg}`} alt="" style={{ maxHeight: 320, maxWidth: "90%", objectFit: "contain" }} />
              ) : (
                <ProductImage id={zoom.id} networkUrl={imgUrl(zoom.id)} style={{ maxHeight: 200, maxWidth: "90%", objectFit: "contain" }} />
              )}
            </div>}
            {/* Infos — sans photo, on descend sous les boutons retour / fermer */}
            <div style={{ padding: SHOW_PRODUCT_IMAGES ? "16px 20px 20px" : "56px 20px 20px" }}>
              <div style={{ fontSize: 11, color: C.muted, fontFamily: "monospace", marginBottom: 4 }}>{zoom.default_code}{zoom.barcode ? <> <Ean code={zoom.barcode} /></> : null}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.35, marginBottom: 10 }}>{zoom.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: C.tealDark }}>
                  {(() => { const cp = applyPricelist(zoom.lst_price || 0, zoom.id, zoom.product_tmpl_id?.[0] || 0, priceItems, cart[zoom.id]?.qty || 1); return cp > 0 ? fmtPrice(cp) : "—"; })()}
                </span>
                {(() => { const s = Math.max(0, Math.round(zoom.virtual_available || 0)); return (
                  <span style={{ fontSize: 11, fontWeight: 600, color: s > 0 ? C.green : C.red, background: s > 0 ? C.greenSoft : C.redSoft, borderRadius: 6, padding: "3px 8px" }}>{s > 0 ? `${s} en stock` : "Rupture"}</span>
                ); })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAVÉ NUMÉRIQUE — saisie directe d'une quantité (fini les 24 taps sur « + »)
// ═══════════════════════════════════════════════════════════════════════════
// Modale d'ajout d'une gratuité : quantité offerte + type de gratuité.
// ═══════════════════════════════════════════════════════════════════════════
// PANNEAU RÈGLES
// ═══════════════════════════════════════════════════════════════════════════
function RulesPanel({ rules, onChange, onClose }: { rules: FreeRule[]; onChange: (r: FreeRule[]) => void; onClose: () => void }) {
  const [panelTab, setPanelTab] = useState<"rules" | "cats">("rules");
  const [form, setForm] = useState<FreeRule | null>(null);

  const newRule = (): FreeRule => ({ id: uid(), name: "", triggerQty: 10, freeQty: 1, allProducts: true, productRefs: [] });

  const save = (r: FreeRule) => {
    if (rules.find(x => x.id === r.id)) onChange(rules.map(x => x.id === r.id ? r : x));
    else onChange([...rules, r]);
    setForm(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, height: "100%", fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onClose} style={{ background: C.bg, border: "none", borderRadius: 8, padding: 7, cursor: "pointer", display: "flex" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth="2"><path d="M18 6l-12 12M6 6l12 12"/></svg>
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, flex: 1 }}>Paramètres</div>
        {panelTab === "rules" && <button onClick={() => setForm(newRule())} style={{ padding: "6px 12px", background: C.purple, color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>+ Règle</button>}
      </div>

      {/* Onglets */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.bg }}>
        {([["rules", "🎁 Gratuités"], ["cats", "🏷️ Catégories"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setPanelTab(key)}
            style={{ flex: 1, padding: "10px 0", border: "none", background: panelTab === key ? C.white : "transparent", borderBottom: panelTab === key ? `2px solid ${C.purple}` : "2px solid transparent", cursor: "pointer", fontSize: 12, fontWeight: panelTab === key ? 700 : 400, color: panelTab === key ? C.purple : C.muted, fontFamily: "inherit", marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" as const, padding: 16 }}>
        {/* Onglet Catégories */}
        {panelTab === "cats" && <CatsEditor />}
        {panelTab === "rules" && <>
        {form && (
          <RuleForm rule={form} onChange={setForm} onSave={() => save(form!)} onCancel={() => setForm(null)} />
        )}

        {!form && rules.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 24px", color: C.muted }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎁</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Aucune règle configurée</div>
            <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>Exemple : 10 achetés → 2 offerts dans un BC séparé automatique</div>
          </div>
        )}

        {!form && rules.map(r => (
          <div key={r.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: C.purpleSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🎁</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{r.name || `${r.triggerQty} → ${r.freeQty} gratuits`}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                {r.triggerQty} achetés → <span style={{ color: C.green, fontWeight: 700 }}>{r.freeQty} offerts</span>
                {" · "}{r.allProducts ? "Tous produits" : `${r.productRefs.length} refs`}
              </div>
            </div>
            <button onClick={() => setForm(r)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 13 }}>✏️</button>
            <button onClick={() => onChange(rules.filter(x => x.id !== r.id))} style={{ background: C.redSoft, border: "none", borderRadius: 8, padding: "5px 10px", cursor: "pointer", fontSize: 13, color: C.red }}>🗑</button>
          </div>
        ))}
        </>}
      </div>
    </div>
  );
}

// ── Éditeur de catégories ─────────────────────────────────────────────────────
function CatsEditor() {
  const [cats, setCats] = useState<SmartCat[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [fEmoji, setFEmoji] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [fCode, setFCode] = useState("");

  useEffect(() => { setCats(loadSmartCats()); }, []);
  const save_ = (updated: SmartCat[]) => { setCats(updated); saveSmartCats(updated); };
  const openEdit = (c: SmartCat) => { setEditId(c.id); setFEmoji(c.emoji); setFLabel(c.label); setFCode(c.code); };
  const openNew = () => { setEditId("new"); setFEmoji("🏷️"); setFLabel(""); setFCode(""); };

  const saveEdit = () => {
    const code = fCode.trim().padStart(2, "0").slice(0, 2);
    if (!fLabel.trim() || !code) return;
    if (editId === "new") {
      save_([...cats, { id: code, code, emoji: fEmoji, label: fLabel.trim() }]);
    } else {
      save_(cats.map(c => c.id === editId ? { ...c, code, emoji: fEmoji, label: fLabel.trim() } : c));
    }
    setEditId(null);
  };

  return (
    <div>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
        Basé sur les 2ème et 3ème caractères de la référence produit.<br/>
        Ex: <code style={{ background: C.bg, padding: "1px 4px", borderRadius: 4 }}>1<strong>01</strong>0101</code> → code <strong>01</strong>
      </div>

      {editId && (
        <div style={{ background: C.white, border: `1.5px solid ${C.teal}`, borderRadius: 14, padding: 14, marginBottom: 14, display: "flex", flexDirection: "column" as const, gap: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={fEmoji} onChange={e => setFEmoji(e.target.value)} style={{ width: 44, padding: "8px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 18, textAlign: "center" as const }} />
            <input value={fCode} onChange={e => setFCode(e.target.value)} placeholder="01" maxLength={2}
              style={{ width: 52, padding: "8px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, fontFamily: "monospace", fontWeight: 700, textAlign: "center" as const }} />
            <input value={fLabel} onChange={e => setFLabel(e.target.value)} placeholder="Nom affiché"
              style={{ flex: 1, padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: "inherit" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setEditId(null)} style={{ flex: 1, padding: "8px 0", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "inherit" }}>Annuler</button>
            <button onClick={saveEdit} style={{ flex: 2, padding: "8px 0", background: C.teal, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "inherit" }}>Enregistrer</button>
          </div>
        </div>
      )}

      <button onClick={openNew} style={{ width: "100%", padding: "9px 0", background: C.tealSoft, border: `1px dashed ${C.teal}`, borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 600, color: C.tealDark, fontFamily: "inherit", marginBottom: 10 }}>
        + Nouvelle catégorie
      </button>

      <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
        {cats.map(c => (
          <div key={c.id} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>{c.emoji}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{c.label}</div>
              <div style={{ fontSize: 10, color: C.muted, fontFamily: "monospace" }}>code : {c.code}</div>
            </div>
            <button onClick={() => openEdit(c)} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "4px 8px", cursor: "pointer", fontSize: 12 }}>✏️</button>
            <button onClick={() => save_(cats.filter(x => x.id !== c.id))} style={{ background: C.redSoft, border: "none", borderRadius: 7, padding: "4px 8px", cursor: "pointer", fontSize: 12, color: C.red }}>🗑</button>
          </div>
        ))}
      </div>

      <button onClick={() => save_(DEFAULT_CATS)} style={{ width: "100%", marginTop: 12, padding: "7px 0", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 11, color: C.muted, fontFamily: "inherit" }}>
        Réinitialiser les catégories par défaut
      </button>
    </div>
  );
}

function RuleForm({ rule, onChange, onSave, onCancel }: { rule: FreeRule; onChange: (r: FreeRule) => void; onSave: () => void; onCancel: () => void }) {
  const refsStr = rule.productRefs.join("\n");
  const inp = (field: keyof FreeRule, value: any) => onChange({ ...rule, [field]: value });
  return (
    <div style={{ background: C.white, border: `1.5px solid ${C.purple}`, borderRadius: 16, padding: 16, marginBottom: 16, display: "flex", flexDirection: "column" as const, gap: 14 }}>
      <div>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Nom de la règle</label>
        <input value={rule.name} onChange={e => inp("name", e.target.value)} placeholder="Ex: 10+1 gratuit"
          style={{ width: "100%", boxSizing: "border-box" as const, padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 14, fontFamily: "inherit" }} />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Qté achetée</label>
          <input type="number" value={rule.triggerQty} onChange={e => inp("triggerQty", Number(e.target.value))} min="1"
            style={{ width: "100%", boxSizing: "border-box" as const, padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 14, fontFamily: "inherit" }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>Qté offerte</label>
          <input type="number" value={rule.freeQty} onChange={e => inp("freeQty", Number(e.target.value))} min="1"
            style={{ width: "100%", boxSizing: "border-box" as const, padding: "9px 12px", border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 14, fontFamily: "inherit" }} />
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>S'applique à</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {([true, false] as const).map(v => (
            <button key={String(v)} onClick={() => inp("allProducts", v)}
              style={{ flex: 1, padding: "8px 0", background: rule.allProducts === v ? C.tealSoft : C.bg, border: `1px solid ${rule.allProducts === v ? C.teal : C.border}`, borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: rule.allProducts === v ? C.tealDark : C.muted, fontFamily: "inherit" }}>
              {v ? "Tous les produits" : "Références spécifiques"}
            </button>
          ))}
        </div>
        {!rule.allProducts && (
          <textarea value={refsStr} onChange={e => inp("productRefs", e.target.value.split(/[\n,;]+/).map((r: string) => r.trim()).filter(Boolean))}
            placeholder={"REF001\nREF002"} rows={3}
            style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 10px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, fontFamily: "monospace", resize: "none" as const }} />
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancel} style={{ flex: 1, padding: "10px 0", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>Annuler</button>
        <button onClick={onSave} style={{ flex: 2, padding: "10px 0", background: C.purple, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "inherit" }}>Enregistrer</button>
      </div>
    </div>
  );
}
