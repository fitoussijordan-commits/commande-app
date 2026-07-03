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

1. **Travailler sur la branche `capacitor`, JAMAIS `main`.**
   `main` = version web de démo qui ne doit pas bouger. Pousser vers `origin capacitor`.
2. **L'assistant ne peut PAS pousser ni builder lui-même** (pas d'accès GitHub/Xcode
   depuis son environnement). Il ÉCRIT les fichiers ; c'est **l'utilisateur (Jordan)**
   qui lance git/build/Run sur son Mac. Toujours lui fournir les commandes.
3. **Toujours vérifier `npx tsc --noEmit` compile avant de proposer un déploiement.**

---

## Workflow de déploiement (commandes pour Jordan, sur son Mac)

```bash
cd ~/Downloads/wms-scanner/commande-app
rm -f .git/index.lock          # au cas où un verrou traîne
git add -A
git commit -m "..."
git push origin capacitor       # déclenche un déploiement Vercel de la branche
npm run build:ios               # export statique du front dans ./out
npx cap sync ios                # copie le front dans le projet iOS
npx cap open ios                # ouvre Xcode → bouton ▶ Run sur l'iPad
```

Après changement de code front, il faut **rebuild:ios + cap sync + Run** — la mise
à jour n'est PAS automatique en natif (contrairement au web).

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
  `NEXT_PUBLIC_API_BASE=https://commande-app-git-capacitor-fitoussis-projects.vercel.app`
  (URL de la branche capacitor). Sans ça, l'app native ne joint pas Odoo (« Load failed »).
- **Protection Vercel Preview** : les déploiements de branche ont une auth Vercel qui
  bloque les requêtes externes (HTTP 401). À désactiver dans Vercel → Settings →
  Deployment Protection → Vercel Authentication → Disabled.
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

Restes possibles / idées non faites :
- Bouton « forcer rechargement complet des images » si les photos changent souvent.
- Distribution TestFlight (nécessite compte Apple Developer 99 €/an) pour équiper les
  commerciaux sans câble et sans expiration 7 jours.
