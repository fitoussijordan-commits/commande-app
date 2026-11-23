// lib/features.ts
// Interrupteurs de fonctionnalités, regroupés ici pour être faciles à retrouver.

// Photos des articles (catalogue, vignettes de gamme, zoom, préchargement
// hors ligne). Désactivées le 2026-11-23 pour accélérer l'app : plus aucune
// image produit n'est demandée à Odoo ni téléchargée. Remettre à true pour
// les réactiver — rien d'autre à changer.
// (Les photos du BDC Excel, elles, restent : voir lib/bdcExcel.ts.)
export const SHOW_PRODUCT_IMAGES = false;
