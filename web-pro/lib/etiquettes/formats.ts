/**
 * LES FORMATS DU § 17, ET LA GRILLE DE LA PLANCHE A4.
 *
 * ------------------------------------------------------------------
 * CE QUE LE § 17 DEMANDE, MOT POUR MOT, ET CE QU'IL FAUT EN LIRE
 * ------------------------------------------------------------------
 *
 * « Formats prévus : 25 × 15 mm, 40 × 20 mm, 50 × 30 mm, 60 × 40 mm,
 *   100 × 50 mm, planches A4, formats personnalisés. »
 *
 * Sept entrées, mais elles ne sont pas de même nature : CINQ sont des
 * tailles d'étiquette, la sixième est un SUPPORT (une feuille A4 qui en
 * porte plusieurs) et la septième une porte ouverte. Les traiter comme
 * une seule liste obligerait à choisir entre « 25 × 15 » et « A4 »,
 * alors qu'un producteur veut précisément du 25 × 15 SUR une planche A4
 * quand il n'a pas de thermique sous la main.
 *
 * D'où deux axes séparés :
 *   • LA TAILLE de l'étiquette — les cinq du § 17, plus toute cote
 *     personnalisée ;
 *   • LE SUPPORT — « rouleau » (une étiquette par page, la page fait
 *     exactement la taille de l'étiquette) ou « planche A4 » (une
 *     grille d'étiquettes sur une feuille de 210 × 297).
 *
 * N'importe laquelle des six tailles se combine avec l'un ou l'autre
 * support : 6 × 2 = douze combinaisons couvrent les sept entrées du
 * § 17 sans en forcer aucune.
 */

import { arrondiMm } from "./mesures.ts";

export type CleFormatEtiquette = "25x15" | "40x20" | "50x30" | "60x40" | "100x50";

export type FormatEtiquette = {
  /** `null` pour un format personnalisé : il n'a pas de clé stable. */
  readonly cle: CleFormatEtiquette | null;
  readonly nom: string;
  readonly largeurMm: number;
  readonly hauteurMm: number;
};

/** Les cinq tailles nommées par le § 17, dans son ordre. */
export const FORMATS_ETIQUETTE: readonly FormatEtiquette[] = [
  { cle: "25x15", nom: "25 × 15 mm", largeurMm: 25, hauteurMm: 15 },
  { cle: "40x20", nom: "40 × 20 mm", largeurMm: 40, hauteurMm: 20 },
  { cle: "50x30", nom: "50 × 30 mm", largeurMm: 50, hauteurMm: 30 },
  { cle: "60x40", nom: "60 × 40 mm", largeurMm: 60, hauteurMm: 40 },
  { cle: "100x50", nom: "100 × 50 mm", largeurMm: 100, hauteurMm: 50 },
];

export function formatEtiquette(cle: CleFormatEtiquette): FormatEtiquette {
  const trouve = FORMATS_ETIQUETTE.find((f) => f.cle === cle);
  if (!trouve) throw new Error(`Format d'étiquette inconnu : ${cle}.`);
  return trouve;
}

/**
 * LES BORNES, ET POURQUOI CELLES-LÀ.
 *
 * 1000 mm est la borne de la base (0090 § 8, `largeur_mm <= 1000`) :
 * les deux doivent dire la même chose, sinon on découvre le refus
 * après avoir composé la planche. 5 mm en bas, parce qu'en dessous il
 * n'y a plus de place pour un QR lisible ni pour un texte de 4 points,
 * et qu'aucun rouleau du commerce ne descend là.
 */
export const LARGEUR_MINIMALE_MM = 5;
export const COTE_MAXIMALE_MM = 1000;

export function formatPersonnalise(largeurMm: number, hauteurMm: number): FormatEtiquette {
  for (const [nom, valeur] of [
    ["largeur", largeurMm],
    ["hauteur", hauteurMm],
  ] as const) {
    if (!Number.isFinite(valeur)) {
      throw new Error(`La ${nom} de l'étiquette doit être un nombre de millimètres.`);
    }
    if (valeur < LARGEUR_MINIMALE_MM || valeur > COTE_MAXIMALE_MM) {
      throw new Error(
        `La ${nom} de l'étiquette doit être comprise entre ${LARGEUR_MINIMALE_MM} et ${COTE_MAXIMALE_MM} mm ; ` +
          `reçu ${valeur} mm.`,
      );
    }
  }
  const l = arrondiMm(largeurMm);
  const h = arrondiMm(hauteurMm);
  return { cle: null, nom: `${l} × ${h} mm`, largeurMm: l, hauteurMm: h };
}

