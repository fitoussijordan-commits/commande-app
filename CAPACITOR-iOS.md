# App iPad native (Capacitor) — guide de build

Cette branche `capacitor` transforme l'app web en **vraie app iOS** qui s'ouvre
**hors ligne** (les fichiers du front sont embarqués dans l'app, plus de page
« pas de connexion »). Le proxy Odoo reste hébergé sur Vercel et est appelé en
absolu quand il y a du réseau.

> ⚠️ Ne merge PAS `capacitor` dans `main`. Ta version web de présentation vit
> sur `main` et ne doit pas bouger. Tout le natif reste sur cette branche.

---

## Ce qui a changé côté code

- `lib/apiBase.ts` — décide d'appeler le proxy en relatif (web) ou en absolu (natif).
- `lib/odoo.ts`, `lib/network.ts`, `components/OrderScreen.tsx` — passent par `apiBase`.
- `next.config.js` — export statique **uniquement** quand `CAPACITOR_BUILD=1`
  (le build Vercel normal n'est pas touché).
- `scripts/build-capacitor.js` — met `app/api` de côté le temps de l'export
  (Next refuse l'export s'il reste des routes API), puis le restaure.
- `capacitor.config.json` — config de l'app (nom, id, dossier `out`).
- `package.json` — scripts `build:ios`, `sync:ios`, `open:ios`.

---

## Prérequis (une seule fois)

1. **Xcode** — gratuit sur le Mac App Store (~7 Go). Ouvre-le une fois pour
   accepter la licence, puis :
   ```
   sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
   ```
2. **CocoaPods** (gestionnaire de dépendances iOS) :
   ```
   sudo gem install cocoapods
   ```

---

## Build initial (une seule fois)

Depuis `~/Downloads/wms-scanner/commande-app`, sur la branche `capacitor` :

```bash
git checkout capacitor
npm install
```

Crée un fichier `.env.local` avec l'URL de ton proxy Vercel (backend Odoo) :

```
NEXT_PUBLIC_API_BASE=https://commande-app-tan.vercel.app
```

Génère le front statique + le projet iOS :

```bash
npm run build:ios          # produit le dossier ./out
npx cap add ios            # crée le dossier ios/ (une seule fois)
npx cap sync ios           # copie le front dans l'app iOS
npx cap open ios           # ouvre le projet dans Xcode
```

---

## À chaque modification du code ensuite

```bash
npm run sync:ios           # rebuild + resync
npx cap open ios
```

---

## Lancer sur un iPad

Dans Xcode :

1. Branche l'iPad en USB (ou utilise le simulateur pour un premier test).
2. En haut, choisis l'iPad comme cible.
3. Onglet **Signing & Capabilities** → sélectionne ton **Apple ID** comme Team
   (un compte gratuit suffit pour tester sur ton propre appareil).
4. Clique **▶ Run**. L'app s'installe sur l'iPad.

Sur l'iPad, si « développeur non vérifié » :
Réglages → Général → VPN et gestion de l'appareil → fais confiance à ton profil.

---

## Test hors ligne (le but de tout ça)

1. Ouvre l'app, connecte-toi à Odoo (avec réseau).
2. « Préparer le hors-ligne » → attends le toast (X produits, Y clients).
3. **Ferme complètement l'app**, coupe le wifi/données.
4. Rouvre l'app → **elle s'ouvre** (plus d'écran d'erreur).
5. Cherche un client, cherche des produits, valide une commande → « en attente ».
6. Rallume le réseau → la commande part seule dans Odoo.

---

## Distribution aux commerciaux (plus tard)

- **TestFlight** (recommandé) : nécessite un compte Apple Developer payant
  (99 €/an). Tu uploades l'app, les commerciaux l'installent via l'app TestFlight.
- **MDM interne** : si ta boîte a une gestion de flotte iPad.

---

## Notes

- **Images produits hors ligne** : pas encore préchargées (cache léger volontaire).
  À ajouter dans un second temps maintenant que le natif encaisse un gros cache.
- **`appId`** dans `capacitor.config.json` : remplace `com.tondomaine.commandeapp`
  par un identifiant à toi (ex: `com.tasociete.commande`) avant la distribution.
