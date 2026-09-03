/**
 * §11V — LIRE UN PLAFOND SAISI À LA MAIN, ET LES TROIS RÉPONSES
 * POSSIBLES (spec p. 19 : `dailyOrganizationLimit`,
 * `monthlyOrganizationLimit`, `agentLimit`).
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER N'UTILISE PAS `inputToCents`
 * ══════════════════════════════════════════════════════════════════
 *
 * `lib/quotes/types.ts` en porte déjà un, et il rend `0` sur une saisie
 * illisible. C'est le bon choix pour une ligne de devis — un poste à
 * zéro se voit sur le total, et le devis n'est pas encore envoyé. C'est
 * le pire choix possible ici.
 *
 * Un plafond de dépense a une propriété qu'une ligne de devis n'a pas :
 * ZÉRO EST UN RÉGLAGE VALIDE ET SILENCIEUX. `daily_organization_limit_cents = 0`
 * veut dire « IA coupée » — la migration 0076 le dit explicitement, et
 * `verifierPlafonds` (runtime/cost.ts) refusera chaque appel avec
 * `budget_exceeded`. Une frappe malheureuse — « 12,5O » avec la lettre
 * O, un espace insécable collé depuis un tableur, une virgule de trop —
 * deviendrait donc « éteindre l'IA de l'entreprise », sans un mot.
 * Personne ne relierait la panne du lendemain matin à la saisie de la
 * veille.
 *
 * D'où trois réponses là où l'autre en rend une, et elles sont
 * IRRÉDUCTIBLES l'une à l'autre :
 *
 *   aucune      Champ vide. La colonne vaut NULL, c'est-à-dire
 *               « aucun plafond ». 0076 insiste : NULL n'est pas zéro.
 *
 *   montant     Un entier de centimes, zéro compris — parce que zéro
 *               DÉLIBÉRÉ est un réglage légitime.
 *
 *   illisible   On ne sait pas. Rien n'est écrit, et l'écran le dit.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE LA LECTURE ACCEPTE
 * ══════════════════════════════════════════════════════════════════
 *
 * La virgule française, le point, les espaces (y compris l'insécable et
 * l'insécable fin, que Windows et les tableurs insèrent dans les
 * milliers), et un symbole € final que personne ne devrait taper mais
 * que tout le monde tape. Rien d'autre : pas de notation scientifique,
 * pas de signe, pas de troisième décimale.
 *
 * Trois décimales sont REFUSÉES plutôt qu'arrondies. « 10,005 » est une
 * saisie qui ne veut rien dire en euros ; l'arrondir, c'est choisir à la
 * place de quelqu'un sur un montant qu'il n'a pas relu.
 */

export type LectureMontant =
  | { etat: "aucune" }
  | { etat: "montant"; cents: number }
  | { etat: "illisible"; saisie: string; raison: string };

/** Les espaces que les tableurs et Windows glissent dans les nombres. */
const ESPACES = /[\s   ]/g;

/**
 * Le plus grand plafond acceptable : dix millions d'euros.
 *
 * Pas une limite technique — `bigint` en tiendrait bien davantage —
 * mais un garde-fou contre la virgule oubliée. Un plafond IA mensuel à
 * dix millions d'euros n'est pas un plafond, c'est un zéro de trop dans
 * une saisie, et il ne protégerait plus de rien.
 */
export const PLAFOND_MAX_CENTIMES = 1_000_000_000;

