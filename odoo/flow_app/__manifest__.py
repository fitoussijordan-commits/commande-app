{
    "name": "Flow",
    "summary": "Prise de commande terrain Dr. Hauschka (app Flow) servie directement par Odoo",
    "description": """
Flow — prise de commande terrain
================================

L'app Flow (identique à flow.dr-hauschka.fr) servie par Odoo à l'adresse /flow/ :
choix du client, catalogue et prix client, MEA, panier et devis, planning,
périmés, préparation de RDV, mode hors ligne…

- Connexion : celle d'Odoo (pas d'écran de connexion propre à Flow).
- Données : lues et écrites directement dans Odoo avec les droits de l'utilisateur.
- Hors ligne : l'app reste utilisable sans réseau une fois ouverte en ligne.
- Assistant IA, import de bons de commande et export des périmés : servis par
  l'app Vercel (flow.dr-hauschka.fr).

Le contenu de static/app est généré : `npm run build:odoo` dans le dépôt commande-app.
""",
    "version": "19.0.1.0.0",
    "category": "Sales/Sales",
    "author": "Dr. Hauschka",
    "license": "LGPL-3",
    "depends": ["web", "sale"],
    "data": ["views/flow_menu.xml"],
    "application": True,
    "installable": True,
}
