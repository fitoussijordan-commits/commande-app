"use client";
import { useState, useEffect } from "react";
import * as odoo from "@/lib/odoo";
import * as sync from "@/lib/sync";
import * as perimes from "@/lib/perimes";

const C = {
  bg: "#f8fafc", white: "#fff", text: "#0f172a", textSec: "#334155",
  muted: "#94a3b8", border: "#e2e8f0",
  teal: "#0d9488", tealDark: "#0f766e", tealSoft: "#f0fdfa", tealMid: "#ccfbf1",
  orange: "#ea580c", orangeSoft: "#fff7ed",
  green: "#16a34a", greenSoft: "#f0fdf4",
  red: "#dc2626", redSoft: "#fef2f2",
  shadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)",
  shadowMd: "0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.05)",
};

const fmt = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

type Mode = "return" | "exchange";

export default function PerimeScreen({ session, client, priceItems, freeTypes, onToast, onDone }: {
  session: odoo.OdooSession;
  client: any;
  priceItems: any[];
  freeTypes: sync.FreeType[];
  onToast: (m: string, t?: "success" | "error" | "info") => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>("return");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [returns, setReturns] = useState<perimes.PerimeLine[]>([]);
  const [exchanges, setExchanges] = useState<perimes.ExchangeLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lotLoading, setLotLoading] = useState<number | null>(null);
  const [lotHits, setLotHits] = useState<perimes.LotHit[]>([]);
  // "" = rien à dire. Sinon message explicite : lot inconnu, jamais livré ici,
  // ou refus Odoo. Ne JAMAIS avaler l'erreur en silence — sans ça, impossible de
  // distinguer « pas de résultat » de « la requête a planté ».
  const [lotNote, setLotNote] = useState("");
  const [lastResult, setLastResult] = useState<{ orderName: string; pickingName: string | null; stockError: string } | null>(null);
  const [recent, setRecent] = useState<any[]>([]);

  // « Où est passé mon BC ? » — on liste les reprises déjà créées pour ce client
  // en cherchant la référence PERIM- portée par le bon de commande.
  const loadRecent = () => {
    perimes.recentReprises(session, client.id).then(setRecent).catch(() => setRecent([]));
  };
  useEffect(() => { loadRecent(); }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const bareme = perimes.baremeFor(client);
  const statut = perimes.statutLabel(client);
  const sansReprise = bareme.taux === 0;

  // Type de gratuité « périmés » retrouvé par son libellé — jamais codé en dur,
  // la valeur technique diffère d'une instance à l'autre.
  const perimeType = freeTypes.find(t => /p[ée]rim/i.test(t.label))?.value;

  const repName = session.name || "Commercial";
  const locationLabel = perimes.rebutLocationName(repName);

  const search = async (text: string) => {
    setQ(text);
    if (text.trim().length < 2) { setResults([]); setLotHits([]); setLotNote(""); return; }
    setSearching(true);
    // En mode reprise, on cherche en parallèle par n° de lot livré à ce client :
    // le commercial lit le lot sur le pot, pas la référence produit.
    if (mode === "return") {
      setLotNote("");
      perimes.searchDeliveredLots(session, client.id, text.trim())
        .then(async hits => {
          setLotHits(hits);
          if (hits.length) return;
          // Aucun lot livré à ce client : ce lot existe-t-il seulement ?
          try {
            // Dire OÙ le lot est parti est bien plus utile que « pas trouvé ».
            const dest = await perimes.findLotRecipients(session, text.trim());
            if (dest.length) {
              setLotNote(`Ce lot a été livré à : ${dest.join(", ")}. Sélectionne cette fiche client pour le reprendre.`);
            } else {
              const exists = await perimes.lotExistsAnywhere(session, text.trim());
              setLotNote(exists
                ? "Ce lot existe dans Odoo mais n'apparaît sur aucune livraison validée."
                : "Aucun lot ne correspond dans Odoo.");
            }
          } catch { setLotNote("Aucun lot livré à ce client ne correspond."); }
        })
        .catch(e => {
          setLotHits([]);
          setLotNote(odoo.isNetworkError(e)
            ? "Recherche par lot indisponible hors ligne."
            : `Recherche par lot refusée par Odoo : ${e?.message || "erreur inconnue"}`);
        });
    } else { setLotHits([]); setLotNote(""); }
    try {
      const r = await odoo.searchRead(session, "product.product",
        ["&", ["sale_ok", "=", true], "|",
          ["name", "ilike", text.trim()], ["default_code", "ilike", text.trim()]],
        ["id", "name", "default_code", "lst_price", "product_tmpl_id"], 30, "name");
      setResults(r);
    } catch {
      try { setResults(await sync.searchCachedProducts(text.trim(), 30)); }
      catch { setResults([]); }
    }
    setSearching(false);
  };

  // Le lot saisi déclenche la recherche du prix réellement payé par le client.
  // Tant qu'aucun lot n'est renseigné, on affiche le prix catalogue en le
  // signalant comme estimé — jamais présenté comme un prix facturé.
  const lookupLot = async (index: number) => {
    const line = returns[index];
    if (!line || !line.lot) return;
    setLotLoading(line.product.id);
    try {
      const hit = await perimes.findPaidPriceByLot(session, client.id, line.product.id, line.lot);
      setReturns(prev => prev.map((x, j) => {
        if (j !== index) return x;
        if (!hit) return { ...x, source: "catalogue" as const, unitPrice: perimes.reprisePrice(x.basePrice, bareme, "catalogue") };
        return {
          ...x,
          basePrice: hit.netUnit,
          unitPrice: perimes.reprisePrice(hit.netUnit, bareme, "facture"),
          source: "facture" as const,
          invoiceDate: hit.date,
        };
      }));
      if (!hit) onToast("Ce lot n'a pas été livré à ce client — prix catalogue appliqué", "info");
    } catch {
      onToast("Recherche du prix indisponible (hors ligne) — prix catalogue conservé", "info");
    }
    setLotLoading(null);
  };

  // Ajout depuis un résultat lot : produit, lot et prix payé déjà connus.
  const addFromLot = (h: perimes.LotHit) => {
    const known = h.netUnit != null;
    const base = known ? h.netUnit! : (h.product.lst_price || 0);
    setReturns(prev => [...prev, {
      product: h.product, qty: 1, lot: h.lot,
      basePrice: base,
      unitPrice: perimes.reprisePrice(base, bareme, known ? "facture" : "catalogue"),
      source: known ? "facture" as const : "catalogue" as const,
      invoiceDate: known ? h.date : undefined,
    }]);
    setQ(""); setResults([]); setLotHits([]); setLotNote("");
  };

  const addProduct = (p: any) => {
    const price = p.lst_price || 0;
    if (mode === "return") {
      setReturns(prev => prev.some(l => l.product.id === p.id)
        ? prev.map(l => l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l)
        : [...prev, { product: p, qty: 1, basePrice: price,
            unitPrice: perimes.reprisePrice(price, bareme, "catalogue"), source: "catalogue" as const, lot: "" }]);
    } else {
      setExchanges(prev => prev.some(l => l.product.id === p.id)
        ? prev.map(l => l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l)
        : [...prev, { product: p, qty: 1, unitPrice: price }]);
    }
    setQ(""); setResults([]); setLotHits([]); setLotNote("");
  };

  const returnsTotal = perimes.returnsValue(returns);
  const exchangesTotal = perimes.exchangesValue(exchanges);
  const balance = returnsTotal - exchangesTotal;

  const validate = async () => {
    if (sansReprise) { onToast("Statut sans droit à reprise", "error"); return; }
    if (!returns.length) { onToast("Aucun produit périmé saisi", "error"); return; }
    setSubmitting(true);
    const localRef = perimes.newLocalRef();
    try {
      const payload = perimes.buildExchangeOrderPayload({
        clientId: client.id,
        pricelistId: client.property_product_pricelist?.[0] || false,
        returns, exchanges, repName, localRef,
        freeType: perimeType,
      });
      const orderId = await odoo.create(session, "sale.order", payload);

      // Le NUMÉRO du BC (S00123), pas son id technique : c'est lui qui sera lu
      // sur le transfert de rebut et dans l'entrepôt.
      let orderName = String(orderId);
      try {
        const rows = await odoo.searchRead(session, "sale.order", [["id", "=", orderId]], ["name"], 1);
        if (rows[0]?.name) orderName = rows[0].name;
      } catch {}

      // Mouvement de stock vers l'emplacement rebut du commercial. Sans droits
      // stock, Odoo refuse : on garde le BC et on le signale, plutôt que de
      // perdre toute la saisie.
      const loc = await perimes.resolveRebutLocation(session, repName);
      let picking: { id: number; name: string } | null = null;
      let stockError = "";
      if ("error" in loc) {
        stockError = loc.error;
      } else {
        const r = await perimes.createRebutPicking(session, {
          clientId: client.id, clientName: client.name, clientRef: client.ref,
          repName, locationId: loc.id, lines: returns, localRef, orderName,
        });
        if ("error" in r) stockError = r.error; else picking = r;
      }

      // Lien croisé : le BC doit aussi pointer vers le transfert, sinon la
      // traçabilité ne marche que dans un sens.
      if (picking) {
        try {
          await odoo.write(session, "sale.order", [orderId], {
            note: `${payload.note}\n\nTransfert de rebut : ${picking.name} → ${locationLabel}`,
          });
        } catch {}
      }

      // Le n° du BC reste affiché à l'écran : un toast disparaît, et il faut
      // pouvoir retrouver le document ensuite.
      setLastResult({ orderName, pickingName: picking?.name || null, stockError });
      setReturns([]); setExchanges([]);
      onToast(
        picking
          ? `BC ${orderName} + transfert ${picking.name}`
          : `BC ${orderName} créé — transfert rebut en échec`,
        picking ? "success" : "info",
      );
      loadRecent();
    } catch (e: any) {
      // Erreur réseau → la saisie reste à l'écran pour être rejouée.
      onToast(
        odoo.isNetworkError(e)
          ? "Réseau indisponible — saisie conservée, réessaie au retour du réseau"
          : `Refus Odoo : ${e?.message || "erreur inconnue"}`,
        "error",
      );
    }
    setSubmitting(false);
  };

  const lines = mode === "return" ? returns : exchanges;

  return (
    <div style={{ flex: 1, overflowY: "auto" as const, padding: "24px 20px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>{client.name}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: C.text, marginBottom: 2 }}>Retour périmés</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          Rebut : <strong style={{ color: C.textSec }}>{locationLabel}</strong>
          {statut && <> · Statut : <strong style={{ color: C.textSec }}>{statut}</strong> — reprise {Math.round(bareme.taux * 100)} %</>}
        </div>

        {/* Taux à 0 : soit Partenaire, soit un statut absent du barème. Dans les
            deux cas il faut le dire, pas afficher un budget de 0,00 €. */}
        {sansReprise && (
          <div style={{ background: C.redSoft, border: `1px solid ${C.red}44`, borderRadius: 12, padding: "11px 13px", marginBottom: 14, fontSize: 12.5, color: C.red, lineHeight: 1.5 }}>
            {statut
              ? <>Le statut <strong>{statut}</strong> ne donne pas droit à la reprise de périmés.</>
              : <>Aucun statut client renseigné dans Odoo — impossible de déterminer le taux de reprise.</>}
          </div>
        )}

        {/* Bascule reprise / échange */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14, background: C.bg, borderRadius: 12, padding: 4 }}>
          {([["return", `Périmés repris (${returns.length})`], ["exchange", `Échange (${exchanges.length})`]] as [Mode, string][]).map(([id, label]) => (
            <button key={id} onClick={() => { setMode(id); setQ(""); setResults([]); setLotHits([]); setLotNote(""); }}
              style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
                background: mode === id ? C.white : "transparent", color: mode === id ? C.tealDark : C.muted, boxShadow: mode === id ? C.shadow : "none" }}>
              {label}
            </button>
          ))}
        </div>

        {/* Recherche produit */}
        <input value={q} onChange={e => search(e.target.value)}
          placeholder={mode === "return" ? "N° de lot, nom ou référence produit…" : "Produit d'échange…"}
          style={{ width: "100%", boxSizing: "border-box" as const, padding: "12px 14px", border: `1.5px solid ${C.border}`, borderRadius: 12, fontSize: 15, fontFamily: "inherit", background: C.white, color: C.text, outline: "none", marginBottom: 8 }} />

        {searching && <div style={{ fontSize: 12, color: C.muted, padding: "4px 2px" }}>Recherche…</div>}

        {/* Résultat de la dernière création — reste affiché, contrairement au toast. */}
        {lastResult && (
          <div style={{ background: C.greenSoft, border: `1px solid ${C.green}55`, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.green, marginBottom: 4 }}>
              BC {lastResult.orderName} créé
            </div>
            <div style={{ fontSize: 11.5, color: C.textSec, lineHeight: 1.55 }}>
              C&apos;est un <strong>devis</strong> sur {client.name}. Dans Odoo : Ventes → Devis, ou cherche
              la référence <strong>{lastResult.orderName}</strong>.
            </div>
            {lastResult.pickingName ? (
              <div style={{ fontSize: 11.5, color: C.textSec, marginTop: 5 }}>
                Transfert de rebut <strong>{lastResult.pickingName}</strong> → {locationLabel}
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: C.red, marginTop: 5, lineHeight: 1.5 }}>
                Transfert de rebut NON créé. Erreur Odoo : {lastResult.stockError || "non renseignée"}
              </div>
            )}
            <button onClick={() => setLastResult(null)}
              style={{ marginTop: 8, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 11, fontWeight: 700, color: C.muted }}>
              Masquer
            </button>
          </div>
        )}

        {/* Reprises déjà enregistrées pour ce client */}
        {recent.length > 0 && returns.length === 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 5 }}>
              Reprises déjà créées pour ce client
            </div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
              {recent.map(o => (
                <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 9, fontSize: 12 }}>
                  <strong style={{ color: C.text }}>{o.name}</strong>
                  <span style={{ color: C.muted, fontSize: 11 }}>{String(o.date_order || "").slice(0, 10)}</span>
                  <span style={{ color: C.muted, fontSize: 11 }}>· {o.state === "draft" ? "Devis" : o.state === "sale" ? "Confirmé" : o.state}</span>
                  <span style={{ marginLeft: "auto", fontWeight: 700, color: o.amount_total < 0 ? C.orange : C.tealDark }}>{fmt(o.amount_total || 0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {lotNote && (
          <div style={{ background: C.orangeSoft, border: `1px solid ${C.orange}44`, borderRadius: 10, padding: "9px 12px", marginBottom: 10, fontSize: 12, color: C.orange, lineHeight: 1.45 }}>
            {lotNote}
          </div>
        )}

        {!searching && q.trim().length >= 2 && results.length === 0 && lotHits.length === 0 && !lotNote && (
          <div style={{ fontSize: 12, color: C.muted, padding: "6px 2px", marginBottom: 8 }}>
            Aucun produit ne correspond à « {q.trim()} ».
          </div>
        )}

        {lotHits.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.muted, textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 5 }}>
              Lots livrés à ce client
            </div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 5, maxHeight: 200, overflowY: "auto" as const }}>
              {lotHits.map(h => (
                <button key={`${h.product.id}-${h.lot}`} onClick={() => addFromLot(h)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: C.greenSoft, border: `1px solid ${C.green}44`, borderRadius: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{h.product.name}</div>
                    <div style={{ fontSize: 10.5, color: C.muted }}>
                      Lot <strong style={{ color: C.textSec }}>{h.lot}</strong> · livré le {h.date}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" as const, flexShrink: 0 }}>
                    {h.netUnit != null ? (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 800, color: C.green }}>{fmt(h.netUnit)}</div>
                        <div style={{ fontSize: 9.5, color: C.muted }}>payé</div>
                      </>
                    ) : (
                      <div style={{ fontSize: 10.5, color: C.orange, fontWeight: 700 }}>prix inconnu</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 5, marginBottom: 14, maxHeight: 220, overflowY: "auto" as const }}>
            {results.map(p => (
              <button key={p.id} onClick={() => addProduct(p)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "left" as const }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{p.name}</div>
                  <div style={{ fontSize: 10.5, color: C.muted, fontFamily: "monospace" }}>{p.default_code}</div>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.tealDark }}>{fmt(p.lst_price || 0)}</span>
              </button>
            ))}
          </div>
        )}

        {/* Lignes saisies */}
        {lines.length === 0 ? (
          <div style={{ textAlign: "center" as const, color: C.muted, padding: "28px 12px", fontSize: 13 }}>
            {mode === "return" ? "Aucun produit périmé saisi" : "Aucun produit d'échange"}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" as const, gap: 8, marginBottom: 16 }}>
            {lines.map((l, i) => (
              <div key={l.product.id} style={{ background: mode === "return" ? C.orangeSoft : C.greenSoft, border: `1px solid ${mode === "return" ? C.orange : C.green}33`, borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{l.product.name}</div>
                  <button onClick={() => mode === "return"
                    ? setReturns(p => p.filter((_, j) => j !== i))
                    : setExchanges(p => p.filter((_, j) => j !== i))}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, fontSize: 15, lineHeight: 1 }}>✕</button>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button onClick={() => mode === "return"
                      ? setReturns(p => p.map((x, j) => j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x))
                      : setExchanges(p => p.map((x, j) => j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}
                      style={{ width: 34, height: 34, borderRadius: 8, background: C.white, border: `1px solid ${C.border}`, cursor: "pointer", fontSize: 16, fontWeight: 700, color: C.red }}>−</button>
                    <span style={{ minWidth: 30, textAlign: "center" as const, fontSize: 14, fontWeight: 800, color: C.text }}>{l.qty}</span>
                    <button onClick={() => mode === "return"
                      ? setReturns(p => p.map((x, j) => j === i ? { ...x, qty: x.qty + 1 } : x))
                      : setExchanges(p => p.map((x, j) => j === i ? { ...x, qty: x.qty + 1 } : x))}
                      style={{ width: 34, height: 34, borderRadius: 8, background: C.white, border: `1px solid ${C.border}`, cursor: "pointer", fontSize: 16, fontWeight: 700, color: C.teal }}>+</button>
                  </div>

                  <input type="number" step="0.01" value={l.unitPrice}
                    onChange={e => {
                      const v = Number(e.target.value) || 0;
                      mode === "return"
                        ? setReturns(p => p.map((x, j) => j === i ? { ...x, unitPrice: v } : x))
                        : setExchanges(p => p.map((x, j) => j === i ? { ...x, unitPrice: v } : x));
                    }}
                    title="Prix unitaire"
                    style={{ width: 90, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: "inherit", color: C.text, outline: "none" }} />

                  {mode === "return" && (
                    <input value={(l as perimes.PerimeLine).lot || ""}
                      onChange={e => setReturns(p => p.map((x, j) => j === i ? { ...x, lot: e.target.value } : x))}
                      onBlur={() => lookupLot(i)}
                      placeholder="N° de lot"
                      style={{ flex: 1, minWidth: 90, padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, fontFamily: "inherit", color: C.text, outline: "none" }} />
                  )}

                  <span style={{ marginLeft: "auto", fontSize: 14, fontWeight: 800, color: mode === "return" ? C.orange : C.green }}>
                    {mode === "return" ? "−" : ""}{fmt(l.qty * l.unitPrice)}
                  </span>
                </div>

                {/* Provenance du prix : un prix estimé ne doit pas passer pour un prix facturé. */}
                {mode === "return" && (() => {
                  const r = l as perimes.PerimeLine;
                  if (lotLoading === r.product.id) {
                    return <div style={{ fontSize: 10.5, color: C.muted, marginTop: 6 }}>Recherche du prix payé…</div>;
                  }
                  const facture = r.source === "facture";
                  return (
                    <div style={{ fontSize: 10.5, marginTop: 6, color: facture ? C.green : C.orange, display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                      <span style={{ fontWeight: 700 }}>
                        {facture ? `Prix payé ${fmt(r.basePrice)}` : `Prix catalogue ${fmt(r.basePrice)} — estimé`}
                      </span>
                      {facture && r.invoiceDate && <span style={{ color: C.muted }}>livré le {r.invoiceDate}</span>}
                      <span style={{ color: C.muted }}>· reprise {Math.round(bareme.taux * 100)} %{!facture && bareme.rsf > 0 ? ` (RSF ${(bareme.rsf * 100).toFixed(2).replace(/\.?0+$/, "")} %)` : ""}</span>
                      {!facture && <span style={{ color: C.muted }}>· saisis le n° de lot pour le prix réel</span>}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}

        {/* Récap + validation */}
        <div style={{ background: "#0f172a", borderRadius: 16, padding: "14px 16px" }}>
          <Row label="Valeur des périmés repris" value={`−${fmt(returnsTotal)}`} color="#fb923c" />
          <Row label="Produits d'échange" value={fmt(exchangesTotal)} color="#5eead4" />
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", marginTop: 8, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Solde du BC</span>
            <span style={{ fontSize: 19, fontWeight: 800, color: balance >= 0 ? "#5eead4" : "#fb923c" }}>
              {fmt(-balance)}
            </span>
          </div>

          <button onClick={validate} disabled={submitting || returns.length === 0 || sansReprise}
            style={{ width: "100%", marginTop: 12, padding: "13px 0", borderRadius: 999, border: "none", fontSize: 14, fontWeight: 800, fontFamily: "inherit",
              background: (returns.length === 0 || sansReprise) ? "rgba(255,255,255,0.12)" : "#2dd4bf",
              color: (returns.length === 0 || sansReprise) ? "rgba(255,255,255,0.4)" : "#0f172a",
              cursor: (returns.length === 0 || sansReprise) ? "default" : "pointer" }}>
            {submitting ? "Création…"
              : sansReprise ? "Reprise non autorisée pour ce statut"
              : returns.length === 0 ? "Saisis un produit périmé"
              : "Créer le BC de retour →"}
          </button>
          {!perimeType && exchanges.length > 0 && (
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", textAlign: "center" as const, marginTop: 7 }}>
              Type de gratuité « périmés » absent d&apos;Odoo — lignes d&apos;échange créées sans type
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.55)" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}
