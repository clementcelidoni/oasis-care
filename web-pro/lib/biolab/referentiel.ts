/**
 * §7 — CE QUE LE RÉFÉRENTIEL AJOUTE AU SOCLE BIOLAB, ET RIEN DE PLUS.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER NE REDÉFINIT RIEN DE `cultures.ts`
 * ══════════════════════════════════════════════════════════════════
 *
 * Le socle du module — le périmètre et le droit (`perimetreBioLab`),
 * le vocabulaire des lots (stades, statuts, contamination, sévérité) et
 * les formats (`formatNombre`, `formatPourcentage`, `formatDateHeure`,
 * `formatAnciennete`…) — vit dans `lib/biolab/cultures.ts`. Les écrans
 * du référentiel l'IMPORTENT. Une seconde table de libellés, ou un
 * second formateur de pourcentage, serait exactement le « second
 * système » que le §6 interdit, en plus discret : deux écrans
 * afficheraient un jour deux mots différents pour la même valeur, et
 * personne ne saurait laquelle croire.
 *
 * Ce fichier porte donc UNIQUEMENT ce que le socle n'a pas :
 *
 *   1. LE VOCABULAIRE DE LA RECETTE ET DE LA PHOTO. Types de
 *      composants, familles de régulateurs, unités de concentration et
 *      de pesée, catégories de photo. Ils n'appartiennent qu'aux écrans
 *      des milieux et des relevés.
 *   2. LA DISCIPLINE DES TAUX. Ce qu'on refuse d'appeler « taux »
 *      quand il n'y a pas assez de lots derrière — une règle
 *      d'AFFICHAGE, jamais un calcul.
 *
 * Les chaînes ci-dessous ne sont pas un choix du web : ce sont les
 * `rawValue` que `MediumComponentType`, `ConcentrationUnit`,
 * `PlantGrowthRegulatorCategory`, `AmountUnit` et
 * `BioLabPhotoCategory` écrivent en base depuis l'iPhone
 * (`OasisCare/BioLab/Models/*.swift`). Les colonnes qui les portent
 * sont du `text` sans contrainte : une valeur inconnue est possible, et
 * `libelle()` du socle la rend telle quelle plutôt que de la taire.
 */

import { FUSEAU_LABORATOIRE, formatPourcentage } from "./cultures.ts";

// ==================================================================
// 1. Le vocabulaire de la recette et de la photo
// ==================================================================

/** `BioLabPhotoCategory` (Phase 7H). */
export const CATEGORIES_PHOTO = ["globalView", "tissueDetail", "medium", "vessel", "equipment"] as const;
export type CategoriePhoto = (typeof CATEGORIES_PHOTO)[number];

export const LIBELLE_CATEGORIE_PHOTO: Record<CategoriePhoto, string> = {
  globalView: "Vue globale",
  tissueDetail: "Détail tissus",
  medium: "Milieu",
  vessel: "Bocal",
  equipment: "Équipement",
};

/** `MediumComponentType` (Phase 7C). */
export const TYPES_COMPOSANT = [
  "basalMedium", "sugar", "plantGrowthRegulator", "vitamin", "additive", "gellingAgent", "other",
] as const;
export type TypeComposant = (typeof TYPES_COMPOSANT)[number];

export const LIBELLE_TYPE_COMPOSANT: Record<TypeComposant, string> = {
  basalMedium: "Milieu de base",
  sugar: "Sucre",
  plantGrowthRegulator: "Régulateur de croissance",
  vitamin: "Vitamine",
  additive: "Additif",
  gellingAgent: "Gélifiant",
  other: "Autre",
};

/**
 * L'ordre dans lequel un préparateur lit une composition : le milieu de
 * base d'abord, le gélifiant en dernier — c'est l'ordre où on les verse.
 */
export const ORDRE_TYPE_COMPOSANT: Record<TypeComposant, number> = {
  basalMedium: 0,
  sugar: 1,
  vitamin: 2,
  plantGrowthRegulator: 3,
  additive: 4,
  gellingAgent: 5,
  other: 6,
};

