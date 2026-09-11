# Module Périmés — spécification technique et fonctionnelle

Reprise de produits périmés avec décote et compensation par produits neufs.
Cible : `commande-app` (Next.js 14 + Capacitor iOS), branche `main`, Odoo online.

> **À lire avec `CONTEXT.md`.** Ce document suppose connues les règles absolues du
> projet (branche unique `main`, l'assistant ne builde pas l'app iOS,
> `npx tsc --noEmit` avant tout déploiement).

---

## 0. Corrections d'hypothèses avant de commencer

Trois points du cahier des charges initial ne correspondent pas à l'application
réelle. Les corriger maintenant évite de construire sur du faux.

### 0.1 Le stockage local n'est ni SQLite ni CoreData

L'app n'est pas native Swift : c'est du React embarqué dans une WebView Capacitor.
Le stockage local est **IndexedDB** (`lib/localdb.ts`), pas SQLite/CoreData.

Conséquences concrètes :

- Pas de SQL. Les « tables d'association » sont des blobs clé/valeur (`kvGet`/`kvSet`)
  ou des stores dédiés. Toute jointure se fait en JavaScript, en mémoire.
- Tout nouveau store impose d'incrémenter `DB_VERSION_WITH_IMAGES` (`lib/localdb.ts`)
  et de l'ajouter à `EXPECTED_STORES`, sinon l'auto-réparation de base ne le crée pas.
- Le quota WKWebView n'est pas illimité. Voir §6.1 sur le volume de la table des lots.

### 0.2 Le compte API technique est un risque de sécurité majeur en l'état

**C'est le point bloquant du projet.** Le proxy actuel (`app/api/odoo/proxy/route.ts`)
autorise `/web/dataset/call_kw`, c'est-à-dire **n'importe quel modèle et n'importe
quelle méthode**. Aujourd'hui ce n'est pas dramatique : la requête est exécutée avec
le `session_id` du commercial, donc Odoo applique ses ACL. Le proxy est permissif,
mais Odoo borne les dégâts.

Introduire un compte technique administrateur côté serveur **supprime cette borne**.
Trois faits aggravants, tous vérifiables :

| Fait | Source | Conséquence |
|---|---|---|
| Le dépôt GitHub est **public** | métadonnée Vercel `githubRepoVisibility: "public"` | L'URL du proxy et la forme exacte du payload sont lisibles par tous |
| `ODOO_URL` **n'est pas défini** dans `.env.local` | fichier `.env.local` | L'allowlist SSRF (`proxy/route.ts:53`) est inactive ; seules les IP privées sont bloquées |
| La protection de déploiement Vercel est **désactivée** | `CONTEXT.md`, section Pièges connus | L'URL de preview répond à tout appelant anonyme |

Mis bout à bout : un `POST` anonyme sur le proxy, avec un `call_kw` arbitraire,
s'exécuterait en administrateur sur l'Odoo de production. Lecture de toute la base
clients, écriture comptable, suppression de données.

**Ne jamais faire :** placer les identifiants du compte technique dans le code
client, dans une variable `NEXT_PUBLIC_*`, ou les laisser accessibles via la route
`/api/odoo/proxy` générique.

**Architecture retenue :** une route dédiée `app/api/odoo/perimes/route.ts`, distincte
du proxy générique, qui applique le principe du moindre privilège. Détail en §4.

### 0.3 Il n'existe pas de transaction distribuée

Le cahier des charges décrit « deux flux » (vente + réception). La file de synchro
(`QueuedAction[]`, `lib/sync.ts:465`) rejoue les actions **en séquence depuis
l'index 0**, sans mémoriser lesquelles ont abouti.

Si la commande de compensation est créée puis que la réception échoue, le rejeu
recrée la commande → **doublon**. C'est exactement le bug « doublon devis » déjà
corrigé une fois sur ce projet (`CONTEXT.md`, passe fiabilité). Il reviendra sous
une forme plus grave ici, parce qu'il touche le stock et la compta.

