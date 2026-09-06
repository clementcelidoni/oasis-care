/**
 * LE VOCABULAIRE DES ÉTIQUETTES — § 17 et § 18.
 *
 * CE FICHIER EST LE MIROIR EXACT DE LA MIGRATION 0090. Le vocabulaire
 * des champs, les bornes des cotes et la liste des familles y sont
 * contraints en base (`etiquette_champs_valides`, la table
 * `etiquette_modeles`). Les répéter ici n'est pas une redondance : la
 * base refuse une écriture, mais c'est TypeScript qui empêche d'écrire
 * un champ inconnu, et c'est `verifierModele()` qui refuse une planche
 * avant qu'un rouleau ne soit engagé.
 *
 * SI LA MIGRATION CHANGE, CE FICHIER CHANGE. Le test `rendu.test.ts`
 * vérifie que les trois modèles fournis par 0090 se rendent sans perte.
 */

/** Le vocabulaire fermé du § 18. Un champ hors de cette liste est refusé. */
export type ChampEtiquette =
  | "logo"
  | "nom"
  | "nomScientifique"
  | "cultivar"
  | "numeroLot"
  | "date"
  | "quantite"
  | "emplacement"
  | "stade"
  | "qr"
  | "codeBarres"
  | "texteLibre";

export const CHAMPS_ETIQUETTE: readonly ChampEtiquette[] = [
  "logo",
  "nom",
  "nomScientifique",
  "cultivar",
  "numeroLot",
  "date",
  "quantite",
  "emplacement",
  "stade",
  "qr",
  "codeBarres",
  "texteLibre",
];

/** Les trois mondes du § 18 : « BioLab, Nursery et Jardins ». */
export type FamilleEtiquette = "jardins" | "pepiniere" | "biolab";

export type AlignementTexte = "gauche" | "centre" | "droite";

/**
 * Un champ posé sur l'étiquette.
 *
 * TOUTES LES COTES SONT EN MILLIMÈTRES, comptées depuis le coin
 * HAUT-GAUCHE de l'étiquette. C'est la convention de la base (0090 §8)
 * et celle du SVG ; le PDF, dont l'origine est en bas à gauche, fait la
 * conversion au dernier moment et à un seul endroit.
 */
export type ChampPlace = {
  readonly champ: ChampEtiquette;
  readonly x: number;
  readonly y: number;
  readonly largeur: number;
  readonly hauteur: number;
  /** Corps du texte en POINTS. Ignoré par le QR et le code-barres. */
  readonly taille?: number;
  readonly gras?: boolean;
  readonly italique?: boolean;
  readonly alignement?: AlignementTexte;
  /** Tracer un filet autour du champ — utile pour caler un modèle. */
  readonly cadre?: boolean;
};

/** Un modèle d'étiquette, tel que la table `etiquette_modeles` le stocke. */
export type ModeleEtiquette = {
  readonly id?: string;
  readonly famille: FamilleEtiquette;
  readonly nom: string;
  readonly largeurMm: number;
  readonly hauteurMm: number;
  /** Le blanc tournant SUR l'étiquette, que la tête thermique ne doit pas mordre. */
  readonly margeMm: number;
  readonly champs: readonly ChampPlace[];
};

/**
 * Ce qu'on imprime sur une étiquette donnée.
 *
 * `url` est l'adresse que porte le QR : elle vient du chantier du
 * résolveur (§ 15), jamais d'ici. AUCUNE LIGNE DE CETTE BIBLIOTHÈQUE NE
 * CONNAÎT DE DOMAINE — c'est délibéré, et c'est ce qui permettra de
 * changer d'adresse un jour sans réimprimer les étiquettes déjà
 * collées : le jeton est opaque, le serveur le résout.
 */
export type DonneesEtiquette = {
  readonly url: string;
  /** Le contenu de chaque champ textuel. Un champ absent laisse un blanc. */
  readonly valeurs: Partial<Record<ChampEtiquette, string>>;
  /**
   * Un logo en image, sous forme de `data:` URI.
   * RENDU DANS LE SVG SEULEMENT — voir la note du rendu PDF.
   */
  readonly logoDataUri?: string;
};

// ------------------------------------------------------------------
// LA LISTE D'AFFICHAGE
// ------------------------------------------------------------------
//
// UN SEUL MOTEUR DE MISE EN PAGE, DEUX SORTIES. Le rendu calcule une
// liste d'éléments géométriques en millimètres ; le SVG et le PDF ne
// font ensuite que la transcrire. C'est ce qui garantit que l'aperçu à
// l'écran et le fichier envoyé à l'imprimante montrent la MÊME chose —
// deux moteurs de mise en page divergeraient au premier accent.
//
// C'est aussi ce qui rend les cotes testables : les tests portent sur
// cette liste, en millimètres, et pas sur une chaîne de balises.

export type ElementRendu =
  | {
      readonly type: "rectangle";
      readonly xMm: number;
      readonly yMm: number;
      readonly largeurMm: number;
      readonly hauteurMm: number;
      /** true = aplat noir ; false = filet. */
      readonly rempli: boolean;
      readonly epaisseurMm?: number;
    }
  | {
      readonly type: "texte";
      /** Point d'ancrage horizontal, selon `alignement`. */
      readonly xMm: number;
      /** LIGNE DE BASE du texte, pas son sommet. */
      readonly yMm: number;
      readonly texte: string;
      readonly taillePt: number;
      readonly gras: boolean;
      readonly italique: boolean;
      readonly alignement: AlignementTexte;
      /** Cadre de découpe : rien ne doit déborder du champ. */
      readonly decoupe: { xMm: number; yMm: number; largeurMm: number; hauteurMm: number };
    }
  | {
      readonly type: "image";
      readonly xMm: number;
      readonly yMm: number;
      readonly largeurMm: number;
      readonly hauteurMm: number;
      readonly dataUri: string;
    };

/** Ce qui n'a pas pu être rendu, et pourquoi. Jamais silencieux. */
export type AvertissementRendu = {
  readonly champ: ChampEtiquette | null;
  readonly message: string;
  /**
   * DEUX POIDS, PARCE QU'ILS N'APPELLENT PAS LE MÊME GESTE.
   *
   *   • « defaut » — l'étiquette ne sortira pas comme elle est
   *     composée : un texte tranché, un QR sous le plancher de
   *     lecture. Il faut corriger avant d'engager le rouleau.
   *   • « remarque » — elle sortira, et voici ce qu'il faut savoir :
   *     un QR lisible de près mais pas à bout de bras, une grille que
   *     la tête thermique déformera un peu.
   *
   * Sans cette distinction, brancher les remarques de densité aurait
   * fait passer les trois modèles fournis pour cassés. Ils ne le sont
   * pas : ils sont à la limite, et c'est une information, pas une
   * panne.
   */
  readonly niveau?: "defaut" | "remarque";
};

export type EtiquetteRendue = {
  readonly largeurMm: number;
  readonly hauteurMm: number;
  readonly elements: readonly ElementRendu[];
  readonly avertissements: readonly AvertissementRendu[];
};
