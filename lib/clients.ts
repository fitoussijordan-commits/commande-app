// lib/clients.ts
// Départage des fiches res.partner partageant un même code client (ref).

export interface PickResult {
  row: any | null;
  /** true = le choix a dû être arbitraire (vrais doublons), à signaler. */
  ambiguous: boolean;
}

/**
 * Choisit LA fiche à ouvrir parmi plusieurs partageant le même ref.
 *
 * Plusieurs fiches au même code, c'est le cas NORMAL dans Odoo : une société
 * porte le ref, et ses adresses de livraison / facturation sont des res.partner
 * enfants qui héritent du même ref et souvent du même nom. S'y ajoutent parfois
 * de vrais doublons de saisie.
 *
 * Avant, l'app abandonnait dès que le lot restait ambigu (« 5 fiches ont le code
 * … — ouvre-le via la recherche »), ce qui rendait le bouton « Ouvrir la fiche
 * client » inutilisable sur les clients les plus courants. On tranche désormais
 * toujours, par critères décroissants de fiabilité — chaque étape ne s'applique
 * QUE si elle réduit le lot sans le vider :
 *
 *  1. nom identique à celui écrit sur le RDV ;
 *  2. type « contact » → écarte les adresses de livraison / facturation ;
 *  3. sans parent_id → la fiche mère plutôt qu'un contact rattaché ;
 *  4. is_company → la société plutôt qu'une personne ;
 *  5. customer_rank le plus haut → la fiche qui reçoit réellement les commandes ;
 *  6. id le plus petit → la plus ancienne, donc l'originale d'un doublon.
 *
 * Les étapes 1 à 5 couvrent la structure société / adresses. La 6 n'intervient
 * que sur des fiches réellement indiscernables : le choix est alors arbitraire
 * mais STABLE (la même fiche à chaque appel), et `ambiguous` le signale pour
 * qu'on le dise à l'utilisateur.
 *
 * @param rows  fiches candidates (déjà filtrées sur le ref ou le nom)
 * @param name  nom lu sur le RDV, s'il y en a un
 */
export function pickClientAmong(rows: any[], name?: string): PickResult {
  if (!rows || !rows.length) return { row: null, ambiguous: false };
  if (rows.length === 1) return { row: rows[0], ambiguous: false };

  // Réduit le lot si le critère isole au moins une fiche, sinon le laisse tel quel.
  const narrow = (list: any[], pred: (r: any) => boolean) => {
    const kept = list.filter(pred);
    return kept.length ? kept : list;
  };

  let lot = rows;
  if (name) {
    const wanted = name.trim().toLowerCase();
    lot = narrow(lot, r => (r.name || "").trim().toLowerCase() === wanted);
  }
  if (lot.length > 1) lot = narrow(lot, r => !r.type || r.type === "contact");
  if (lot.length > 1) lot = narrow(lot, r => !r.parent_id);
  if (lot.length > 1) lot = narrow(lot, r => Boolean(r.is_company));
  if (lot.length > 1) {
    const best = Math.max(...lot.map(r => Number(r.customer_rank) || 0));
    lot = narrow(lot, r => (Number(r.customer_rank) || 0) === best);
  }
  if (lot.length === 1) return { row: lot[0], ambiguous: false };

  // Fiches réellement identiques : la plus ancienne, et on le signale.
  const oldest = lot.reduce((a, b) => (Number(a.id) <= Number(b.id) ? a : b));
  return { row: oldest, ambiguous: true };
}
