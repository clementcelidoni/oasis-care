/**
 * §INSCRIPTION — CE QU'ON VIENT DE DEMANDER : LA FORME, ET SA LECTURE.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EST SÉPARÉ DE SON VOISIN
 * ══════════════════════════════════════════════════════════════════
 *
 * Même raison que `lib/ui/flashShared.ts` : `paiement-en-cours.ts`
 * importe `next/headers`, qui n'existe que côté serveur et qui rend le
 * module inchargeable par `node --test`. Or la lecture de ce cookie est
 * exactement le genre de code qu'il faut tester — c'est elle qui peut
 * avaler la seule chose qu'on ait à dire à quelqu'un qui vient de
 * donner sa carte.
 *
 * Ici : un nom de cookie, une durée, un type, une fonction pure. Rien
 * qui touche à une API de plateforme.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE PROBLÈME QUE CE COOKIE RÉSOUT
 * ══════════════════════════════════════════════════════════════════
 *
 * Le retour du navigateur et l'événement signé du prestataire sont deux
 * courses indépendantes, et LE NAVIGATEUR GAGNE PRESQUE TOUJOURS. À la
 * seconde où le client revient chez nous, il n'existe encore aucune
 * ligne dans `organization_subscriptions` : rien à lire, rien à
 * afficher, rien à dire — au moment le plus important du parcours,
 * puisqu'il vient de donner sa carte.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE COOKIE EST UN AIDE-MÉMOIRE D'ÉCRAN. IL N'OUVRE AUCUN DROIT.
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est la règle déjà écrite pour l'identifiant de session dans l'URL
 * de succès (`lib/billing/stripe.ts`) : IL SERT À AFFICHER, PAS À
 * OUVRIR UN DROIT. Quelqu'un qui fabriquerait ce cookie à la main
 * verrait la phrase « nous attendons la confirmation de votre
 * paiement », et rien de plus, jamais — l'abonnement est toujours relu
 * en base.
 *
 * Conséquence dans l'autre sens, et c'est elle qui compte : LE COOKIE
 * SURVIT À UN ABANDON DE PAIEMENT. Le chemin de retour d'abandon est
 * une simple page, qui ne peut pas écrire de cookie. L'écran de
 * confirmation ne dit donc jamais « c'est payé » sur la seule foi du
 * cookie : il dit ce qui a été demandé, qu'on attend la réponse, et que
 * si la page de paiement a été quittée, rien n'a été prélevé. Les deux
 * lectures sont vraies en même temps, et l'écran les tient toutes les
 * deux.
 */

export const COOKIE_PAIEMENT = "oasis_paiement";

/**
 * Deux heures, en secondes.
 *
 * Au-delà, « votre paiement est en cours de confirmation » ne décrit
 * plus rien de réel : un événement qui n'est pas arrivé en deux heures
 * n'est pas un retard, c'est un incident. Mieux vaut ne plus rien dire
 * que dire une chose fausse.
 */
export const DUREE_COOKIE_PAIEMENT = 2 * 60 * 60;

export type PaiementEnCours = {
  /** L'offre demandée — sert à retrouver son nom dans le catalogue. */
  planKey: string;
  cycle: "monthly" | "yearly";
  /** Le client entre-t-il par l'essai d'un mois ? */
  avecEssai: boolean;
  /** Le premier prélèvement annoncé, en AAAA-MM-JJ. */
  premierPrelevementLe: string;
  /** La fin de l'essai, ou `null` quand il n'y en a pas. */
  finEssaiLe: string | null;
};

const FORME_JOUR = /^\d{4}-\d{2}-\d{2}$/;

function texte(valeur: unknown): string {
  return typeof valeur === "string" ? valeur : "";
}

/**
 * LA LECTURE, PURE ET SÉVÈRE.
 *
 * Elle rend `null` au moindre doute plutôt que de compléter par des
 * valeurs par défaut : une date de prélèvement inventée serait affichée
 * avec le même aplomb qu'une date vraie.
 */
export function lirePaiementEnCours(valeurBrute: string | undefined): PaiementEnCours | null {
  if (!valeurBrute) return null;

  let objet: unknown;
  try {
    objet = JSON.parse(valeurBrute);
  } catch {
    return null;
  }
  if (typeof objet !== "object" || objet === null || Array.isArray(objet)) return null;

  const source = objet as Record<string, unknown>;

  const planKey = texte(source.planKey).trim();
  if (planKey === "" || planKey.length > 64) return null;

  const cycle = texte(source.cycle);
  if (cycle !== "monthly" && cycle !== "yearly") return null;

  if (typeof source.avecEssai !== "boolean") return null;

  const premierPrelevementLe = texte(source.premierPrelevementLe);
  if (!FORME_JOUR.test(premierPrelevementLe)) return null;

  const finEssaiBrute = source.finEssaiLe;
  let finEssaiLe: string | null = null;
  if (finEssaiBrute !== null && finEssaiBrute !== undefined) {
    const jour = texte(finEssaiBrute);
    if (!FORME_JOUR.test(jour)) return null;
    finEssaiLe = jour;
  }

  // UN ESSAI SANS DATE DE FIN N'EST PAS UN ESSAI. Laisser passer cette
  // contradiction ferait afficher « un mois gratuit » sans dire jusqu'à
  // quand — c'est-à-dire la seule information qui compte.
  if (source.avecEssai === true && finEssaiLe === null) return null;

  return {
    planKey,
    cycle,
    avecEssai: source.avecEssai,
    premierPrelevementLe,
    finEssaiLe,
  };
}
