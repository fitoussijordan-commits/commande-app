// lib/changelog.ts
// Journal des versions affiché en bas de l'app (« Version … » → Nouveautés).
// À COMPLÉTER À CHAQUE MISE EN PRODUCTION : une entrée par jour, la plus
// récente en premier, des phrases que le commercial comprend.
export interface ChangelogEntry { date: string; items: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-11-13",
    items: [
      "Messages sur mes commandes : la commande s'ouvre avec les échanges en haut (le détail en dessous) ; bouton « ✎ Modifier » pour la charger dans le panier et la modifier / compléter.",
      "Préparer le RDV : « Top positif » (plus grosses hausses par produit) à côté des plus grosses baisses.",
      "Commandes portail : « Valider DC » refusé pour un client Bloqué compta / en redressement (validation par le service client), comme pour les commandes saisies.",
      "MEA en liste : un bloc coloré par MEA avec son titre, et ses variantes (Essentiel, Standard, Premium…) à l'intérieur.",
      "Commandes portail : « ✎ Modifier » charge la commande dans le panier — quantités modifiables, articles retirés ou ajoutés — puis la commande est mise à jour dans Odoo et validée DC.",
      "Messages sur mes commandes : tout message (service client, collègue) sur une commande d'un de vos clients s'affiche, que vous soyez cité ou non.",
      "Échanges d'une commande : taper @ propose les collègues ; la personne choisie est citée (lien) et notifiée dans Odoo.",
      "Accueil : « Commandes portail à valider » (site WALA, non validées DC, non livrées — vos commandes seulement). « ✓ Valider DC » ajoute l'étiquette Validé DC ; « + Compléter » ouvre le catalogue pour ajouter des articles à la commande, qui est ensuite validée DC.",
      "Accueil : « Messages sur mes commandes » sous l'agenda ; la commande s'ouvre en plein écran pour répondre (elle restait coincée dans la carte).",
      "Accueil : « Messages sur mes commandes » — messages du service client en attente sur vos commandes ; un tap ouvre la commande pour répondre, et le message disparaît une fois traité (réponse ou bouton « Traité »). Les messages où vous êtes cité (@) apparaissent en premier, même sur une commande d'un collègue.",
      "Commandes jointes : le champ Odoo « Commandes jointes » est rempli avec les numéros (S7xxxx, …) sur la nouvelle commande et sur chaque commande jointe.",
      "Commandes à joindre : le lien est maintenant écrit des deux côtés dans Odoo (champ « Commandes jointes » et note interne sur chaque commande), avec un message de confirmation.",
      "Commandes en attente : la liste se referme quand on ouvre une commande en grand.",
      "Panier : la flèche pour ouvrir / fermer le récap répond au premier appui (les clics en bord de bouton étaient perdus).",
      "Commandes en attente : le numéro ouvre la commande en grand (produits, livraison, lots, remises) avec les échanges du chatter ; réponse au service client en note interne, jamais envoyée au client.",
      "Historique : les échanges (chatter) apparaissent aussi dans le détail de chaque commande.",
      "MEA et devis d'implantation : flèche ▾ pour voir le contenu de l'offre (articles, quantités, remises, offerts) avant de l'ajouter.",
      "Palmarès : filtre « Tous / En baisse / En hausse » pour n'afficher que les écarts négatifs ou positifs.",
      "Palmarès : période au choix (du … au …), quantités N-1 sur la même période, écart, et tri par quantités, N-1, plus grosses baisses ou hausses.",
      "RDV : la note du rendez-vous est recopiée dans les Notes DC de la fiche client (datée, avec la date et le type du RDV).",
      "MEA et devis d'implantation : le bouton « Liste / Cartes » change aussi leur affichage (une ligne par offre).",
      "Fiche client → « Préparer le RDV » : CA à date N / N-1, offres du cycle faites ou à proposer (offre prévue + note), quantités proposées par produit d'après les achats N-1, plus grosses baisses du client.",
      "Fiche client : tuile « Assistant » retirée.",
      "BDC Excel : photo de chaque produit et logo officiel Dr. Hauschka (repris des BDC de séminaire), titre et en-tête bien cadrés.",
      "Mes MEA → « BDC Excel » : BDC de la MEA pour tous les clients affichés en un fichier (un onglet par client), pour l'après-séminaire.",
      "BDC Excel de la MEA généré pour le client (même présentation que les BDC de séminaire : achats N-1, proposition commerciale, remise client, kit offert).",
      "Création du devis : animation des produits qui sautent et barre de progression avec les étapes pendant l'envoi à Odoo.",
      "MEA : filtre « Actives / Toutes » (tableau de bord et suivi), actives par défaut ; seules les MEA actives sont proposées dans les RDV.",
      "Suivi MEA : « Offre prévue » et notes de nouveau saisissables (gardées sur l'appareil tant que le modèle Odoo « Suivi MEA » n'existe pas).",
      "Tableau de bord : CA et évolution par client calculés comme sur la fiche client (champs Odoo « CA à date N / N-1 »).",
      "Factures : fenêtre de détail (règlements et avoirs imputés, échéance et retard, lignes, adresses, PDF et pièces jointes, accès à la commande d'origine).",
      "Factures : les tuiles « Avoirs » et « Reste dû » filtrent la liste ; chaque avoir s'ouvre dans sa propre fenêtre.",
      "MEA ajoutée après un devis d'implantation : les références communes passent dans la MEA avec sa remise, même quand la ligne du modèle est à 0.",
      "Panier : bouton corbeille pour tout vider d'un coup, et bouton « Retirer » sur chaque MEA (articles, gratuités, remise et offre cochée retirés ensemble).",
      "MEA : les testeurs du modèle à quantité 0 sont repris dans les gratuités, à 0 — au commercial de choisir (les lignes à 0 ne partent pas sur le devis).",
      "Ruptures : la ligne « RUPTURE » du devis indique le manquant, la référence, l'EAN et le nom de l'article.",
      "Version de l'app affichée en bas de l'écran, avec ce journal des nouveautés.",
      "Listes déroulantes lisibles sous Windows (le type de commande s'affichait blanc sur blanc).",
      "Panier : « Type de commande » et « Offre commandée » visibles aussi quand Odoo est réglé dans une autre langue que le français.",
      "Périmés : le transfert de rebut est de nouveau créé (erreur « Invalid field 'name' » corrigée).",
      "Suivi des colis TNT : le lien ouvre bien le suivi sur tnt.fr.",
      "Historique : détail de commande complet — adresse de livraison, transporteur et suivi du colis, quantités livrées, lots, remises accordées, totaux HT / TVA / TTC.",
    ],
  },
  {
    date: "2026-11-12",
    items: [
      "Animations : boutons, changements d'écran, panier, chargements et validation de commande.",
      "Barre de franco de port sous le total du panier.",
      "Note client : dictée vocale sur iPad (bouton REC).",
      "Accueil : recherche en haut, RDV du jour, bloc « Reprendre ».",
      "Catalogue en vue liste ; panier compact.",
      "Historique client : onglet Factures (avoirs rattachés, reste dû).",
      "Ruptures : le manquant part sur une ligne « RUPTURE » à 0.",
      "MEA : variante recalculée selon les quantités, gratuités suivies par offre.",
    ],
  },
  {
    date: "2026-11-04",
    items: [
      "Tableau de bord commercial : chiffres clés vs N-1, CA par mois, top / flop, MEA, clients à visiter.",
      "Mes MEA : suivi des campagnes et planification des RDV.",
      "Icône de l'app sur l'écran d'accueil.",
    ],
  },
  {
    date: "2026-11-03",
    items: [
      "Planning : glisser-déposer des RDV, vue mois épurée.",
      "Clients proches : rayon réglable.",
    ],
  },
];
