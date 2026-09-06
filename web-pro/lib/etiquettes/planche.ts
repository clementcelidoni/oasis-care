/**
 * LA PLANCHE — composition, pagination, et la marge de 14 mm contournée.
 *
 * ------------------------------------------------------------------
 * LE PROBLÈME DES 14 MM, ET COMMENT ON LE RÈGLE
 * ------------------------------------------------------------------
 *
 * web-pro/app/globals.css contient, lignes 226-236 :
 *
 *     @media print { @page { margin: 14mm; } }
 *
 * Ce fichier est importé par app/layout.tsx, la mise en page RACINE.
 * Next.js n'offre aucun moyen de s'y soustraire : les quatre-vingts et
 * quelques routes de web-pro en héritent, et les futures aussi. Sous
 * cette règle, 14 + 14 = 28 mm de marges verticales, donc :
 *
 *     25 × 15 mm  →  −13 mm de hauteur imprimable
 *     40 × 20 mm  →   −8 mm
 *     50 × 30 mm  →   +2 mm
 *     60 × 40 mm  →  +12 mm
 *     100 × 50 mm →  +22 mm de haut pour 72 de large
 *
 * AUCUN des cinq formats du § 17 n'est utilisable tel quel, et trois
 * ont une surface imprimable NÉGATIVE.
 *
 * LA SOLUTION RETENUE, et pourquoi celle-là plutôt qu'une autre :
 *
 *   • `@page` ne se limite pas à un sélecteur — c'est une règle de
 *     document, pas d'élément. On ne peut donc pas l'« annuler pour
 *     cette page-ci » depuis une feuille de style ordinaire.
 *   • Mais `@page` obéit à la CASCADE : à spécificité égale, la
 *     déclaration la plus tardive gagne. Une balise <style> placée dans
 *     le CORPS du document est analysée APRÈS les feuilles du <head> —
 *     donc après globals.css. `cssImpressionPlanche()` rend exactement
 *     ce bloc, et la page d'impression le pose dans son corps.
 *   • Les PAGES NOMMÉES (`@page etiquettes { … }` avec
 *     `.planche { page: etiquettes }`) seraient conceptuellement plus
 *     propres, mais la propriété `page` n'est arrivée que tardivement
 *     dans les navigateurs : s'y fier seule laisserait une planche
 *     fausse sur les postes en retard, sans le moindre message.
 *   • MODIFIER globals.css serait la troisième voie. Elle est écartée :
 *     c'est un fichier partagé que d'autres chantiers touchent en ce
 *     moment, et la marge de 14 mm est JUSTE pour un devis. On ne casse
 *     pas le devis pour arranger l'étiquette.
 *
 * ------------------------------------------------------------------
 * ET LES MILLIMÈTRES, ALORS ?
 * ------------------------------------------------------------------
 *
 * Le PDF direct sort aux cotes exactes : le MediaBox les impose, rien
 * ne peut les changer. Le chemin navigateur, lui, dépend de deux
 * réglages que NOTRE CODE NE PEUT PAS FORCER : l'échelle à 100 % et les
 * marges du navigateur à zéro. D'où la RÈGLE DE CONTRÔLE : une barre de
 * 50 mm graduée, imprimée en pied de planche, avec la phrase qui dit
 * quoi en faire. Trois secondes et un décamètre suffisent à transformer
 * une promesse en mesure.
 */

import {
  A4_HAUTEUR_MM,
  A4_LARGEUR_MM,
  HAUTEUR_REGLE_MM,
  caseGrille,
  grilleA4,
  type GrilleA4,
  type OptionsGrilleA4,
} from "./formats.ts";
import { HAUTEUR_CAPITALE, arrondiMm, mm, pointsVersMm } from "./mesures.ts";
import { ecrirePdf, type PagePdf } from "./pdf.ts";
import { rendreEtiquette, type OptionsRendu } from "./rendu.ts";
import { documentSvg, elementsVersSvg } from "./svg.ts";
import type { AvertissementRendu, DonneesEtiquette, ElementRendu, ModeleEtiquette } from "./types.ts";

