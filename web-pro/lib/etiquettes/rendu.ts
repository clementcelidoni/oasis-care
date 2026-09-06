/**
 * LE MOTEUR DE MISE EN PAGE — UN SEUL, POUR LES DEUX SORTIES.
 *
 * Ce fichier transforme « un modèle du § 18 + les données d'un élément »
 * en une LISTE D'ÉLÉMENTS GÉOMÉTRIQUES EN MILLIMÈTRES. Le SVG et le PDF
 * ne font ensuite que transcrire cette liste.
 *
 * POURQUOI CE DÉTOUR PLUTÔT QUE DEUX RENDUS DIRECTS. Parce que deux
 * moteurs de mise en page divergent — toujours, et au pire moment : le
 * paysagiste valide sa planche à l'écran, l'imprime, et découvre que le
 * nom scientifique déborde sur le QR. Un seul moteur, deux
 * transcriptions bêtes, et l'aperçu EST le résultat.
 *
 * Et parce que les cotes deviennent testables. Un test qui vérifie une
 * chaîne « <rect x="2.5" » vérifie une chaîne. Un test qui vérifie
 * `elements[3].xMm === 2.5` vérifie une COTE.
 *
 * RIEN N'EST SILENCIEUX. Un texte trop long, un code-barres impossible,
 * un QR trop dense : chaque cas remonte dans `avertissements`. Une
 * étiquette ratée coûte un autocollant et un déplacement au jardin ;
 * elle ne doit jamais se découvrir sur place.
 */

import { encoderCode39, moduleCode39Mm, normaliserPourCode39 } from "./code39.ts";
import { remarquesDensite } from "./densite.ts";
import {
  HAUTEUR_CAPITALE,
  PROFONDEUR_JAMBAGE,
  arrondiMm,
  largeurTexteMm,
  pointsVersMm,
} from "./mesures.ts";
import { SILENCE_QR_MODULES, encoderQr, type NiveauCorrection } from "./qr.ts";
import type {
  AvertissementRendu,
  ChampEtiquette,
  ChampPlace,
  DonneesEtiquette,
  ElementRendu,
  EtiquetteRendue,
  ModeleEtiquette,
} from "./types.ts";

// La zone de silence vit dans l'encodeur (voir qr.ts). On la
// ré-exporte ici parce que tout le reste du produit la lit depuis ce
// module — casser cet import n'apporterait rien.
export { SILENCE_QR_MODULES } from "./qr.ts";

/** En dessous, un appareil photo de téléphone décroche. Voir densite.ts. */
export const MODULE_QR_MINIMAL_MM = 0.33;

/** Corps minimal : en dessous de 4 points, plus personne ne lit. */
export const CORPS_MINIMAL_PT = 4;

export type OptionsRendu = {
  readonly niveauCorrection?: NiveauCorrection;
  /** Tracer un filet gris autour de chaque champ, pour caler un modèle. */
  readonly cadresDeReperage?: boolean;
};

/** Les libellés affichés quand un champ n'a pas de valeur, en aperçu. */
const EXEMPLES: Readonly<Record<ChampEtiquette, string>> = {
  logo: "OASIS RARE CARE",
  nom: "Palmier de Chine",
  nomScientifique: "Trachycarpus fortunei",
  cultivar: "« Wagnerianus »",
  numeroLot: "LOT-2026-004",
  date: "05/09/2026",
  quantite: "120 u",
  emplacement: "Serre 2 — B3",
  stade: "Multiplication",
  qr: "",
  codeBarres: "LOT-2026-004",
  texteLibre: "Arrosage modéré, plein soleil.",
};

/** Un modèle d'aperçu rempli de valeurs d'exemple. */
export function donneesExemple(url: string): DonneesEtiquette {
  return { url, valeurs: { ...EXEMPLES } };
}

// ------------------------------------------------------------------
// VÉRIFICATION DU MODÈLE
// ------------------------------------------------------------------

/**
 * Ce qui rend un modèle inimprimable. On refuse AVANT de composer, pas
 * devant l'imprimante avec le rouleau engagé — c'est le raisonnement
 * de `etiquette_champs_valides` en base, transposé côté web.
 */
