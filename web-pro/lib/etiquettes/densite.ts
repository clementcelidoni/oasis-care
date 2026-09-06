/**
 * LA DENSITÉ DU QR — le calcul qui décide si l'étiquette sert à quelque chose.
 *
 * ------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE
 * ------------------------------------------------------------------
 *
 * Sur une étiquette de 25 × 15 mm, la place est comptée au dixième de
 * millimètre. La longueur de l'adresse et celle du jeton décident de la
 * VERSION du QR, la version décide du nombre de modules, et le nombre
 * de modules décide de la taille d'un module — c'est-à-dire de la
 * possibilité même de scanner. Un caractère de trop dans le domaine
 * peut faire basculer une version entière.
 *
 * Ce fichier ne devine pas : il encode réellement le contenu avec
 * l'encodeur de qr.ts, lit la version obtenue, et fait la division.
 *
 * ------------------------------------------------------------------
 * LES SEUILS, ET D'OÙ ILS VIENNENT
 * ------------------------------------------------------------------
 *
 * Ce ne sont PAS des valeurs de norme — ISO/IEC 18004 ne dit rien de la
 * taille physique, c'est un standard d'encodage. Ce sont des seuils de
 * PRATIQUE, et il faut les lire comme tels :
 *
 *   • 0,50 mm par module : confortable. Un téléphone lit du premier
 *     coup, à bout de bras, dans un jardin, avec des reflets.
 *   • 0,33 mm : la limite basse. Ça se lit, mais il faut approcher,
 *     stabiliser, et une étiquette sale ou gondolée ne passe plus.
 *     C'est l'ordre de grandeur que la profession retient pour un QR
 *     lu par un lecteur portable — autour de 0,25 à 0,33 mm.
 *   • En dessous : on imprime un carré décoratif.
 *
 * ET LA ZONE DE SILENCE COMPTE. Quatre modules clairs de chaque côté,
 * exigés par la norme, s'ajoutent aux modules du code. Un carré de
 * 13 mm pour un QR de version 4 (33 modules) n'offre pas 13/33 =
 * 0,39 mm par module mais 13/41 = 0,32 mm. Beaucoup de calculs de
 * densité oublient ce détail et concluent le contraire de la vérité.
 *
 * ------------------------------------------------------------------
 * LA TÊTE THERMIQUE, L'AUTRE CONTRAINTE
 * ------------------------------------------------------------------
 *
 * Une thermique à 203 dpi trace des points de 25,4/203 = 0,1251 mm. Il
 * faut au moins DEUX points par module — un module d'un seul point sort
 * baveux et irrégulier. Et surtout, le nombre de points par module
 * devrait être ENTIER : à 2,4 points par module, l'imprimante alterne
 * des modules de 2 et de 3 points, ce qui déforme la grille et fait
 * décrocher les lecteurs. C'est la cause la plus fréquente des QR
 * thermiques illisibles, et elle ne se voit pas à l'écran.
 */

import { SILENCE_QR_MODULES, encoderQr, type ModeQr, type NiveauCorrection } from "./qr.ts";
import { FORMATS_ETIQUETTE } from "./formats.ts";
import { arrondiMm } from "./mesures.ts";

export const SEUIL_CONFORTABLE_MM = 0.5;
export const SEUIL_LIMITE_MM = 0.33;

/** Pas d'une tête thermique, en millimètres, aux deux définitions courantes. */
export const POINT_203_DPI_MM = 25.4 / 203;
export const POINT_300_DPI_MM = 25.4 / 300;

export type VerdictLecture = "confortable" | "limite" | "illisible";

export type MesureDensiteQr = {
  readonly contenu: string;
  readonly longueurCaracteres: number;
  readonly version: number;
  readonly niveau: NiveauCorrection;
  readonly modes: readonly ModeQr[];
  /** Modules du code seul. */
  readonly modulesParCote: number;
  /** Modules avec la zone de silence — c'est ce qui occupe la place. */
  readonly modulesAvecSilence: number;
  readonly coteBoiteMm: number;
  readonly tailleModuleMm: number;
  readonly verdictAppareilPhoto: VerdictLecture;
  readonly pointsParModule203: number;
  readonly pointsParModule300: number;
  /** Écart au nombre entier de points à 203 dpi, de 0 (parfait) à 0,5. */
  readonly irregularite203: number;
  readonly remarques: readonly string[];
};