/** Le support physique : un rouleau continu, ou une feuille A4. */
export type SupportPlanche = "rouleau" | "a4";

export type OptionsPlanche = {
  readonly modele: ModeleEtiquette;
  readonly support: SupportPlanche;
  /** Réglages de la grille A4. Ignorés sur rouleau. */
  readonly grille?: OptionsGrilleA4;
  /** Combien d'exemplaires de CHAQUE étiquette. Par défaut 1. */
  readonly copies?: number;
  /**
   * Combien de cases sauter au début de la première planche.
   * POURQUOI CE RÉGLAGE EXISTE : une planche A4 prédécoupée à moitié
   * entamée est la situation normale d'un atelier. Sans lui, on gâche
   * une demi-feuille d'étiquettes à chaque impression.
   */
  readonly casesSautees?: number;
  /** Tracer le contour de chaque étiquette, pour découper aux ciseaux. */
  readonly traitsDeCoupe?: boolean;
  /** Imprimer la règle de contrôle de 50 mm en pied de planche. */
  readonly regleDeControle?: boolean;
  readonly rendu?: OptionsRendu;
};

export type PagePlanche = {
  readonly largeurMm: number;
  readonly hauteurMm: number;
  readonly elements: readonly ElementRendu[];
  readonly nombreEtiquettes: number;
};

export type Planche = {
  readonly pages: readonly PagePlanche[];
  /** `null` sur rouleau : il n'y a pas de grille, une page = une étiquette. */
  readonly grille: GrilleA4 | null;
  readonly etiquetteLargeurMm: number;
  readonly etiquetteHauteurMm: number;
  readonly nombreEtiquettes: number;
  readonly avertissements: readonly AvertissementRendu[];
};

/** Épaisseur d'un trait de coupe : le plus fin qui s'imprime encore. */
const TRAIT_DE_COUPE_MM = 0.08;

// ------------------------------------------------------------------
// LA RÈGLE DE CONTRÔLE
// ------------------------------------------------------------------

export const LONGUEUR_REGLE_MM = 50;

/**
 * Une barre de 50,0 mm graduée tous les 10 mm, et la phrase qui dit
 * quoi en faire. Rendue en éléments, comme tout le reste : elle sort
 * donc identique en SVG et en PDF, et le test mesure sa longueur.
 */
export function elementsRegleDeControle(xMm: number, yMm: number, largeurPageMm = A4_LARGEUR_MM): ElementRendu[] {
  const elements: ElementRendu[] = [];
  const hauteurBarre = 1.2;

  elements.push({
    type: "rectangle",
    xMm: arrondiMm(xMm),
    yMm: arrondiMm(yMm),
    largeurMm: LONGUEUR_REGLE_MM,
    hauteurMm: hauteurBarre,
    rempli: true,
  });

  // Les graduations montent AU-DESSUS de la barre : posées en dessous,
  // elles seraient confondues avec le texte.
  for (let graduation = 0; graduation <= LONGUEUR_REGLE_MM; graduation += 10) {
    elements.push({
      type: "rectangle",
      xMm: arrondiMm(xMm + graduation - (graduation === LONGUEUR_REGLE_MM ? 0.3 : 0)),
      yMm: arrondiMm(yMm - 2),
      largeurMm: 0.3,
      hauteurMm: 2,
      rempli: true,
    });
  }

  // LA PHRASE EST CENTRÉE SUR LA PAGE, PAS ALIGNÉE SUR LA BARRE.
  // Elle fait près de 180 mm de long ; calée sur le bord gauche d'une
  // barre elle-même centrée (donc à 80 mm), elle finirait à 260 mm sur
  // une feuille qui en fait 210 — imprimée nulle part, et personne ne
  // saurait jamais pourquoi la consigne manque.
  const taillePt = 5.5;
  const margeTexte = 6;
  elements.push({
    type: "texte",
    xMm: arrondiMm(largeurPageMm / 2),
    yMm: arrondiMm(yMm + hauteurBarre + 0.6 + pointsVersMm(taillePt) * HAUTEUR_CAPITALE),
    texte:
      `Cette barre mesure exactement ${LONGUEUR_REGLE_MM} mm. Si votre règle dit autre chose, ` +
      `l'échelle d'impression n'est pas à 100 % : réimprimez avec « Échelle : 100 % » et « Marges : aucune ».`,
    taillePt,
    gras: false,
    italique: false,
    alignement: "centre",
    decoupe: {
      xMm: margeTexte,
      yMm: arrondiMm(yMm + hauteurBarre),
      largeurMm: arrondiMm(largeurPageMm - 2 * margeTexte),
      // TROIS MILLIMÈTRES ET DEMI, PAS CINQ : à cinq, le cadre de
      // découpe débordait du bord de la feuille. Il ne s'imprime pas,
      // mais un cadre qui sort de la page est une erreur qu'on finit
      // par recopier ailleurs.
      hauteurMm: 3.5,
    },
  });

  return elements;
}

