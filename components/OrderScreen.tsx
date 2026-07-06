"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import * as odoo from "@/lib/odoo";
import AppointmentModal from "@/components/AppointmentModal";
import ClientNoteModal from "@/components/ClientNoteModal";
import OfflineBar from "@/components/OfflineBar";
import * as sync from "@/lib/sync";
import * as geo from "@/lib/geo";
import { apiUrl } from "@/lib/apiBase";
import * as loyalty from "@/lib/loyalty";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
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
  inbox: <><path d="M22 13h-6l-2 3h-4l-2-3H2"/><path d="M5 4h14l3 9v7H2v-7Z"/></>,
  check: <path d="M20 6 9 17l-5-5"/>,
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
interface CartItem { product: any; qty: number; unitPrice: number; }
interface FreeRule {
  id: string; name: string; triggerQty: number; freeQty: number;
  allProducts: boolean; productRefs: string[];
}
interface FreeItem { product: any; qty: number; ruleName: string; }

const LS_RULES  = "wms_order_rules_v2";
const LS_DRAFTS = "wms_order_drafts_v1"; // un brouillon PAR client (map clientId → Draft), plus d'écrasement
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

function matchesCat(product: any, cat: SmartCat): boolean {
  return getCatCode(product) === cat.code;
}

function loadRules(): FreeRule[] { try { return JSON.parse(localStorage.getItem(LS_RULES) || "[]"); } catch { return []; } }
function saveRules(r: FreeRule[]) { localStorage.setItem(LS_RULES, JSON.stringify(r)); }

interface Draft {
  client: any;
  cart: Record<number, CartItem>;
  note: string;
  savedAt: number; // timestamp
}

// Brouillons stockés par client (clientId → Draft) — changer de client n'écrase plus rien.
function loadAllDrafts(): Record<string, Draft> {
  try { return JSON.parse(localStorage.getItem(LS_DRAFTS) || "{}"); } catch { return {}; }
}
function saveAllDrafts(d: Record<string, Draft>) { localStorage.setItem(LS_DRAFTS, JSON.stringify(d)); }

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
function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

// ── Calcul prix pricelist côté client (1 seul appel Odoo au départ) ───────────
interface PriceItem {
  applied_on: string;          // '0_product_variant' | '1_product' | '2_product_category' | '3_global'
  compute_price: string;       // 'fixed' | 'discount' | 'formula'
  product_id: any;             // [id, name] ou false
  product_tmpl_id: any;
  categ_id: any;
  fixed_price: number;
  percent_price: number;       // % de remise pour compute_price='discount'
  price_discount: number;      // % de remise pour compute_price='formula'
  price_surcharge: number;
  min_quantity: number;
  date_start?: string | false; // dates de validité de la règle (absentes sur certaines instances)
  date_end?: string | false;
}

// Tri par spécificité : variante > produit > catégorie > global, puis palier de
// quantité décroissant (la meilleure règle applicable gagne). Sans ce tri, l'ordre
// arbitraire renvoyé par Odoo (non triable par "sequence" ici) pouvait faire gagner
// une règle globale sur une règle propre au produit → prix client faux.
const APPLIED_ON_RANK: Record<string, number> = {
  "0_product_variant": 0, "1_product": 1, "2_product_category": 2, "3_global": 3,
};
function sortPriceItems(items: PriceItem[]): PriceItem[] {
  return [...items].sort((a, b) =>
    (APPLIED_ON_RANK[a.applied_on] ?? 9) - (APPLIED_ON_RANK[b.applied_on] ?? 9)
    || (b.min_quantity || 0) - (a.min_quantity || 0)
  );
}

function applyPricelist(lstPrice: number, productId: number, productTmplId: number, items: PriceItem[], qty = 1): number {
  // Priorité : product_variant > product_template > global (items pré-triés par sortPriceItems).
  const today = new Date().toISOString().slice(0, 10);

  for (const item of items) {
    if (item.min_quantity > qty) continue;
    // Règle datée : ignorée hors de sa période de validité (promo expirée / à venir).
    if (item.date_start && String(item.date_start).slice(0, 10) > today) continue;
    if (item.date_end && String(item.date_end).slice(0, 10) < today) continue;

    const appliesToProduct =
      (item.applied_on === "0_product_variant" && item.product_id && item.product_id[0] === productId) ||
      (item.applied_on === "1_product" && item.product_tmpl_id && item.product_tmpl_id[0] === productTmplId) ||
      (item.applied_on === "3_global");

    if (!appliesToProduct) continue;

    if (item.compute_price === "fixed")    return item.fixed_price;
    if (item.compute_price === "discount") return lstPrice * (1 - item.percent_price / 100);
    if (item.compute_price === "formula")  return Math.max(0, lstPrice * (1 - item.price_discount / 100) + item.price_surcharge);
  }
  return lstPrice; // aucune règle → prix catalogue
}

const PRICELIST_ITEM_FIELDS = [
  "applied_on", "compute_price", "product_id", "product_tmpl_id", "categ_id",
  "fixed_price", "percent_price", "price_discount", "price_surcharge", "min_quantity",
];

async function fetchPricelistItems(session: odoo.OdooSession, pricelistId: number): Promise<PriceItem[]> {
  // Pas de tri "sequence asc" : ce champ n'existe pas sur product.pricelist.item
  // dans cette instance Odoo et faisait échouer la requête (prix → catalogue).
  // Limite 0 = TOUTES les règles (avant : 500 → grille tronquée = prix faux).
  const domain = [["pricelist_id", "=", pricelistId], ["active", "=", true]];
  try {
    let items: PriceItem[];
    try {
      items = await odoo.searchRead(session, "product.pricelist.item", domain,
        [...PRICELIST_ITEM_FIELDS, "date_start", "date_end"], 0);
    } catch (e) {
      if (odoo.isNetworkError(e)) throw e;
      // Repli si date_start/date_end n'existent pas sur cette instance.
      items = await odoo.searchRead(session, "product.pricelist.item", domain, PRICELIST_ITEM_FIELDS, 0);
    }
    return sortPriceItems(items);
  } catch {
    // Hors ligne → règles préchargées par « Télécharger les données ».
    // (Avant : ce cache existait mais n'était JAMAIS lu → prix catalogue hors ligne.)
    const cached = await sync.getCachedPricelistItems(pricelistId);
    return sortPriceItems(cached as PriceItem[]);
  }
}

