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

// Recherche client : écarte les adresses enfants et les doublons (code, nom).
// Partagé par l'écran client et la prise de RDV.
const ADDRESS_TYPES = new Set(["delivery", "invoice", "other", "private"]);

// Score de « fiche la plus légitime » quand deux enregistrements se disputent le
// même code client : société > fiche racine > fiche renseignée.
function clientScore(c: any): number {
  return (c.is_company ? 4 : 0) + (c.parent_id ? 0 : 2) + (c.phone ? 1 : 0);
}

// Dédoublonne les résultats de recherche client.
//
// Odoo peut renvoyer DEUX enregistrements res.partner pour ce qui est, côté
// utilisateur, un seul client : la société mère et une de ses adresses enfants
// (livraison/facturation) portant le même nom et le même code. L'adresse enfant
// n'apparaît pas comme une ligne séparée dans la liste Contacts d'Odoo — elle vit
// dans l'onglet « Contacts & Adresses » — mais si elle a customer_rank > 0 elle
// remonte quand même dans un search_read, d'où le doublon à l'écran.
//
// Deux passes : on écarte les adresses enfants, puis, en filet de sécurité, on ne
// garde qu'une fiche par couple (code, nom).
export function dedupeClients(rows: any[]): any[] {
  // Passe 1 — adresses enfants. Repli sur la liste brute si le filtre vide tout
  // (instance Odoo sans champ `type`, ou cache préchargé avant cette version).
  const roots = rows.filter(c => !(c.parent_id && ADDRESS_TYPES.has(c.type)));
  const base = roots.length ? roots : rows;

  // Passe 2 — doublons réels sur (code, nom). Sans code, on ne touche à rien :
  // deux clients distincts peuvent légitimement porter le même nom.
  const bestByKey = new Map<string, number>();
  const out: any[] = [];
  for (const c of base) {
    const ref = (c.ref || "").trim().toLowerCase();
    if (!ref) { out.push(c); continue; }
    const key = `${ref}|${(c.name || "").trim().toLowerCase()}`;
    const at = bestByKey.get(key);
    if (at === undefined) { bestByKey.set(key, out.push(c) - 1); continue; }
    if (clientScore(c) > clientScore(out[at])) out[at] = c;
  }
  return out;
}