// ------------------------------------------------------------------
// LA COMPOSITION
// ------------------------------------------------------------------

/** Décale toute une liste d'éléments. Le seul endroit qui translate. */
function decaler(elements: readonly ElementRendu[], dxMm: number, dyMm: number): ElementRendu[] {
  return elements.map((element) => {
    if (element.type === "texte") {
      return {
        ...element,
        xMm: arrondiMm(element.xMm + dxMm),
        yMm: arrondiMm(element.yMm + dyMm),
        decoupe: {
          ...element.decoupe,
          xMm: arrondiMm(element.decoupe.xMm + dxMm),
          yMm: arrondiMm(element.decoupe.yMm + dyMm),
        },
      };
    }
    return { ...element, xMm: arrondiMm(element.xMm + dxMm), yMm: arrondiMm(element.yMm + dyMm) };
  });
}

export function composerPlanche(entrees: readonly DonneesEtiquette[], options: OptionsPlanche): Planche {
  // UNE PLANCHE SANS ÉTIQUETTE EST REFUSÉE ICI, pas trois appels plus
  // loin dans l'écriture du PDF. « Générer les QR d'un lot » sur un lot
  // vide est un cas normal de l'interface : il doit rendre une phrase
  // que le producteur comprend, pas une erreur de bas niveau.
  if (entrees.length === 0) {
    throw new Error("Aucune étiquette à imprimer : la sélection est vide.");
  }
  const copies = Math.max(1, Math.floor(options.copies ?? 1));
  const modele = options.modele;
  const avertissements: AvertissementRendu[] = [];

  // Chaque étiquette est rendue UNE fois par entrée, pas une fois par
  // copie : encoder deux cents fois le même QR coûterait deux cents
  // Reed-Solomon pour un résultat identique au module près.
  // ON NE DIT PAS DEUX CENTS FOIS LA MÊME CHOSE. Le QR trop dense d'un
  // modèle est un défaut DU MODÈLE : il se répète à l'identique sur
  // chaque étiquette de la planche, et deux cents lignes identiques ne
  // se lisent pas — elles noient les avertissements qui, eux, ne
  // concernent qu'une étiquette (« Trachycarpus fortunei Wagnerianus a
  // dû être coupé »). On dédoublonne sur le texte exact.
  const dejaDits = new Set<string>();
  const rendues = entrees.map((entree) => {
    const rendue = rendreEtiquette(modele, entree, options.rendu);
    for (const avertissement of rendue.avertissements) {
      const cle = `${avertissement.champ ?? ""} ${avertissement.message}`;
      if (dejaDits.has(cle)) continue;
      dejaDits.add(cle);
      avertissements.push(avertissement);
    }
    return rendue;
  });

  const aPlacer: ElementRendu[][] = [];
  for (const rendue of rendues) for (let c = 0; c < copies; c += 1) aPlacer.push([...rendue.elements]);

  const contour = (xMm: number, yMm: number): ElementRendu => ({
    type: "rectangle",
    xMm: arrondiMm(xMm),
    yMm: arrondiMm(yMm),
    largeurMm: arrondiMm(modele.largeurMm),
    hauteurMm: arrondiMm(modele.hauteurMm),
    rempli: false,
    epaisseurMm: TRAIT_DE_COUPE_MM,
  });

  if (options.support === "rouleau") {
    if (options.regleDeControle) {
      avertissements.push({
        champ: null,
        message:
          "La règle de contrôle n'est pas imprimée sur un rouleau : elle mesure 50 mm et prendrait la place " +
          "de l'étiquette. Imprimez une fois la page de contrôle (plancheDeControle) pour régler l'imprimante.",
      });
    }
    const pages: PagePlanche[] = aPlacer.map((elements) => ({
      largeurMm: arrondiMm(modele.largeurMm),
      hauteurMm: arrondiMm(modele.hauteurMm),
      elements: options.traitsDeCoupe ? [contour(0, 0), ...elements] : elements,
      nombreEtiquettes: 1,
    }));
    return {
      pages,
      grille: null,
      etiquetteLargeurMm: arrondiMm(modele.largeurMm),
      etiquetteHauteurMm: arrondiMm(modele.hauteurMm),
      nombreEtiquettes: aPlacer.length,
      avertissements,
    };
  }

  const grille = grilleA4(modele.largeurMm, modele.hauteurMm, {
    ...options.grille,
    regleDeControle: options.regleDeControle ?? options.grille?.regleDeControle ?? false,
  });

  const sautees = Math.max(0, Math.floor(options.casesSautees ?? 0));
  if (sautees >= grille.parPage) {
    throw new Error(
      `On ne peut pas sauter ${sautees} cases : cette planche n'en compte que ${grille.parPage}. ` +
        `Prenez une feuille neuve.`,
    );
  }

  const pages: PagePlanche[] = [];
  let index = 0;
  let premiere = true;
  while (index < aPlacer.length) {
    const debut = premiere ? sautees : 0;
    const elements: ElementRendu[] = [];
    let posees = 0;
    for (let cellule = debut; cellule < grille.parPage && index < aPlacer.length; cellule += 1) {
      const { xMm, yMm } = caseGrille(grille, cellule);
      if (options.traitsDeCoupe) elements.push(contour(xMm, yMm));
      elements.push(...decaler(aPlacer[index], xMm, yMm));
      index += 1;
      posees += 1;
    }
    if (grille.regleDeControle) {
      elements.push(
        ...elementsRegleDeControle(
          (A4_LARGEUR_MM - LONGUEUR_REGLE_MM) / 2,
          A4_HAUTEUR_MM - HAUTEUR_REGLE_MM + 2,
        ),
      );
    }
    pages.push({ largeurMm: A4_LARGEUR_MM, hauteurMm: A4_HAUTEUR_MM, elements, nombreEtiquettes: posees });
    premiere = false;
  }

  return {
    pages,
    grille,
    etiquetteLargeurMm: arrondiMm(modele.largeurMm),
    etiquetteHauteurMm: arrondiMm(modele.hauteurMm),
    nombreEtiquettes: aPlacer.length,
    avertissements,
  };
}