export function verifierModele(modele: ModeleEtiquette): string[] {
  const fautes: string[] = [];
  const { largeurMm, hauteurMm, margeMm } = modele;

  if (!(largeurMm > 0) || !(hauteurMm > 0)) fautes.push("L'étiquette doit avoir une largeur et une hauteur positives.");
  if (margeMm < 0) fautes.push("La marge de l'étiquette ne peut pas être négative.");
  if (margeMm * 2 >= Math.min(largeurMm, hauteurMm)) {
    fautes.push(
      `La marge de ${margeMm} mm mange l'étiquette entière (${largeurMm} × ${hauteurMm} mm) : il ne resterait rien à imprimer.`,
    );
  }

  const gauche = margeMm;
  const haut = margeMm;
  const droite = largeurMm - margeMm;
  const bas = hauteurMm - margeMm;

  modele.champs.forEach((champ, index) => {
    const situation = `Le champ « ${champ.champ} » (nº ${index + 1})`;
    if (!(champ.largeur > 0) || !(champ.hauteur > 0)) {
      fautes.push(`${situation} doit avoir une largeur et une hauteur positives.`);
      return;
    }
    if (champ.x < gauche - 1e-6 || champ.y < haut - 1e-6) {
      fautes.push(`${situation} entre dans la marge : la tête d'impression la mordrait.`);
    }
    if (champ.x + champ.largeur > droite + 1e-6 || champ.y + champ.hauteur > bas + 1e-6) {
      fautes.push(
        `${situation} déborde de l'étiquette : il finit à ` +
          `${arrondiMm(champ.x + champ.largeur)} × ${arrondiMm(champ.y + champ.hauteur)} mm ` +
          `alors que la zone imprimable s'arrête à ${arrondiMm(droite)} × ${arrondiMm(bas)} mm.`,
      );
    }
  });

  return fautes;
}

// ------------------------------------------------------------------
// AJUSTEMENT DU TEXTE
// ------------------------------------------------------------------

/** 2 % de sécurité : les chasses du gras sont approchées (voir mesures.ts). */
const SECURITE_LARGEUR = 0.98;

type TexteAjuste = { texte: string; taillePt: number; coupe: boolean };

function ajusterTexte(texte: string, largeurMm: number, taillePt: number, gras: boolean): TexteAjuste {
  const tient = (t: string, taille: number) => largeurTexteMm(t, taille, gras) <= largeurMm * SECURITE_LARGEUR;
  if (tient(texte, taillePt)) return { texte, taillePt, coupe: false };

  // On réduit d'abord le corps, par quarts de point : réduire est
  // toujours préférable à couper, un nom d'espèce tronqué ne veut plus
  // rien dire.
  for (let taille = taillePt - 0.25; taille >= CORPS_MINIMAL_PT; taille -= 0.25) {
    if (tient(texte, taille)) return { texte, taillePt: Math.round(taille * 100) / 100, coupe: false };
  }

  // Puis on coupe, avec des points de suspension pour que la coupe SE
  // VOIE : un nom tronqué sans marque se lit comme un nom complet.
  let coupe = texte;
  while (coupe.length > 1 && !tient(`${coupe}…`, CORPS_MINIMAL_PT)) coupe = coupe.slice(0, -1);
  return { texte: `${coupe}…`, taillePt: CORPS_MINIMAL_PT, coupe: true };
}

/** Découpe un texte en lignes qui tiennent dans la largeur donnée. */
function decouperEnLignes(texte: string, largeurMm: number, taillePt: number, gras: boolean): string[] {
  const lignes: string[] = [];
  for (const paragraphe of texte.split("\n")) {
    let courante = "";
    for (const mot of paragraphe.split(/\s+/).filter(Boolean)) {
      const essai = courante ? `${courante} ${mot}` : mot;
      if (largeurTexteMm(essai, taillePt, gras) <= largeurMm * SECURITE_LARGEUR || !courante) {
        courante = essai;
      } else {
        lignes.push(courante);
        courante = mot;
      }
    }
    lignes.push(courante);
  }
  return lignes;
}

function ancrageX(champ: ChampPlace): number {
  const alignement = champ.alignement ?? "gauche";
  if (alignement === "centre") return champ.x + champ.largeur / 2;
  if (alignement === "droite") return champ.x + champ.largeur;
  return champ.x;
}

/** Corps par défaut d'un champ : les trois quarts de la hauteur du cadre. */
function corpsParDefaut(champ: ChampPlace): number {
  if (champ.taille && champ.taille > 0) return champ.taille;
  const pointsDisponibles = (champ.hauteur / 25.4) * 72;
  return Math.max(CORPS_MINIMAL_PT, Math.round(pointsDisponibles * 0.75 * 4) / 4);
}

// ------------------------------------------------------------------
// LE RENDU
// ------------------------------------------------------------------

