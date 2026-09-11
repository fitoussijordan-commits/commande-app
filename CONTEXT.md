# CONTEXT — à lire en premier

Ce fichier résume tout le projet pour qu'un nouvel assistant puisse reprendre
sans repartir de zéro. **Lis-le en entier avant d'agir.**

---

## Ce qu'est ce projet

App **Next.js 14 + Capacitor iOS** de prise de commande terrain pour les
commerciaux Dr. Hauschka. Connexion directe à **Odoo** via un proxy hébergé sur
Vercel. Objectif principal : **fonctionner hors ligne** (vraie app iPad native).

- Front : React (`"use client"`), une seule page (`app/page.tsx`).
- Backend : routes API Next dans `app/api/odoo/` (proxy Odoo + images).
- Natif : wrap **Capacitor** → app iOS installée sur iPad, ouverture offline.

---

## RÈGLES ABSOLUES

1. **Une seule base : `main`.** Une seule branche, une seule URL.
   `main` sert la **production** `https://commande-app-tan.vercel.app`, et c'est
   cette même URL qu'appelle l'app iPad (`NEXT_PUBLIC_API_BASE` dans `.env.local`).
   Un push sur `main` met donc à jour d'un coup ce que Jordan vérifie sur PC **et**
   le proxy Odoo utilisé par les iPad.
   *(Règles précédentes, caduques : « travailler sur `capacitor`, jamais `main` »,
   puis « garder les deux branches alignées ».)*

   ⚠️ **`capacitor` existe encore, le temps de la migration.** Les iPad déjà
   déployés ont l'ancienne URL de préview figée dans leur binaire — l'URL est
   injectée au moment du `build:ios`, pas au lancement. Tant qu'un iPad n'a pas
   été rebuildé sur la prod, il faut continuer à pousser `capacitor` aussi :
   ```bash
   git push origin main:main main:capacitor && git branch -f capacitor main
   ```
   Une fois **tous** les iPad à jour, supprimer la branche :
   ```bash
   git push origin --delete capacitor && git branch -d capacitor
   ```
2. **L'assistant fait tout jusqu'à Xcode.** Quand il tourne dans Claude Code sur le
   Mac de Jordan, il a git, le CLI `vercel`, `npm run build:ios` et
   `npx cap sync ios`. Il commite, pousse, vérifie le déploiement et prépare le
   projet iOS lui-même — inutile de lui demander de « fournir les commandes ».
   Seule limite réelle : **ouvrir Xcode et appuyer sur ▶** (GUI, signature,
   iPad branché). C'est la seule étape qui revient à Jordan.
   *(Ancienne règle, caduque : « l'assistant ne peut PAS pousser ni builder ».)*
3. **Toujours vérifier `npx tsc --noEmit` compile avant de proposer un déploiement.**

---

## Workflow de déploiement

**Côté assistant** (il enchaîne ça tout seul) :

```bash
cd ~/Downloads/wms-scanner/commande-app
rm -f .git/index.lock          # au cas où un verrou traîne
npx tsc --noEmit               # règle 3
git add -A && git commit -m "..."
git push origin main           # déploie la prod → vérifiable sur PC en ~30 s
```

Puis, **seulement quand il faut mettre l'iPad à jour** :

```bash
npm run build:ios                                        # export statique dans ./out
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx cap sync ios     # copie dans le projet iOS
```

**Côté Jordan**, une seule étape — ouvrir Xcode et lancer sur l'iPad :

```bash
npx cap open ios                # puis bouton ▶ Run
```

Deux rythmes distincts, et c'est voulu :

- **Vérifier sur PC** = un `git push origin main`, rien d'autre. Vercel redéploie
  `commande-app-tan.vercel.app` tout seul.
- **Mettre à jour l'iPad** = rebuild + cap sync + Run dans Xcode. Ce n'est **pas**
  automatique en natif : le front est embarqué dans le binaire. Les routes API,
  elles, sont appelées en direct sur Vercel — donc un correctif côté `app/api/`
  atteint les iPad dès le push, **sans** rebuild.

---

## Architecture offline (le cœur du projet)

Fichiers à lire pour comprendre :

- `lib/localdb.ts` — cache **IndexedDB** (produits, clients, prix, images, MEA,
  favoris/CA/historique par client) + **file de synchro** générique
  (commandes, notes, RDV). Contient une **auto-réparation** de la base si un store
  manque (bump de version). Incrémenter `DB_VERSION_WITH_IMAGES` à chaque nouveau store.
- `lib/sync.ts` — `preloadCatalog()` (téléchargement au bouton « Télécharger les
  données »), lectures cache (`getCachedProducts/Clients/Mea/...`), `flushQueue()`
  (rejeu de la file vers Odoo au retour réseau), préchargement des images.
- `lib/network.ts` — détection réseau fiable (`navigator.onLine` + ping proxy) + hook `useNetwork`.
- `lib/apiBase.ts` — `apiUrl()` : chemin relatif en web, URL absolue Vercel en natif
  (lit `NEXT_PUBLIC_API_BASE`).
- `lib/cors.ts` — en-têtes CORS sur le proxy (obligatoire : en natif l'app est sur
  `capacitor://localhost` et appelle Vercel en cross-origin).
- `components/OfflineBar.tsx` — barre d'état : réseau, bouton « Télécharger les
  données », compteur en attente, synchro auto au retour réseau.
- `components/OrderScreen.tsx` — écran principal (~2000 lignes). Contient tous les
  fallbacks offline (recherche client/produit, favoris, CA, historique, MEA).

**Principe des fallbacks** : chaque appel Odoo est dans un `try/catch`. En ligne →
Odoo + mise en cache. Hors ligne (catch) → lecture du cache local.

**Données par client** (favoris, CA, historique) : mises en cache **paresseusement**
quand Jordan ouvre la fiche client EN LIGNE. Donc un client jamais ouvert en ligne
n'aura pas ces données hors ligne. (Le catalogue/clients/MEA, eux, sont préchargés
en masse au bouton « Télécharger les données ».)