La réponse est l'idempotence, pas la transaction. Voir §5.

---

## 1. Modèle de données

### 1.1 Côté Odoo — ce qui existe déjà

| Donnée | Emplacement | Remarque |
|---|---|---|
| Statut client | `res.partner.x_statut_client_id` → `x_statut_client` | Porte la typologie (Ambassadeur, Compagnon, Bio C'Bon…) |
| Périmés demandés | `res.partner.x_valeurs_perimes_demandes` (float) | Saisi **manuellement** par le service client aujourd'hui |
| Périmés accordés | `res.partner.x_valeurs_perimes_accordes` (float) | Idem |
| Type de gratuité | `sale.order.line.type_gratuit` (selection) | Chargé par `sync.loadFreeTypes()` |
| Tarif client | `res.partner.property_product_pricelist` | Ex. « Tarif 2026 17% (EUR) » |

### 1.2 Côté Odoo — ce qu'il faut créer (demande à Ninh)

**a) Barème de décote sur `x_statut_client`** — deux champs :

| Champ | Type | Exemple |
|---|---|---|
| `x_taux_reprise` | float | `0.8` pour Ambassadeur |
| `x_rsf` | float | `0.17` pour Ambassadeur |

Sans ça, le barème est codé en dur dans l'app, et chaque révision tarifaire impose
un rebuild Xcode + réinstallation sur chaque iPad. Deux champs Studio évitent ça
définitivement, et donnent une source unique partagée avec le service client.

> **Ambiguïté à lever avant le développement.** La colonne « décote » du tableau se
> lit comme un **coefficient de restitution** (Ambassadeur 0,8 = 80 % de la valeur
> rendue en budget), pas comme une remise. Lue littéralement comme une décote,
> 0,8 signifierait l'inverse. Et « Partenaire = 0 » voudrait dire *aucune reprise* —
> le module doit alors le dire explicitement, pas afficher « budget : 0,00 € ».
> Second point : le RSF s'applique-t-il à la valorisation N-1, aux produits de
> remplacement, ou aux deux ? Sur une Rose à 32,5 %, l'écart atteint un tiers du
> budget. Enfin, Elsie Compagnon (0,8 / 13 %) diverge de Compagnon (0,7 / 13 %) :
> volontaire ou coquille ?

**b) Modèle de reprise** — c'est ce qui manque vraiment. Sans lui, aucun détail
produit n'est conservé et les deux flottants de la fiche client restent des
compteurs aveugles.

```
x_reprise_perime            (en-tête)
  partner_id        many2one  res.partner
  user_id           many2one  res.users        # le commercial
  date_reprise      date
  statut_client_id  many2one  x_statut_client  # figé à la date
  taux_reprise      float                      # figé à la date
  valeur_reprise    monetary                   # Σ lignes
  budget_accorde    monetary                   # valeur × taux
  sale_order_id     many2one  sale.order       # commande de compensation
  picking_id        many2one  stock.picking    # réception rebut
  local_ref         char      (indexé, unique) # clé d'idempotence
  state             selection draft/done

x_reprise_perime_line       (lignes)
  reprise_id        many2one  x_reprise_perime
  product_id        many2one  product.product
  lot_name          char
  quantity          float
  prix_origine      monetary                   # net facturé retrouvé
  prix_source       selection facture/tarif_n1/derogation
  valeur_ligne      monetary
```

Une fois ce modèle en place, `x_valeurs_perimes_demandes` et
`x_valeurs_perimes_accordes` deviennent des champs **calculés** (`compute` + `store`)
sommant les reprises de l'année. Trois bénéfices : plus de saisie manuelle, le total
par an et par client sort tout seul pour l'onglet historique, et surtout
**l'idempotence est préservée** — un rejeu ne double plus le compteur, contrairement
à un incrément fait depuis l'app.

**c) Emplacement racine `WH/Rebut`** — à créer une fois à la main, pas par l'API
(voir §3.3 sur les conséquences de valorisation).