export function rendreEtiquette(
  modele: ModeleEtiquette,
  donnees: DonneesEtiquette,
  options: OptionsRendu = {},
): EtiquetteRendue {
  const fautes = verifierModele(modele);
  if (fautes.length > 0) {
    throw new Error(`Ce modèle d'étiquette ne peut pas être imprimé :\n— ${fautes.join("\n— ")}`);
  }

  const elements: ElementRendu[] = [];
  const avertissements: AvertissementRendu[] = [];

  for (const champ of modele.champs) {
    if (options.cadresDeReperage || champ.cadre) {
      elements.push({
        type: "rectangle",
        xMm: arrondiMm(champ.x),
        yMm: arrondiMm(champ.y),
        largeurMm: arrondiMm(champ.largeur),
        hauteurMm: arrondiMm(champ.hauteur),
        rempli: false,
        epaisseurMm: 0.1,
      });
    }

    if (champ.champ === "qr") {
      rendreQr(champ, donnees, options, elements, avertissements);
      continue;
    }
    if (champ.champ === "codeBarres") {
      rendreCodeBarres(champ, donnees, elements, avertissements);
      continue;
    }
    if (champ.champ === "logo" && donnees.logoDataUri) {
      elements.push({
        type: "image",
        xMm: arrondiMm(champ.x),
        yMm: arrondiMm(champ.y),
        largeurMm: arrondiMm(champ.largeur),
        hauteurMm: arrondiMm(champ.hauteur),
        dataUri: donnees.logoDataUri,
      });
      continue;
    }
    rendreTexte(champ, donnees, elements, avertissements);
  }

  return {
    largeurMm: arrondiMm(modele.largeurMm),
    hauteurMm: arrondiMm(modele.hauteurMm),
    elements,
    avertissements,
  };
}

function rendreTexte(
  champ: ChampPlace,
  donnees: DonneesEtiquette,
  elements: ElementRendu[],
  avertissements: AvertissementRendu[],
): void {
  const valeur = (donnees.valeurs[champ.champ] ?? "").trim();
  if (!valeur) return;

  const gras = champ.gras ?? false;
  const italique = champ.italique ?? false;
  const corps = corpsParDefaut(champ);
  const decoupe = {
    xMm: arrondiMm(champ.x),
    yMm: arrondiMm(champ.y),
    largeurMm: arrondiMm(champ.largeur),
    hauteurMm: arrondiMm(champ.hauteur),
  };

  // Seul le texte libre passe à la ligne : c'est le seul champ dont le
  // § 18 laisse entendre qu'il peut être long. Un nom scientifique sur
  // deux lignes serait illisible sur 25 mm.
  const multiligne = champ.champ === "texteLibre";
  const hauteurLigneMm = pointsVersMm(corps) * 1.15;

  if (multiligne) {
    const lignesPossibles = Math.max(1, Math.floor(champ.hauteur / hauteurLigneMm));
    const lignes = decouperEnLignes(valeur, champ.largeur, corps, gras);
    const retenues = lignes.slice(0, lignesPossibles);
    if (lignes.length > retenues.length) {
      avertissements.push({
        champ: champ.champ,
        message:
          `Le texte libre a été tronqué : ${lignes.length} lignes ne tiennent pas dans ` +
          `${arrondiMm(champ.hauteur)} mm de haut, ${retenues.length} sont imprimées.`,
      });
    }
    const hauteurBloc = retenues.length * hauteurLigneMm;
    const premiereBase = champ.y + (champ.hauteur - hauteurBloc) / 2 + pointsVersMm(corps) * HAUTEUR_CAPITALE;
    const poses: ElementRendu[] = [];
    retenues.forEach((ligne, index) => {
      poses.push({
        type: "texte",
        xMm: arrondiMm(ancrageX(champ)),
        yMm: arrondiMm(premiereBase + index * hauteurLigneMm),
        texte: ligne,
        taillePt: corps,
        gras,
        italique,
        alignement: champ.alignement ?? "gauche",
        decoupe,
      });
    });
    signalerDebordementVertical(champ, poses, avertissements);
    elements.push(...poses);
    return;
  }

  const ajuste = ajusterTexte(valeur, champ.largeur, corps, gras);
  if (ajuste.coupe) {
    avertissements.push({
      champ: champ.champ,
      message:
        `« ${valeur} » a dû être coupé : même à ${CORPS_MINIMAL_PT} points il ne tient pas dans ` +
        `${arrondiMm(champ.largeur)} mm. Élargissez le champ ou raccourcissez le texte.`,
    });
  } else if (ajuste.taillePt < corps) {
    avertissements.push({
      champ: champ.champ,
      message: `« ${valeur} » a été réduit de ${corps} à ${ajuste.taillePt} points pour tenir dans son cadre.`,
    });
  }

  // Centrage vertical sur la HAUTEUR DE CAPITALE : un texte centré sur
  // la hauteur totale de la police paraît toujours trop haut, parce que
  // la place des jambages du « p » et du « g » reste vide.
  const capitaleMm = pointsVersMm(ajuste.taillePt) * HAUTEUR_CAPITALE;
  const pose: ElementRendu = {
    type: "texte",
    xMm: arrondiMm(ancrageX(champ)),
    yMm: arrondiMm(champ.y + (champ.hauteur + capitaleMm) / 2),
    texte: ajuste.texte,
    taillePt: ajuste.taillePt,
    gras,
    italique,
    alignement: champ.alignement ?? "gauche",
    decoupe,
  };
  signalerDebordementVertical(champ, [pose], avertissements);
  elements.push(pose);
}