/** `PlantGrowthRegulatorCategory` (Phase 7C). */
export const CATEGORIES_PGR = ["cytokinin", "auxin", "gibberellin", "other"] as const;
export type CategoriePGR = (typeof CATEGORIES_PGR)[number];

export const LIBELLE_CATEGORIE_PGR: Record<CategoriePGR, string> = {
  cytokinin: "Cytokinine",
  auxin: "Auxine",
  gibberellin: "Gibbérelline",
  other: "Autre",
};

/** `ConcentrationUnit` (Phase 7C, étendue par l'amélioration §12). */
export const UNITES_CONCENTRATION = [
  "milligramsPerLiter", "gramsPerLiter", "millilitersPerLiter", "micromolar",
  "microgramsPerLiter", "molar", "millimolar", "microlitersPerLiter",
] as const;
export type UniteConcentration = (typeof UNITES_CONCENTRATION)[number];

export const LIBELLE_UNITE_CONCENTRATION: Record<UniteConcentration, string> = {
  milligramsPerLiter: "mg/L",
  gramsPerLiter: "g/L",
  millilitersPerLiter: "mL/L",
  micromolar: "µM",
  microgramsPerLiter: "µg/L",
  molar: "M",
  millimolar: "mM",
  microlitersPerLiter: "µL/L",
};

/** `AmountUnit` — l'unité d'une pesée réelle, pas d'une concentration. */
export const UNITES_QUANTITE = ["gram", "milligram", "microgram", "liter", "milliliter", "microliter"] as const;
export type UniteQuantite = (typeof UNITES_QUANTITE)[number];

export const LIBELLE_UNITE_QUANTITE: Record<UniteQuantite, string> = {
  gram: "g",
  milligram: "mg",
  microgram: "µg",
  liter: "L",
  milliliter: "mL",
  microliter: "µL",
};

/**
 * Un trouble CONSTATÉ sur l'échelle de sévérité.
 *
 * `unknown` ne compte pas, exactement comme `BioLabAnalyticsService` :
 * « je n'ai pas su juger » n'est pas « c'est atteint ». À ne pas
 * confondre avec `none`, qui veut dire « j'ai regardé, il n'y a rien ».
 *
 * C'est un PRÉDICAT, pas un libellé : le socle porte les mots
 * (`SEVERITE_LABELS`), celui-ci porte la règle de comptage, et la règle
 * n'existe nulle part ailleurs.
 */
export function severiteAtteinte(valeur: string): boolean {
  return valeur !== "none" && valeur !== "unknown";
}

/**
 * Une date en jour/mois/année.
 *
 * Le socle formate l'heure (`formatDateHeure`), le jour court d'une
 * frise (`formatJourCourt`) et l'ancienneté (`formatAnciennete`), mais
 * pas la date seule — et une colonne « Préparée le » n'a que faire de
 * l'heure.
 */
export function formaterDate(valeur: string | null | undefined): string {
  if (!valeur) return "—";
  return new Date(valeur).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: FUSEAU_LABORATOIRE,
  });
}

// ==================================================================
// 2. La discipline des taux
// ==================================================================

/**
 * LE SEUIL SOUS LEQUEL UN TAUX N'EST PAS UN TAUX.
 *
 * Un lot contaminé sur trois, ce n'est pas « 33 % de contamination » :
 * c'est un lot contaminé sur trois. Le pourcentage donne à un accident
 * l'allure d'une tendance, et c'est sur cette allure qu'on décide de
 * changer un protocole — la décision la plus coûteuse du métier.
 *
 * Cinq est le choix de ce produit, pas une règle scientifique : c'est
 * l'ordre de grandeur en dessous duquel l'ajout d'un seul lot déplace
 * le chiffre de plus de quinze points. L'amélioration §26 du module
 * mobile dit la même chose autrement (« Basé sur N lots », affiché à
 * côté de tout taux) ; ici on va un cran plus loin en refusant le
 * pourcentage lui-même.
 */
export const SEUIL_TAUX = 5;