export type OptionsDensite = {
  readonly niveau?: NiveauCorrection;
  readonly silenceModules?: number;
};

function verdict(tailleModuleMm: number): VerdictLecture {
  if (tailleModuleMm >= SEUIL_CONFORTABLE_MM) return "confortable";
  if (tailleModuleMm >= SEUIL_LIMITE_MM) return "limite";
  return "illisible";
}

/**
 * LES REMARQUES DE LISIBILITÉ, ISOLÉES POUR QU'ELLES SORTENT DU PLACARD.
 *
 * Elles vivaient à l'intérieur de `mesurerDensiteQr`, que seul l'éditeur
 * de modèle appelait. Le moteur de rendu, lui, ne connaissait qu'un
 * seuil unique (0,33 mm) : un QR « à la limite » ou une grille irrégulière
 * pour une tête thermique ne remontaient donc JAMAIS jusqu'à la planche.
 * Or les deux modèles Oasis les plus utilisés sont précisément dans ce
 * cas — 0,439 mm par module, 3,51 points à 203 dpi, irrégularité 0,49,
 * c'est-à-dire la pire valeur possible.
 *
 * Le calcul était déjà écrit ; il ne manquait que le branchement.
 */
export function remarquesDensite(tailleModuleMm: number): string[] {
  const remarques: string[] = [];
  const points203 = tailleModuleMm / POINT_203_DPI_MM;
  const irregularite = Math.abs(points203 - Math.round(points203));

  const lecture = verdict(tailleModuleMm);
  if (lecture === "illisible") {
    remarques.push(
      `À ${arrondiMm(tailleModuleMm)} mm par module, ce QR ne se scanne pas : il faut ${SEUIL_LIMITE_MM} mm au minimum.`,
    );
  } else if (lecture === "limite") {
    remarques.push(
      `À ${arrondiMm(tailleModuleMm)} mm par module, ce QR se lit de près et sur une étiquette propre. ` +
        `Comptez ${SEUIL_CONFORTABLE_MM} mm pour qu'il se lise à bout de bras dans un jardin.`,
    );
  }
  if (points203 < 2) {
    remarques.push(
      `Une thermique à 203 dpi ne tracerait que ${Math.round(points203 * 10) / 10} point(s) par module : ` +
        `il en faut deux au minimum. Imprimez ce format sur une 300 dpi, ou agrandissez le QR.`,
    );
  } else if (irregularite > 0.15) {
    remarques.push(
      `À 203 dpi, ce QR fait ${Math.round(points203 * 100) / 100} points par module : l'imprimante alternera ` +
        `des modules de ${Math.floor(points203)} et de ${Math.ceil(points203)} points, ce qui déforme la grille. ` +
        `Un cadre de QR ajusté à un nombre entier de points serait plus sûr.`,
    );
  }
  return remarques;
}

/** Mesure la densité d'un contenu dans un carré de côté donné. */
export function mesurerDensiteQr(contenu: string, coteBoiteMm: number, options: OptionsDensite = {}): MesureDensiteQr {
  const niveau = options.niveau ?? "M";
  const silence = options.silenceModules ?? SILENCE_QR_MODULES;
  const matrice = encoderQr(contenu, { niveau });

  const modulesAvecSilence = matrice.taille + 2 * silence;
  const tailleModuleMm = coteBoiteMm / modulesAvecSilence;
  const points203 = tailleModuleMm / POINT_203_DPI_MM;
  const irregularite = Math.abs(points203 - Math.round(points203));

  const lecture = verdict(tailleModuleMm);
  const remarques = remarquesDensite(tailleModuleMm);

  return {
    contenu,
    longueurCaracteres: contenu.length,
    version: matrice.version,
    niveau,
    modes: matrice.modes,
    modulesParCote: matrice.taille,
    modulesAvecSilence,
    coteBoiteMm: arrondiMm(coteBoiteMm),
    tailleModuleMm,
    verdictAppareilPhoto: lecture,
    pointsParModule203: points203,
    pointsParModule300: tailleModuleMm / POINT_300_DPI_MM,
    irregularite203: irregularite,
    remarques,
  };
}

/**
 * Le côté du plus grand QR carré qu'un format d'étiquette peut porter.
 *
 * C'est le MEILLEUR cas : le QR occupe toute la hauteur utile, et il ne
 * reste rien pour le texte. Une étiquette réelle en laisse toujours un
 * peu ; ce nombre sert de plafond, pas de promesse.
 */