**d) Valeur `perimes` dans la sélection `sale.order.line.type_gratuit`**, si absente.

> L'app ne codera pas la valeur technique en dur : elle la retrouvera par son
> libellé dans la sélection déjà chargée (`/p[ée]rim/i`), comme pour Coffre DC.

### 1.3 Côté iPad — nouveaux stores IndexedDB

```ts
// lib/localdb.ts — ajouter à STORES et EXPECTED_STORES,
// puis incrémenter DB_VERSION_WITH_IMAGES (4 → 5).
export const STORES = {
  // ... existant
  lotPrices: "lotPrices",   // keyPath "key" — clé `lp-${clientId}`
  scales:    "scales",      // keyPath "key" — barèmes de décote
} as const;
```

**Table des prix par lot** — clé `lp-${clientId}`, valeur :

```ts
interface LotPriceEntry {
  productId: number;
  lot: string;           // normalisé majuscules, sans espaces
  netUnit: number;       // prix unitaire NET facturé
  invoiceDate: string;   // "YYYY-MM-DD" — départage si plusieurs factures
  invoiceRef: string;    // pour l'écran de justification
}
type LotPriceCache = { fetchedAt: number; entries: LotPriceEntry[] };
```

**Mise en cache paresseuse, par client, jamais en masse.** Voir §6.1.

---

## 2. Retrouver le prix d'origine net

### 2.1 La bonne source

Le cahier des charges hésite entre `stock.move.line` et `account.move.line`.
Ce n'est pas équivalent :

- `stock.move.line` porte le **lot** mais aucun prix négocié.
- `account.move.line` porte le **prix net facturé** mais pas le lot.

Le lien entre les deux passe par `sale.order.line` :
`stock.move.line → move_id → sale_line_id ← sale.order.line → invoice_lines`.

### 2.2 Requêtes (2 appels, par client, en ligne)

**Appel 1 — mouvements sortants livrés portant un lot :**

```json
{
  "model": "stock.move.line",
  "method": "search_read",
  "args": [[
    ["picking_id.partner_id", "=", 4821],
    ["state", "=", "done"],
    ["lot_id", "!=", false],
    ["picking_code", "=", "outgoing"]
  ]],
  "kwargs": {
    "fields": ["product_id", "lot_id", "quantity", "move_id", "date"],
    "limit": 0,
    "context": { "lang": "fr_FR" }
  }
}
```

> **v16 / v17 :** le champ de quantité réalisée est `qty_done` en v16 et `quantity`
> en v17. Détecter la version au démarrage (§7.1) plutôt que de supposer.

**Appel 2 — prix net facturé des lignes de vente correspondantes :**

```json
{
  "model": "sale.order.line",
  "method": "search_read",
  "args": [["id", "in", [12001, 12002]]],
  "kwargs": {
    "fields": ["product_id", "price_unit", "discount", "order_id", "invoice_lines"],
    "limit": 0
  }
}
```

Prix net unitaire = `price_unit * (1 - discount / 100)`.

> Utiliser `sale.order.line` plutôt que `account.move.line` : la remise y est
> exploitable directement, et le rattachement au lot passe par `sale_line_id`
> qu'on a déjà. `account.move.line` obligerait à un troisième saut et gère mal
> les factures groupées.

### 2.3 Règles de résolution

```
resolvePrixOrigine(clientId, productId, lot) :
  candidats = cache[clientId].entries filtrés sur (productId, lot normalisé)

  si candidats non vide :
      → le plus récent par invoiceDate        source = "facture"

  sinon si tarif N-1 disponible :
      → applyPricelist(lst_price, ..., itemsN1, qty)   source = "tarif_n1"
      → marquer la ligne « prix estimé » dans l'UI

  sinon :
      → saisie manuelle par le commercial      source = "derogation"
      → la ligne part avec un drapeau de dérogation, visible en back-office
```

Normaliser le lot des deux côtés : `String(lot).trim().toUpperCase()`. Un lot saisi
`ab-123 ` ne doit pas rater `AB-123`.