/**
 * LE TEXTE TIENT-IL EN HAUTEUR ? Personne ne le vérifiait.
 *
 * `ajusterTexte` n'ajuste que la LARGEUR, et `verifierModele` ne
 * contrôle que le rectangle du cadre. Un corps de 24 points dans un
 * cadre de 4 mm passait donc sans un mot : mesuré sur une 60 × 40, les
 * glyphes s'étalaient de 0,96 à 8,83 mm alors que le cadre allait de 2
 * à 6 — ils mordaient la marge en haut et entraient de 2,83 mm dans le
 * champ voisin. Et comme le PDF découpe toujours alors que le SVG ne
 * découpait qu'en cas de débordement en largeur, l'aperçu et le
 * fichier imprimé montraient deux choses différentes.
 *
 * CE QU'ON MESURE : l'encre réelle. Le haut d'une ligne est sa ligne de
 * base moins la hauteur de capitale ; le bas, sa ligne de base plus la
 * profondeur de jambage — un « g » descend, même si le mot n'en a pas,
 * parce que le cadre doit tenir n'importe quel texte.
 *
 * ON AVERTIT, ON NE CORRIGE PAS. Réduire d'office le corps changerait
 * en silence la composition d'une étiquette que quelqu'un a réglée au
 * dixième ; le § 18 demande que l'éditeur MONTRE ce qui ne rentre pas.
 * La découpe, elle, est posée dans les deux sorties : ce qui est
 * annoncé est ce qui sort.
 */
function signalerDebordementVertical(
  champ: ChampPlace,
  poses: readonly ElementRendu[],
  avertissements: AvertissementRendu[],
): void {
  let hautMm = Number.POSITIVE_INFINITY;
  let basMm = Number.NEGATIVE_INFINITY;
  for (const pose of poses) {
    if (pose.type !== "texte") continue;
    hautMm = Math.min(hautMm, pose.yMm - pointsVersMm(pose.taillePt) * HAUTEUR_CAPITALE);
    basMm = Math.max(basMm, pose.yMm + pointsVersMm(pose.taillePt) * PROFONDEUR_JAMBAGE);
  }
  if (!Number.isFinite(hautMm) || !Number.isFinite(basMm)) return;

  // UN DIXIÈME DE MILLIMÈTRE DE TOLÉRANCE. En dessous, on parlerait
  // d'arrondis de calcul plutôt que de mise en page, et un avertissement
  // qui crie pour rien finit par ne plus être lu.
  const TOLERANCE_MM = 0.1;
  const depasseEnHaut = champ.y - hautMm > TOLERANCE_MM;
  const depasseEnBas = basMm - (champ.y + champ.hauteur) > TOLERANCE_MM;
  if (!depasseEnHaut && !depasseEnBas) return;

  const debord = arrondiMm(Math.max(champ.y - hautMm, basMm - (champ.y + champ.hauteur)));
  avertissements.push({
    champ: champ.champ,
    message:
      `Le texte déborde de son cadre en hauteur : ${debord} mm de trop ` +
      `(cadre de ${arrondiMm(champ.hauteur)} mm de haut). Il sera tranché à l'impression. ` +
      `Réduisez le corps ou agrandissez le cadre.`,
  });
}

