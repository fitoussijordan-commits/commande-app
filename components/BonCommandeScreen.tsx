"use client";
// Import d'un bon de commande client (PDF ou photo).
//
// 1. Le document est lu par /api/bon-commande (Claude) → lignes brutes
//    (EAN, référence, désignation, quantité, prix).
// 2. Chaque ligne est rapprochée du catalogue Odoo par recherche EXACTE sur
//    l'EAN (barcode) puis la référence (default_code). Aucune correspondance
//    « approchante » n'est faite automatiquement : une ligne sans code reconnu
//    reste à choisir à la main, pour qu'un produit ne soit jamais deviné.
// 3. Le commercial vérifie, corrige, puis les lignes retenues remplissent le
//    panier habituel — prix client, remises et validation restent ceux de la
//    prise de commande normale.
import { useState, useEffect, useRef } from "react";
import * as odoo from "@/lib/odoo";
import * as sync from "@/lib/sync";
import { apiUrl } from "@/lib/apiBase";
import { PriceItem, applyPricelist } from "@/lib/pricing";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  orange: "#ea580c", orangeSoft: "#fff7ed",
  green: "#16a34a", greenSoft: "#f0fdf4",
  red: "#dc2626", redSoft: "#fef2f2",
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)",
};

const PRODUCT_FIELDS = ["id", "name", "default_code", "barcode", "lst_price", "product_tmpl_id", "virtual_available"];
// Photo iPad : 3 à 6 Mo en JPEG. Réduite à 2000 px de côté, elle reste très
// lisible pour la lecture et passe sous la limite de taille des requêtes Vercel.
const MAX_IMAGE_SIDE = 2000;
const MAX_FILE_BYTES = 3_000_000;

interface LigneLue {
  ean: string; reference: string; designation: string;
  quantite: number; prix_unitaire_ht: number | null;
}
interface BonLu {
  client: { nom: string; ville: string };
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

const digits = (s: string) => (s || "").replace(/\D/g, "");

// Rapprochement exact avec le catalogue : EAN d'abord (le plus sûr), puis référence.
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
  return lignes.map((lue, i) => {
    const pe = byEan.get(digits(lue.ean));
    const pr = byRef.get((lue.reference || "").trim());
    const product = pe || pr || null;
    const qty = Math.max(0, Math.round(lue.quantite || 0));
    return {
      key: i, lue, product,
      matchedBy: pe ? "ean" : pr ? "reference" : null,
      qty, include: !!product && qty > 0,
      priceMode: "odoo", manualPrice: "",
    };
  });
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
    height: 32, padding: "0 12px", borderRadius: 16, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
    border: `1.5px solid ${active ? C.teal : C.border}`,
    background: active ? C.teal : C.white, color: active ? "#fff" : C.textSec,
  };
}

function fmtPrice(n: number) { return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n); }