### 2.4 Tarif N-1

Le client porte « Tarif 2026 17% (EUR) ». `fetchPricelistItems(session, pricelistId)`
(`OrderScreen.tsx:271`) accepte **déjà un ID de tarif quelconque** : charger le tarif
N-1 est un second appel à la même fonction, sans nouveau moteur de calcul. Le tri par
spécificité et les dates de validité sont déjà gérés.

Reste à identifier *quel* tarif est le N-1. Deviner par substitution d'année dans le
nom fonctionne jusqu'au jour où quelqu'un renomme un tarif — et le symptôme sera une
valeur de reprise silencieusement fausse, pas une erreur. **Deux options, à trancher
avec Ninh :** un champ `x_pricelist_precedent_id` sur `product.pricelist`, ou un
sélecteur dans l'UI avec le N-1 présélectionné et affiché en clair.

> **Piège connu :** ne jamais trier une requête `product.pricelist.item` par
> `sequence`, ce champ n'existe pas sur cette instance (`CONTEXT.md`).

---

## 3. Payloads Odoo

### 3.1 Arborescence d'emplacements

Cible : `WH / Rebut / 2026 / Caroline / 2026-03`.

**Résolution niveau par niveau, avec `search` avant `create` :**

```json
{
  "model": "stock.location",
  "method": "search_read",
  "args": [[["name", "=", "2026-03"], ["location_id", "=", 512]]],
  "kwargs": { "fields": ["id"], "limit": 1 }
}
```

Si vide, création :

```json
{
  "model": "stock.location",
  "method": "create",
  "args": [{
    "name": "2026-03",
    "location_id": 512,
    "usage": "internal",
    "company_id": 1
  }]
}
```

> **Course concurrente.** Deux iPad qui synchronisent la même minute peuvent passer
> le `search` tous les deux avant que l'un ait créé l'emplacement → doublon
> `2026-03` sous le même parent. Odoo n'a pas de contrainte d'unicité native sur
> `(name, location_id)`. Deux parades, à combiner : sérialiser la résolution
> d'arborescence côté route API (mutex en mémoire par chemin), et re-`search` après
> création en gardant le plus petit ID si un doublon apparaît. Demander à Ninh une
> contrainte SQL `unique(name, location_id, company_id)` sur la branche Rebut est
> la solution propre.

### 3.2 Réception (flux stock)

```json
{
  "model": "stock.picking",
  "method": "create",
  "args": [{
    "partner_id": 4821,
    "picking_type_id": 1,
    "location_id": 8,
    "location_dest_id": 984,
    "origin": "PERIM-LOCAL-1785142381-a3f9c2",
    "note": "Reprise périmés — PHARMACIE AZUR (75-002583) — DC : Caroline"
  }]
}
```

- `location_id` : emplacement client, lu sur `res.partner.property_stock_customer`,
  repli sur `stock.stock_location_customers`.
- `origin` : **porte le `localRef`** — c'est la clé d'idempotence (§5).

Puis les mouvements, puis la validation :

```json
{
  "model": "stock.move",
  "method": "create",
  "args": [{
    "name": "Crème de jour 30ml — lot AB-123",
    "product_id": 3310,
    "product_uom_qty": 4,
    "product_uom": 1,
    "picking_id": 77012,
    "location_id": 8,
    "location_dest_id": 984
  }]
}
```

> **v16 / v17 :** le champ one2many des mouvements sur `stock.picking` s'appelle
> `move_lines` en v16 et `move_ids` en v17. Créer les `stock.move` séparément avec
> `picking_id` évite entièrement ce piège — c'est la raison de ce découpage.

Séquence de validation, avec le lot :

```
1. callMethod("stock.picking", "action_confirm", [[pickingId]])
2. callMethod("stock.picking", "action_assign",  [[pickingId]])
3. write("stock.move.line", [mlId], { lot_name: "AB-123", quantity: 4 })
      # v16 : qty_done au lieu de quantity
4. callMethod("stock.picking", "button_validate", [[pickingId]])
```