function rendreQr(
  champ: ChampPlace,
  donnees: DonneesEtiquette,
  options: OptionsRendu,
  elements: ElementRendu[],
  avertissements: AvertissementRendu[],
): void {
  if (!donnees.url) {
    avertissements.push({ champ: "qr", message: "Aucune adresse à encoder : le QR n'a pas été imprimé." });
    return;
  }

  const matrice = encoderQr(donnees.url, { niveau: options.niveauCorrection ?? "M" });
  const cote = Math.min(champ.largeur, champ.hauteur);
  const modulesTotal = matrice.taille + 2 * SILENCE_QR_MODULES;
  const tailleModule = cote / modulesTotal;

  if (tailleModule < MODULE_QR_MINIMAL_MM) {
    avertissements.push({
      champ: "qr",
      message:
        `Le QR fait ${arrondiMm(tailleModule)} mm par module (version ${matrice.version}, ` +
        `${matrice.taille} modules plus ${SILENCE_QR_MODULES} de silence de chaque côté) : sous ` +
        `${MODULE_QR_MINIMAL_MM} mm, un appareil photo de téléphone décroche. Agrandissez le cadre du QR, ` +
        `ou raccourcissez l'adresse.`,
    });
  } else {
    // AU-DESSUS DU PLANCHER N'EST PAS « BON ». Le seuil unique de
    // 0,33 mm ne dit rien du confort de lecture ni de ce qu'une tête
    // thermique saura tracer : à 3,51 points par module, l'imprimante
    // alterne 3 et 4 points et déforme la grille — la cause la plus
    // fréquente des QR thermiques illisibles. densite.ts sait dire tout
    // cela depuis le début ; personne ne l'appelait depuis la planche.
    //
    // On ne le dit PAS deux fois : sous le plancher, le message
    // ci-dessus est plus précis et se suffit.
    for (const remarque of remarquesDensite(tailleModule)) {
      avertissements.push({ champ: "qr", message: remarque, niveau: "remarque" });
    }
  }

  // Le carré est centré dans son cadre : si le cadre n'est pas carré, le
  // QR ne s'étire pas — un QR étiré ne se scanne pas.
  const origineX = champ.x + (champ.largeur - cote) / 2 + SILENCE_QR_MODULES * tailleModule;
  const origineY = champ.y + (champ.hauteur - cote) / 2 + SILENCE_QR_MODULES * tailleModule;

  // ON FUSIONNE LES MODULES SOMBRES CONSÉCUTIFS. Un QR de version 4
  // compte 1089 modules ; en rectangles séparés, cela pèse quatre fois
  // plus dans le PDF et le SVG, et surtout cela laisse un filet blanc
  // d'arrondi entre deux modules voisins que certains moteurs de rendu
  // font apparaître à l'impression.
  for (let y = 0; y < matrice.taille; y += 1) {
    let x = 0;
    while (x < matrice.taille) {
      if (!matrice.modules[y][x]) {
        x += 1;
        continue;
      }
      let fin = x;
      while (fin < matrice.taille && matrice.modules[y][fin]) fin += 1;
      elements.push({
        type: "rectangle",
        xMm: arrondiMm(origineX + x * tailleModule),
        yMm: arrondiMm(origineY + y * tailleModule),
        largeurMm: arrondiMm((fin - x) * tailleModule),
        hauteurMm: arrondiMm(tailleModule),
        rempli: true,
      });
      x = fin;
    }
  }
}

function rendreCodeBarres(
  champ: ChampPlace,
  donnees: DonneesEtiquette,
  elements: ElementRendu[],
  avertissements: AvertissementRendu[],
): void {
  const brut = (donnees.valeurs.codeBarres ?? donnees.valeurs.numeroLot ?? "").trim();
  if (!brut) return;

  const { valeur, modifie } = normaliserPourCode39(brut);
  if (modifie) {
    avertissements.push({
      champ: "codeBarres",
      message:
        `Le code-barres imprime « ${valeur} » et non « ${brut} » : le Code 39 ne connaît que les ` +
        `majuscules, les chiffres et « - . $ / + % espace ».`,
    });
  }

  const code = encoderCode39(valeur);
  const moduleEtroitMm = moduleCode39Mm(code, champ.largeur);
  if (moduleEtroitMm < 0.19) {
    avertissements.push({
      champ: "codeBarres",
      message:
        `Le code-barres fait ${arrondiMm(moduleEtroitMm)} mm par module étroit sur ${arrondiMm(champ.largeur)} mm : ` +
        `sous 0,19 mm, une douchette de poste ne le lit plus. Élargissez le champ, ou raccourcissez le numéro.`,
    });
  }

  for (const barre of code.barres) {
    elements.push({
      type: "rectangle",
      xMm: arrondiMm(champ.x + barre.debutModules * moduleEtroitMm),
      yMm: arrondiMm(champ.y),
      largeurMm: arrondiMm(barre.largeurModules * moduleEtroitMm),
      hauteurMm: arrondiMm(champ.hauteur),
      rempli: true,
    });
  }
}
