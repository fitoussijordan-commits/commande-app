// lib/changelog.ts
// Journal des versions affiché en bas de l'app (« Version … » → Nouveautés).
// À COMPLÉTER À CHAQUE MISE EN PRODUCTION : une entrée par jour, la plus
// récente en premier, des phrases que le commercial comprend.
export interface ChangelogEntry { date: string; items: string[] }

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-11-13",
    items: [
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