`lot_name` (et non `lot_id`) laisse Odoo créer le lot s'il n'existe pas encore côté
entrepôt — cas fréquent pour un lot parti chez le client il y a deux ans.

> **v16 / v17 :** le modèle de lot a été renommé `stock.production.lot` → `stock.lot`
> en v17. Ne pas l'adresser directement ; passer par `lot_name` contourne le
> problème.

> `button_validate` peut renvoyer une **wizard action** (backorder, lots manquants)
> au lieu de valider. Traiter tout retour de type `dict` contenant `res_model` comme
> un échec explicite plutôt que comme un succès. Voir §7.3.

### 3.3 Choix de l'emplacement : point de vigilance comptable

`usage: "internal"` rend les produits périmés **visibles en stock et valorisés au
bilan**. Ce n'est presque certainement pas voulu pour des produits destinés à la
destruction.

Trois options, par ordre de préférence :

1. **Réception en `internal` sous `WH/Rebut`, puis `stock.scrap`.** Traçabilité
   complète (on sait ce qui est rentré, de qui, quand), puis sortie de la
   valorisation. C'est le schéma Odoo natif pour ce cas.
2. **Emplacement `usage: "inventory"`** (perte d'inventaire). Sort immédiatement de
   la valorisation, mais l'arborescence par commercial/mois y est moins naturelle.
3. **`internal` seul** — le plus simple, mais il faut alors exclure explicitement la
   branche Rebut des rapports de stock et de valorisation, et quelqu'un devra y
   penser à chaque nouveau rapport.

**À valider avec la comptabilité avant développement**, pas après.

### 3.4 Commande de compensation

Reprend le chemin `sale.order` existant, avec le type de gratuité résolu par libellé :

```json
{
  "model": "sale.order",
  "method": "create",
  "args": [{
    "partner_id": 4821,
    "pricelist_id": 22,
    "client_order_ref": "PERIM-LOCAL-1785142381-a3f9c2",
    "note": "Compensation périmés — valeur reprise 128,40 € — décote 0,8 — budget 102,72 €",
    "order_line": [
      [0, 0, {
        "product_id": 3311,
        "product_uom_qty": 6,
        "price_unit": 17.12,
        "discount": 100,
        "type_gratuit": "perimes"
      }]
    ]
  }]
}
```

`client_order_ref` porte le même `localRef` que le `origin` du picking : les deux
objets sont ainsi rattachables entre eux et déduplicables indépendamment.

---

## 4. Route API dédiée et privilèges

### 4.1 Principe

Le commercial n'a pas les droits stock. Deux opérations seulement nécessitent une
élévation : **créer un emplacement** et **valider une réception**. Tout le reste
(lecture catalogue, lecture factures, création du `sale.order`) passe par sa propre
session, avec ses ACL — et doit continuer à le faire.

`app/api/odoo/perimes/route.ts`, distincte du proxy générique :

```
POST /api/odoo/perimes
Body : {
  sessionId,            // session du COMMERCIAL, pour l'identifier
  odooUrl,
  localRef,             // clé d'idempotence
  partnerId,
  salesRepName,         // pour l'arborescence
  lines: [ { productId, lot, qty, netUnit } ],
  compensation: { pricelistId, lines: [...] }
}
```

Étapes serveur, dans l'ordre :

1. **Authentifier le commercial** — `/web/session/get_session_info` avec son
   `sessionId`. Échec → 401. C'est ce qui empêche un appel anonyme.
2. **Valider le payload** — typage strict, bornes sur les quantités, `partnerId`
   entier, `lot` sur une liste de caractères autorisés. Aucun nom de modèle ni de
   méthode ne transite depuis le client.
3. **Vérifier que ce commercial a accès à ce client** — `search_count` sur
   `res.partner` avec **sa** session. Sinon un commercial peut créer des reprises
   sur le portefeuille d'un collègue.
4. **Court-circuit d'idempotence** — chercher un `stock.picking` dont `origin` vaut
   `localRef`. S'il existe, renvoyer son ID sans rien créer.
5. **Élever** — authentifier le compte technique (env serveur), résoudre
   l'arborescence, créer et valider le picking.
6. **Journaliser** — `localRef`, commercial, client, montants.

### 4.2 Variables d'environnement

```bash
# Vercel → Settings → Environment Variables (JAMAIS de préfixe NEXT_PUBLIC_)
ODOO_TECH_LOGIN=api.perimes@drhauschka.fr
ODOO_TECH_PASSWORD=...            # idéalement une clé API Odoo, pas un mot de passe
ODOO_URL=https://wala-prod.odoo.com   # actuellement ABSENT — à définir (§0.2)
```

Le compte technique doit être **le plus étroit possible** : droits stock, pas
administrateur général. Un groupe Odoo dédié (`Stock / Utilisateur` + droit de
création d'emplacement) suffit ; « Paramètres » n'est pas nécessaire.

### 4.3 Verrous complémentaires

- Définir `ODOO_URL` réactive l'allowlist SSRF déjà codée (`proxy/route.ts:53`),
  aujourd'hui inerte.
- Réactiver la protection de déploiement Vercel sur les preview, ou au minimum
  exiger un en-tête partagé sur `/api/odoo/perimes`.
- Limiter le débit plus sévèrement que le proxy générique : `checkRateLimit` existe
  déjà (`lib/rateLimiter.ts`), viser ~20 req/min par IP sur cette route.
- Conserver `withCors` / `preflight` (`lib/cors.ts`) : en natif l'app appelle depuis
  `capacitor://localhost`, donc en cross-origin.

---

## 5. Idempotence — le cœur de la fiabilité

### 5.1 Le problème

`flushQueue` rejoue `actions[]` **depuis l'index 0** (`lib/sync.ts:465`). Un échec à
la troisième action relance les deux premières au flush suivant. Sur une reprise,
cela signifie : commande de compensation en double, ou réception en double, ou les
deux. Le stock et la compta divergent, et personne ne s'en aperçoit avant l'inventaire.

### 5.2 La réponse

**Une clé unique par reprise, écrite dans Odoo, vérifiée avant chaque création.**

```
localRef = `PERIM-${Date.now()}-${random36(6)}`   # généré à la saisie, jamais régénéré
```

- `stock.picking.origin` = `localRef`
- `sale.order.client_order_ref` = `localRef`
- `x_reprise_perime.local_ref` = `localRef` (champ indexé)

Avant toute création, `search_count` sur la clé. Si > 0, on saute. Le rejeu devient
sûr par construction, sans transaction distribuée.

### 5.3 Amélioration à porter sur la file existante

Ajouter un curseur de progression à `QueuedOrder` :

```ts
export interface QueuedOrder {
  // ... existant
  doneUpTo?: number;      // index de la dernière action confirmée
  actionResults?: number[]; // ids Odoo obtenus, pour les actions dépendantes
}
```

`flushQueue` reprend alors à `doneUpTo + 1`. Bénéfice au-delà des périmés : les RDV
et notes déjà en file en profitent aussi.

> Ce n'est pas une optimisation. Sans curseur **ou** sans clé d'idempotence, le
> doublon est certain à la première coupure réseau en plein envoi — situation
> normale en visite client.

---

## 6. Workflow iPad (pseudo-code)

### 6.1 Préchargement — ce qui est réaliste

Précharger `[Client × Produit × Lot → prix net]` pour **tous** les clients est
irréaliste. Ordre de grandeur : ~460 produits, plusieurs milliers de clients,
plusieurs lots par couple, plusieurs années d'historique — on parle de centaines de
milliers d'entrées dans une WebView.

**Stratégie : cache paresseux par client**, exactement le motif déjà utilisé pour
les favoris, le CA et l'historique (`sync.cacheClientData`).

```
onOuvertureFicheClient(client) :
    si en ligne :
        entries = chargerPrixParLot(client.id)      # §2.2, 2 appels
        kvSet(STORES.lotPrices, `lp-${client.id}`, { fetchedAt: now, entries })
    # hors ligne : on lit ce qui a été mis en cache lors d'une visite précédente
```

Le barème de décote, lui, est petit et global → préchargé en masse dans
`preloadCatalog()`, comme les types de gratuité.

**Limite à assumer et à afficher :** un client jamais ouvert en ligne n'aura pas ses
prix par lot hors ligne. Le module doit alors basculer sur le tarif N-1 en indiquant
clairement « prix estimé », plutôt que d'échouer. C'est la même limite que celle
déjà documentée pour les favoris et le CA dans `CONTEXT.md`.

### 6.2 Saisie et calcul

```
ÉTAPE 1 — Reprise
─────────────────
pour chaque produit périmé saisi ou scanné :
    lot ← saisie OBLIGATOIRE (bloquer la validation si vide)
    lotNorm ← trim + uppercase

    { prix, source } ← resolvePrixOrigine(client.id, produit.id, lotNorm)   # §2.3

    si source ≠ "facture" :
        afficher un bandeau « prix estimé — tarif N-1 » sur la ligne

    valeurLigne ← prix × qty × (1 − RSF)        # ← §1.2, à confirmer
    ajouter à reprises[]

valeurReprise ← Σ valeurLigne

ÉTAPE 2 — Budget
────────────────
statut ← client.x_statut_client_id
taux   ← bareme[statut].x_taux_reprise

si taux == 0 :
    afficher « Le statut <statut> ne donne pas droit à reprise »   # pas « 0,00 € »
    STOP

budget ← valeurReprise × taux

ÉTAPE 3 — Compensation
──────────────────────
tant que le commercial ajoute des produits :
    prixNeuf ← applyPricelist(lst_price, ..., itemsAnneeEnCours, qty)
    consommé ← Σ (prixNeuf × qty)
    restant  ← budget − consommé
    afficher restant en vert, orange sous 10 %, rouge si négatif

    # Ne PAS bloquer à budget dépassé : afficher un avertissement.
    # Même logique que le stock insuffisant — un devis n'est pas une expédition,
    # et le back-office arbitre.

ÉTAPE 4 — Validation
────────────────────
localRef ← `PERIM-${now}-${rand}`                # généré UNE fois

si en ligne :
    POST /api/odoo/perimes { ... localRef ... }
    si succès      → écran de confirmation
    si erreur RÉSEAU (odoo.isNetworkError) → mise en file
    si erreur MÉTIER (400 Odoo)            → toast avec la cause exacte,
                                             saisie CONSERVÉE, pas de mise en file
sinon :
    enqueueAction({ kind: "perime", label: `Périmés — ${client.name}`, ... })
```

> La distinction erreur réseau / erreur métier est déjà implémentée
> (`odoo.isNetworkError`, `odoo.isSessionExpired`). La respecter est indispensable :
> enfiler une reprise **refusée** par Odoo la ferait rééchouer en boucle, bug déjà
> rencontré et corrigé sur les commandes.

### 6.3 Rejeu hors ligne

Le rejeu doit passer par la **même route** `/api/odoo/perimes`, pas par des
`QueuedAction` brutes : la création d'emplacement et la validation de picking
exigent le compte technique. Prévoir un `kind: "perime"` dont `flushQueue` sait
qu'il appelle une route dédiée plutôt que `odoo.create`.

---

## 7. Points de vigilance

### 7.1 Version Odoo

Trois différences v16/v17 touchent directement ce module :

| Sujet | v16 | v17 |
|---|---|---|
| Quantité réalisée | `qty_done` | `quantity` |
| Mouvements du picking | `move_lines` | `move_ids` |
| Modèle de lot | `stock.production.lot` | `stock.lot` |

Détecter la version une fois au démarrage (`ir.module.module` ou
`/web/webclient/version_info`), la mettre en cache, et adapter. Ne pas supposer.

### 7.2 Performances

- Les deux requêtes de prix par lot sont non bornées (`limit: 0`) sur un gros client.
  Mettre une limite haute (5 000) et un garde-fou d'affichage.
- Le cache par lot doit expirer : `fetchedAt` plus vieux que 30 jours → rechargement
  silencieux à la prochaine ouverture en ligne.
- Prévoir un bouton de purge : `lotPrices` peut grossir sur un iPad qui a vu
  plusieurs centaines de clients en un an.

### 7.3 Erreurs API

- `button_validate` renvoyant un `dict` avec `res_model` = wizard, **pas** un succès.
  Le traiter comme un échec métier et remonter le message.
- Créer le picking **avant** le `sale.order` : si le stock échoue, aucune commande
  fantôme n'a été créée. L'inverse laisse une commande sans reprise.
- Journaliser `localRef` dans chaque message d'erreur : sans lui, une reprise en
  échec est introuvable en support.
- `lastError` est déjà affiché dans le panneau de file (`OfflineBar`) — y faire
  remonter la cause Odoo exacte, comme pour les commandes.

### 7.4 Sécurité — récapitulatif

| Risque | Parade |
|---|---|
| Compte technique exposé via le proxy générique | Route dédiée, payload typé, aucun `model`/`method` client |
| Appel anonyme | Vérification de la session du commercial avant élévation |
| Reprise sur le client d'un collègue | `search_count` sur `res.partner` avec la session du commercial |
| SSRF | Définir `ODOO_URL` (actuellement absent) |
| URL de preview publique | Réactiver la protection Vercel ou en-tête partagé |
| Rejeu / doublon | `localRef` + `search_count` avant création |
| Privilèges excessifs | Groupe Odoo stock dédié, pas administrateur |

---

## 8. Feuille de route

| Lot | Contenu | Dépendances |
|---|---|---|
| **0** | Décisions métier : sens de la décote, portée du RSF, Elsie Compagnon, usage de l'emplacement rebut | Expéditeur du mail + comptabilité |
| **1** | Champs Odoo : `x_taux_reprise`/`x_rsf`, modèle `x_reprise_perime`, valeur `perimes`, racine `WH/Rebut` | Ninh |
| **2** | Écran de saisie + calcul de budget, barème dans un fichier de config isolé, tarif N-1 choisi manuellement | Aucune — **démarrable tout de suite** |
| **3** | Résolution du prix par lot + cache paresseux par client | Lot 2 |
| **4** | Route `/api/odoo/perimes`, compte technique, arborescence, picking | Lot 1 + accès Vercel |
| **5** | Idempotence : `localRef`, curseur `doneUpTo` sur la file | Lot 4 |
| **6** | Onglet historique : total périmés par an et par client | Lot 1 |

Le **lot 2 ne dépend d'aucune réponse en attente**. Il produit un écran présentable
et testable, sur lequel les vraies sources se branchent ensuite sans réécriture.

---

## 9. Questions ouvertes

**Métier** — Sens exact de la colonne « décote » (coefficient de restitution ou
remise) ? Portée du RSF (valorisation N-1, remplacement, les deux) ? Elsie Compagnon
0,8 / 13 % : volontaire ? Que faire quand le budget est dépassé — bloquer ou avertir ?
Les produits périmés doivent-ils sortir de la valorisation (§3.3) ?

**Technique (Ninh)** — Version Odoo exacte ? Un tarif peut-il pointer vers celui de
l'année précédente ? Contrainte d'unicité possible sur `stock.location(name,
location_id)` ? Le compte technique peut-il être limité au groupe stock ? Peut-on
créer `x_reprise_perime` en Studio, ou faut-il un module ?

**Produit** — Que fait le module si le commercial n'a jamais ouvert ce client en
ligne (pas de prix par lot en cache) : tarif N-1 estimé, ou refus de saisie ?