// ------------------------------------------------------------------
// LES DEUX SORTIES
// ------------------------------------------------------------------

/** Un SVG par page, aux cotes exactes. */
export function plancheVersSvg(planche: Planche): string[] {
  return planche.pages.map((page, index) =>
    documentSvg(page.largeurMm, page.hauteurMm, elementsVersSvg(page.elements, `p${index}`), {
      classe: "oasis-planche",
    }),
  );
}

/** Le PDF complet, une page par planche. */
export function plancheVersPdf(planche: Planche): Uint8Array {
  const pages: PagePdf[] = planche.pages.map((page) => ({
    largeurMm: page.largeurMm,
    hauteurMm: page.hauteurMm,
    elements: page.elements,
  }));
  return ecrirePdf(pages);
}

/**
 * LE BLOC CSS À POSER DANS LE CORPS DE LA PAGE D'IMPRESSION.
 *
 * À rendre dans un <style> du <body>, pas du <head> : c'est sa position
 * tardive dans la cascade qui lui fait gagner contre le
 * `@page { margin: 14mm }` de globals.css. Rendu dans le <head>, il
 * perdrait — et la planche sortirait fausse sans un mot.
 */
export function cssImpressionPlanche(planche: Planche): string {
  const page = planche.pages[0];
  if (!page) throw new Error("Planche vide : il n'y a rien à imprimer.");
  const l = mm(page.largeurMm);
  const h = mm(page.hauteurMm);
  return [
    "@media print {",
    "  /* Cette règle DOIT venir après celle de globals.css : à",
    "     spécificité égale, la dernière déclarée gagne. C'est pour cela",
    `     que ce bloc est rendu dans le corps du document. */`,
    `  @page { size: ${l}mm ${h}mm; margin: 0; }`,
    "  html, body { margin: 0; padding: 0; background: #fff; }",
    "  /* RIEN D'AUTRE QUE LES PLANCHES NE DOIT SORTIR DE L'IMPRIMANTE,",
    "     et le sélecteur doit tenir dans une mise en page IMBRIQUÉE.",
    "     Un sélecteur d'enfant direct de body ne marche que si le",
    "     bloc à imprimer est posé JUSTE sous body. Dans une",
    "     application Next.js il est enfoui sous la mise en page racine,",
    "     le bandeau et le fil d'Ariane : cette règle-là aurait masqué",
    "     l'ancêtre commun, donc la planche avec, et sorti une page",
    "     BLANCHE. On nomme donc ce qu'on garde plutôt que ce qu'on",
    "     cache : le bloc, son contenu, et la chaîne de ses ancêtres. */",
    "  body *:not(:has(.oasis-impression)):not(.oasis-impression):not(.oasis-impression *)",
    "    { display: none !important; }",
    "  /* Les ancêtres survivent, mais leurs marges et leurs largeurs",
    "     décaleraient la planche sur la feuille. On les remet à plat. */",
    "  body *:has(.oasis-impression) {",
    "    display: block !important; margin: 0 !important; padding: 0 !important;",
    "    width: auto !important; max-width: none !important; border: 0 !important;",
    "    position: static !important; overflow: visible !important; background: #fff !important; }",
    "  .oasis-impression { display: block !important; margin: 0 !important; padding: 0 !important; }",
    `  .oasis-planche { display: block; width: ${l}mm; height: ${h}mm;`,
    "    break-inside: avoid; page-break-inside: avoid;",
    "    break-after: page; page-break-after: always; }",
    "  .oasis-planche:last-of-type { break-after: auto; page-break-after: auto; }",
    "}",
    "@media screen {",
    "  /* L'aperçu montre la planche à sa taille réelle, ombrée comme une",
    "     feuille posée sur un bureau : c'est le seul moyen de se rendre",
    "     compte qu'une étiquette de 25 mm est petite. */",
    `  .oasis-planche { display: block; width: ${l}mm; height: ${h}mm;`,
    "    margin: 0 auto 8mm; box-shadow: 0 1px 6px rgba(0,0,0,0.25); background: #fff; }",
    "}",
  ].join("\n");
}