**Créations hors ligne** (commande, note client, RDV) → mises en file
(`enqueueOrder` / `enqueueAction`), rejouées vers Odoo au retour réseau via `flushQueue`.

---

## Pièges connus (déjà rencontrés — ne pas refaire)

- **`sequence` n'existe PAS** sur `product.pricelist.item` dans cet Odoo. Ne jamais
  trier une requête pricelist par `sequence` → ça fait planter toute la requête.
- **Proxy sur Vercel** : `.env.local` doit contenir
  `NEXT_PUBLIC_API_BASE=https://commande-app-tan.vercel.app` (URL de production).
  Sans ça, l'app native ne joint pas Odoo (« Load failed »). Cette valeur est figée
  dans le binaire **au moment du `build:ios`** — la changer impose un rebuild.
- **Protection Vercel Preview** : si on repasse un jour par une URL de préview, les
  déploiements de branche ont une auth Vercel qui bloque les requêtes externes
  (HTTP 401). À désactiver dans Vercel → Settings → Deployment Protection →
  Vercel Authentication → Disabled. Sans objet sur l'URL de production.
- **`cap sync` et le locale** : `npx cap sync ios` échoue au `pod install` avec
  `Unicode Normalization not appropriate for ASCII-8BIT` quand `LANG` n'est pas
  défini (cas d'un shell non interactif). Trompeur : la copie des assets web
  réussit quand même, seul `pod install` casse — on croit la synchro faite.
  Toujours préfixer : `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx cap sync ios`.
- **Ordre `.env.local` → `build:ios`** : l'URL d'API est figée dans `out/` au
  moment du build. Changer `.env.local` **après** un `build:ios` ne sert à rien —
  le `cap sync` qui suit recopie l'ancien bundle. Toujours rebuilder avant de
  synchroniser. Vérif rapide :
  `grep -rhoE "https://commande-app[a-zA-Z0-9.-]*" ios/App/App/public/ | sort -u`
- **CORS** : déjà géré dans `lib/cors.ts` + `OPTIONS` sur les routes. Ne pas casser.
- **Session Odoo** : gardée en localStorage, persiste (natif). Ne JAMAIS déconnecter
  sur une erreur réseau (sinon le commercial est bloqué hors ligne). Le bouton
  « Accueil » de l'écran de confirmation ne doit PAS déconnecter.
- **Login impossible hors ligne** : normal (Odoo vérifie le mot de passe). Le
  commercial se connecte au bureau, puis reste connecté.
- **Verrous git** : le sandbox laisse parfois un `.git/index.lock`. Faire `rm -f .git/index.lock`.

---

## État actuel (dernier commit : voir `git log`)

Fonctionne hors ligne : ouverture app, recherche clients/produits (+images),
MEA (liste + ajout au panier), favoris/CA/historique par client, création de
commandes/notes/RDV en file, synchro auto au retour réseau.

Icône app = logo Dr. Hauschka (`logo.png` → `ios/App/App/Assets.xcassets/AppIcon.appiconset/`).

Quick wins UX (juillet 2026) :
- **Toasts réellement affichés** (`app/page.tsx` — avant : `console.log`, aucun message visible).
- **Flèche retour ≠ déconnexion** : masquée sur l'écran racine ; bouton logout dédié
  avec `window.confirm` (rappel : impossible de se reconnecter hors ligne).
- Écran de confirmation : « Accueil » mène au planning (avant : doublon exact de
  « Nouvelle commande »).
- `ConfirmStep` supprimé (code mort, jamais rendu).
- **File de synchro visible** : badge « en attente/échec » cliquable dans OfflineBar →
  panneau détaillé (statut, `lastError` Odoo exact, tout réessayer, supprimer).
  Toast d'échec inclut désormais la vraie cause (`flushQueue` retourne `errors[]`).
- Fix : une commande bloquée en `syncing` (app tuée en plein envoi) est rejouée au
  flush suivant et compte dans le compteur (avant : invisible pour toujours).

Refonte graphique (juillet 2026) :
- **Pastille réseau dans la top bar** (remplace le bandeau OfflineBar permanent).
  Tap → panneau consolidé : réseau, données locales (téléchargement + progression),
  file d'envoi détaillée. `OfflineBar` est monté DANS la top bar d'OrderScreen.
- **Teal unique** : plus aucun violet ni dégradé (C.purple est un alias teal pour
  le panneau règles masqué). Cartes hub à plat (1 seule carte accentuée).
- **Icônes SVG** (`Icon` + `ICON_PATHS` dans OrderScreen) à la place des emojis du
  chrome. Les emojis des catégories (données utilisateur) sont conservés.
- **Tactile** : steppers produits 44 px, panier 36 px ; le CHIFFRE de quantité est
  tapable → pavé numérique `QtyPad` (presets +6/+12/+24, saisie directe).
- Bouton valider : affiche « Enregistrer hors ligne · envoi auto » quand offline
  (état via événements navigateur `navOnline`, léger, sans ping).
- Fix RDV hors ligne : `enrichCalendarEventValues` dans `lib/sync.ts` crée
  l'étiquette calendar.event.type au REJEU (l'automatisation Studio du client
  plante sinon en IndexError sur categ_ids[0]).