// ------------------------------------------------------------------
// LA PLANCHE A4
// ------------------------------------------------------------------

/** A4 : 210 × 297 mm, par définition de la norme ISO 216. */
export const A4_LARGEUR_MM = 210;
export const A4_HAUTEUR_MM = 297;

/**
 * LA MARGE MINIMALE D'UNE FEUILLE A4.
 *
 * Ce n'est pas une préférence : une laser ou un jet d'encre de bureau
 * ne sait pas imprimer jusqu'au bord. La zone non imprimable fait 4 à
 * 5 mm selon les modèles. On prend 5 mm, et on le dit — une étiquette
 * qui tomberait dans cette bande sortirait tronquée sans prévenir.
 */
export const MARGE_A4_MINIMALE_MM = 5;

/**
 * La hauteur que la règle de contrôle réserve en pied de planche.
 *
 * ELLE EST PASSÉE DE 8 À 12 mm, ET CE N'EST PAS UN AJUSTEMENT DE GOÛT.
 * À 8 mm, le bloc était posé à 291 mm : la barre descendait à 292,2 et
 * la CONSIGNE — « si cette barre ne mesure pas 50 mm, l'échelle n'est
 * pas à 100 % » — se posait entre 294,2 et 294,6 mm. Or la zone sûre
 * s'arrête à 292 mm (297 moins les 5 mm que MARGE_A4_MINIMALE_MM
 * documente juste au-dessus). Le seul dispositif qui transforme la
 * promesse des millimètres en MESURE était donc imprimé dans la bande
 * que le module lui-même déclare non imprimable, et la phrase qui
 * explique quoi faire tombait en entier.
 *
 * Aggravant : la marche à suivre affichée demande « Marges : aucune »,
 * ce qui laisse la marge matérielle rogner, puis « mesurez la barre en
 * bas de page » — c'est-à-dire ce qui venait d'être coupé.
 *
 * La place existait : sur une planche 50 × 30 avec règle, le bas des
 * étiquettes est à 271,5 mm.
 */
export const HAUTEUR_REGLE_MM = 12;

/**
 * La dernière ligne de la feuille qu'une imprimante de bureau sait
 * encrer. Tout ce qui va au-delà sort tronqué sans prévenir.
 */
export const BAS_IMPRIMABLE_A4_MM = A4_HAUTEUR_MM - MARGE_A4_MINIMALE_MM;

export type OptionsGrilleA4 = {
  /** Marge minimale sur les quatre bords. Par défaut 5 mm. */
  readonly margeMm?: number;
  /**
   * LES DEUX MARGES SÉPARÉES, POUR TOMBER SUR UNE PRÉDÉCOUPE.
   *
   * Une planche autocollante du commerce n'a presque jamais la même
   * marge en haut et à gauche : sur un format très répandu de
   * 38,1 × 21,2 mm en 5 × 13, la première colonne commence à 4,75 mm du
   * bord gauche et la première ligne à 10,7 mm du haut. Avec une marge
   * unique, aucune valeur ne permet de viser les deux à la fois — les
   * étiquettes tombaient forcément à côté d'un des deux axes.
   *
   * Elles retombent sur `margeMm` quand on ne les pose pas, donc rien
   * ne change pour qui découpe aux ciseaux.
   */
  readonly margeXMm?: number;
  readonly margeYMm?: number;
  /** Blanc entre deux colonnes. Par défaut 2 mm. */
  readonly gouttiereXMm?: number;
  /** Blanc entre deux lignes. Par défaut 2 mm. */
  readonly gouttiereYMm?: number;
  /**
   * Centrer le bloc d'étiquettes sur la feuille.
   * VRAI PAR DÉFAUT, et c'est le bon choix quand on découpe aux
   * ciseaux : le reste de feuille est réparti également, donc une
   * dérive d'entraînement de l'imprimante ne mange pas une colonne
   * entière d'un seul côté.
   * À METTRE À FAUX pour une planche prédécoupée du commerce, dont les
   * découpes imposent l'origine.
   */
  readonly centrer?: boolean;
  /** Réserver le pied de page pour la règle de contrôle de 50 mm. */
  readonly regleDeControle?: boolean;
};