export default function BonCommandeScreen({ session, client, priceItems, onApply, onToast }: {
  session: odoo.OdooSession;
  client: any;
  priceItems: PriceItem[];
  onApply: (lines: ImportedLine[], note: string) => void;
  onToast: (msg: string, type?: "success" | "error" | "info") => void;
}) {
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState<"" | "lecture" | "catalogue">("");
  const [error, setError] = useState("");
  const [bon, setBon] = useState<BonLu | null>(null);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [searchFor, setSearchFor] = useState<number | null>(null);

  const clientPrice = (p: any, qty: number) =>
    applyPricelist(p.lst_price || 0, p.id, p.product_tmpl_id?.[0] || 0, priceItems, Math.max(1, qty));

  const analyse = async (file: File) => {
    setError(""); setBon(null); setLignes([]); setFileName(file.name);
    setLoading("lecture");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 65_000);
    try {
      let payload: { data: string; mediaType: string };
      if (file.type === "application/pdf") {
        if (file.size > MAX_FILE_BYTES) throw new Error("PDF trop volumineux (3 Mo maximum)");
        payload = { data: await readAsBase64(file), mediaType: "application/pdf" };
      } else if (file.type.startsWith("image/")) {
        payload = await shrinkImage(file);
      } else {
        throw new Error("Choisis un PDF ou une photo");
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
  const total = retenues.reduce((s, l) => s + l.qty * linePrice(l), 0);
  const autreClient = bon?.client?.nom ? !sameClientHint(bon.client.nom, client.name) : false;

  const apply = () => {
    if (!retenues.length) return;
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

  return (
    <div style={{ flex: 1, overflowY: "auto" as const, padding: "24px 20px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>Importer un bon de commande</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4, marginBottom: 18 }}>
          PDF reçu par mail ou photo du bon papier. Les produits sont retrouvés par EAN ou référence ; tu vérifies avant d'ajouter au panier.
        </div>

        <label style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          padding: "18px 20px", borderRadius: 16, border: `2px dashed ${C.teal}`,
          background: C.tealSoft, color: C.tealDark, fontWeight: 700, fontSize: 15,
          cursor: loading ? "wait" : "pointer", opacity: loading ? 0.6 : 1,
        }}>
          <input type="file" accept="application/pdf,image/*" disabled={!!loading}
            style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void analyse(f); }} />
          {loading === "lecture" ? "Lecture du bon…" : loading === "catalogue" ? "Recherche des produits…" : fileName ? "Choisir un autre document" : "Choisir un PDF ou prendre une photo"}
        </label>
        {fileName && !loading && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{fileName}</div>}

        {error && (
          <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 12, background: C.redSoft, color: C.red, fontSize: 13, fontWeight: 600 }}>
            {error}
          </div>
        )}

        {bon && !loading && (
          <>
            <div style={{ marginTop: 20, padding: "14px 16px", borderRadius: 14, background: C.white, border: `1.5px solid ${C.border}`, boxShadow: C.shadow, fontSize: 13, color: C.textSec, lineHeight: 1.6 }}>
              <div><b>Émetteur :</b> {bon.client.nom || "—"}{bon.client.ville ? ` (${bon.client.ville})` : ""}</div>
              {bon.numero_commande && <div><b>N° de commande :</b> {bon.numero_commande}</div>}
              {bon.date_livraison && <div><b>Livraison souhaitée :</b> {fmtDay(bon.date_livraison)}</div>}
              {bon.commentaire && <div><b>Commentaire :</b> {bon.commentaire}</div>}
              {autreClient && (
                <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 10, background: C.orangeSoft, color: C.orange, fontWeight: 700 }}>
                  Ce bon semble venir de « {bon.client.nom} », pas de {client.name}. Vérifie le client avant de continuer.
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, margin: "16px 0 10px", fontSize: 12, fontWeight: 700 }}>
              <span style={{ padding: "4px 10px", borderRadius: 8, background: C.greenSoft, color: C.green }}>{lignes.length - nonTrouvees} trouvée{lignes.length - nonTrouvees > 1 ? "s" : ""}</span>
              {nonTrouvees > 0 && <span style={{ padding: "4px 10px", borderRadius: 8, background: C.orangeSoft, color: C.orange }}>{nonTrouvees} à choisir</span>}
              {avecEcart > 0 && <span style={{ padding: "4px 10px", borderRadius: 8, background: C.orangeSoft, color: C.orange }}>{avecEcart} écart{avecEcart > 1 ? "s" : ""} de prix</span>}
              {avecEcart > 0 && (
                <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button onClick={() => setAllPriceModes("bon")} style={chipBtn(false)}>Tout au prix du bon</button>
                  <button onClick={() => setAllPriceModes("odoo")} style={chipBtn(false)}>Tout au prix Odoo</button>
                </span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
              {lignes.map(l => {
                const prixClient = l.product ? clientPrice(l.product, l.qty) : null;
                const ecart = ecartPct(l);
                const manualInvalid = l.priceMode === "manuel" && manualValue(l) == null;
                return (
                  <div key={l.key} style={{
                    padding: "12px 14px", borderRadius: 14, background: C.white, boxShadow: C.shadow,
                    border: `1.5px solid ${l.product ? C.border : C.orange}`,
                    opacity: l.product && !l.include ? 0.55 : 1,
                  }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <input type="checkbox" checked={l.include} disabled={!l.product}
                        onChange={e => update(l.key, { include: e.target.checked })}
                        style={{ width: 22, height: 22, marginTop: 2, accentColor: C.teal, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: C.muted }}>
                          Sur le bon : {l.lue.designation}
                          {(l.lue.ean || l.lue.reference) && ` · ${[l.lue.ean, l.lue.reference].filter(Boolean).join(" / ")}`}
                        </div>
                        {l.product ? (
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginTop: 2 }}>
                            {l.product.name}
                            <span style={{ fontSize: 11, fontWeight: 600, color: l.matchedBy === "manuel" ? C.orange : C.green, marginLeft: 8 }}>
                              {l.matchedBy === "ean" ? "EAN ✓" : l.matchedBy === "reference" ? "Réf ✓" : "choisi à la main"}
                            </span>
                          </div>
                        ) : (
                          <div style={{ fontSize: 13, fontWeight: 700, color: C.orange, marginTop: 2 }}>Produit non trouvé dans le catalogue</div>
                        )}
                        {l.product && (
                          <div style={{ display: "flex", flexWrap: "wrap" as const, alignItems: "center", gap: 6, marginTop: 8 }}>
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
                                width: 100, height: 32, borderRadius: 16, padding: "0 12px", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                                border: `1.5px solid ${manualInvalid ? C.red : l.priceMode === "manuel" ? C.teal : C.border}`,
                                background: l.priceMode === "manuel" ? C.tealSoft : C.white, color: C.text,
                              }} />
                            {ecart != null && (
                              <span style={{ fontSize: 11, fontWeight: 700, color: C.orange }}>
                                bon {ecart > 0 ? "+" : ""}{ecart.toFixed(0)} % vs Odoo
                              </span>
                            )}
                          </div>
                        )}
                        <button onClick={() => setSearchFor(searchFor === l.key ? null : l.key)}
                          style={{ marginTop: 6, padding: 0, border: "none", background: "none", color: C.teal, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                          {l.product ? "Changer de produit" : "Choisir le produit"}
                        </button>
                        {searchFor === l.key && (
                          <ProductPicker session={session} initial={l.lue.designation}
                            onPick={p => { update(l.key, { product: p, matchedBy: "manuel", include: l.qty > 0 }); setSearchFor(null); }} />
                        )}
                      </div>
                      <input type="number" inputMode="numeric" min={0} value={l.qty}
                        onChange={e => update(l.key, { qty: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                        style={{ width: 64, height: 40, borderRadius: 10, border: `1.5px solid ${C.border}`, textAlign: "center" as const, fontSize: 16, fontWeight: 800, fontFamily: "inherit", flexShrink: 0 }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {lignes.length === 0 && (
              <div style={{ marginTop: 12, fontSize: 13, color: C.muted }}>Aucune ligne de produit trouvée sur ce document.</div>
            )}

            <button onClick={apply} disabled={!retenues.length}
              style={{
                width: "100%", marginTop: 20, padding: "16px 20px", borderRadius: 16, border: "none",
                background: retenues.length ? C.teal : C.border, color: "#fff",
                fontSize: 15, fontWeight: 800, cursor: retenues.length ? "pointer" : "default", fontFamily: "inherit",
              }}>
              Ajouter {retenues.length} ligne{retenues.length > 1 ? "s" : ""} au panier · {fmtPrice(total)} HT
            </button>
          </>
        )}
      </div>
    </div>
  );
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

  useEffect(() => {
    const words = q.trim().split(/\s+/).filter(w => w.length >= 2);
    if (!words.length) { setResults([]); return; }
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      let rows: any[] = [];
      try {
        // Un seul mot : il peut s'agir d'une référence ou d'un EAN.
        const codeClause: any[] = words.length === 1
          ? ["|", "|", ["default_code", "ilike", words[0]], ["barcode", "ilike", words[0]], ["name", "ilike", words[0]]]
          : words.map(w => ["name", "ilike", w]);
        try {
          rows = await odoo.searchRead(session, "product.product", [["sale_ok", "=", true], ...codeClause], PRODUCT_FIELDS, 10, "name");
          // Aucun résultat avec tous les mots : on relâche sur les deux premiers.
          if (!rows.length && words.length > 2) {
            rows = await odoo.searchRead(session, "product.product",
              [["sale_ok", "=", true], ...words.slice(0, 2).map(w => ["name", "ilike", w])], PRODUCT_FIELDS, 10, "name");
          }
        } catch (e) {
          if (!odoo.isNetworkError(e)) throw e;
          const lw = words.map(w => w.toLowerCase());
          rows = (await sync.getCachedProducts()).filter((p: any) => {
            const hay = `${p.name || ""} ${p.default_code || ""} ${p.barcode || ""}`.toLowerCase();
            return lw.every(w => hay.includes(w));
          }).slice(0, 10);
        }
      } catch { rows = []; }
      // Ignore une réponse arrivée après une frappe plus récente.
      if (id !== reqId.current) return;
      setResults(rows);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [q, session]);

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ position: "relative" as const }}>
        <input value={q} autoFocus onChange={e => setQ(e.target.value)}
          placeholder="Nom, référence ou EAN"
          style={{ width: "100%", boxSizing: "border-box" as const, height: 38, borderRadius: 10, border: `1.5px solid ${C.teal}`, padding: "0 36px 0 12px", fontSize: 14, fontFamily: "inherit" }} />
        {loading && <span style={{ position: "absolute" as const, right: 12, top: 10, fontSize: 12, color: C.muted }}>…</span>}
      </div>
      {!loading && q.trim().length >= 2 && results.length === 0 && (
        <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>Aucun produit trouvé.</div>
      )}
      {results.map(p => (
        <button key={p.id} onClick={() => onPick(p)}
          style={{ display: "block", width: "100%", textAlign: "left" as const, marginTop: 4, padding: "8px 10px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: C.text }}>
          {p.name} <span style={{ color: C.muted, fontSize: 11 }}>{[p.default_code, p.barcode].filter(Boolean).join(" · ")}</span>
        </button>
      ))}
    </div>
  );
}
