/**
 * ==================================================================
 * LIRE UN PLAFOND SAISI À LA MAIN — TROIS RÉPONSES, PAS UNE
 * ==================================================================
 *
 * Un plafond de dépense a une propriété qu'une ligne de devis n'a pas :
 * ZÉRO EST UN RÉGLAGE VALIDE ET SILENCIEUX. `daily_organization_limit_cents = 0`
 * veut dire « IA coupée » — la migration 0076 le dit explicitement, et
 * le contrôle de coût refusera chaque appel avec `budget_exceeded`.
 *
 * Une lecture qui rendrait `0` sur une saisie illisible — « 12,5O » avec
 * la lettre O, un espace insécable collé depuis un tableur, une virgule
 * de trop — transformerait donc une frappe malheureuse en « éteindre
 * l'IA de cette entreprise », sans un mot. Personne ne relierait la
 * panne du lendemain matin à la saisie de la veille.
 *
 * D'où trois réponses, IRRÉDUCTIBLES l'une à l'autre :
 *
 *   aucune      Champ vide. La colonne vaut NULL : « aucun plafond ».
 *               0076 insiste, et 0080 le répète : NULL n'est pas zéro.
 *   montant     Un entier de centimes, zéro compris — parce que zéro
 *               DÉLIBÉRÉ est un réglage légitime.
 *   illisible   On ne sait pas. Rien n'est écrit, et l'écran le dit.
 *
 * Ce qui est accepté : la virgule française, le point, les espaces (y
 * compris l'insécable et l'insécable fin, que Windows et les tableurs
 * insèrent dans les milliers), et un symbole € final que personne ne
 * devrait taper mais que tout le monde tape. Rien d'autre : ni notation
 * scientifique, ni signe, ni troisième décimale.
 *
 * Trois décimales sont REFUSÉES plutôt qu'arrondies. « 10,005 » ne veut
 * rien dire en euros ; l'arrondir, c'est choisir à la place de
 * quelqu'un sur un montant qu'il n'a pas relu.
 */

export type LectureMontant =
  | { etat: "aucune" }
  | { etat: "montant"; cents: number }
  | { etat: "illisible"; saisie: string; raison: string };

/**
 * Les espaces que les tableurs et Windows glissent dans les nombres.
 *
 * Les deux insécables sont écrites en séquences d'échappement, pas en
 * caractères littéraux : U+00A0 et U+202F sont invisibles dans un
 * éditeur, et une relecture ne peut pas vérifier ce qu'elle ne voit
 * pas.
 */
const ESPACES = /[\s\u00A0\u202F]/gu;

/**
 * Le plus grand plafond acceptable : dix millions d'euros.
 *
 * Pas une limite technique — `bigint` en tiendrait bien davantage —
 * mais un garde-fou contre la virgule oubliée. Un plafond IA mensuel à
 * dix millions d'euros n'est pas un plafond, c'est un zéro de trop, et
 * il ne protégerait plus de rien. C'est exactement le geste que l'audit
 * a reproché au gestionnaire client : passer de 50 € à 1 000 000 € en
 * un formulaire.
 */
export const PLAFOND_MAX_CENTIMES = 1_000_000_000;

export function lireMontantEuros(brut: string | null | undefined): LectureMontant {
  if (brut === null || brut === undefined) return { etat: "aucune" };

  const saisie = String(brut);

  // Le VIDE se juge AVANT de retirer le symbole. Un champ ne contenant
  // qu'un « € » n'est pas vide : c'est une saisie commencée puis
  // abandonnée. La traiter comme « aucune » retirerait un plafond que
  // personne n'a demandé de retirer.
  const sansEspaces = saisie.replace(ESPACES, "");
  if (sansEspaces === "") return { etat: "aucune" };

  const nettoye = sansEspaces.replace(/€$/, "");

  // Un motif explicite plutôt que `Number.parseFloat` : ce dernier lit
  // « 12abc » comme 12 et « 1e3 » comme 1000, deux lectures que
  // personne n'a jamais voulues.
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

/**
 * La valeur à préremplir dans un champ, depuis ce que la base rend.
 *
 * `null` devient la chaîne VIDE, jamais « 0 » : rouvrir le formulaire
 * d'une entreprise sans plafond et y trouver des zéros ferait
 * enregistrer « IA coupée » au premier clic sur Enregistrer.
 */
export function champDepuisCents(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Comment se dit un plafond à l'écran.
 *
 * Trois états, exactement ceux de la base — et la fonction rend une
 * ÉTIQUETTE plutôt qu'un nombre pour que les trois soient nommés :
 *
 *   `null` → « Aucun plafond »   (la dépense n'est pas bornée)
 *   `0`    → « IA coupée »       (aucun appel ne passera)
 *   sinon  → le montant
 *
 * Un tableau qui afficherait un tiret pour le premier et « 0 € » pour
 * le second inviterait à les lire comme la même chose.
 */
export type EtatPlafond =
  | { etat: "aucun" }
  | { etat: "coupee" }
  | { etat: "montant"; cents: number };

export function etatPlafond(cents: number | null | undefined): EtatPlafond {
  if (cents === null || cents === undefined) return { etat: "aucun" };
  if (cents === 0) return { etat: "coupee" };
  return { etat: "montant", cents };
}

/**
 * Vrai si cette entreprise n'est bornée par rien du tout.
 *
 * Trois nuls, ou aucune ligne : dans les deux cas, la dépense IA de
 * cette entreprise est sans limite, et c'est ce que l'écran doit
 * signaler — pas « pas encore configuré », qui laisserait croire à un
 * état d'attente inoffensif.
 */
export function sansAucunPlafond(plafonds: {
  daily_organization_limit_cents: number | null;
  monthly_organization_limit_cents: number | null;
  per_agent_limit_cents: number | null;
} | null): boolean {
  if (plafonds === null) return true;
  return (
    plafonds.daily_organization_limit_cents === null &&
    plafonds.monthly_organization_limit_cents === null &&
    plafonds.per_agent_limit_cents === null
  );
}
