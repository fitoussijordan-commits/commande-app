"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import * as odoo from "@/lib/odoo";
import AppointmentModal from "@/components/AppointmentModal";
import ClientNoteModal from "@/components/ClientNoteModal";
import * as loyalty from "@/lib/loyalty";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  purple: "#7c3aed", purpleSoft: "#f5f3ff",
  orange: "#ea580c", orangeSoft: "#fff7ed",
  green: "#16a34a", greenSoft: "#f0fdf4",
  red: "#dc2626", redSoft: "#fef2f2",
  blue: "#2563eb", blueSoft: "#eff6ff",
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)",
  shadowMd: "0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.05)",
  shadowXl: "0 20px 25px rgba(0,0,0,0.10), 0 8px 10px rgba(0,0,0,0.04)",
};

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
}

function applyPricelist(lstPrice: number, productId: number, productTmplId: number, items: PriceItem[], qty = 1): number {
  // Priorité : product_variant > product_template > global
  // On prend la première règle qui s'applique (Odoo respecte la séquence)
  const today = new Date().toISOString().slice(0, 10);

  for (const item of items) {
    if (item.min_quantity > qty) continue;

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

async function fetchPricelistItems(session: odoo.OdooSession, pricelistId: number): Promise<PriceItem[]> {
  return odoo.searchRead(session, "product.pricelist.item",
    [["pricelist_id", "=", pricelistId], ["active", "=", true]],
    ["applied_on", "compute_price", "product_id", "product_tmpl_id", "categ_id",
     "fixed_price", "percent_price", "price_discount", "price_surcharge", "min_quantity"],
    500, "sequence asc"  // Odoo trie par séquence pour appliquer la bonne priorité
  );
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
    _validatedTagIdCache = null;
  }
  return _validatedTagIdCache ?? null;
}

// Programmes de remise Odoo (Ventes → Réductions & fidélité) — récupérés une fois par session app,
// ce sont des données globales (pas liées à un client précis).
let _loyaltyProgramsCache: loyalty.LoyaltyProgram[] | null = null;
async function getLoyaltyPrograms(session: odoo.OdooSession): Promise<loyalty.LoyaltyProgram[]> {
  if (_loyaltyProgramsCache !== null) return _loyaltyProgramsCache;
  _loyaltyProgramsCache = await loyalty.fetchActiveLoyaltyPrograms(session);
  return _loyaltyProgramsCache;
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
  const [done, setDone] = useState<{ mainId: number; freeId: number | null } | null>(null);
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

  // Chargement initial : règles + migration de l'ancien format de brouillon unique + remises Odoo
  useEffect(() => {
    setRules(loadRules());
    migrateLegacyDraft();
    refreshPendingDrafts();
    getLoyaltyPrograms(session).then(setLoyaltyPrograms);
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
  // existant pour CE client précisément, charge sa pricelist, puis entre dans le catalogue.
  const enterOrderMode = () => {
    if (!client) return;
    setCart({});
    setNote("");
    setAppliedPromos({});
    setResumePrompt(loadDraftForClient(client.id));
    const plId = client.property_product_pricelist?.[0];
    if (plId) fetchPricelistItems(session, plId).then(setPriceItems).catch(() => setPriceItems([]));
    else setPriceItems([]);
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
      const mainId = await odoo.create(session, "sale.order", {
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
      });

      let freeId: number | null = null;
      if (freeItems.length > 0) {
        freeId = await odoo.create(session, "sale.order", {
          partner_id: client.id, state: "draft",
          note: `Articles offerts — lié au devis #${mainId}`,
          ...tagVals,
          order_line: freeItems.map(fi => [0, 0, {
            product_id: fi.product.id,
            product_uom_qty: fi.qty,
            price_unit: 0,
          }]),
        });
      }
      removeDraftForClient(client.id); // effacer le brouillon de CE client après création réussie
      refreshPendingDrafts();
      setAppliedPromos({});
      setDone({ mainId, freeId });
    } catch (e: any) { onToast("Erreur : " + e.message, "error"); }
    setSubmitting(false);
  };

  // Écran confirmation finale
  if (done) return (
    <div style={{ position: "fixed", inset: 0, left: desktop ? 248 : 0, background: "linear-gradient(135deg, #0f766e 0%, #7c3aed 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 24, padding: "48px 40px", maxWidth: 480, width: "90%", textAlign: "center", boxShadow: C.shadowXl }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.text, marginBottom: 8 }}>Devis créé !</div>
        <div style={{ fontSize: 15, color: C.muted, lineHeight: 1.6, marginBottom: 32 }}>
          Devis principal <span style={{ color: C.teal, fontWeight: 700 }}>#{done.mainId}</span> dans Odoo
          {done.freeId && <><br/>BC gratuit <span style={{ color: C.purple, fontWeight: 700 }}>#{done.freeId}</span> créé automatiquement</>}
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <button onClick={() => { setDone(null); setCart({}); setClient(null); setNote(""); setResumePrompt(null); setAppliedPromos({}); setStep("client"); }}
            style={{ padding: "14px 28px", background: C.teal, color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Nouvelle commande
          </button>
          <button onClick={onBack}
            style={{ padding: "14px 24px", background: C.bg, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 15, cursor: "pointer", fontFamily: "inherit" }}>
            Menu
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, left: desktop ? 248 : 0, zIndex: 150, background: C.bg, display: "flex", flexDirection: "column" as const, fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>

      {/* ── Top bar ── */}
      <div style={{ height: 56, background: "#fff", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 20px", gap: 16, flexShrink: 0, boxShadow: C.shadow }}>
        <button onClick={() => {
            if (step === "catalog" || step === "history") setStep("hub");
            else if (step === "hub") setStep("client");
            else if (step === "home") setStep("client");
            else onBack();
          }}
          title="Retour"
          style={{ width: 36, height: 36, borderRadius: 10, background: C.bg, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.text} strokeWidth="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>

        {/* Fil d'ariane simple : où on en est pour ce client */}
        <div style={{ fontSize: 13, fontWeight: 700, color: C.muted }}>
          {step === "home" && "Accueil"}
          {step === "client" && "Choisir un client"}
          {step === "hub" && "Fiche client"}
          {step === "catalog" && "Prise de commande"}
          {step === "history" && "Historique des commandes"}
        </div>

        <div style={{ flex: 1 }} />

        {/* Voir planning — visible sur l'écran de recherche client (pas de client sélectionné) */}
        {step === "client" && (
          <button onClick={() => setStep("home")}
            style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 14px", borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: C.textSec }}>
            📅 Voir planning
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
            style={{ width: 36, height: 36, borderRadius: 10, background: C.bg, border: `1px solid ${C.border}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
            📅
          </button>
        )}

        {/* Remises additionnelles Odoo disponibles pour ce panier */}
        {step === "catalog" && availablePromoCount > 0 && (
          <button onClick={() => setShowPromoPanel(v => !v)} title="Remises disponibles pour ce panier"
            style={{ display: "flex", alignItems: "center", gap: 5, height: 36, padding: "0 10px", borderRadius: 10, background: showPromoPanel ? C.orangeSoft : C.orange, border: `1px solid ${C.orange}`, cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ fontSize: 14 }}>🏷️</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: showPromoPanel ? C.orange : "#fff" }}>{availablePromoCount}</span>
          </button>
        )}


        {/* Accès discret aux brouillons en attente — jamais affiché sans action volontaire */}
        {pendingDrafts.length > 0 && (
          <button onClick={() => setShowDraftsPanel(v => !v)} title="Commandes en attente de finalisation"
            style={{ display: "flex", alignItems: "center", gap: 5, height: 36, padding: "0 10px", borderRadius: 10, background: showDraftsPanel ? "#fef9c3" : C.bg, border: `1px solid ${showDraftsPanel ? "#fde047" : C.border}`, cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ fontSize: 14 }}>📝</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>{pendingDrafts.length}</span>
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
          <span style={{ fontSize: 18 }}>📝</span>
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
        <HomeScreen session={session} onNewOrder={() => setStep("client")} />
      )}

      {step === "client" && <ClientStep session={session} onSelect={c => {
        setClient(c);
        setStep("hub");
        // 1 seul appel pricelist, réutilisé plus tard par la prise de commande
        const plId = c.property_product_pricelist?.[0];
        if (plId) fetchPricelistItems(session, plId).then(setPriceItems).catch(() => setPriceItems([]));
        else setPriceItems([]);
      }} />}

      {step === "hub" && client && (
        <ClientHub
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

const CLIENT_FIELDS = ["id", "name", "ref", "city", "country_id", "property_product_pricelist", "email", "phone"];

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

function HomeScreen({ session, onNewOrder }: { session: odoo.OdooSession; onNewOrder: () => void }) {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const monday = startOfWeek(new Date());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const today = new Date();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 7);
        const rows = await odoo.searchRead(session, "calendar.event",
          [["user_id", "=", session.uid], ["start", "<", toOdooDateStr(sunday)], ["stop", ">=", toOdooDateStr(monday)]],
          ["id", "name", "start", "stop", "location"], 200, "start asc");
        setEvents(rows);
      } catch {
        setEvents([]);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const eventsByDay = days.map(d => events.filter(e => sameDay(odooToLocalDate(e.start), d)));
  const totalCount = events.length;

  return (
    <div style={{ flex: 1, overflowY: "auto" as const, padding: "36px 24px 60px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        {/* En-tête */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 16, marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>Bonjour {session.name?.split(" ")[0] || ""} 👋</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: C.text, marginTop: 2 }}>Ta semaine</div>
          </div>
          <button onClick={onNewOrder}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "13px 22px", background: "linear-gradient(135deg, #0d9488, #0f766e)", color: "#fff", border: "none", borderRadius: 14, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 8px 20px rgba(13,148,136,0.3)" }}>
            🛒 Nouvelle commande
          </button>
        </div>

        {/* Bandeau résumé */}
        <div style={{ background: "linear-gradient(135deg, #0d9488 0%, #7c3aed 100%)", borderRadius: 18, padding: "18px 22px", color: "#fff", marginBottom: 24, display: "flex", alignItems: "center", gap: 14, boxShadow: "0 10px 24px rgba(15,23,42,0.16)" }}>
          <div style={{ fontSize: 28 }}>📅</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>
              {loading ? "Chargement du planning…" : totalCount === 0 ? "Aucun RDV cette semaine" : `${totalCount} RDV cette semaine`}
            </div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
              {monday.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} — {days[6].toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
            </div>
          </div>
        </div>

        {/* Planning jour par jour */}
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
          {days.map((d, i) => {
            const dayEvents = eventsByDay[i];
            const isToday = sameDay(d, today);
            const isPast = d < today && !isToday;
            return (
              <div key={i} style={{ display: "flex", gap: 16, padding: "14px 4px", borderBottom: i < 6 ? `1px solid ${C.border}` : "none", opacity: isPast ? 0.5 : 1 }}>
                {/* Colonne date */}
                <div style={{ width: 64, flexShrink: 0, textAlign: "center" as const }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: isToday ? C.teal : C.muted, textTransform: "uppercase" as const, letterSpacing: "0.04em" }}>{WEEKDAY_LABELS[i].slice(0, 3)}</div>
                  <div style={{
                    width: 34, height: 34, borderRadius: "50%", margin: "4px auto 0",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: isToday ? "linear-gradient(135deg, #0d9488, #7c3aed)" : "transparent",
                    color: isToday ? "#fff" : C.text, fontSize: 15, fontWeight: 800,
                  }}>
                    {d.getDate()}
                  </div>
                </div>

                {/* Colonne événements */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" as const, gap: 6, paddingTop: 2 }}>
                  {dayEvents.length === 0 ? (
                    <div style={{ fontSize: 12, color: C.muted, paddingTop: 6 }}>Aucun RDV</div>
                  ) : dayEvents.map(e => (
                    <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.tealSoft, border: `1px solid ${C.tealMid}`, borderRadius: 10, padding: "8px 12px" }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: C.tealDark, flexShrink: 0, minWidth: 40 }}>
                        {odooToLocalDate(e.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{e.name}</div>
                        {e.location && <div style={{ fontSize: 11, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>📍 {e.location}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
        const r = await odoo.searchRead(session, "res.partner",
          ["|", ["name", "ilike", q], ["ref", "ilike", q], ["customer_rank", ">", 0], ["active", "=", true]],
          CLIENT_FIELDS, 30);
        setResults(r);
      } catch {}
      setLoading(false);
    }, 300);
  }, [q, session]);

  // Taper dans la recherche désactive le mode localisation (évite la confusion entre les deux listes)
  useEffect(() => { if (q.length >= 2 && locMode) setLocMode(false); }, [q]); // eslint-disable-line

  const enableLocation = () => {
    setLocError("");
    if (!("geolocation" in navigator)) {
      setLocError("Géolocalisation non disponible sur cet appareil");
      return;
    }
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const rows = await odoo.searchRead(session, "res.partner",
            [["customer_rank", ">", 0], ["active", "=", true], ["partner_latitude", "!=", 0], ["partner_longitude", "!=", 0]],
            [...CLIENT_FIELDS, "partner_latitude", "partner_longitude"], 500);
          const withDist = rows
            .map((r: any) => ({ ...r, _distKm: haversineKm(latitude, longitude, r.partner_latitude, r.partner_longitude) }))
            .filter((r: any) => r._distKm <= LOC_RADIUS_KM)
            .sort((a: any, b: any) => a._distKm - b._distKm);
          if (!withDist.length) {
            setLocError(`Aucun client à moins de ${fmtDistance(LOC_RADIUS_KM)} de ta position`);
          }
          setNearby(withDist);
          setLocMode(true);
        } catch (e: any) {
          setLocError("Erreur de chargement des clients : " + e.message);
        }
        setLocLoading(false);
      },
      () => {
        setLocError("Position refusée ou indisponible — vérifie l'autorisation de localisation");
        setLocLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const displayed = q.length >= 2 ? results : (locMode ? nearby : []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: "linear-gradient(135deg, #0d9488, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 32 }}>👤</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.text }}>Choisir un client</div>
          <div style={{ fontSize: 14, color: C.muted, marginTop: 6 }}>Recherche par nom, référence ou ville</div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <div style={{ position: "relative" as const, flex: 1 }}>
            <svg style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input autoFocus value={q} onChange={e => setQ(e.target.value)}
              placeholder="Nom du client..."
              style={{ width: "100%", boxSizing: "border-box" as const, padding: "14px 14px 14px 44px", border: `1.5px solid ${C.border}`, borderRadius: 14, fontSize: 16, fontFamily: "inherit", background: C.white, color: C.text, boxShadow: C.shadowMd, outline: "none" }} />
          </div>
          <button
            onClick={() => locMode ? setLocMode(false) : enableLocation()}
            title="Proposer les clients les plus proches de ma position"
            disabled={locLoading}
            style={{ flexShrink: 0, width: 50, display: "flex", alignItems: "center", justifyContent: "center", background: locMode ? C.teal : C.white, border: `1.5px solid ${locMode ? C.teal : C.border}`, borderRadius: 14, cursor: locLoading ? "default" : "pointer", boxShadow: C.shadowMd, fontSize: 20 }}>
            {locLoading ? "…" : "📍"}
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
                  {c.city && <span>📍 {c.city}</span>}
                  {c.phone && <span>📞 {c.phone}</span>}
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
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HUB CLIENT — écran d'accueil une fois le client sélectionné
// ═══════════════════════════════════════════════════════════════════════════
function ClientHub({ client, hasDraft, onOrder, onHistory, onAppointment, onNote }: {
  client: any; hasDraft: boolean;
  onOrder: () => void; onHistory: () => void; onAppointment: () => void; onNote: () => void;
}) {
  const cards = [
    { key: "order", icon: "🛒", title: "Prise de commande", subtitle: hasDraft ? "Brouillon en attente" : "Nouveau devis", gradient: "linear-gradient(135deg, #0d9488, #0f766e)", badge: hasDraft, onClick: onOrder },
    { key: "history", icon: "🕓", title: "Historique", subtitle: "Commandes passées", gradient: "linear-gradient(135deg, #2563eb, #1d4ed8)", badge: false, onClick: onHistory },
    { key: "rdv", icon: "📅", title: "Prendre un RDV", subtitle: "Agenda Odoo", gradient: "linear-gradient(135deg, #7c3aed, #6d28d9)", badge: false, onClick: onAppointment },
    { key: "note", icon: "🗒️", title: "Note client", subtitle: "Compte rendu, vocal ou écrit", gradient: "linear-gradient(135deg, #ea580c, #c2410c)", badge: false, onClick: onNote },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center", padding: "48px 24px", overflowY: "auto" as const }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        {/* Carte identité client */}
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 36 }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: "linear-gradient(135deg, #0d9488, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 800, color: "#fff", flexShrink: 0, boxShadow: "0 8px 20px rgba(13,148,136,0.3)" }}>
            {client.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: C.text, lineHeight: 1.2 }}>{client.name}</div>
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 10, marginTop: 6 }}>
              {client.ref && <span style={{ fontSize: 12, color: C.muted }}>Réf: {client.ref}</span>}
              {client.city && <span style={{ fontSize: 12, color: C.muted }}>📍 {client.city}</span>}
              {client.phone && <span style={{ fontSize: 12, color: C.muted }}>📞 {client.phone}</span>}
            </div>
            {client.property_product_pricelist && (
              <div style={{ display: "inline-block", marginTop: 8, fontSize: 11, fontWeight: 700, color: C.teal, background: C.tealSoft, borderRadius: 8, padding: "3px 9px" }}>
                {client.property_product_pricelist[1]}
              </div>
            )}
          </div>
        </div>

        {/* Grille d'actions */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
          {cards.map(c => (
            <button key={c.key} onClick={c.onClick}
              style={{ position: "relative" as const, textAlign: "left" as const, padding: "22px 20px", borderRadius: 20, border: "none", background: c.gradient, color: "#fff", cursor: "pointer", fontFamily: "inherit", boxShadow: "0 10px 24px rgba(15,23,42,0.14)", transition: "transform 0.15s" }}>
              {c.badge && (
                <div style={{ position: "absolute" as const, top: 14, right: 14, width: 10, height: 10, borderRadius: "50%", background: "#fde047", boxShadow: "0 0 0 3px rgba(255,255,255,0.35)" }} />
              )}
              <div style={{ fontSize: 30, marginBottom: 14 }}>{c.icon}</div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{c.title}</div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 3 }}>{c.subtitle}</div>
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
      } catch (e: any) {
        setError(e.message || "Erreur de chargement");
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
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
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

  // URL vignette via proxy (chargée en lazy + cache navigateur 1h) — évite de charger 500 base64 d'un coup
  const imgUrl = (id: number) => `/api/odoo/image?odooUrl=${encodeURIComponent(session.config.url)}&id=${id}&s=${session.sessionId}`;

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
      } else {
        setFavProducts([]);
      }
      setFavLoaded(true);
    } catch (e: any) { onToast("Erreur favoris: " + e.message, "error"); }
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
    } catch {}
    setMeaLoading(false);
  };

  const applyMeaTemplate = async (template: any) => {
    setApplyingMea(template.id);
    try {
      // Utilise les IDs de lignes déjà chargés pour éviter le filtre sur order_template_id
      const lineIds: number[] = template.sale_order_template_line_ids || [];
      if (!lineIds.length) { onToast("Aucun produit dans cette offre", "error"); setApplyingMea(null); return; }
      const lines = await odoo.searchRead(session, "sale.order.template.line",
        [["id", "in", lineIds], ["product_id", "!=", false]],
        ["product_id", "product_uom_qty"],
        200);
      if (!lines.length) { onToast("Aucun produit dans cette offre", "error"); setApplyingMea(null); return; }

      const productIds = lines.map((l: any) => l.product_id[0]);
      const products = await odoo.searchRead(session, "product.product",
        [["id", "in", productIds]],
        ["id", "name", "default_code", "barcode", "lst_price", "product_tmpl_id", "virtual_available"],
        productIds.length);
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
      else return p; // pour la recherche, retourner sans stocker
    } catch {}
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

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>

      {/* ── Sidebar catégories par mots-clés ── */}
      <div style={{ width: 160, background: C.white, borderRight: `1px solid ${C.border}`, overflowY: "auto" as const, flexShrink: 0 }}>
        <div style={{ padding: "12px 10px 6px", fontSize: 10, fontWeight: 700, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.08em" }}>Gammes</div>

        {/* Tous */}
        <button onClick={() => setActiveCatId(null)}
          style={{ width: "100%", padding: "10px 10px", background: !activeCatId ? C.tealSoft : "transparent", border: "none", borderLeft: `3px solid ${!activeCatId ? C.teal : "transparent"}`, cursor: "pointer", textAlign: "left" as const, fontSize: 12, fontWeight: !activeCatId ? 700 : 400, color: !activeCatId ? C.tealDark : C.textSec, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 7 }}>
          <span>🏠</span> Tous
        </button>

        {/* Favoris du client */}
        <button onClick={() => { setActiveCatId(FAV_CAT_ID); loadFavorites(); }}
          style={{ width: "100%", padding: "10px 10px", background: activeCatId === FAV_CAT_ID ? C.orangeSoft : "transparent", border: "none", borderLeft: `3px solid ${activeCatId === FAV_CAT_ID ? C.orange : "transparent"}`, cursor: "pointer", textAlign: "left" as const, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, transition: "all 0.1s" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: activeCatId === FAV_CAT_ID ? 700 : 400, color: activeCatId === FAV_CAT_ID ? C.orange : C.textSec }}>
            <span>⭐</span> Favoris
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
              <span>🎁</span> MEA
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
                <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
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
              <div style={{ fontSize: 32, marginBottom: 10 }}>⭐</div>
              <div>{favProducts.length === 0 ? "Ce client n'a passé aucune commande sur les 12 derniers mois" : "Aucun favori en stock — désactive « Stock dispo » pour tout voir"}</div>
            </div>
          ) : loading && allProducts.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: C.muted }}>Chargement…</div>
          ) : !activeCatId && !isSearching && allProducts.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60%", flexDirection: "column" as const, gap: 12, color: C.muted }}>
              <div style={{ fontSize: 48 }}>📦</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Aucun produit en stock</div>
            </div>
          ) : displayedProducts.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: C.muted }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
              <div>Aucun résultat</div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
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
                      <div style={{ position: "absolute", fontSize: 32 }}>📦</div>
                      <img src={imgUrl(p.id)} alt="" loading="lazy" style={{ height: 72, objectFit: "contain", position: "relative" as const, zIndex: 1 }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                      <div style={{ position: "absolute", bottom: 4, right: 4, background: "rgba(255,255,255,0.85)", borderRadius: 6, width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.5"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
                      </div>
                      {isFree && <div style={{ position: "absolute", top: 5, right: 5, background: C.green, color: "#fff", fontSize: 9, fontWeight: 700, borderRadius: 5, padding: "2px 5px" }}>OFFERT</div>}
                      {qty > 0 && <div style={{ position: "absolute", top: 5, left: 5, background: C.teal, color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: 7, padding: "2px 7px" }}>{qty}</div>}
                    </div>
                    <div style={{ padding: "8px 10px 10px" }}>
                      <div style={{ fontSize: 9, color: C.muted, fontFamily: "monospace", marginBottom: 1 }}>{p.default_code}{p.barcode ? ` · ${p.barcode}` : ""}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: C.text, lineHeight: 1.3, height: 28, overflow: "hidden" }}>{p.name}</div>
                      {activeCatId === FAV_CAT_ID && p.totalQty != null && (
                        <div style={{ fontSize: 9, fontWeight: 700, color: C.orange, background: C.orangeSoft, borderRadius: 5, padding: "2px 5px", marginTop: 3, display: "inline-block" }}>
                          ⭐ {Math.round(p.totalQty)} commandé{Math.round(p.totalQty) > 1 ? "s" : ""} · {p.times} fois
                        </div>
                      )}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 5, marginBottom: 6 }}>
                        <div style={{ display: "flex", flexDirection: "column" as const, gap: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: hasDiscount ? C.green : C.tealDark }}>{clientPrice > 0 ? fmtPrice(clientPrice) : "—"}</span>
                          {hasDiscount && <span style={{ fontSize: 9, color: C.muted, textDecoration: "line-through" }}>{fmtPrice(p.lst_price)}</span>}
                        </div>
                        <span style={{ fontSize: 9, fontWeight: 600, color: stock > 0 ? C.green : C.red, background: stock > 0 ? C.greenSoft : C.redSoft, borderRadius: 5, padding: "2px 5px" }}>{stock > 0 ? stock : "Rupture"}</span>
                      </div>
                      <div style={{ display: "flex", background: qty > 0 ? C.tealSoft : C.bg, borderRadius: 8, overflow: "hidden", border: `1px solid ${qty > 0 ? C.tealMid : C.border}` }}>
                        <button onClick={() => onQtyChange(p, qty - 1, clientPrice)} style={{ flex: 1, padding: "7px 0", background: "transparent", border: "none", cursor: "pointer", fontSize: 17, fontWeight: 700, color: qty > 0 ? C.red : C.muted, lineHeight: 1 }}>−</button>
                        <span style={{ flex: 1, textAlign: "center" as const, fontSize: 14, fontWeight: 800, color: qty > 0 ? C.tealDark : C.muted, lineHeight: "30px" }}>{qty}</span>
                        <button onClick={() => onQtyChange(p, qty + 1, clientPrice)} style={{ flex: 1, padding: "7px 0", background: "transparent", border: "none", cursor: "pointer", fontSize: 17, fontWeight: 700, color: C.teal, lineHeight: 1 }}>+</button>
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
      <div style={{ width: 280, background: C.white, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column" as const, flexShrink: 0 }}>
        {/* Header panier */}
        <div style={{ padding: "12px 14px", background: "linear-gradient(135deg, #0d9488, #0f766e)", color: "#fff" }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>🛒 Panier — {client.name}</div>
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
            {cartCount} article{cartCount > 1 ? "s" : ""} · {fmtPrice(cartTotal)}
            {freeCount > 0 && <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.2)", borderRadius: 5, padding: "1px 6px" }}>+{freeCount} offerts</span>}
          </div>
        </div>

        {/* Liste articles */}
        <div style={{ flex: 1, overflowY: "auto" as const, padding: "10px 12px" }}>
          {cartItems.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 12px", color: C.muted }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🛒</div>
              <div style={{ fontSize: 12 }}>Ajoute des produits</div>
            </div>
          ) : (
            cartItems.map(item => (
              <div key={item.product.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "7px 8px", background: C.bg, borderRadius: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{item.product.name}</div>
                  <div style={{ fontSize: 10, color: C.muted }}>{fmtPrice(item.qty * item.unitPrice)}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  <button onClick={() => onQtyChange(item.product, item.qty - 1)} style={{ width: 22, height: 22, borderRadius: 5, background: C.redSoft, border: "none", cursor: "pointer", color: C.red, fontSize: 14, fontWeight: 700, lineHeight: 1 }}>−</button>
                  <span style={{ fontSize: 13, fontWeight: 800, color: C.text, minWidth: 18, textAlign: "center" as const }}>{item.qty}</span>
                  <button onClick={() => onQtyChange(item.product, item.qty + 1)} style={{ width: 22, height: 22, borderRadius: 5, background: C.tealSoft, border: "none", cursor: "pointer", color: C.teal, fontSize: 14, fontWeight: 700, lineHeight: 1 }}>+</button>
                </div>
              </div>
            ))
          )}

          {/* Articles gratuits */}
          {freeItems.length > 0 && (
            <div style={{ margin: "8px 0", padding: "8px 10px", background: C.greenSoft, border: `1px solid ${C.green}33`, borderRadius: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.green, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5 }}>🎁 BC Gratuit (séparé)</div>
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
              <div style={{ fontSize: 10, fontWeight: 700, color: C.orange, textTransform: "uppercase" as const, letterSpacing: "0.05em", marginBottom: 5 }}>🏷️ Remises appliquées</div>
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

          {/* Note */}
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note interne..."
            rows={2} style={{ width: "100%", boxSizing: "border-box" as const, marginTop: 6, padding: "7px 9px", border: `1px solid ${C.border}`, borderRadius: 9, fontSize: 11, fontFamily: "inherit", resize: "none" as const, background: C.bg }} />
        </div>

        {/* Footer total + valider */}
        <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: C.muted }}>Total HT indicatif</span>
            <span style={{ fontSize: 17, fontWeight: 800, color: C.tealDark }}>{fmtPrice(cartTotal)}</span>
          </div>
          <button onClick={onValidate} disabled={submitting || cartCount === 0}
            style={{ width: "100%", padding: "13px 0", background: cartCount === 0 ? C.border : submitting ? C.muted : "linear-gradient(135deg, #0d9488, #0f766e)", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: cartCount === 0 ? "default" : "pointer", fontFamily: "inherit", boxShadow: cartCount > 0 && !submitting ? "0 4px 12px rgba(13,148,136,0.35)" : "none", transition: "all 0.2s" }}>
            {submitting ? "Création…" : cartCount === 0 ? "Panier vide" : `Créer le devis${freeItems.length > 0 ? " + BC gratuit" : ""}`}
          </button>
          <div style={{ fontSize: 10, color: C.muted, textAlign: "center" as const, marginTop: 5 }}>Prix Odoo appliqués à la création</div>
        </div>
      </div>

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
                <img src={imgUrl(zoom.id)} alt="" style={{ maxHeight: 200, maxWidth: "90%", objectFit: "contain" }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
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
// ÉTAPE 3 — Confirmation
// ═══════════════════════════════════════════════════════════════════════════
function ConfirmStep({ cart, freeItems, total, client, note, setNote, onQtyChange, onBack, onSubmit, submitting }: {
  cart: Record<number, CartItem>; freeItems: FreeItem[]; total: number;
  client: any; note: string; setNote: (n: string) => void;
  onQtyChange: (p: any, q: number) => void;
  onBack: () => void; onSubmit: () => void; submitting: boolean;
}) {
  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
      {/* Liste articles */}
      <div style={{ flex: 1, overflowY: "auto" as const, padding: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 16 }}>Récapitulatif de la commande</div>

        {/* Articles commandés */}
        <div style={{ background: C.white, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.border}`, marginBottom: 16, boxShadow: C.shadow }}>
          <div style={{ padding: "12px 16px", background: C.teal, color: "#fff", fontSize: 12, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
            📦 Articles ({Object.values(cart).reduce((s, i) => s + i.qty, 0)} unités)
          </div>
          {Object.values(cart).map((item, i) => (
            <div key={item.product.id} style={{ padding: "12px 16px", borderBottom: i < Object.values(cart).length - 1 ? `1px solid ${C.border}` : undefined, display: "flex", alignItems: "center", gap: 12 }}>
              {item.product.image_128 && <img src={`data:image/png;base64,${item.product.image_128}`} alt="" style={{ width: 44, height: 44, objectFit: "contain", borderRadius: 8, background: C.bg, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{item.product.name}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{item.product.default_code} · {fmtPrice(item.unitPrice)} / unité</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div style={{ display: "flex", background: C.bg, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
                  <button onClick={() => onQtyChange(item.product, item.qty - 1)} style={{ padding: "5px 10px", background: "none", border: "none", cursor: "pointer", fontSize: 15, color: C.red, fontWeight: 700 }}>−</button>
                  <span style={{ padding: "5px 8px", fontSize: 14, fontWeight: 800, color: C.text }}>{item.qty}</span>
                  <button onClick={() => onQtyChange(item.product, item.qty + 1)} style={{ padding: "5px 10px", background: "none", border: "none", cursor: "pointer", fontSize: 15, color: C.teal, fontWeight: 700 }}>+</button>
                </div>
                <span style={{ fontSize: 14, fontWeight: 800, color: C.tealDark, minWidth: 70, textAlign: "right" as const }}>{fmtPrice(item.qty * item.unitPrice)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* BC gratuit */}
        {freeItems.length > 0 && (
          <div style={{ background: C.greenSoft, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.green}33`, marginBottom: 16 }}>
            <div style={{ padding: "12px 16px", background: C.green, color: "#fff", fontSize: 12, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
              🎁 BC Gratuit séparé (créé automatiquement)
            </div>
            {freeItems.map((fi, i) => (
              <div key={i} style={{ padding: "12px 16px", borderBottom: i < freeItems.length - 1 ? `1px solid ${C.green}22` : undefined, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.green }}>{fi.product.name}</div>
                  <div style={{ fontSize: 11, color: C.green, opacity: 0.8 }}>{fi.ruleName}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.green }}>{fi.qty} × 0,00 €</div>
              </div>
            ))}
          </div>
        )}

        {/* Note */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Note interne</div>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Informations complémentaires..."
            rows={3} style={{ width: "100%", boxSizing: "border-box" as const, padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 13, fontFamily: "inherit", resize: "none" as const, background: C.white }} />
        </div>
      </div>

      {/* Panneau latéral total */}
      <div style={{ width: 300, background: C.white, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column" as const, padding: 24, gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 4 }}>Client</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{client.name}</div>
          {client.property_product_pricelist && <div style={{ fontSize: 12, color: C.teal, marginTop: 2 }}>📋 {client.property_product_pricelist[1]}</div>}
        </div>

        <div style={{ border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: C.muted }}>Sous-total</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{fmtPrice(total)}</span>
          </div>
          {freeItems.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: C.green }}>🎁 Articles offerts</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: C.green }}>BC séparé</span>
            </div>
          )}
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Total HT</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: C.tealDark }}>{fmtPrice(total)}</span>
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 4, textAlign: "center" as const }}>Prix Odoo appliqués à la création</div>
        </div>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column" as const, gap: 10 }}>
          <button onClick={onSubmit} disabled={submitting}
            style={{ padding: "16px 0", background: submitting ? C.muted : "linear-gradient(135deg, #0d9488, #0f766e)", color: "#fff", border: "none", borderRadius: 14, fontSize: 16, fontWeight: 800, cursor: submitting ? "default" : "pointer", fontFamily: "inherit", boxShadow: submitting ? "none" : "0 4px 14px rgba(13,148,136,0.4)" }}>
            {submitting ? "Création en cours…" : `Créer le devis${freeItems.length > 0 ? " + BC gratuit" : ""}`}
          </button>
          <button onClick={onBack}
            style={{ padding: "12px 0", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 12, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
            ← Modifier le panier
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