export function coteQrMaximalMm(largeurMm: number, hauteurMm: number, margeMm = 1.5): number {
  return arrondiMm(Math.min(largeurMm, hauteurMm) - 2 * margeMm);
}

export type LigneTableauDensite = {
  readonly format: string;
  readonly largeurMm: number;
  readonly hauteurMm: number;
  readonly coteQrMm: number;
  readonly mesure: MesureDensiteQr;
};

/** La densité obtenue sur chacun des cinq formats du § 17. */
export function tableauDensite(contenu: string, options: OptionsDensite & { margeMm?: number } = {}): LigneTableauDensite[] {
  const marge = options.margeMm ?? 1.5;
  return FORMATS_ETIQUETTE.map((format) => {
    const cote = coteQrMaximalMm(format.largeurMm, format.hauteurMm, marge);
    return {
      format: format.nom,
      largeurMm: format.largeurMm,
      hauteurMm: format.hauteurMm,
      coteQrMm: cote,
      mesure: mesurerDensiteQr(contenu, cote, options),
    };
  });
}

/**
 * À PARTIR DE QUELLE LONGUEUR D'ADRESSE ÇA NE PASSE PLUS.
 *
 * On allonge le contenu caractère par caractère et on s'arrête au
 * dernier qui tient au-dessus du seuil. C'est une recherche par force
 * brute et elle est assumée : chaque essai est un encodage complet,
 * donc le résultat est exact — aucune formule ne remplacerait le
 * franchissement de version, qui est un escalier, pas une pente.
 *
 * `modele` sert à fabriquer un contenu réaliste : on répète son dernier
 * caractère, parce qu'une adresse minuscule et un jeton majuscule ne
 * changent pas de mode en s'allongeant.
 */
export type LongueurMaximale = {
  readonly longueurMax: number;
  readonly version: number;
  readonly tailleModuleMm: number;
  /**
   * `true` quand la recherche s'est arrêtée parce que l'encodeur refuse
   * d'aller au-delà de la version 10, et NON parce que le seuil était
   * franchi. Autrement dit : sur ce format, la taille des modules n'est
   * plus la contrainte — c'est le plafond que nous nous sommes fixé.
   * Sans ce drapeau, on lirait « 216 caractères maximum » comme une
   * limite physique alors que c'est une limite de notre encodeur.
   */
  readonly plafondEncodeur: boolean;
};

export function longueurContenuMaximale(
  coteBoiteMm: number,
  // `modele` EST OBLIGATOIRE, et c'est délibéré. Une valeur par défaut
  // serait un domaine codé en dur — exactement ce que adresse.ts
  // interdit, et ce qu'un test vérifie fichier par fichier dans cette
  // bibliothèque. Le résultat dépend d'ailleurs entièrement du modèle :
  // demander jusqu'où une adresse peut s'allonger sans dire de quelle
  // adresse on parle n'aurait pas de sens.
  options: OptionsDensite & { seuilMm?: number; modele: string },
): LongueurMaximale | null {
  const seuil = options.seuilMm ?? SEUIL_LIMITE_MM;
  const modele = options.modele;
  if (!modele) {
    throw new Error("Il faut un contenu de départ pour mesurer jusqu'où une adresse d'étiquette peut s'allonger.");
  }
  const remplissage = modele[modele.length - 1];

  let dernier: LongueurMaximale | null = null;
  // 300 : au-delà de la capacité de la version 10 au niveau L (274
  // octets), l'encodeur lèvera de toute façon.
  for (let longueur = 1; longueur <= 300; longueur += 1) {
    const contenu =
      longueur <= modele.length ? modele.slice(0, longueur) : modele + remplissage.repeat(longueur - modele.length);
    let mesure: MesureDensiteQr;
    try {
      mesure = mesurerDensiteQr(contenu, coteBoiteMm, options);
    } catch {
      // La version 10 est dépassée : ce n'est pas le seuil qui a arrêté
      // la recherche, et il faut que l'appelant puisse le distinguer.
      if (dernier) dernier = { ...dernier, plafondEncodeur: true };
      break;
    }
    if (mesure.tailleModuleMm < seuil) break;
    dernier = {
      longueurMax: longueur,
      version: mesure.version,
      tailleModuleMm: mesure.tailleModuleMm,
      plafondEncodeur: false,
    };
  }
  return dernier;
}