export function lireMontantEuros(brut: string | null | undefined): LectureMontant {
  if (brut === null || brut === undefined) return { etat: "aucune" };

  const saisie = String(brut);

  // Le VIDE se juge AVANT de retirer le symbole. Un champ ne contenant
  // qu'un « € » n'est pas un champ vide : c'est une saisie commencée
  // puis abandonnée. La traiter comme « aucune » retirerait un plafond
  // de dépense sans que personne l'ait demandé — un geste trop
  // conséquent pour venir d'un caractère oublié.
  const sansEspaces = saisie.replace(ESPACES, "");
  if (sansEspaces === "") return { etat: "aucune" };

  const nettoye = sansEspaces.replace(/€$/, "");

  // Un motif explicite plutôt que `Number.parseFloat` : ce dernier lit
  // « 12abc » comme 12 et « 1e3 » comme 1000, deux lectures qu'un
  // utilisateur n'a jamais voulues.
  const motif = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(nettoye);
  if (motif === null) {
    return {
      etat: "illisible",
      saisie,
      raison:
        "Attendu un montant en euros, deux décimales au plus (par exemple 25 ou 12,50). " +
        "Laissez le champ vide pour ne poser aucun plafond, ou écrivez 0 pour couper l'IA.",
    };
  }

  const euros = Number(motif[1]);
  const decimales = (motif[2] ?? "").padEnd(2, "0");
  const cents = euros * 100 + Number(decimales);

  if (cents > PLAFOND_MAX_CENTIMES) {
    return {
      etat: "illisible",
      saisie,
      raison: `Ce plafond dépasse ${PLAFOND_MAX_CENTIMES / 100} €. Un plafond de cet ordre ne protège de rien : vérifiez la virgule.`,
    };
  }

  return { etat: "montant", cents };
}

// ------------------------------------------------------------------
// Écrire un montant qui n'est peut-être qu'un minorant
// ------------------------------------------------------------------

/**
 * Une dépense observée : ce qu'on sait, et combien d'appels échappent au
 * calcul.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI PAS `sommerCouts` (runtime/cost.ts)
 * ══════════════════════════════════════════════════════════════════
 *
 * `sommerCouts` rend `null` dès qu'un terme est inconnu, et c'est juste
 * pour son usage : additionner les coûts d'UN appel escaladé, où un
 * total partiel serait un mensonge.
 *
 * Sur un tableau de bord mensuel, la même règle donnerait un écran
 * entièrement vide dès qu'un seul appel sur mille est passé sans tarif
 * connu. L'exploitant perdrait les 999 autres, qui sont exacts, pour
 * cause d'un seul inconnu — et il ne saurait toujours pas ce qu'il
 * dépense.
 *
 * On garde donc les deux nombres côte à côte, et l'écran écrit « au
 * moins 12,40 € — 3 appels sans tarif connu ». C'est exactement la
 * doctrine que la base a déjà choisie : `ai_cost_budget_remaining`
 * (0076) rend `unpriced_events_today` À CÔTÉ de la dépense, pour la
 * même raison.
 *
 * Ce qu'on ne fait JAMAIS, c'est compter un appel non tarifé pour zéro.
 */
export type Depense = {
  /** La somme des estimations connues, en centimes entiers. */
  centsConnus: number;
  /** Le nombre d'appels comptés sans montant. Rend `centsConnus` minorant. */
  appelsSansTarif: number;
  /** Le nombre total d'appels agrégés. */
  appels: number;
};

export const DEPENSE_VIDE: Depense = Object.freeze({
  centsConnus: 0,
  appelsSansTarif: 0,
  appels: 0,
});

/** Ajoute un appel à une dépense. `null` compte comme « sans tarif ». */
export function ajouterAppel(depense: Depense, coutCents: number | null): Depense {
  return {
    centsConnus: depense.centsConnus + (coutCents ?? 0),
    appelsSansTarif: depense.appelsSansTarif + (coutCents === null ? 1 : 0),
    appels: depense.appels + 1,
  };
}

/** Vrai quand `centsConnus` ne peut pas être présenté comme un total. */
export function estMinorant(depense: Depense): boolean {
  return depense.appelsSansTarif > 0;
}

/**
 * La moyenne par unité, ou `null`.
 *
 * `null` quand il n'y a rien à diviser : « 0 € en moyenne » et « aucune
 * décision à moyenner » ne disent pas la même chose, et `MetricCard`
 * affiche un tiret pour la seconde.
 */
export function moyenneCents(depense: Depense, unites: number): number | null {
  if (unites <= 0) return null;
  return Math.round(depense.centsConnus / unites);
}