export type GrilleA4 = {
  readonly pageLargeurMm: number;
  readonly pageHauteurMm: number;
  readonly etiquetteLargeurMm: number;
  readonly etiquetteHauteurMm: number;
  readonly colonnes: number;
  readonly lignes: number;
  /** Coin haut-gauche de la première étiquette. */
  readonly origineXMm: number;
  readonly origineYMm: number;
  /** LE PAS DE GRILLE : d'un coin d'étiquette au coin suivant. */
  readonly pasXMm: number;
  readonly pasYMm: number;
  readonly parPage: number;
  readonly regleDeControle: boolean;
};

/**
 * Combien d'étiquettes tiennent sur une A4, et exactement où.
 *
 * LE CALCUL, ET LE PIÈGE QU'IL ÉVITE. Avec n colonnes il y a n − 1
 * gouttières, pas n : oublier ce « − 1 » fait perdre une colonne sur
 * les petits formats, ou pire, en fait déborder une hors de la feuille.
 */
export function grilleA4(
  etiquetteLargeurMm: number,
  etiquetteHauteurMm: number,
  options: OptionsGrilleA4 = {},
): GrilleA4 {
  const marge = Math.max(options.margeMm ?? MARGE_A4_MINIMALE_MM, 0);
  const margeX = Math.max(options.margeXMm ?? marge, 0);
  const margeY = Math.max(options.margeYMm ?? marge, 0);
  const gouttiereX = Math.max(options.gouttiereXMm ?? 2, 0);
  const gouttiereY = Math.max(options.gouttiereYMm ?? 2, 0);
  const centrer = options.centrer ?? true;
  const regle = options.regleDeControle ?? false;

  const largeurUtile = A4_LARGEUR_MM - 2 * margeX;
  const hauteurUtile = A4_HAUTEUR_MM - 2 * margeY - (regle ? HAUTEUR_REGLE_MM : 0);

  if (etiquetteLargeurMm > largeurUtile || etiquetteHauteurMm > hauteurUtile) {
    throw new Error(
      `Une étiquette de ${etiquetteLargeurMm} × ${etiquetteHauteurMm} mm ne tient pas sur une A4 ` +
        `avec ${margeX} mm de marge à gauche et ${margeY} mm en haut (zone utile ` +
        `${arrondiMm(largeurUtile)} × ${arrondiMm(hauteurUtile)} mm). ` +
        `Réduisez la marge, ou imprimez ce format sur rouleau.`,
    );
  }

  const combien = (utile: number, cote: number, gouttiere: number) =>
    Math.max(1, Math.floor((utile + gouttiere) / (cote + gouttiere)));

  const colonnes = combien(largeurUtile, etiquetteLargeurMm, gouttiereX);
  const lignes = combien(hauteurUtile, etiquetteHauteurMm, gouttiereY);

  const largeurBloc = colonnes * etiquetteLargeurMm + (colonnes - 1) * gouttiereX;
  const hauteurBloc = lignes * etiquetteHauteurMm + (lignes - 1) * gouttiereY;

  const origineX = centrer ? (A4_LARGEUR_MM - largeurBloc) / 2 : margeX;
  const origineY = centrer ? (A4_HAUTEUR_MM - (regle ? HAUTEUR_REGLE_MM : 0) - hauteurBloc) / 2 : margeY;

  return {
    pageLargeurMm: A4_LARGEUR_MM,
    pageHauteurMm: A4_HAUTEUR_MM,
    etiquetteLargeurMm: arrondiMm(etiquetteLargeurMm),
    etiquetteHauteurMm: arrondiMm(etiquetteHauteurMm),
    colonnes,
    lignes,
    origineXMm: arrondiMm(origineX),
    origineYMm: arrondiMm(origineY),
    pasXMm: arrondiMm(etiquetteLargeurMm + gouttiereX),
    pasYMm: arrondiMm(etiquetteHauteurMm + gouttiereY),
    parPage: colonnes * lignes,
    regleDeControle: regle,
  };
}

/** Position du coin haut-gauche de la case `index` d'une grille. */
export function caseGrille(grille: GrilleA4, index: number): { xMm: number; yMm: number } {
  if (index < 0 || index >= grille.parPage) {
    throw new Error(`Case ${index} hors de la planche (elle en compte ${grille.parPage}).`);
  }
  const colonne = index % grille.colonnes;
  const ligne = Math.floor(index / grille.colonnes);
  return {
    xMm: arrondiMm(grille.origineXMm + colonne * grille.pasXMm),
    yMm: arrondiMm(grille.origineYMm + ligne * grille.pasYMm),
  };
}
