// Config PostCSS volontairement vide.
//
// Sans ce fichier, PostCSS remonte l'arborescence à la recherche d'une config et
// finit par trouver ~/postcss.config.js (un fichier qui traîne dans le dossier
// personnel et qui réclame tailwindcss + autoprefixer). Ces paquets ne sont pas
// installés ici, donc `npm run build` et `npm run build:ios` échouaient en local
// dès qu'un fichier .css était importé — avec l'erreur « Cannot find module
// 'tailwindcss' », très loin de sa vraie cause.
//
// Le déclarer ici arrête la recherche : le projet écrit du CSS simple, sans
// pipeline. Ne pas supprimer sans vérifier que ~/postcss.config.js a disparu.
module.exports = {
  plugins: {},
};