// ------------------------------------------------------------------
// LA PAGE DE CONTRÔLE DE L'IMPRIMANTE
// ------------------------------------------------------------------

/**
 * Une A4 à imprimer UNE FOIS, avant la première planche, pour régler
 * l'imprimante. Deux règles perpendiculaires de 150 et 200 mm : à cette
 * longueur, une dérive de 2 % fait 3 et 4 mm — visible à l'œil nu, et
 * indiscutable au décamètre. Sur une barre de 50 mm, les mêmes 2 % font
 * un millimètre, qu'on peut toujours mettre sur le compte du trait.
 */
export function plancheDeControle(): Planche {
  const elements: ElementRendu[] = [];
  const x0 = 20;
  const y0 = 40;
  const horizontale = 150;
  const verticale = 200;

  const texte = (
    xMm: number,
    yMm: number,
    contenu: string,
    taillePt: number,
    gras = false,
  ): ElementRendu => ({
    type: "texte",
    xMm: arrondiMm(xMm),
    yMm: arrondiMm(yMm),
    texte: contenu,
    taillePt,
    gras,
    italique: false,
    alignement: "gauche",
    decoupe: { xMm: 0, yMm: 0, largeurMm: A4_LARGEUR_MM, hauteurMm: A4_HAUTEUR_MM },
  });

  elements.push(texte(x0, 20, "Oasis Rare Care — contrôle de l'échelle d'impression", 12, true));
  elements.push(
    texte(
      x0,
      26,
      "Imprimez cette page avec « Échelle : 100 % » et « Marges : aucune », puis mesurez les deux barres.",
      8,
    ),
  );
  elements.push(
    texte(
      x0,
      31,
      "Si elles ne font pas exactement 150 et 200 mm, aucune planche d'étiquettes ne sortira aux bonnes cotes.",
      8,
    ),
  );

  // Barre horizontale, graduée tous les 10 mm.
  elements.push({ type: "rectangle", xMm: x0, yMm: y0, largeurMm: horizontale, hauteurMm: 1.5, rempli: true });
  for (let g = 0; g <= horizontale; g += 10) {
    const majeure = g % 50 === 0;
    elements.push({
      type: "rectangle",
      xMm: arrondiMm(x0 + g - (g === horizontale ? 0.4 : 0)),
      yMm: arrondiMm(y0 - (majeure ? 4 : 2.5)),
      largeurMm: 0.4,
      hauteurMm: majeure ? 4 : 2.5,
      rempli: true,
    });
    if (majeure) elements.push(texte(x0 + g + 0.6, y0 - 4.8, `${g}`, 6));
  }
  elements.push(texte(x0, y0 + 6, `Cette barre doit mesurer ${horizontale} mm.`, 9, true));

  // Barre verticale.
  elements.push({ type: "rectangle", xMm: x0, yMm: y0 + 14, largeurMm: 1.5, hauteurMm: verticale, rempli: true });
  for (let g = 0; g <= verticale; g += 10) {
    const majeure = g % 50 === 0;
    elements.push({
      type: "rectangle",
      xMm: arrondiMm(x0 + 1.5),
      yMm: arrondiMm(y0 + 14 + g - (g === verticale ? 0.4 : 0)),
      largeurMm: majeure ? 4 : 2.5,
      hauteurMm: 0.4,
      rempli: true,
    });
    if (majeure) elements.push(texte(x0 + 6.5, y0 + 14 + g + 1.5, `${g}`, 6));
  }
  elements.push(texte(x0 + 10, y0 + 14 + verticale - 2, `Cette barre doit mesurer ${verticale} mm.`, 9, true));

  return {
    pages: [{ largeurMm: A4_LARGEUR_MM, hauteurMm: A4_HAUTEUR_MM, elements, nombreEtiquettes: 0 }],
    grille: null,
    etiquetteLargeurMm: 0,
    etiquetteHauteurMm: 0,
    nombreEtiquettes: 0,
    avertissements: [],
  };
}