function computeFreeItems(cart: Record<number, CartItem>, rules: FreeRule[]): FreeItem[] {
  const out: FreeItem[] = [];
  for (const rule of rules) {
    let total = 0;
    const matched: any[] = [];
    for (const item of Object.values(cart)) {
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

// Résout l'id de l'étiquette Odoo "Validé" (crm.tag, utilisée sur sale.order.tag_ids) — mise en cache
// au niveau module pour ne faire la recherche qu'une seule fois par session app.
let _validatedTagIdCache: number | null | undefined = undefined;
async function getValidatedTagId(session: odoo.OdooSession): Promise<number | null> {
  if (_validatedTagIdCache !== undefined) return _validatedTagIdCache;
  try {
    const tags = await odoo.searchRead(session, "crm.tag", [["name", "ilike", "valid"]], ["id", "name"], 20);
    const exact = tags.find((t: any) => (t.name || "").trim().toLowerCase() === "validé");
    _validatedTagIdCache = exact ? exact.id : (tags[0]?.id ?? null);
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
function ProductImage({ id, networkUrl, style }: { id: number; networkUrl: string; style: React.CSSProperties }) {
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
  return <img src={src} alt="" loading="lazy" style={style} onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />;
}

// ═══════════════════════════════════════════════════════════════════════════
export default function OrderScreen({ session, onBack, onToast, desktop }: Props) {
  const [step, setStep] = useState<"home" | "client" | "hub" | "catalog" | "history">("client");
  const [client, setClient] = useState<any>(null);
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]); // items pricelist du client
  const [cart, setCart] = useState<Record<number, CartItem>>({});
  const [rules, setRules] = useState<FreeRule[]>([]);
  const [freeItems, setFreeItems] = useState<FreeItem[]>([]);
  const [showRules, setShowRules] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ mainId: number | null; freeId: number | null; offline?: boolean } | null>(null);
  const [note, setNote] = useState("");
  // Brouillon détecté pour le client qu'on vient de sélectionner (jamais un autre client — pas de fuite visuelle)
  const [resumePrompt, setResumePrompt] = useState<Draft | null>(null);
  // Liste de tous les brouillons en attente (tous clients confondus) — accès discret, jamais affiché tout seul
  const [pendingDrafts, setPendingDrafts] = useState<{ clientId: string; draft: Draft }[]>([]);
  const [showDraftsPanel, setShowDraftsPanel] = useState(false);
  const [showAppointment, setShowAppointment] = useState(false);
  const [showClientNote, setShowClientNote] = useState(false);
  // Remises additionnelles Odoo (Ventes → Réductions & fidélité)
  const [loyaltyPrograms, setLoyaltyPrograms] = useState<loyalty.LoyaltyProgram[]>([]);
  const [appliedPromos, setAppliedPromos] = useState<Record<number, loyalty.AppliedPromo>>({});
  const [showPromoPanel, setShowPromoPanel] = useState(false);
  const refreshPendingDrafts = useCallback(() => setPendingDrafts(listDrafts()), []);

  // D'où vient-on quand on ouvre une fiche client : recherche ou planning.
  // Sert au bouton retour pour revenir au bon écran.
  const [clientOrigin, setClientOrigin] = useState<"search" | "planning">("search");

  // Sélectionne un client (depuis la recherche ou depuis un RDV du planning) et ouvre sa fiche.
  const selectClient = useCallback((c: any, origin: "search" | "planning" = "search") => {
    setClient(c);
    setClientOrigin(origin);
    setStep("hub");
    // 1 seul appel pricelist, réutilisé plus tard par la prise de commande
    const plId = c.property_product_pricelist?.[0];
    if (plId) fetchPricelistItems(session, plId).then(setPriceItems).catch(() => setPriceItems([]));
    else setPriceItems([]);
  }, [session]);

  // Chargement initial : règles + migration de l'ancien format de brouillon unique + remises Odoo
  useEffect(() => {
    setRules(loadRules());
    migrateLegacyDraft();
    refreshPendingDrafts();
    getLoyaltyPrograms(session).then(setLoyaltyPrograms).catch(() => {});
  }, [session, refreshPendingDrafts]);

  // Programmes dont les conditions sont actuellement remplies par le panier
  const triggeredPromos = loyaltyPrograms.filter(p => loyalty.isProgramTriggered(p, cart));
  const availablePromoCount = triggeredPromos.filter(p => !appliedPromos[p.id]).length;

  const applyPromo = async (program: loyalty.LoyaltyProgram) => {
    const reward = program.rewards[0];
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
  const removePromo = (programId: number) => {
    setAppliedPromos(prev => { const n = { ...prev }; delete n[programId]; return n; });
  };

  // Depuis le hub client → "Prise de commande" : repart d'un panier vide, détecte un brouillon
  // existant pour CE client précisément, puis entre dans le catalogue.
  // (La pricelist est déjà chargée par selectClient — pas de 2ᵉ appel redondant.)
  const enterOrderMode = () => {
    if (!client) return;
    setCart({});
    setNote("");
    setAppliedPromos({});
    setResumePrompt(loadDraftForClient(client.id));
    setStep("catalog");
  };

  // Sauvegarde auto du brouillon du client courant dès que le panier ou la note change —
  // stocké par client, ne touche jamais aux brouillons des autres clients.
  useEffect(() => {
    if (client && Object.keys(cart).length > 0) {
      saveDraftForClient(client.id, { client, cart, note, savedAt: Date.now() });
      refreshPendingDrafts();
    }
  }, [cart, client, note, refreshPendingDrafts]);

  useEffect(() => { setFreeItems(HOMEMADE_RULES_ENABLED ? computeFreeItems(cart, rules) : []); }, [cart, rules]);

  const cartCount = Object.values(cart).reduce((s, i) => s + i.qty, 0);
  const cartTotal = Object.values(cart).reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const freeCount = freeItems.reduce((s, i) => s + i.qty, 0);

  const setQty = (product: any, qty: number, unitPrice?: number) => {
    setCart(prev => {
      if (qty <= 0) { const n = { ...prev }; delete n[product.id]; return n; }
      const price = unitPrice ?? prev[product.id]?.unitPrice ?? product.lst_price ?? 0;
      return { ...prev, [product.id]: { product, qty, unitPrice: price } };
    });
  };

  // Reprendre le brouillon proposé pour le client qu'on vient de sélectionner
  const acceptResumePrompt = () => {
    if (!resumePrompt) return;
    setCart(resumePrompt.cart);
    setNote(resumePrompt.note || "");
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
    setCart(d.cart);
    setNote(d.note || "");
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
    setSubmitting(true);
    try {
      const validatedTagId = await getValidatedTagId(session);
      if (validatedTagId === null) {
        onToast("Étiquette « Validé » introuvable dans Odoo — commande créée sans étiquette", "info");
      }
      const tagVals = validatedTagId ? { tag_ids: [[6, 0, [validatedTagId]]] } : {};

      const pricelistId = client.property_product_pricelist?.[0] || false;

      // Remises additionnelles Odoo appliquées manuellement (bouton 🏷️) : % par produit du panier
      const lineDiscounts = loyalty.computeLineDiscounts(appliedPromos, cart);
      // Produits offerts par une remise "Achetez X" (distincts des règles maison du panneau ⚙️)
      const promoFreeLines = Object.values(appliedPromos).filter((p): p is loyalty.AppliedFreePromo => p.type === "product");

      // Commande + toutes ses lignes créées en UN SEUL appel Odoo (commandes one2many [0,0,{...}])
      // au lieu d'un appel par ligne — c'est ça qui rendait les gros devis lents.
      const mainPayload: any = {
        partner_id: client.id, state: "draft",
        ...(pricelistId ? { pricelist_id: pricelistId } : {}),
        note: note || "",
        ...tagVals,
        order_line: [
          ...Object.values(cart).map(item => [0, 0, {
            product_id: item.product.id,
            product_uom_qty: item.qty,
            price_unit: item.unitPrice,
            ...(lineDiscounts[item.product.id] ? { discount: lineDiscounts[item.product.id] } : {}),
          }]),
          ...promoFreeLines.map(p => [0, 0, {
            product_id: p.reward.reward_product_id,
            product_uom_qty: p.reward.reward_product_qty,
            price_unit: 0,
          }]),
        ],
      };

      const freePayload: any | null = freeItems.length > 0 ? {
        partner_id: client.id, state: "draft",
        note: `Articles offerts — lié au devis principal`,
        ...tagVals,
        order_line: freeItems.map(fi => [0, 0, {
          product_id: fi.product.id,
          product_uom_qty: fi.qty,
          price_unit: 0,
        }]),
      } : null;

      const cartTotal = Object.values(cart).reduce((s, it) => s + it.qty * it.unitPrice, 0);

      // 1) Devis principal
      let mainId: number;
      try {
        mainId = await odoo.create(session, "sale.order", mainPayload);
      } catch (e: any) {
        if (odoo.isNetworkError(e)) {
          // Réseau indisponible → on met la commande en file de synchro locale.
          const payloads = freePayload ? [mainPayload, freePayload] : [mainPayload];
          await sync.queueOrder(client.name, cartTotal, payloads);
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

      // 2) BC gratuit — le devis principal EXISTE déjà dans Odoo : quoi qu'il
      // arrive ici, on ne remet JAMAIS mainPayload en file (sinon doublon au rejeu).
      let freeId: number | null = null;
      if (freePayload) {
        freePayload.note = `Articles offerts — lié au devis #${mainId}`;
        try {
          freeId = await odoo.create(session, "sale.order", freePayload);
        } catch (e: any) {
          if (odoo.isNetworkError(e)) {
            await sync.queueOrder(client.name, 0, [freePayload], `BC gratuit — ${client.name}`);
            onToast("Devis créé ; le BC gratuit part en file (réseau coupé), envoi auto", "info");
          } else {
            onToast(`Devis #${mainId} créé, mais Odoo a refusé le BC gratuit : ${e?.message || e}`, "error");
          }
        }
      }

      removeDraftForClient(client.id);
      refreshPendingDrafts();
      setAppliedPromos({});
      setDone({ mainId, freeId });
    } catch (e: any) { onToast("Erreur : " + e.message, "error"); }
    setSubmitting(false);
  };

  // Écran confirmation finale
  if (done) return (
    <div style={{ position: "fixed", inset: 0, left: desktop ? 248 : 0, background: "#0f766e", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: "48px 40px", maxWidth: 480, width: "90%", textAlign: "center", boxShadow: C.shadowXl }}>
        <div style={{ width: 84, height: 84, borderRadius: "50%", background: done.offline ? C.orangeSoft : C.tealSoft, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
          <Icon name={done.offline ? "wifiOff" : "check"} size={40} color={done.offline ? C.orange : C.teal} strokeWidth={2.5} />
        </div>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.text, marginBottom: 8 }}>
          {done.offline ? "Commande en attente" : "Devis créé !"}
        </div>
        <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.6, marginBottom: 32 }}>
          {done.offline ? (
            <>Enregistrée hors ligne sur cet appareil.<br/>
            Elle sera envoyée à Odoo automatiquement dès le retour du réseau — voir « en attente » en haut de l'écran.</>
          ) : (
            <>Devis principal <span style={{ color: C.teal, fontWeight: 700 }}>#{done.mainId}</span> dans Odoo
            {done.freeId && <><br/>BC gratuit <span style={{ color: C.purple, fontWeight: 700 }}>#{done.freeId}</span> créé automatiquement</>}</>
          )}
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button onClick={() => { setDone(null); setCart({}); setClient(null); setNote(""); setResumePrompt(null); setAppliedPromos({}); setStep("client"); }}
            style={{ padding: "14px 28px", background: C.teal, color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Nouvelle commande
          </button>
          {/* Mène au planning (avant : doublon exact de « Nouvelle commande ») */}
          <button onClick={() => { setDone(null); setCart({}); setClient(null); setNote(""); setResumePrompt(null); setAppliedPromos({}); setStep("home"); }}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 24px", background: C.bg, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>
            <Icon name="calendar" size={16} /> Mon planning
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, left: desktop ? 248 : 0, zIndex: 150, background: C.bg, display: "flex", flexDirection: "column" as const, fontFamily: "'DM Sans', sans-serif", overflow: "hidden", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>

      {/* ── Top bar ── */}
      <div style={{ height: 56, background: "#fff", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 20px", gap: 16, flexShrink: 0, boxShadow: C.shadow }}>
        {/* Flèche retour — jamais sur l'écran racine (avant, elle déconnectait : un tap
             accidentel en tournée = impossible de se reconnecter hors ligne). */}
        {step !== "client" && (
          <button onClick={() => {
              if (step === "catalog" || step === "history") setStep("hub");
              else if (step === "hub") setStep(clientOrigin === "planning" ? "home" : "client");
              else setStep("client");
            }}
            title="Retour"
            style={{ width: 36, height: 36, borderRadius: 10, background: C.bg, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
          </button>
        )}

        {/* Fil d'ariane simple : où on en est pour ce client */}
        <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>
          {step === "home" && "Accueil"}
          {step === "client" && "Choisir un client"}
          {step === "hub" && "Fiche client"}
          {step === "catalog" && "Prise de commande"}
          {step === "history" && "Historique des commandes"}
        </div>

        <div style={{ flex: 1 }} />

        {/* Pastille réseau + données + file d'envoi (remplace l'ancien bandeau permanent) */}
        <OfflineBar session={session} onToast={onToast} />

        {/* Voir planning — visible sur l'écran de recherche client (pas de client sélectionné) */}
        {step === "client" && (
          <button onClick={() => setStep("home")}
            style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 14px", borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: C.textSec }}>
            <Icon name="calendar" size={15} /> Planning
          </button>
        )}

        {/* Déconnexion — uniquement sur l'écran racine, avec confirmation explicite
             (hors ligne, impossible de se reconnecter : Odoo doit vérifier le mot de passe). */}
        {step === "client" && (
          <button
            onClick={() => {
              if (window.confirm("Se déconnecter d'Odoo ?\n\nAttention : hors ligne, impossible de se reconnecter. En tournée, reste connecté.")) onBack();
            }}
            title="Se déconnecter"
            style={{ width: 36, height: 36, borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>
          </button>
        )}

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
              <div style={{ fontSize: 12, fontWeight: 700, color: C.tealDark }}>{client.name}</div>
              {client.property_product_pricelist && <div style={{ fontSize: 10, color: C.teal }}>{client.property_product_pricelist[1]}</div>}
            </div>
            {step !== "client" && <button onClick={(e) => { e.stopPropagation(); setClient(null); setCart({}); setAppliedPromos({}); setStep("client"); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 14, lineHeight: 1 }}>✕</button>}
          </div>
        )}

        {/* RDV — uniquement sur l'écran de commande (catalogue & panier), pas sur la sélection client */}
        {client && step === "catalog" && (
          <button onClick={() => setShowAppointment(true)} title="Prendre un RDV avec ce client"
            style={{ width: 36, height: 36, borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.textSec, flexShrink: 0 }}>
            <Icon name="calendar" size={16} />
          </button>
        )}

        {/* Remises additionnelles Odoo disponibles pour ce panier */}
        {step === "catalog" && availablePromoCount > 0 && (
          <button onClick={() => setShowPromoPanel(v => !v)} title="Remises disponibles pour ce panier"
            style={{ display: "flex", alignItems: "center", gap: 5, height: 36, padding: "0 10px", borderRadius: 10, background: showPromoPanel ? C.orangeSoft : C.orange, border: `1px solid ${C.orange}`, cursor: "pointer", fontFamily: "inherit", color: showPromoPanel ? C.orange : "#fff" }}>
            <Icon name="tag" size={14} />
            <span style={{ fontSize: 12, fontWeight: 800 }}>{availablePromoCount}</span>
          </button>
        )}


        {/* Accès discret aux brouillons en attente — jamais affiché sans action volontaire */}
        {pendingDrafts.length > 0 && (
          <button onClick={() => setShowDraftsPanel(v => !v)} title="Commandes en attente de finalisation"
            style={{ display: "flex", alignItems: "center", gap: 5, height: 36, padding: "0 10px", borderRadius: 10, background: showDraftsPanel ? "#fef9c3" : C.bg, border: `1px solid ${showDraftsPanel ? "#fde047" : C.border}`, cursor: "pointer", fontFamily: "inherit", color: "#92400e" }}>
            <Icon name="file" size={14} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>{pendingDrafts.length}</span>
          </button>
        )}

        {HOMEMADE_RULES_ENABLED && (
          <button onClick={() => setShowRules(!showRules)} style={{ width: 36, height: 36, borderRadius: 10, background: showRules ? C.purpleSoft : C.bg, border: `1px solid ${showRules ? C.purple : C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
            ⚙️
          </button>
        )}
      </div>

      {/* ── Bandeau reprise — scopé UNIQUEMENT au client qu'on vient de sélectionner,
           jamais un autre client : pas de fuite d'info si on est en face d'un client. ── */}
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
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }} onClick={() => setShowPromoPanel(false)}>
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
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }} onClick={() => setShowDraftsPanel(false)}>
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
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }} onClick={() => setShowRules(false)}>
          <div style={{ width: 400, height: "100%", background: "#fff", boxShadow: C.shadowXl, overflowY: "auto" as const }} onClick={e => e.stopPropagation()}>
            <RulesPanel rules={rules} onChange={r => { setRules(r); saveRules(r); }} onClose={() => setShowRules(false)} />
          </div>
        </div>
      )}

      {/* ── Étapes ── */}
      {step === "home" && (
        <HomeScreen session={session} onNewOrder={() => setStep("client")} onOpenClient={(c) => selectClient(c, "planning")} onToast={onToast} />
      )}

      {step === "client" && <ClientStep session={session} onSelect={selectClient} />}

      {step === "hub" && client && (
        <ClientHub
          session={session}
          client={client}
          hasDraft={!!loadDraftForClient(client.id)}
          onOrder={enterOrderMode}
          onHistory={() => setStep("history")}
          onAppointment={() => setShowAppointment(true)}
          onNote={() => setShowClientNote(true)}
        />
      )}

      {step === "history" && client && (
        <ClientHistory session={session} client={client} />
      )}

      {step === "catalog" && client && (
        <CatalogStep session={session} cart={cart} onQtyChange={setQty} freeItems={freeItems}
          onValidate={handleValidate} submitting={submitting}
          note={note} setNote={setNote} client={client} priceItems={priceItems} onToast={onToast}
          appliedPromos={appliedPromos} />
      )}

      {showAppointment && client && (
        <AppointmentModal session={session} client={client} onClose={() => setShowAppointment(false)} onToast={onToast} />
      )}
      {showClientNote && client && (
        <ClientNoteModal session={session} client={client} onClose={() => setShowClientNote(false)} onToast={onToast} />
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
const LOC_RADIUS_KM = 1;

// is_company sert au départage quand plusieurs fiches partagent le même code (ref).
const CLIENT_FIELDS = ["id", "name", "ref", "city", "country_id", "property_product_pricelist", "email", "phone", "is_company"];

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

function HomeScreen({ session, onNewOrder, onOpenClient, onToast }: {
  session: odoo.OdooSession; onNewOrder: () => void;
  onOpenClient: (client: any) => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = semaine en cours, ±1 = semaine précédente/suivante
  const [selectedEvent, setSelectedEvent] = useState<any>(null); // RDV ouvert en aperçu
  const [openingClient, setOpeningClient] = useState(false);
  const [editingEvent, setEditingEvent] = useState<any>(null); // RDV en cours de modification
  const [cancelling, setCancelling] = useState(false);
  const [reloadKey, setReloadKey] = useState(0); // force le rechargement du planning
  const [newAdminRdv, setNewAdminRdv] = useState(false); // nouveau RDV sans client (administratif)

  // ── Swipe tactile gauche/droite pour changer de semaine ──────────────────
  // Perf : on manipule directement le transform du DOM (via gridRef) pendant le
  // glissement, sans setState → aucun re-render par frame = suivi du doigt fluide.
  const gridRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef<{ x: number; y: number; dx: number; locked: null | "h" | "v" }>({ x: 0, y: 0, dx: 0, locked: null });
  const SWIPE_EASE = "transform 0.32s cubic-bezier(0.22,1,0.36,1)";

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, dx: 0, locked: null };
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
        setWeekOffset(o => o + (dir > 0 ? -1 : 1));
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

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 7);
        const rows = await odoo.searchRead(session, "calendar.event",
          [["user_id", "=", session.uid], ["start", "<", toOdooDateStr(sunday)], ["stop", ">=", toOdooDateStr(monday)]],
          ["id", "name", "start", "stop", "location", "description", "x_studio_code_client_cli_calendar", "x_studio_annul"], 200, "start asc");
        setEvents(rows);
      } catch {
        setEvents([]);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, monday, reloadKey]);

  // Annule un RDV : marque le champ Odoo x_studio_annul = true (garde la trace).
  const cancelEvent = async (e: any) => {
    setCancelling(true);
    try {
      try {
        await odoo.write(session, "calendar.event", [e.id], { x_studio_annul: true });
        onToast("RDV annulé", "success");
      } catch {
        await sync.queueAppointmentCancel(e.id, e.name || "RDV");
        onToast("Annulation enregistrée hors ligne — sera envoyée au retour du réseau", "info");
      }
      setSelectedEvent(null);
      setReloadKey(k => k + 1);
    } finally {
      setCancelling(false);
    }
  };

  const eventsByDay = days.map(d => events.filter(e => sameDay(odooToLocalDate(e.start), d)));
  const totalCount = events.length;

  // Les RDV créés depuis l'outil Commande indiquent le client dans la description
  // (le champ partner_ids n'est volontairement pas utilisé, cf. AppointmentModal — anti-invitation Outlook).
  // On retrouve donc le client en relisant cette description plutôt que via un lien structuré.
  const openEventClient = async (e: any) => {
    // 1) Source FIABLE : le code client stocké dans le champ Odoo dédié.
    const fieldCode = (typeof e.x_studio_code_client_cli_calendar === "string"
      ? e.x_studio_code_client_cli_calendar : "").trim();

    // 2) Repli sur la description "Client : NOM (CODE) — téléphone" (anciens RDV).
    const desc: string = e.description || "";
    const line = (desc.match(/Client\s*:\s*(.+)/i)?.[1]) || "";
    const descCode = line.match(/\(([^)]+)\)/)?.[1]?.trim() || "";
    const name = line.replace(/\(.*$/, "").replace(/—.*$/, "").trim();

    const code = fieldCode || descCode;   // le code (ref) prime toujours sur le nom
    if (!code && !name) { onToast("Aucun client associé à ce RDV", "info"); return; }

    // Compare deux codes de façon stricte (insensible casse/espaces).
    const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

    // Départage quand PLUSIEURS fiches partagent le même code (cas réel : société
    // + contact de livraison/facturation au même ref, ou doublon de fiche) :
    //  1. une seule fiche → elle ;
    //  2. sinon, celle dont le nom correspond EXACTEMENT au nom du RDV ;
    //  3. sinon, l'unique fiche « société » du lot (les contacts rattachés sont écartés).
    // Toujours en correspondance stricte — on n'ouvre jamais une fiche au hasard.
    const pickClient = (rows: any[]): any | null => {
      if (rows.length === 1) return rows[0];
      if (rows.length > 1) {
        if (name) {
          const exact = rows.filter((r: any) => (r.name || "").trim().toLowerCase() === name.toLowerCase());
          if (exact.length === 1) return exact[0];
          if (exact.length > 1) rows = exact;
        }
        const companies = rows.filter((r: any) => r.is_company);
        if (companies.length === 1) return companies[0];
      }
      return null;
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
        const hit = pickClient(matches);
        if (hit) { onOpenClient(hit); return; }
      } catch {}

      // Sinon Odoo : par CODE exact d'abord — les CLIENTS (customer_rank > 0) en
      // priorité, ce qui écarte fournisseurs/contacts au même ref ; repli sans ce
      // filtre si aucun résultat. Jamais de "ilike" approximatif.
      let rows: any[] = [];
      if (code) {
        rows = await odoo.searchRead(session, "res.partner",
          [["ref", "=", code], ["active", "=", true], ["customer_rank", ">", 0]], CLIENT_FIELDS, 5);
        if (!rows.length) {
          rows = await odoo.searchRead(session, "res.partner",
            [["ref", "=", code], ["active", "=", true]], CLIENT_FIELDS, 5);
        }
      } else if (name) {
        rows = await odoo.searchRead(session, "res.partner",
          [["name", "=", name], ["active", "=", true]], CLIENT_FIELDS, 5);
      }
      const hit = pickClient(rows);
      if (hit) onOpenClient(hit);
      else if (rows.length > 1) onToast(`${rows.length} fiches ont le code ${code || name} dans Odoo (mêmes noms) — ouvre-le via la recherche`, "info");
      else onToast("Client introuvable pour ce RDV", "info");
    } catch {
      onToast("Erreur lors de l'ouverture du client", "error");
    } finally {
      setOpeningClient(false);
    }
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
            Salut {session.name?.split(" ")[0] || ""}, {loading ? "…" : <span style={{ color: C.teal }}>{totalCount} RDV</span>} cette semaine
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => setWeekOffset(o => o - 1)} title="Semaine précédente"
            style={{ width: 32, height: 32, borderRadius: "50%", background: C.white, border: `1px solid ${C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.textSec, boxShadow: C.shadow }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <div onClick={() => weekOffset !== 0 && setWeekOffset(0)}
            style={{ fontSize: 13, fontWeight: 800, color: "#fff", background: C.teal, borderRadius: 999, padding: "9px 18px", cursor: weekOffset !== 0 ? "pointer" : "default", whiteSpace: "nowrap" as const, boxShadow: "0 8px 18px rgba(13,148,136,0.25)" }}>
            {monday.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} — {days[6].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
          </div>
          <button onClick={() => setWeekOffset(o => o + 1)} title="Semaine suivante"
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

      {/* Vue semaine — 7 colonnes façon cartes, glissables gauche/droite */}
      <div
        ref={gridRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          flex: 1,
          display: "grid", gridTemplateColumns: "repeat(7, minmax(120px, 1fr))", gap: 12,
          alignItems: "stretch",
          transform: "translateX(0px)",
          willChange: "transform",
          touchAction: "pan-y" as const,
        }}
      >
        {days.map((d, i) => {
          const dayEvents = eventsByDay[i];
          const isToday = sameDay(d, today);
          const isPast = d < today && !isToday;
          return (
            <div key={i} style={{
              display: "flex", flexDirection: "column" as const, borderRadius: 18,
              background: isToday ? "#0f766e" : C.white,
              boxShadow: isToday ? "0 16px 32px rgba(13,148,136,0.28)" : "0 2px 8px rgba(15,23,42,0.05)",
              opacity: isPast ? 0.55 : 1, overflow: "hidden",
            }}>
              {/* En-tête jour */}
              <div style={{ padding: "14px 8px 10px", textAlign: "center" as const, flexShrink: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: isToday ? "rgba(255,255,255,0.75)" : C.muted, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>{WEEKDAY_LABELS[i].slice(0, 3)}</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2, color: isToday ? "#fff" : C.text }}>
                  {d.getDate()}
                </div>
              </div>

              {/* Événements du jour */}
              <div style={{ flex: 1, padding: "0 8px 10px", display: "flex", flexDirection: "column" as const, gap: 6, minHeight: 80 }}>
                {dayEvents.length === 0 ? (
                  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: isToday ? "rgba(255,255,255,0.5)" : C.border }}>—</div>
                ) : dayEvents.map((e, idx) => {
                  const col = EVENT_COLORS[idx % EVENT_COLORS.length];
                  return (
                    <button key={e.id} onClick={() => setSelectedEvent(e)} title="Voir le rendez-vous"
                      style={{ background: e.x_studio_annul ? "#f8fafc" : col.bg, border: "none", borderRadius: 10, padding: "8px 10px", cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const, width: "100%", boxShadow: isToday ? "0 4px 10px rgba(15,23,42,0.12)" : "none", opacity: e.x_studio_annul ? 0.6 : 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: e.x_studio_annul ? C.muted : col.text }}>
                        {odooToLocalDate(e.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        {e.x_studio_annul && " · Annulé"}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginTop: 2, lineHeight: 1.3, overflow: "hidden", display: "-webkit-box" as const, WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, textDecoration: e.x_studio_annul ? "line-through" : "none" }}>{e.name}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Aperçu d'un RDV (heure, lieu, client, notes) avant d'ouvrir la fiche ── */}
      {selectedEvent && (() => {
        const e = selectedEvent;
        const start = odooToLocalDate(e.start);
        const stop = e.stop ? odooToLocalDate(e.stop) : null;
        const desc: string = e.description || "";
        const clientLine = (desc.match(/Client\s*:\s*(.+)/i)?.[1]) || "";
        const clientName = clientLine.replace(/\(.*$/, "").replace(/—.*$/, "").trim();
        const clientRef = clientLine.match(/\(([^)]+)\)/)?.[1]?.trim() || "";
        const phone = clientLine.match(/—\s*(.+)$/)?.[1]?.trim() || "";
        const notes = (desc.split(/\n\n/).slice(1).join("\n\n")).trim();
        const timeStr = start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
          + (stop ? ` – ${stop.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "");
        const dateStr = start.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
        return (
          <div onClick={() => setSelectedEvent(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={ev => ev.stopPropagation()}
              style={{ width: "100%", maxWidth: 420, background: C.white, borderRadius: 22, boxShadow: C.shadowXl, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>
              <div style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)", padding: "22px 24px", color: "#fff" }}>
                <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 6 }}>Rendez-vous</div>
                <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.25 }}>{e.name}</div>
              </div>
              <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column" as const, gap: 14 }}>
                <Row icon="calendar" label={dateStr} />
                <Row icon="clock" label={timeStr} />
                {e.location && <Row icon="pin" label={e.location} />}
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
                  {e.x_studio_annul ? (
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
function ClientStep({ session, onSelect }: { session: odoo.OdooSession; onSelect: (c: any) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<any>(null);

  // ── Mode localisation ──────────────────────────────────────────────────
  const [locMode, setLocMode] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState("");
  const [nearby, setNearby] = useState<any[]>([]);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        // Nom, référence OU ville — aligné sur la recherche hors ligne (et sur le
        // sous-titre de l'écran, qui promettait déjà la ville).
        const r = await odoo.searchRead(session, "res.partner",
          ["|", "|", ["name", "ilike", q], ["ref", "ilike", q], ["city", "ilike", q], ["customer_rank", ">", 0], ["active", "=", true]],
          CLIENT_FIELDS, 30);
        setResults(r);
      } catch {
        // Réseau indisponible → on cherche dans le cache local préchargé.
        try {
          const cached = await sync.searchCachedClients(q, 30);
          setResults(cached);
        } catch { setResults([]); }
      }
      setLoading(false);
    }, 300);
  }, [q, session]);

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
          [["customer_rank", ">", 0], ["active", "=", true], ["partner_latitude", "!=", 0], ["partner_longitude", "!=", 0]],
          [...CLIENT_FIELDS, "partner_latitude", "partner_longitude"], 500);
      } catch {
        // Hors ligne → clients géolocalisés depuis le cache préchargé.
        rows = await sync.getCachedClients();
      }
      const withDist = rows
        .filter((r: any) => r.partner_latitude && r.partner_longitude)
        .map((r: any) => ({ ...r, _distKm: haversineKm(latitude, longitude, r.partner_latitude, r.partner_longitude) }))
        .filter((r: any) => r._distKm <= LOC_RADIUS_KM)
        .sort((a: any, b: any) => a._distKm - b._distKm);
      if (!withDist.length) {
        setLocError(`Aucun client à moins de ${fmtDistance(LOC_RADIUS_KM)} de ta position`);
      }
      setNearby(withDist);
      setLocMode(true);
    } catch (e: any) {
      setLocError(e?.message || "Position indisponible — vérifie l'autorisation de localisation");
    } finally {
      setLocLoading(false);
    }
  };

  const displayed = q.length >= 2 ? results : (locMode ? nearby : []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: C.tealSoft, border: `1.5px solid ${C.tealMid}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Icon name="user" size={34} color={C.teal} />
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.text }}>Choisir un client</div>
          <div style={{ fontSize: 14, color: C.muted, marginTop: 6 }}>Recherche par nom, référence ou ville</div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <div style={{ position: "relative" as const, flex: 1 }}>
            <svg style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input value={q} onChange={e => setQ(e.target.value)}
              placeholder="Nom du client..."
              style={{ width: "100%", boxSizing: "border-box" as const, padding: "14px 14px 14px 44px", border: `1.5px solid ${C.border}`, borderRadius: 14, fontSize: 16, fontFamily: "inherit", background: C.white, color: C.text, boxShadow: C.shadowMd, outline: "none" }} />
          </div>
          <button
            onClick={() => locMode ? setLocMode(false) : enableLocation()}
            title="Proposer les clients les plus proches de ma position"
            disabled={locLoading}
            style={{ flexShrink: 0, width: 50, display: "flex", alignItems: "center", justifyContent: "center", background: locMode ? C.teal : C.white, border: `1.5px solid ${locMode ? C.teal : C.border}`, borderRadius: 14, cursor: locLoading ? "default" : "pointer", boxShadow: C.shadowMd, color: locMode ? "#fff" : C.textSec }}>
            {locLoading ? "…" : <Icon name="pin" size={20} />}
          </button>
        </div>

        {locMode && !locLoading && !locError && (
          <div style={{ fontSize: 12, color: C.teal, fontWeight: 600, marginBottom: 10, textAlign: "center" as const }}>
            Clients à moins de {fmtDistance(LOC_RADIUS_KM)} — {nearby.length} résultat{nearby.length > 1 ? "s" : ""}
          </div>
        )}
        {locError && (
          <div style={{ fontSize: 12, color: C.red, background: C.redSoft, borderRadius: 10, padding: "8px 12px", marginBottom: 10, textAlign: "center" as const }}>
            {locError}
          </div>
        )}

        {(loading || locLoading) && <div style={{ textAlign: "center", color: C.muted, padding: 12, fontSize: 14 }}>{locLoading ? "Localisation en cours…" : "Recherche en cours…"}</div>}

        <div style={{ display: "flex", flexDirection: "column" as const, gap: 8, maxHeight: "50vh", overflowY: "auto" as const }}>
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HUB CLIENT — écran d'accueil une fois le client sélectionné
// ═══════════════════════════════════════════════════════════════════════════
function ClientHub({ session, client, hasDraft, onOrder, onHistory, onAppointment, onNote }: {
  session: odoo.OdooSession; client: any; hasDraft: boolean;
  onOrder: () => void; onHistory: () => void; onAppointment: () => void; onNote: () => void;
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

  // Refonte : une seule carte accentuée (l'action principale), les autres en blanc.
  const cards = [
    { key: "order", icon: "cart", title: "Prise de commande", subtitle: hasDraft ? "Brouillon en attente" : "Nouveau devis", primary: true, badge: hasDraft, onClick: onOrder },
    { key: "history", icon: "clock", title: "Historique", subtitle: "Commandes passées", primary: false, badge: false, onClick: onHistory },
    { key: "rdv", icon: "calendar", title: "Prendre un RDV", subtitle: "Agenda Odoo", primary: false, badge: false, onClick: onAppointment },
    { key: "note", icon: "note", title: "Note client", subtitle: "Compte rendu, vocal ou écrit", primary: false, badge: false, onClick: onNote },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", padding: "48px 24px", overflowY: "auto" as const }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        {/* Carte identité client */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 36 }}>
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
            {client.property_product_pricelist && (
              <div style={{ display: "inline-block", marginTop: 8, fontSize: 11, fontWeight: 700, color: C.teal, background: C.tealSoft, borderRadius: 8, padding: "3px 9px" }}>
                {client.property_product_pricelist[1]}
              </div>
            )}
          </div>
        </div>

        {/* Statistiques client */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 28 }}>
          <div style={{ background: "#0f766e", borderRadius: 16, padding: "14px 16px", color: "#fff", boxShadow: "0 8px 20px rgba(13,148,136,0.25)" }}>
            <div style={{ fontSize: 19, fontWeight: 800 }}>{stats ? fmtPrice(stats.ca) : "…"}</div>
            <div style={{ fontSize: 10.5, opacity: 0.85, fontWeight: 600, marginTop: 2, textTransform: "uppercase" as const, letterSpacing: "0.03em" }}>CA 12 mois</div>
          </div>
          <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: "14px 16px", boxShadow: C.shadow }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: C.text }}>{stats ? stats.count : "…"}</div>
            <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 2, textTransform: "uppercase" as const, letterSpacing: "0.03em" }}>Commandes</div>
          </div>
          <div style={{ background: C.white, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: "14px 16px", boxShadow: C.shadow }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: C.text }}>{lastDateLabel}</div>
            <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, marginTop: 2, textTransform: "uppercase" as const, letterSpacing: "0.03em" }}>Dernière cmd</div>
          </div>
        </div>

        {/* Grille d'actions */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
          {cards.map(c => (
            <button key={c.key} onClick={c.onClick}
              style={{
                position: "relative" as const, textAlign: "left" as const, padding: "20px 20px", borderRadius: 20,
                border: c.primary ? "none" : `1.5px solid ${C.border}`,
                background: c.primary ? C.teal : C.white,
                color: c.primary ? "#fff" : C.text,
                cursor: "pointer", fontFamily: "inherit",
                boxShadow: c.primary ? "0 10px 24px rgba(13,148,136,0.25)" : C.shadow,
                transition: "transform 0.15s",
              }}>
              {c.badge && (
                <div style={{ position: "absolute" as const, top: 14, right: 14, width: 10, height: 10, borderRadius: "50%", background: "#fde047", boxShadow: "0 0 0 3px rgba(255,255,255,0.35)" }} />
              )}
              <div style={{
                width: 46, height: 46, borderRadius: 14, marginBottom: 14,
                background: c.primary ? "rgba(255,255,255,0.18)" : C.tealSoft,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon name={c.icon} size={24} color={c.primary ? "#fff" : C.teal} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{c.title}</div>
              <div style={{ fontSize: 12, opacity: c.primary ? 0.85 : 1, color: c.primary ? undefined : C.muted, marginTop: 3 }}>{c.subtitle}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HISTORIQUE DES COMMANDES — devis/commandes passés de ce client
// ═══════════════════════════════════════════════════════════════════════════
function ClientHistory({ session, client }: { session: odoo.OdooSession; client: any }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [orderLines, setOrderLines] = useState<any[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);

  const openOrder = async (o: any) => {
    setSelectedOrder(o);
    setLoadingLines(true);
    setOrderLines([]);
    try {
      const lines = await odoo.searchRead(session, "sale.order.line",
        [["order_id", "=", o.id], ["display_type", "=", false]],
        ["id", "product_id", "name", "product_uom_qty", "price_unit", "price_subtotal", "discount"], 200);
      setOrderLines(lines);
    } catch {}
    setLoadingLines(false);
  };

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

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", padding: "32px 24px", overflowY: "auto" as const }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 18 }}>{client.name}</div>

        {loading ? (
          <div style={{ textAlign: "center" as const, color: C.muted, padding: 40 }}>Chargement…</div>
        ) : error ? (
          <div style={{ background: C.redSoft, color: C.red, borderRadius: 12, padding: "12px 16px", fontSize: 13 }}>{error}</div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: "center" as const, color: C.muted, padding: 60 }}>
            <div style={{ marginBottom: 12 }}><Icon name="inbox" size={40} color={C.border} /></div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Aucune commande pour ce client</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
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
        )}
      </div>

      {/* ── Détail d'une commande (overlay) ── */}
      {selectedOrder && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setSelectedOrder(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 480, maxHeight: "85vh", display: "flex", flexDirection: "column" as const, background: C.white, borderRadius: 20, boxShadow: C.shadowXl, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>
            <div style={{ padding: "20px 22px 14px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{selectedOrder.name}</div>
                <button onClick={() => setSelectedOrder(null)} style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 18, lineHeight: 1 }}>✕</button>
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
                {selectedOrder.date_order ? fmtDate(new Date(selectedOrder.date_order.replace(" ", "T") + "Z").getTime()) : "—"}
                {" · "}
                {(stateInfo[selectedOrder.state] || { label: selectedOrder.state }).label}
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto" as const, padding: "12px 22px" }}>
              {loadingLines ? (
                <div style={{ textAlign: "center" as const, color: C.muted, padding: 30 }}>Chargement…</div>
              ) : orderLines.length === 0 ? (
                <div style={{ textAlign: "center" as const, color: C.muted, padding: 30, fontSize: 13 }}>Aucune ligne trouvée</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                  {orderLines.map(l => (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{l.product_id ? l.product_id[1] : l.name}</div>
                        <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                          {l.product_uom_qty} × {fmtPrice(l.price_unit)}
                          {l.discount > 0 && ` · -${l.discount}%`}
                        </div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: C.tealDark, flexShrink: 0 }}>{fmtPrice(l.price_subtotal)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: "14px 22px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 13, color: C.muted }}>Total HT</span>
              <span style={{ fontSize: 17, fontWeight: 800, color: C.tealDark }}>{fmtPrice(selectedOrder.amount_total)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ÉTAPE 2 — Catalogue + Panier persistant
// ═══════════════════════════════════════════════════════════════════════════
function CatalogStep({ session, cart, onQtyChange, freeItems, onValidate, submitting, note, setNote, client, priceItems, onToast, appliedPromos }: {
  session: odoo.OdooSession; cart: Record<number, CartItem>;
  onQtyChange: (p: any, q: number, price?: number) => void; freeItems: FreeItem[];
  onValidate: () => void; submitting: boolean;
  note: string; setNote: (n: string) => void; client: any;
  priceItems: PriceItem[];
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
  appliedPromos: Record<number, loyalty.AppliedPromo>;
}) {
  const [smartCats, setSmartCats] = useState<SmartCat[]>([]);
  const [activeCatId, setActiveCatId] = useState<string | null>(null);
  const [allProducts, setAllProducts] = useState<any[]>([]); // cache complet des produits en stock
  const [loading, setProdLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [stockOnly, setStockOnly] = useState(true); // n'afficher que les articles avec du stock prévisionnel
  const searchInput = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<any>(null);

  // Pavé numérique quantité : tap sur le chiffre d'un produit (grille ou panier).
  // price fourni depuis la grille (prix client calculé) ; absent depuis le panier
  // (on garde alors le prix déjà enregistré sur la ligne).
  const [pad, setPad] = useState<{ product: any; price?: number } | null>(null);

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
    setZoomLoading(true);
    try {
      const r = await odoo.searchRead(session, "product.product", [["id", "=", p.id]], ["image_1024"], 1);
      setZoomImg(r?.[0]?.image_1024 || "");
    } catch {}
    setZoomLoading(false);
  };

  // ── MEA / Offres ─────────────────────────────────────────────────────────
  const MEA_CAT_ID = "__mea__";
  const [meaTemplates, setMeaTemplates] = useState<any[]>([]);
  const [meaLoading, setMeaLoading] = useState(false);
  const [applyingMea, setApplyingMea] = useState<number | null>(null);

  // ── Favoris : produits déjà commandés par le client, triés par quantité ───
  const FAV_CAT_ID = "__fav__";
  const [favProducts, setFavProducts] = useState<any[]>([]);
  const [favLoading, setFavLoading] = useState(false);
  const [favLoaded, setFavLoaded] = useState(false);

  const loadFavorites = async () => {
    if (favLoaded || !client?.id) return;
    setFavLoading(true);
    try {
      // 12 derniers mois pour rester pertinent et rapide
      const since = new Date();
      since.setFullYear(since.getFullYear() - 1);
      const sinceStr = since.toISOString().slice(0, 10);
      const lines = await odoo.searchRead(session, "sale.order.line",
        [["order_partner_id", "=", client.id], ["product_id", "!=", false], ["create_date", ">=", sinceStr], ["state", "in", ["sale", "done"]]],
        ["product_id", "product_uom_qty", "create_date"],
        2000, "create_date desc");
      // Agrégation par produit : quantité totale, nb de commandes, dernière date
      const agg = new Map<number, { totalQty: number; times: number; lastDate: string }>();
      for (const l of lines) {
        const pid = l.product_id?.[0];
        if (!pid) continue;
        const cur = agg.get(pid) || { totalQty: 0, times: 0, lastDate: "" };
        cur.totalQty += l.product_uom_qty || 0;
        cur.times += 1;
        if ((l.create_date || "") > cur.lastDate) cur.lastDate = l.create_date || "";
        agg.set(pid, cur);
      }
      const ids = Array.from(agg.keys());
      if (ids.length) {
        const prods = await odoo.searchRead(session, "product.product",
          [["id", "in", ids]],
          ["id", "name", "default_code", "barcode", "lst_price", "product_tmpl_id", "virtual_available"],
          ids.length);
        const enriched = prods.map((p: any) => ({ ...p, ...agg.get(p.id) }));
        enriched.sort((a: any, b: any) => (b.totalQty || 0) - (a.totalQty || 0));
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
      else onToast("Favoris indisponibles hors ligne pour ce client", "info");
    }
    setFavLoading(false);
  };

  const loadMeaTemplates = async () => {
    if (meaTemplates.length > 0) return;
    setMeaLoading(true);
    try {
      const templates = await odoo.searchRead(session, "sale.order.template",
        [["active", "=", true]],
        ["id", "name", "sale_order_template_line_ids"],
        200, "name");
      setMeaTemplates(templates);
      sync.cacheMea(templates).catch(() => {});
    } catch {
      // Hors ligne → modèles MEA préchargés
      try { setMeaTemplates(await sync.getCachedMea()); } catch {}
    }
    setMeaLoading(false);
  };

  const applyMeaTemplate = async (template: any) => {
    setApplyingMea(template.id);
    try {
      // Utilise les IDs de lignes déjà chargés pour éviter le filtre sur order_template_id
      const lineIds: number[] = template.sale_order_template_line_ids || [];
      if (!lineIds.length) { onToast("Aucun produit dans cette offre", "error"); setApplyingMea(null); return; }

      let lines: any[];
      try {
        lines = await odoo.searchRead(session, "sale.order.template.line",
          [["id", "in", lineIds], ["product_id", "!=", false]],
          ["id", "product_id", "product_uom_qty"],
          200);
      } catch {
        // Hors ligne → lignes préchargées
        lines = await sync.getCachedMeaLines(lineIds);
      }
      if (!lines.length) { onToast("Aucun produit dans cette offre", "error"); setApplyingMea(null); return; }

      const productIds = lines.map((l: any) => l.product_id[0]);
      let products: any[];
      try {
        products = await odoo.searchRead(session, "product.product",
          [["id", "in", productIds]],
          ["id", "name", "default_code", "barcode", "lst_price", "product_tmpl_id", "virtual_available"],
          productIds.length);
      } catch {
        // Hors ligne → produits depuis le catalogue préchargé
        const cached = await sync.getCachedProducts();
        const set = new Set(productIds);
        products = cached.filter((p: any) => set.has(p.id));
      }
      const productMap = new Map<number, any>(products.map((p: any) => [p.id as number, p]));

      let added = 0;
      for (const line of lines) {
        const product: any = productMap.get(line.product_id[0]);
        if (!product) continue;
        const qty = Math.max(1, Math.round(line.product_uom_qty || 1));
        const clientPrice = applyPricelist(product.lst_price || 0, product.id, product.product_tmpl_id?.[0] || 0, priceItems, qty);
        onQtyChange(product, (cart[product.id]?.qty || 0) + qty, clientPrice);
        added++;
      }
      onToast(`✅ ${template.name} — ${added} produit${added > 1 ? "s" : ""} ajouté${added > 1 ? "s" : ""}`, "success");
    } catch (e: any) { onToast("Erreur: " + e.message, "error"); }
    setApplyingMea(null);
  };

  useEffect(() => { setSmartCats(loadSmartCats()); }, []);

  // Chargement initial : tous les produits vendables actifs
  const loadAll = useCallback(async (q: string) => {
    setProdLoading(true);
    const domain: any[] = [
      ["sale_ok", "=", true],
      ["active", "=", true],
    ];
    if (q.trim().length >= 2) {
      domain.push("|");
      domain.push(["name", "ilike", q.trim()]);
      domain.push(["default_code", "ilike", q.trim()]);
    }
    try {
      const p = await odoo.searchRead(session, "product.product", domain,
        ["id", "name", "default_code", "barcode", "lst_price", "product_tmpl_id", "virtual_available"], 500, "name");
      // Produits en stock en premier, puis les autres
      p.sort((a: any, b: any) => (b.virtual_available || 0) - (a.virtual_available || 0));
      if (!q) setAllProducts(p);
      else { setProdLoading(false); return p; } // pour la recherche, retourner sans stocker
    } catch {
      // Réseau indisponible → on lit le catalogue préchargé en local.
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

  // Produits affichés = filtre catégorie + filtre recherche sur le cache local
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const isSearching = search.trim().length >= 2;

  useEffect(() => {
    if (!isSearching) { setSearchResults([]); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setProdLoading(true);
      const r = await loadAll(search);
      if (r) setSearchResults(r as any[]);
      setProdLoading(false);
    }, 300);
  }, [search, loadAll, isSearching]);

  const inStock = (p: any) => (p.virtual_available || 0) > 0;

  const baseProducts = isSearching
    ? searchResults
    : activeCatId === FAV_CAT_ID
      ? favProducts
      : activeCatId
        ? allProducts.filter(p => {
            const cat = smartCats.find(c => c.id === activeCatId);
            return cat ? matchesCat(p, cat) : true;
          })
        : allProducts;
  const displayedProducts = stockOnly ? baseProducts.filter(inStock) : baseProducts;

  const freeProductIds = new Set(freeItems.map(f => f.product.id));
  const cartItems = Object.values(cart);
  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);
  const cartTotal = cartItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const freeCount = freeItems.reduce((s, i) => s + i.qty, 0);
  const lineDiscounts = loyalty.computeLineDiscounts(appliedPromos, cart);
  const discountTotal = cartItems.reduce((s, i) => {
    const pct = lineDiscounts[i.product.id] || 0;
    return s + (i.qty * i.unitPrice * pct) / 100;
  }, 0);
  const netTotal = cartTotal - discountTotal;

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

      {/* ── Sidebar catégories par mots-clés ── */}
      <div style={{ width: 160, background: C.white, borderRight: `1px solid ${C.border}`, overflowY: "auto" as const, flexShrink: 0 }}>
        <div style={{ padding: "12px 10px 6px", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Gammes</div>

        {/* Tous */}
        <button onClick={() => setActiveCatId(null)}
          style={{ width: "100%", padding: "10px 10px", background: !activeCatId ? C.tealSoft : "transparent", border: "none", borderLeft: `3px solid ${!activeCatId ? C.teal : "transparent"}`, cursor: "pointer", textAlign: "left" as const, fontSize: 12, fontWeight: !activeCatId ? 700 : 400, color: !activeCatId ? C.tealDark : C.textSec, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 7 }}>
          <Icon name="home" size={13} /> Tous
        </button>

        {/* Favoris du client */}
        <button onClick={() => { setActiveCatId(FAV_CAT_ID); loadFavorites(); }}
          style={{ width: "100%", padding: "10px 10px", background: activeCatId === FAV_CAT_ID ? C.orangeSoft : "transparent", border: "none", borderLeft: `3px solid ${activeCatId === FAV_CAT_ID ? C.orange : "transparent"}`, cursor: "pointer", textAlign: "left" as const, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, transition: "all 0.1s" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: activeCatId === FAV_CAT_ID ? 700 : 400, color: activeCatId === FAV_CAT_ID ? C.orange : C.textSec }}>
            <Icon name="star" size={13} /> Favoris
          </span>
          {favLoaded && favProducts.length > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: activeCatId === FAV_CAT_ID ? C.orange : C.muted, background: activeCatId === FAV_CAT_ID ? C.orangeSoft : C.bg, borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>{favProducts.length}</span>}
        </button>

        {/* Catégories configurées */}
        {smartCats.map(cat => {
          const count = allProducts.filter(p => matchesCat(p, cat) && (!stockOnly || inStock(p))).length;
          const active = activeCatId === cat.id;
          return (
            <button key={cat.id} onClick={() => setActiveCatId(cat.id)}
              style={{ width: "100%", padding: "10px 10px", background: active ? C.tealSoft : "transparent", border: "none", borderLeft: `3px solid ${active ? C.teal : "transparent"}`, cursor: "pointer", textAlign: "left" as const, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, transition: "all 0.1s" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: active ? 700 : 400, color: active ? C.tealDark : C.textSec }}>
                <span>{cat.emoji}</span>{cat.label}
              </span>
              {count > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: active ? C.teal : C.muted, background: active ? C.tealMid : C.bg, borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>{count}</span>}
            </button>
          );
        })}

        {/* ── Offres MEA ── */}
        <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 6 }}>
          <div style={{ padding: "4px 10px 4px", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Offres</div>
          <button
            onClick={() => { setActiveCatId(MEA_CAT_ID); loadMeaTemplates(); }}
            style={{ width: "100%", padding: "10px 10px", background: activeCatId === MEA_CAT_ID ? C.orangeSoft : "transparent", border: "none", borderLeft: `3px solid ${activeCatId === MEA_CAT_ID ? C.orange : "transparent"}`, cursor: "pointer", textAlign: "left" as const, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 7, transition: "all 0.1s" }}>
            <span style={{ fontSize: 12, fontWeight: activeCatId === MEA_CAT_ID ? 700 : 400, color: activeCatId === MEA_CAT_ID ? C.orange : C.textSec, display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="gift" size={13} /> MEA
            </span>
          </button>
        </div>
      </div>

      {/* ── Zone produits ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, overflow: "hidden", minWidth: 0 }}>
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
          {activeCatId === MEA_CAT_ID ? (
            meaLoading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: C.muted }}>Chargement…</div>
            ) : meaTemplates.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: C.muted }}>
                <div style={{ marginBottom: 10 }}><Icon name="file" size={32} color={C.border} /></div>
                <div>Aucun modèle de devis trouvé</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
                {meaTemplates.map((t) => {
                  const isApplying = applyingMea === t.id;
                  const lineCount = t.sale_order_template_line_ids?.length || 0;
                  return (
                    <div key={t.id} style={{ minHeight: 90, background: C.white, borderRadius: 10, border: `1px solid ${isApplying ? C.teal : C.border}`, boxShadow: C.shadow, display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", transition: "border-color 0.15s" }}>
                      {/* Infos */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>{lineCount} produit{lineCount > 1 ? "s" : ""}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.35, overflowWrap: "anywhere" as const }}>{t.name}</div>
                      </div>
                      {/* Bouton */}
                      <button
                        onClick={() => applyMeaTemplate(t)}
                        disabled={isApplying}
                        style={{ flexShrink: 0, padding: "8px 14px", background: isApplying ? C.bg : C.teal, color: isApplying ? C.muted : "#fff", border: `1px solid ${isApplying ? C.border : C.teal}`, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: isApplying ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" as const }}>
                        {isApplying ? "…" : "+ Ajouter"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          ) : activeCatId === FAV_CAT_ID && favLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: C.muted }}>Chargement des favoris…</div>
          ) : activeCatId === FAV_CAT_ID && favLoaded && displayedProducts.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: C.muted }}>
              <div style={{ marginBottom: 10 }}><Icon name="star" size={32} color={C.border} /></div>
              <div>{favProducts.length === 0 ? "Ce client n'a passé aucune commande sur les 12 derniers mois" : "Aucun favori en stock — désactive « Stock dispo » pour tout voir"}</div>
            </div>
          ) : loading && allProducts.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: C.muted }}>Chargement…</div>
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
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(172px, 1fr))", gap: 10 }}>
              {displayedProducts.map(p => {
                const qty = cart[p.id]?.qty || 0;
                const isFree = freeProductIds.has(p.id);
                const stock = Math.max(0, Math.round(p.virtual_available || 0));
                // Prix client calculé côté client à partir des items pricelist (0 appel supplémentaire)
                const clientPrice = applyPricelist(p.lst_price || 0, p.id, p.product_tmpl_id?.[0] || 0, priceItems, qty || 1);
                const hasDiscount = priceItems.length > 0 && Math.abs(clientPrice - (p.lst_price || 0)) > 0.01;
                return (
                  <div key={p.id} style={{ background: C.white, borderRadius: 14, overflow: "hidden", border: `2px solid ${qty > 0 ? C.teal : isFree ? C.green : C.border}`, boxShadow: qty > 0 ? `0 0 0 3px ${C.tealSoft}` : C.shadow, transition: "all 0.15s" }}>
                    <div onClick={() => openZoom(p)} title="Agrandir l'image" style={{ height: 80, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" as const, cursor: "zoom-in" }}>
                      <div style={{ position: "absolute" }}><Icon name="package" size={30} color={C.border} /></div>
                      <ProductImage id={p.id} networkUrl={imgUrl(p.id)} style={{ height: 72, objectFit: "contain", position: "relative" as const, zIndex: 1 }} />
                      <div style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(255,255,255,0.85)", borderRadius: 6, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.5"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
                      </div>
                      {isFree && <div style={{ position: "absolute", top: 5, right: 5, background: C.green, color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 5, padding: "2px 5px" }}>OFFERT</div>}
                      {qty > 0 && <div style={{ position: "absolute", top: 5, left: 5, background: C.teal, color: "#fff", fontSize: 12, fontWeight: 800, borderRadius: 7, padding: "2px 8px" }}>{qty}</div>}
                    </div>
                    <div style={{ padding: "8px 10px 10px" }}>
                      <div style={{ fontSize: 10.5, color: C.muted, fontFamily: "monospace", marginBottom: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.default_code}{p.barcode ? ` · ${p.barcode}` : ""}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text, lineHeight: 1.3, height: 33, overflow: "hidden" }}>{p.name}</div>
                      {activeCatId === FAV_CAT_ID && p.totalQty != null && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.orange, background: C.orangeSoft, borderRadius: 5, padding: "2px 6px", marginTop: 3, display: "inline-block" }}>
                          {Math.round(p.totalQty)} commandé{Math.round(p.totalQty) > 1 ? "s" : ""} · {p.times} fois
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 5, marginBottom: 6 }}>
                        <div style={{ display: "flex", flexDirection: "column" as const, gap: 1 }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: hasDiscount ? C.green : C.tealDark }}>{clientPrice > 0 ? fmtPrice(clientPrice) : "—"}</span>
                          {hasDiscount && <span style={{ fontSize: 10, color: C.muted, textDecoration: "line-through" }}>{fmtPrice(p.lst_price)}</span>}
                        </div>
                        <span style={{ fontSize: 10.5, fontWeight: 600, color: stock > 0 ? C.green : C.red, background: stock > 0 ? C.greenSoft : C.redSoft, borderRadius: 5, padding: "2px 6px" }}>{stock > 0 ? stock : "Rupture"}</span>
                      </div>
                      {/* Stepper tactile : boutons 44px (norme Apple), chiffre TAPABLE → pavé numérique */}
                      <div style={{ display: "flex", background: qty > 0 ? C.tealSoft : C.bg, borderRadius: 10, overflow: "hidden", border: `1px solid ${qty > 0 ? C.tealMid : C.border}` }}>
                        <button onClick={() => onQtyChange(p, qty - 1, clientPrice)} style={{ flex: 1, height: 44, background: "transparent", border: "none", cursor: "pointer", fontSize: 20, fontWeight: 700, color: qty > 0 ? C.red : C.muted, lineHeight: 1 }}>−</button>
                        <button onClick={() => setPad({ product: p, price: clientPrice })} title="Saisir une quantité"
                          style={{ flex: 1.2, height: 44, background: "transparent", border: "none", borderLeft: `1px solid ${qty > 0 ? C.tealMid : C.border}`, borderRight: `1px solid ${qty > 0 ? C.tealMid : C.border}`, cursor: "pointer", fontSize: 16, fontWeight: 800, color: qty > 0 ? C.tealDark : C.muted, fontFamily: "inherit" }}>
                          {qty}
                        </button>
                        <button onClick={() => onQtyChange(p, qty + 1, clientPrice)} style={{ flex: 1, height: 44, background: "transparent", border: "none", cursor: "pointer", fontSize: 20, fontWeight: 700, color: C.teal, lineHeight: 1 }}>+</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Panier persistant (droite) ── */}
      <div style={{ width: 310, background: C.white, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column" as const, flexShrink: 0 }}>
        {/* Header panier */}
        <div style={{ padding: "12px 14px", background: "#0f766e", color: "#fff" }}>
          <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}><Icon name="cart" size={14} /> Panier — {client.name}</div>
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
            {cartCount} article{cartCount > 1 ? "s" : ""} · {fmtPrice(cartTotal)}
            {freeCount > 0 && <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.2)", borderRadius: 5, padding: "1px 6px" }}>+{freeCount} offerts</span>}
          </div>
        </div>

        {/* Liste articles */}
        <div style={{ flex: 1, overflowY: "auto" as const, padding: "10px 12px" }}>
          {cartItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 12px", color: C.muted }}>
              <div style={{ marginBottom: 8 }}><Icon name="cart" size={28} color={C.border} /></div>
              <div style={{ fontSize: 12 }}>Ajoute des produits</div>
            </div>
          ) : (
            cartItems.map(item => {
              const pct = lineDiscounts[item.product.id] || 0;
              const gross = item.qty * item.unitPrice;
              const net = gross * (1 - pct / 100);
              return (
                <div key={item.product.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "8px 8px", background: C.bg, borderRadius: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{item.product.name}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{item.qty} × {fmtPrice(item.unitPrice)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => onQtyChange(item.product, item.qty - 1)} style={{ width: 36, height: 36, borderRadius: 8, background: C.redSoft, border: "none", cursor: "pointer", color: C.red, fontSize: 17, fontWeight: 700, lineHeight: 1 }}>−</button>
                    <button onClick={() => setPad({ product: item.product })} title="Saisir une quantité"
                      style={{ minWidth: 32, height: 36, borderRadius: 8, background: "transparent", border: `1px solid ${C.border}`, cursor: "pointer", fontSize: 13.5, fontWeight: 800, color: C.text, fontFamily: "inherit", padding: "0 4px" }}>
                      {item.qty}
                    </button>
                    <button onClick={() => onQtyChange(item.product, item.qty + 1)} style={{ width: 36, height: 36, borderRadius: 8, background: C.tealSoft, border: "none", cursor: "pointer", color: C.teal, fontSize: 17, fontWeight: 700, lineHeight: 1 }}>+</button>
                  </div>
                  <div style={{ minWidth: 52, textAlign: "right" as const, flexShrink: 0 }}>
                    {pct > 0 ? (
                      <>
                        <div style={{ fontSize: 10, color: C.muted, textDecoration: "line-through" }}>{fmtPrice(gross)}</div>
                        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.orange }}>{fmtPrice(net)}</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>{fmtPrice(gross)}</div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Articles gratuits */}
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

          {/* Remises additionnelles appliquées */}
          {Object.keys(appliedPromos).length > 0 && (
            <div style={{ margin: "8px 0", padding: "8px 10px", background: C.orangeSoft, border: `1px solid ${C.orange}33`, borderRadius: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.orange, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5, display: "flex", alignItems: "center", gap: 5 }}><Icon name="tag" size={11} /> Remises appliquées</div>
              {Object.values(appliedPromos).map(p => (
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

        {/* Bloc récap sombre — note + total + validation */}
        <div style={{ padding: "0 12px 12px" }}>
          <div style={{ background: "#0f172a", borderRadius: 18, padding: "14px 14px 16px", boxShadow: "0 12px 28px rgba(15,23,42,0.35)" }}>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note pour la commande..."
              rows={2} style={{ width: "100%", boxSizing: "border-box" as const, marginBottom: 12, padding: "9px 11px", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, fontSize: 12, fontFamily: "inherit", resize: "none" as const, background: "rgba(255,255,255,0.06)", color: "#fff", outline: "none" }} />

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 10, display: "flex", flexDirection: "column" as const, gap: 5, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>Sous-total</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{fmtPrice(cartTotal)}</span>
              </div>
              {discountTotal > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#fb923c" }}>Remise appliquée</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#fb923c" }}>−{fmtPrice(discountTotal)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Total HT</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: "#5eead4" }}>{fmtPrice(netTotal)}</span>
              </div>
            </div>

            {/* Le bouton annonce la mise en file AVANT la validation quand on est hors
                 ligne — pas de surprise après coup. */}
            <button onClick={onValidate} disabled={submitting || cartCount === 0}
              style={{ width: "100%", padding: "14px 0", background: cartCount === 0 ? "rgba(255,255,255,0.12)" : submitting ? "rgba(94,234,212,0.4)" : "#2dd4bf", color: cartCount === 0 ? "rgba(255,255,255,0.4)" : "#0f172a", border: "none", borderRadius: 999, fontSize: 14, fontWeight: 800, cursor: cartCount === 0 ? "default" : "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
              {submitting ? "Création…"
                : cartCount === 0 ? "Panier vide"
                : !navOnline ? "Enregistrer hors ligne · envoi auto"
                : `Créer le devis${freeItems.length > 0 ? " + BC gratuit" : ""} →`}
            </button>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textAlign: "center" as const, marginTop: 8 }}>
              {navOnline ? "Prix Odoo appliqués à la création" : "Hors ligne — la commande partira au retour du réseau"}
            </div>
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

      {/* ── Modale zoom image ── */}
      {zoom && (
        <div onClick={() => setZoom(null)}
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
            {/* Image */}
            <div style={{ height: 340, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "16px 16px 0 0" }}>
              {zoomLoading ? (
                <span style={{ color: C.muted, fontSize: 13 }}>Chargement…</span>
              ) : zoomImg ? (
                <img src={`data:image/png;base64,${zoomImg}`} alt="" style={{ maxHeight: 320, maxWidth: "90%", objectFit: "contain" }} />
              ) : (
                <ProductImage id={zoom.id} networkUrl={imgUrl(zoom.id)} style={{ maxHeight: 200, maxWidth: "90%", objectFit: "contain" }} />
              )}
            </div>
            {/* Infos */}
            <div style={{ padding: "16px 20px 20px" }}>
              <div style={{ fontSize: 11, color: C.muted, fontFamily: "monospace", marginBottom: 4 }}>{zoom.default_code}{zoom.barcode ? ` · EAN ${zoom.barcode}` : ""}</div>
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
function QtyPad({ name, initial, onSet, onClose }: {
  name: string; initial: number; onSet: (n: number) => void; onClose: () => void;
}) {
  const [val, setVal] = useState("");                      // saisie en cours ("" = quantité actuelle)
  const shown = val === "" ? String(initial) : val;
  const commit = (n?: number) => {
    const q = n ?? (parseInt(shown, 10) || 0);
    onSet(Math.max(0, Math.min(9999, q)));
    onClose();
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 250, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 304, background: "#fff", borderRadius: 20, boxShadow: C.shadowXl, padding: 18, fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{name}</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: val === "" ? C.muted : C.text, textAlign: "center" as const, padding: "6px 0 10px" }}>{shown}</div>

        {/* Presets colis : AJOUTE à la quantité actuelle (réassort rapide) */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {[6, 12, 24].map(n => (
            <button key={n} onClick={() => commit((parseInt(shown, 10) || 0) + n)}
              style={{ flex: 1, height: 40, background: C.tealSoft, border: `1px solid ${C.tealMid}`, borderRadius: 10, fontSize: 13.5, fontWeight: 700, color: C.tealDark, cursor: "pointer", fontFamily: "inherit" }}>
              +{n}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {keys.map(k => (
            <button key={k}
              onClick={() => {
                if (k === "C") setVal("0");
                else if (k === "⌫") setVal(v => (v === "" ? "" : v.slice(0, -1)));
                else setVal(v => ((v === "" || v === "0" ? k : v + k)).slice(0, 4));
              }}
              style={{ height: 52, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 20, fontWeight: 700, color: k === "C" || k === "⌫" ? C.muted : C.text, cursor: "pointer", fontFamily: "inherit" }}>
              {k}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={onClose}
            style={{ flex: 1, height: 48, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 14, color: C.muted, cursor: "pointer", fontFamily: "inherit" }}>
            Annuler
          </button>
          <button onClick={() => commit()}
            style={{ flex: 2, height: 48, background: C.teal, border: "none", borderRadius: 12, fontSize: 15, fontWeight: 800, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
            Valider
          </button>
        </div>
      </div>
    </div>
  );
}

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
