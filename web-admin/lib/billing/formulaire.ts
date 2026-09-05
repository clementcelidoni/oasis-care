/**
 * ==================================================================
 * L'ÉTAT D'UN FORMULAIRE — partagé par les actions et les écrans
 * ==================================================================
 *
 * DANS SON PROPRE FICHIER, ET PAS DANS `actions.ts`. Un module marqué
 * `"use server"` n'est censé exporter que des fonctions asynchrones :
 * tout le reste — une constante, un type, une fonction pure — y est
 * toléré aujourd'hui mais n'a rien à y faire, et un composant client
 * qui importe `actions.ts` pour une constante tire dans son paquet la
 * référence de chaque action du fichier.
 *
 * Ces trois lignes vivent donc ici, où le client peut les lire sans
 * rien tirer d'autre.
 */

export type EtatFormulaire = {
  statut: "vierge" | "ok" | "erreur";
  /** Ce qu'on affiche à côté du bouton. `null` à l'état vierge. */
  message: string | null;
};

export const ETAT_VIERGE: EtatFormulaire = { statut: "vierge", message: null };

/**
 * Traduit le refus d'une fonction de 0081.
 *
 * LES MESSAGES DE 0081 SONT AFFICHÉS TELS QUELS, et c'est délibéré :
 * ils sont écrits en français, ils disent ce qui a été refusé ET
 * pourquoi, et ils nomment souvent le geste qui débloque (« décidez la
 * case », « validez le numéro de TVA », « annulez la remise d'abord »).
 * Les remplacer par une phrase de notre cru perdrait précisément
 * l'information qu'on est allé chercher jusqu'en base.
 *
 * Le SQLSTATE ne sert donc qu'à choisir la mise en contexte :
 *   42501  refus d'accès — permission ou second facteur ;
 *   23514  règle métier — le message se suffit ;
 *   23503  cible introuvable ;
 *   23505  déjà fait, ou doublon refusé ;
 *   PGRST202 / 42883  la fonction n'existe pas : 0081 n'est pas jouée.
 */
export function messageDeLErreur(
  operation: string,
  error: { message: string; code?: string },
): string {
  switch (error.code) {
    case "42501":
      return `${operation} : la base a refusé. ${error.message}`;
    case "23514":
    case "P0002":
      return error.message;
    case "23503":
    case "23505":
      return `${operation} : ${error.message}`;
    case "PGRST202":
    case "42883":
      return (
        `${operation} : la fonction n'existe pas dans la base. La migration ` +
        "0081_control_center_suite.sql n'est probablement pas appliquée — ou le cache de " +
        "schéma de PostgREST n'a pas encore été rechargé."
      );
    default:
      return `${operation} : ${error.message} (${error.code ?? "sans code"}).`;
  }
}

/** Un uuid, ou rien. Évite d'envoyer une chaîne libre dans un paramètre `uuid`. */
export function lireUuid(formData: FormData, champ: string): string | null {
  const brut = formData.get(champ);
  if (typeof brut !== "string") return null;
  const valeur = brut.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valeur)
    ? valeur
    : null;
}

/** Le motif, obligatoire partout. Vide ou absent rend `null`, jamais `""`. */
export function lireMotif(formData: FormData): string | null {
  const brut = formData.get("motif");
  if (typeof brut !== "string") return null;
  const motif = brut.trim();
  return motif.length === 0 ? null : motif;
}

export function lireTexte(formData: FormData, champ: string): string | null {
  const brut = formData.get(champ);
  if (typeof brut !== "string") return null;
  const valeur = brut.trim();
  return valeur.length === 0 ? null : valeur;
}

/**
 * Un entier positif saisi à la main. TROIS réponses, comme pour l'argent.
 *
 * `aucun` (champ vide) et `0` sont des choses différentes : « sièges
 * compris : non décidé » et « sièges compris : zéro » ne facturent pas
 * la même chose. Une saisie illisible est REFUSÉE, jamais ramenée à
 * zéro — c'est la leçon de `lib/ia/montants.ts`, et elle vaut ici pour
 * la même raison.
 */
export type LectureEntier =
  | { etat: "aucun" }
  | { etat: "entier"; valeur: number }
  | { etat: "illisible"; raison: string };

export function lireEntier(
  brut: string | null | undefined,
  options?: { max?: number },
): LectureEntier {
  if (brut === null || brut === undefined) return { etat: "aucun" };
  // Les deux insécables sont écrites en séquences d’échappement et non en
  // caractères littéraux : U+00A0 et U+202F sont invisibles dans un
  // éditeur, et une relecture ne peut pas vérifier ce qu’elle ne voit
  // pas. Windows et les tableurs en glissent dans les nombres.
  const nettoye = String(brut).replace(/[\s\u00A0\u202F]/gu, "");
  if (nettoye === "") return { etat: "aucun" };

  if (!/^\d{1,9}$/.test(nettoye)) {
    return {
      etat: "illisible",
      raison: "Attendu un nombre entier positif, ou un champ vide pour « non décidé ».",
    };
  }

  const valeur = Number(nettoye);
  const max = options?.max;
  if (max !== undefined && valeur > max) {
    return { etat: "illisible", raison: `Valeur au-delà du maximum admis (${max}).` };
  }
  return { etat: "entier", valeur };
}