Passe fiabilité (juillet 2026) :
- **Erreur réseau ≠ erreur métier** : `lib/odoo.ts` classe désormais les erreurs
  (`isNetworkError`, `isSessionExpired`). Réseau/5xx/429 → rejouable (file) ;
  erreur Odoo (400) → définitive. `handleValidate` n'enfile plus une commande
  REFUSÉE par Odoo comme si c'était du hors-ligne (elle rééchouait en boucle) :
  toast avec la cause exacte, panier/brouillon conservés.
- **Fix doublon devis** : si le devis principal était créé mais le BC gratuit
  échouait, les DEUX payloads partaient en file → devis principal en double au
  rejeu. Désormais seul le BC gratuit est enfilé (label « BC gratuit — client »).
- **Prix hors ligne réparés** : `getCachedPricelistItems` n'était JAMAIS lu →
  prix catalogue hors ligne. `fetchPricelistItems` lit maintenant le cache en repli.
- **Tri des règles pricelist** : plus de « première règle du tableau gagne » ;
  tri par spécificité (variante > produit > catégorie > global) puis min_quantity
  décroissante. Dates de validité (`date_start`/`date_end`) respectées, avec repli
  si les champs n'existent pas sur l'instance. Limite 500 → 0 (grille complète).
- **Cache étiquette « Validé » non poisonné** : un échec (offline) ne fige plus
  `null` pour toute la session.
- **Session expirée visible** : événement `odoo:session-expired` → toast global
  dans `page.tsx` (1/min max), sans déconnecter (règle absolue).
- **ErrorBoundary** dans `page.tsx` : plus de page blanche définitive en cas de
  crash JS — écran de secours + bouton recharger (brouillons/file préservés).
- **Remises fidélité hors ligne** : préchargées à l'étape 5 de `preloadCatalog`
  (cache meta `loyaltyPrograms`), lues en repli par `getLoyaltyPrograms`.
- **Planning : fix « plusieurs clients ont ce code »** : `openEventClient` filtre
  d'abord `customer_rank > 0`, puis départage par nom exact du RDV, puis par
  l'unique fiche société (`is_company`, ajouté à CLIENT_FIELDS ici et dans sync).
  Toujours en correspondance stricte — jamais d'ouverture au hasard.
- Recherche client en ligne : la VILLE est cherchée (comme hors ligne et comme
  promis par le sous-titre). Stats client sans plafond 300. Suppression du double
  fetch pricelist dans `enterOrderMode`.

Restes possibles / idées non faites :
- Bouton « forcer rechargement complet des images » si les photos changent souvent.
- Distribution TestFlight (nécessite compte Apple Developer 99 €/an) pour équiper les
  commerciaux sans câble et sans expiration 7 jours.
- Découper `OrderScreen.tsx` (~2 500 lignes) en fichiers par écran.
- Ajouter l'étiquette « Validé » au REJEU des commandes enfilées hors ligne
  (aujourd'hui : payload figé sans tag si créé offline).
