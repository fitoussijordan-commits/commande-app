# Commande App

App autonome de prise de commande (extraite du WMS) — connexion directe à Odoo,
sans dépendre de la session de l'app WMS.

## Setup

```bash
npm install
npm run dev
```

Ouvrir http://localhost:3000 — un écran de connexion Odoo s'affiche
(URL, base de données, identifiants).

## Déploiement (GitHub + Vercel)

```bash
git init
git add .
git commit -m "init commande-app"
```

Créer un repo sur GitHub (ex: `commande-app`), puis :

```bash
git remote add origin git@github.com:TON_USER/commande-app.git
git branch -M main
git push -u origin main
```

Sur [vercel.com](https://vercel.com) → **Add New Project** → importer le repo `commande-app`.
Vercel détecte Next.js automatiquement, aucune configuration nécessaire.

### Variable d'environnement (optionnelle mais recommandée)

Dans Vercel → Project Settings → Environment Variables, ajouter :

| Nom | Valeur |
|---|---|
| `ODOO_URL` | `https://monentreprise.odoo.com` (ton URL Odoo exacte) |

Voir `.env.local.example`. Sans cette variable, l'app fonctionne quand même (le proxy
bloque uniquement les IPs privées/locales), mais la fixer verrouille le proxy sur ta
seule instance Odoo — recommandé avant de distribuer l'app aux commerciaux.

## Prochaines étapes (voir discussion)

- Cache local (catalogue produits, clients) pour l'affichage instantané et l'offline
- File de synchronisation des commandes créées hors-ligne
- Wrap Capacitor pour build iOS + distribution TestFlight interne
