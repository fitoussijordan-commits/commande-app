// lib/text.ts
// Utilitaires de texte partagés par l'app.

/**
 * Convertit en texte brut une valeur qui peut être du HTML.
 *
 * `calendar.event.description` est un champ HTML dans Odoo : dès qu'un RDV est
 * créé ou seulement touché côté Odoo, la description revient balisée
 * (`<br>`, `<div>`, `<a href="mailto:…">`) et sur UNE seule ligne.
 *
 * Or l'app stocke le client dans cette description au format texte
 * `Client : NOM (CODE) — téléphone`, puis une ligne vide, puis la note. Sans
 * conversion :
 *  - les regex `Client\s*:\s*(.+)` avalaient tout le HTML restant (le téléphone
 *    s'affichait suivi de `<br><strong>Organisé par</strong>…`) ;
 *  - `split(/\n\n/)` ne trouvait aucun séparateur, donc la note passait pour
 *    vide et une édition la remplaçait par le bloc HTML entier.
 *
 * On convertit en texte plutôt que d'injecter le HTML : pas de
 * `dangerouslySetInnerHTML` sur un contenu venu d'Odoo, qui a pu être saisi par
 * n'importe qui.
 */
export function descToText(html: string): string {
  if (!html) return "";
  // Déjà du texte brut : ni balise, ni entité. Le test porte aussi sur les
  // entités, sinon une description encodée mais sans balise (« Dupont &amp; Fils »)
  // ressortait telle quelle, avec le &amp; visible à l'écran.
  if (!/<[a-z!/]/i.test(html) && !/&(?:[a-z]+|#\d+);/i.test(html)) return html;
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")                          // balises restantes
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")                          // en dernier : sinon &amp;lt; casse
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Liens d'itinéraire vers l'adresse d'un RDV : Waze, et Plans (iPad sans Waze).
// Écrits aussi dans la description du RDV pour être cliquables dans Outlook.
export function routeUrls(address: string) {
  const q = encodeURIComponent(address.trim());
  return { waze: `https://waze.com/ul?q=${q}&navigate=yes`, plans: `https://maps.apple.com/?daddr=${q}` };
}
export const ROUTE_LINE = /^\s*(Waze|Plans)\s*:/i;
export function routeLines(address: string): string {
  if (!address.trim()) return "";
  const u = routeUrls(address);
  return `Waze : ${u.waze}\nPlans : ${u.plans}`;
}

// Retire les liens d'itinéraire d'une description, même recollée sur une seule ligne par Odoo.
export function stripRouteLinks(text: string): string {
  return text.replace(/[ \t]*\b(Waze|Plans)\s*:\s*https?:\/\/\S+/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

// Texte → HTML pour un champ Odoo « html » : sans <br>, Odoo recolle toutes les
// lignes en une seule (le téléphone se retrouvait suivi des liens Waze / Plans).
export function textToHtml(text: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.split("\n").map(esc).join("<br/>");
}