/**
 * Un taux observé, avec de quoi savoir s'il veut dire quelque chose.
 *
 * `taux` reste toujours calculé quand il est calculable — c'est lui qui
 * sert à TRIER une liste, y compris sous le seuil, où l'ordre reste
 * juste même si le pourcentage ne se montre pas. C'est `fiable` qui
 * décide de l'affichage.
 */
export type TauxObserve = {
  /** null quand l'effectif est nul : une moyenne sur rien n'est pas zéro. */
  taux: number | null;
  touches: number;
  effectif: number;
  /** false sous `SEUIL_TAUX` : on affiche alors les faits bruts. */
  fiable: boolean;
};

export function observer(touches: number, effectif: number): TauxObserve {
  return {
    taux: effectif > 0 ? touches / effectif : null,
    touches,
    effectif,
    fiable: effectif >= SEUIL_TAUX,
  };
}

/**
 * Ce qu'on écrit dans une cellule.
 *
 * Trois cas, et jamais un quatrième : le pourcentage quand il porte,
 * les faits bruts quand l'effectif est trop mince, et « Non disponible »
 * quand il n'y a rien. « 0 % » est réservé au vrai zéro mesuré — zéro
 * lot touché sur un effectif suffisant.
 *
 * Le pourcentage lui-même est mis en forme par le socle : un second
 * formateur finirait par arrondir autrement.
 */
export function direTaux(observe: TauxObserve): string {
  if (observe.effectif === 0) return "Non disponible";
  if (!observe.fiable) return `${observe.touches} sur ${observe.effectif}`;
  return formatPourcentage(observe.taux) ?? "Non disponible";
}

/**
 * La même chose pour une CARTE, où « Non disponible » ne rentre pas et
 * où l'absence se dit par un tiret.
 *
 * `null` quand il n'y a rien à dire : `MetricCard` affiche alors « — »
 * en gris pâle, ce qui est le seul rendu honnête d'un inconnu.
 */
export function direTauxEnCarte(observe: TauxObserve): string | null {
  if (observe.effectif === 0 || observe.taux === null) return null;
  if (!observe.fiable) return `${observe.touches} sur ${observe.effectif}`;
  return formatPourcentage(observe.taux);
}

/**
 * REFAIRE UN TAUX OBSERVÉ À PARTIR DE CE QUE LA BASE REND.
 *
 * Les fonctions de 0087 rendent un taux ET son dénominateur, jamais le
 * numérateur : pour une PROPORTION (touchés / effectif), celui-ci se
 * retrouve exactement, puisque les deux termes sont des entiers. Rien
 * n'est recalculé ici — le taux reste celui de la base ; on ne fait que
 * retrouver de quoi appliquer la règle d'affichage.
 *
 * À N'EMPLOYER QUE SUR UNE PROPORTION. Une MOYENNE (le rendement de
 * multiplication, la survie) n'a pas de numérateur entier : pour
 * celles-là, c'est `direEffectif` qui dit sur combien de mesures elle
 * porte.
 */
export function observerDepuisTaux(
  taux: number | string | null | undefined,
  effectif: number,
): TauxObserve {
  const n = typeof taux === "string" ? Number(taux) : (taux ?? null);
  const valide = n !== null && Number.isFinite(n);
  return {
    taux: valide ? (n as number) : null,
    touches: valide ? Math.round((n as number) * effectif) : 0,
    effectif,
    fiable: effectif >= SEUIL_TAUX,
  };
}

/**
 * Sur combien de mesures porte une moyenne, et si c'est assez.
 *
 * Une moyenne sur deux lots n'est pas fausse, mais elle ne dit rien de
 * la production : le texte le signale au lieu de laisser croire à une
 * tendance.
 */
export function direEffectif(effectif: number, singulier: string, pluriel: string): string {
  if (effectif <= 0) return "aucune mesure derrière ce chiffre";
  const mot = effectif > 1 ? pluriel : singulier;
  return effectif < SEUIL_TAUX
    ? `moyenne sur ${effectif} ${mot} seulement`
    : `moyenne sur ${effectif} ${mot}`;
}
