import { test } from "node:test";
import assert from "node:assert/strict";

import {
  A4_HAUTEUR_MM,
  A4_LARGEUR_MM,
  BAS_IMPRIMABLE_A4_MM,
  FORMATS_ETIQUETTE,
  HAUTEUR_REGLE_MM,
  caseGrille,
  formatPersonnalise,
  grilleA4,
} from "./formats.ts";
import { MM_PAR_POUCE, POINTS_PAR_POUCE, largeurTexteMm, mmVersPoints, pointsVersMm } from "./mesures.ts";
import { lireCotesPdf } from "./pdf.ts";
import {
  LONGUEUR_REGLE_MM,
  composerPlanche,
  cssImpressionPlanche,
  elementsRegleDeControle,
  plancheDeControle,
  plancheVersPdf,
  plancheVersSvg,
} from "./planche.ts";
import { MODELES_OASIS } from "./modeles.ts";
import { donneesExemple } from "./rendu.ts";
import type { DonneesEtiquette, ModeleEtiquette } from "./types.ts";

/**
 * LES MILLIMÈTRES SONT DES MILLIMÈTRES.
 *
 * Ces tests ne regardent PAS à quoi ressemble une étiquette. Ils
 * regardent ses COTES, et rien d'autre — parce qu'une planche qui dérive
 * de 2 % est physiquement inutilisable : le rouleau die-cut a ses
 * découpes à un pas fixe, et le décalage s'accumule d'une étiquette à la
 * suivante jusqu'à ce que le QR tombe à cheval sur deux autocollants.
 *
 * LA TOLÉRANCE RETENUE EST DE 1 µm — 0,001 mm. Ce n'est pas du zèle :
 * c'est vingt mille fois plus serré que les 2 % qui condamnent une
 * planche, et mille fois plus fin qu'un point de tête thermique à
 * 203 dpi. Une tolérance lâche laisserait passer exactement le défaut
 * qu'on cherche à interdire.
 *
 * ET ON MESURE LE DOCUMENT PRODUIT, pas l'intention : `lireCotesPdf`
 * rouvre les octets du PDF et relit les MediaBox que le lecteur lira.
 */

const MICRON = 0.001;

const URL_ESSAI = "https://oasisrarecare.fr/x/3f8a1c4e9b2d7a604f5e1c8b3d9a2e70";

function exemple(): DonneesEtiquette {
  return donneesExemple(URL_ESSAI);
}

// ==================================================================
// LES CONVERSIONS
// ==================================================================

test("un pouce vaut 25,4 mm et 72 points, exactement", () => {
  assert.equal(MM_PAR_POUCE, 25.4);
  assert.equal(POINTS_PAR_POUCE, 72);
  assert.equal(mmVersPoints(25.4), 72);
  assert.equal(pointsVersMm(72), 25.4);
  // Aller-retour sur cent valeurs : la conversion ne doit rien perdre.
  for (let v = 1; v <= 100; v += 1) {
    assert.ok(Math.abs(pointsVersMm(mmVersPoints(v)) - v) < 1e-9, `${v} mm`);
  }
});

// ==================================================================
// LES CINQ FORMATS DU § 17
// ==================================================================

test("les cinq formats du § 17 portent exactement les cotes annoncées", () => {
  assert.deepEqual(
    FORMATS_ETIQUETTE.map((f) => [f.cle, f.largeurMm, f.hauteurMm]),
    [
      ["25x15", 25, 15],
      ["40x20", 40, 20],
      ["50x30", 50, 30],
      ["60x40", 60, 40],
      ["100x50", 100, 50],
    ],
  );
});

test("chaque format sort du PDF aux cotes EXACTES, mesurées sur le fichier", () => {
  for (const format of FORMATS_ETIQUETTE) {
    const modele: ModeleEtiquette = {
      famille: "pepiniere",
      nom: `essai ${format.nom}`,
      largeurMm: format.largeurMm,
      hauteurMm: format.hauteurMm,
      margeMm: 1,
      champs: [
        {
          champ: "qr",
          x: 1,
          y: 1,
          largeur: Math.min(format.largeurMm, format.hauteurMm) - 2,
          hauteur: Math.min(format.largeurMm, format.hauteurMm) - 2,
        },
      ],
    };
    const planche = composerPlanche([exemple()], { modele, support: "rouleau" });
    const cotes = lireCotesPdf(plancheVersPdf(planche));
    assert.equal(cotes.length, 1, format.nom);
    assert.ok(Math.abs(cotes[0].largeurMm - format.largeurMm) < MICRON, `${format.nom} : largeur`);
    assert.ok(Math.abs(cotes[0].hauteurMm - format.hauteurMm) < MICRON, `${format.nom} : hauteur`);
  }
});

test("un format personnalisé sort aux cotes demandées, virgules comprises", () => {
  for (const [largeur, hauteur] of [
    [38.1, 21.2],
    [101.6, 50.8], // 4 × 2 pouces : le rouleau Zebra le plus répandu
    [7, 5],
    [1000, 1000],
  ] as const) {
    const format = formatPersonnalise(largeur, hauteur);
    const planche = composerPlanche([exemple()], {
      modele: {
        famille: "biolab",
        nom: format.nom,
        largeurMm: format.largeurMm,
        hauteurMm: format.hauteurMm,
        margeMm: 0.5,
        champs: [],
      },
      support: "rouleau",
    });
    const cotes = lireCotesPdf(plancheVersPdf(planche));
    assert.ok(Math.abs(cotes[0].largeurMm - largeur) < MICRON, `${format.nom} : largeur`);
    assert.ok(Math.abs(cotes[0].hauteurMm - hauteur) < MICRON, `${format.nom} : hauteur`);
  }
});

test("un format hors bornes est refusé, avec la borne dans le message", () => {
  assert.throws(() => formatPersonnalise(2, 20), /entre 5 et 1000 mm/);
  assert.throws(() => formatPersonnalise(20, 1200), /entre 5 et 1000 mm/);
  assert.throws(() => formatPersonnalise(Number.NaN, 20), /nombre de millimètres/);
});

// ==================================================================
// LA PLANCHE A4 : SES MARGES ET SON PAS DE GRILLE
// ==================================================================

test("la planche A4 fait 210 × 297 mm dans le PDF produit", () => {
  const planche = composerPlanche([exemple()], { modele: MODELES_OASIS.pepiniere, support: "a4" });
  const cotes = lireCotesPdf(plancheVersPdf(planche));
  assert.ok(Math.abs(cotes[0].largeurMm - A4_LARGEUR_MM) < MICRON);
  assert.ok(Math.abs(cotes[0].hauteurMm - A4_HAUTEUR_MM) < MICRON);
});

test("le pas de grille vaut l'étiquette plus la gouttière, sans dérive sur toute la planche", () => {
  for (const format of FORMATS_ETIQUETTE) {
    const grille = grilleA4(format.largeurMm, format.hauteurMm, { gouttiereXMm: 2, gouttiereYMm: 3 });
    assert.ok(Math.abs(grille.pasXMm - (format.largeurMm + 2)) < MICRON, `${format.nom} : pas X`);
    assert.ok(Math.abs(grille.pasYMm - (format.hauteurMm + 3)) < MICRON, `${format.nom} : pas Y`);

    // LE POINT CRITIQUE : la dernière case doit tomber exactement où
    // l'arithmétique la met, sans accumulation d'arrondis. Sur douze
    // colonnes, une dérive de 0,01 mm par pas ferait déjà 0,12 mm.
    const derniere = caseGrille(grille, grille.parPage - 1);
    const attenduX = grille.origineXMm + (grille.colonnes - 1) * grille.pasXMm;
    const attenduY = grille.origineYMm + (grille.lignes - 1) * grille.pasYMm;
    assert.ok(Math.abs(derniere.xMm - attenduX) < MICRON, `${format.nom} : dernière colonne`);
    assert.ok(Math.abs(derniere.yMm - attenduY) < MICRON, `${format.nom} : dernière ligne`);
  }
});

test("aucune étiquette ne déborde de la feuille, ni n'entre dans la marge non imprimable", () => {
  for (const format of FORMATS_ETIQUETTE) {
    for (const marge of [5, 8, 12]) {
      const grille = grilleA4(format.largeurMm, format.hauteurMm, { margeMm: marge });
      const derniere = caseGrille(grille, grille.parPage - 1);
      assert.ok(grille.origineXMm >= marge - MICRON, `${format.nom} : bord gauche à ${grille.origineXMm}`);
      assert.ok(grille.origineYMm >= marge - MICRON, `${format.nom} : bord haut à ${grille.origineYMm}`);
      assert.ok(
        derniere.xMm + format.largeurMm <= A4_LARGEUR_MM - marge + MICRON,
        `${format.nom} : dépasse à droite`,
      );
      assert.ok(
        derniere.yMm + format.hauteurMm <= A4_HAUTEUR_MM - marge + MICRON,
        `${format.nom} : dépasse en bas`,
      );
    }
  }
});

test("le nombre d'étiquettes par planche est celui que la géométrie permet", () => {
  // Vérification à la main pour deux formats, marge 5 mm, gouttière 2 mm.
  // Zone utile : 200 × 287 mm.
  //   50 × 30 → (200+2)/(50+2) = 3,88 → 3 colonnes ; (287+2)/(30+2) = 9,03 → 9 lignes.
  //   25 × 15 → (200+2)/(25+2) = 7,48 → 7 colonnes ; (287+2)/(15+2) = 17,0 → 17 lignes.
  const cinquante = grilleA4(50, 30);
  assert.equal(cinquante.colonnes, 3);
  assert.equal(cinquante.lignes, 9);
  assert.equal(cinquante.parPage, 27);

  const petite = grilleA4(25, 15);
  assert.equal(petite.colonnes, 7);
  assert.equal(petite.lignes, 17);
  assert.equal(petite.parPage, 119);
});

test("le bloc centré laisse le même blanc des deux côtés", () => {
  const grille = grilleA4(50, 30, { centrer: true });
  const largeurBloc = grille.colonnes * 50 + (grille.colonnes - 1) * 2;
  const droite = A4_LARGEUR_MM - (grille.origineXMm + largeurBloc);
  assert.ok(Math.abs(grille.origineXMm - droite) < MICRON, `gauche ${grille.origineXMm} ≠ droite ${droite}`);
});

test("sans centrage, le bloc part de la marge exacte", () => {
  const grille = grilleA4(50, 30, { centrer: false, margeMm: 7 });
  assert.equal(grille.origineXMm, 7);
  assert.equal(grille.origineYMm, 7);
});

test("une étiquette plus grande que la feuille est refusée, pas rognée en silence", () => {
  assert.throws(() => grilleA4(250, 30), /ne tient pas sur une A4/);
  assert.throws(() => grilleA4(50, 300), /ne tient pas sur une A4/);
});

// ==================================================================
// LA RÈGLE DE CONTRÔLE
// ==================================================================

test("la règle de contrôle mesure exactement 50 mm, et ses graduations sont tous les 10 mm", () => {
  const elements = elementsRegleDeControle(30, 280);
  const barre = elements.find((e) => e.type === "rectangle" && e.largeurMm === LONGUEUR_REGLE_MM);
  assert.ok(barre && barre.type === "rectangle");
  assert.equal(barre.largeurMm, 50);
  assert.equal(barre.xMm, 30);

  const graduations = elements
    .filter((e) => e.type === "rectangle" && e.largeurMm === 0.3)
    .map((e) => (e.type === "rectangle" ? e.xMm : 0))
    .sort((a, b) => a - b);
  assert.equal(graduations.length, 6);
  // La dernière graduation est rentrée de sa propre épaisseur pour
  // rester DANS les 50 mm : c'est le bord droit de la barre qui marque
  // 50, pas le bord droit du trait.
  assert.deepEqual(graduations.slice(0, 5), [30, 40, 50, 60, 70]);
  assert.ok(Math.abs(graduations[5] - (30 + 50 - 0.3)) < MICRON);

  const phrase = elements.find((e) => e.type === "texte");
  assert.ok(phrase && phrase.type === "texte");
  assert.match(phrase.texte, /50 mm/);
  assert.match(phrase.texte, /100 %/);
  assert.match(phrase.texte, /Marges : aucune/);
});

test("la règle réserve sa place : les étiquettes ne montent pas dessus", () => {
  const planche = composerPlanche([exemple()], {
    modele: MODELES_OASIS.pepiniere,
    support: "a4",
    regleDeControle: true,
  });
  assert.ok(planche.grille);
  const derniere = caseGrille(planche.grille, planche.grille.parPage - 1);
  const basDesEtiquettes = derniere.yMm + planche.grille.etiquetteHauteurMm;
  const hautDeLaRegle = A4_HAUTEUR_MM - HAUTEUR_REGLE_MM + 2 - 2; // la barre, moins ses graduations
  assert.ok(
    basDesEtiquettes <= hautDeLaRegle + MICRON,
    `les étiquettes descendent à ${basDesEtiquettes} mm, la règle commence à ${hautDeLaRegle} mm`,
  );
});

test("TOUTE l'encre de la règle de contrôle reste dans la zone imprimable", () => {
  // LE SEUL DISPOSITIF QUI TRANSFORME LA PROMESSE DES MILLIMÈTRES EN
  // MESURE ÉTAIT IMPRIMÉ DANS LA BANDE NON IMPRIMABLE. La barre
  // descendait à 292,2 mm et sa consigne — celle qui explique quoi
  // faire quand la mesure est fausse — tombait entre 294,2 et
  // 294,6 mm, au-delà des 292 mm qu'une imprimante de bureau sait
  // encrer. On mesurait donc une barre coupée avec une notice absente.
  //
  // On relève ici l'encre RÉELLE, rectangles et glyphes compris, sur
  // la planche telle que composerPlanche la produit.
  const planche = composerPlanche([exemple()], {
    modele: MODELES_OASIS.pepiniere,
    support: "a4",
    regleDeControle: true,
  });
  const page = planche.pages[planche.pages.length - 1];

  let basDeLEncre = 0;
  for (const element of page.elements) {
    if (element.type === "texte") {
      // Ligne de base plus jambage : c'est le bas réel des glyphes.
      basDeLEncre = Math.max(basDeLEncre, element.yMm + pointsVersMm(element.taillePt) * 0.212);
    } else {
      basDeLEncre = Math.max(basDeLEncre, element.yMm + element.hauteurMm);
    }
  }

  assert.ok(
    basDeLEncre <= BAS_IMPRIMABLE_A4_MM + MICRON,
    `l'encre descend à ${basDeLEncre} mm, la zone imprimable s'arrête à ${BAS_IMPRIMABLE_A4_MM} mm`,
  );

  // Et la contre-épreuve : la consigne est bien là, pas seulement la
  // barre. Une barre sans sa notice ne se mesure pas.
  const phrase = page.elements.find((e) => e.type === "texte" && /100 %/.test(e.texte));
  assert.ok(phrase, "la consigne de la règle de contrôle a disparu de la planche");
});

test("sur rouleau, la règle est refusée AVEC son motif, pas ignorée en silence", () => {
  const planche = composerPlanche([exemple()], {
    modele: MODELES_OASIS.biolab,
    support: "rouleau",
    regleDeControle: true,
  });
  assert.match(planche.avertissements.map((a) => a.message).join(" "), /n'est pas imprimée sur un rouleau/);
});

test("la page de contrôle porte deux barres de 150 et 200 mm", () => {
  const planche = plancheDeControle();
  const rectangles = planche.pages[0].elements.filter((e) => e.type === "rectangle");
  const horizontale = rectangles.find((e) => e.type === "rectangle" && e.largeurMm === 150);
  const verticale = rectangles.find((e) => e.type === "rectangle" && e.hauteurMm === 200);
  assert.ok(horizontale, "barre horizontale de 150 mm absente");
  assert.ok(verticale, "barre verticale de 200 mm absente");

  const cotes = lireCotesPdf(plancheVersPdf(planche));
  assert.ok(Math.abs(cotes[0].largeurMm - A4_LARGEUR_MM) < MICRON);
  assert.ok(Math.abs(cotes[0].hauteurMm - A4_HAUTEUR_MM) < MICRON);
});

// ==================================================================
// LE SVG PORTE LES MÊMES COTES QUE LE PDF
// ==================================================================

test("le SVG déclare ses cotes en millimètres, avec une unité utilisateur par millimètre", () => {
  for (const format of FORMATS_ETIQUETTE) {
    const planche = composerPlanche([exemple()], {
      modele: {
        famille: "jardins",
        nom: format.nom,
        largeurMm: format.largeurMm,
        hauteurMm: format.hauteurMm,
        margeMm: 1,
        champs: [],
      },
      support: "rouleau",
    });
    const svg = plancheVersSvg(planche)[0];
    assert.match(svg, new RegExp(`width="${format.largeurMm}mm"`), format.nom);
    assert.match(svg, new RegExp(`height="${format.hauteurMm}mm"`), format.nom);
    // viewBox en unités = mm : sans cela, `width="60mm"` mettrait à
    // l'échelle un dessin exprimé dans une autre unité, et tout dériverait.
    assert.match(svg, new RegExp(`viewBox="0 0 ${format.largeurMm} ${format.hauteurMm}"`), format.nom);
  }
});

test("SVG et PDF placent la MÊME encre : la liste d'éléments est unique", () => {
  // Il n'y a qu'un moteur de mise en page. Ce test le prouve en
  // comparant le nombre de rectangles pleins du SVG au nombre de « re f »
  // du PDF : deux transcriptions de la même liste.
  const planche = composerPlanche([exemple()], { modele: MODELES_OASIS.jardins, support: "rouleau" });
  const svg = plancheVersSvg(planche)[0];
  const pdf = new TextDecoder("latin1").decode(plancheVersPdf(planche));

  const rectanglesSvg = (svg.match(/<rect [^>]*fill="#000"/g) ?? []).length;
  const rectanglesPdf = (pdf.match(/re f/g) ?? []).length;
  assert.equal(rectanglesSvg, rectanglesPdf);
  assert.ok(rectanglesSvg > 50, "un QR devrait produire des dizaines de rectangles");

  const textesSvg = (svg.match(/<text /g) ?? []).length;
  const textesPdf = (pdf.match(/ Tj ET/g) ?? []).length;
  assert.equal(textesSvg, textesPdf);
});

// ==================================================================
// LA MARGE DE 14 MM CONTOURNÉE
// ==================================================================

test("le CSS d'impression remet la marge à zéro et fixe la taille de page", () => {
  const planche = composerPlanche([exemple()], { modele: MODELES_OASIS.biolab, support: "rouleau" });
  const css = cssImpressionPlanche(planche);
  assert.match(css, /@page \{ size: 40mm 20mm; margin: 0; \}/);
  assert.match(css, /html, body \{ margin: 0; padding: 0/);
  // Et il dit POURQUOI il doit être posé dans le corps : sans cette
  // phrase, quelqu'un le déplacera un jour dans le <head> et la planche
  // sortira avec 14 mm de marge, sans le moindre message d'erreur.
  assert.match(css, /la dernière déclarée gagne/);

  // ET IL DOIT TENIR DANS UNE MISE EN PAGE IMBRIQUÉE. Le sélecteur
  // « body > *:not(...) » n'atteint qu'un enfant direct de body ; sous
  // la mise en page racine de Next.js, il aurait masqué l'ancêtre
  // commun — donc la planche — et sorti une page blanche. On vérifie
  // que ce piège n'est pas réintroduit.
  assert.ok(
    !css.includes("body >"),
    "le CSS d'impression suppose de nouveau que la planche est un enfant direct de body",
  );
  assert.ok(css.includes(":has(.oasis-impression)"));
});

test("le CSS d'une planche A4 déclare bien 210 × 297", () => {
  const planche = composerPlanche([exemple()], { modele: MODELES_OASIS.pepiniere, support: "a4" });
  assert.match(cssImpressionPlanche(planche), /@page \{ size: 210mm 297mm; margin: 0; \}/);
});

// ==================================================================
// LA PAGINATION
// ==================================================================

test("les étiquettes se répartissent sur autant de planches qu'il faut, sans en perdre", () => {
  const modele = MODELES_OASIS.pepiniere; // 27 par planche
  const entrees = Array.from({ length: 70 }, (_v, i) =>
    donneesExemple(`https://oasisrarecare.fr/x/${String(i).padStart(32, "0")}`),
  );
  const planche = composerPlanche(entrees, { modele, support: "a4" });
  assert.equal(planche.nombreEtiquettes, 70);
  assert.equal(planche.pages.length, 3);
  assert.deepEqual(
    planche.pages.map((p) => p.nombreEtiquettes),
    [27, 27, 16],
  );
  assert.equal(lireCotesPdf(plancheVersPdf(planche)).length, 3);
});

test("les copies multiplient les étiquettes, pas les encodages", () => {
  const planche = composerPlanche([exemple()], { modele: MODELES_OASIS.pepiniere, support: "a4", copies: 27 });
  assert.equal(planche.nombreEtiquettes, 27);
  assert.equal(planche.pages.length, 1);
  assert.equal(planche.pages[0].nombreEtiquettes, 27);
});

test("une feuille entamée : on saute les cases déjà décollées", () => {
  const planche = composerPlanche([exemple(), exemple()], {
    modele: MODELES_OASIS.pepiniere,
    support: "a4",
    casesSautees: 5,
  });
  assert.ok(planche.grille);
  const attendu = caseGrille(planche.grille, 5);
  // La première étiquette posée doit démarrer à la sixième case.
  const premierRectangle = planche.pages[0].elements.find((e) => e.type === "rectangle");
  assert.ok(premierRectangle && premierRectangle.type === "rectangle");
  assert.ok(premierRectangle.xMm >= attendu.xMm - MICRON);
  assert.ok(premierRectangle.yMm >= attendu.yMm - MICRON);
});

test("sauter plus de cases qu'il n'y en a est refusé, avec le compte exact", () => {
  assert.throws(
    () => composerPlanche([exemple()], { modele: MODELES_OASIS.pepiniere, support: "a4", casesSautees: 27 }),
    /n'en compte que 27/,
  );
});

test("sur rouleau, une page par étiquette, chacune à la taille de l'étiquette", () => {
  const planche = composerPlanche([exemple(), exemple(), exemple()], {
    modele: MODELES_OASIS.biolab,
    support: "rouleau",
  });
  assert.equal(planche.pages.length, 3);
  const cotes = lireCotesPdf(plancheVersPdf(planche));
  assert.equal(cotes.length, 3);
  for (const cote of cotes) {
    assert.ok(Math.abs(cote.largeurMm - 40) < MICRON);
    assert.ok(Math.abs(cote.hauteurMm - 20) < MICRON);
  }
});

// ==================================================================
// TOUTE L'ENCRE RESTE DANS LA PAGE
// ==================================================================

/**
 * L'étendue réelle d'un élément, TEXTE COMPRIS.
 *
 * Écrite après avoir trouvé le défaut qu'elle attrape : la phrase de la
 * règle de contrôle, longue de 180 mm, était calée sur le bord gauche
 * d'une barre elle-même centrée à 80 mm — elle finissait donc à 260 mm
 * sur une feuille de 210. Le test précédent ignorait les textes, sous
 * prétexte que leur ancre n'est pas un coin. C'était une bonne raison
 * de les traiter à part, pas de ne pas les regarder.
 */
function etendue(element: { type: string } & Record<string, unknown>) {
  if (element.type !== "texte") {
    return {
      gauche: element.xMm as number,
      droite: (element.xMm as number) + (element.largeurMm as number),
      haut: element.yMm as number,
      bas: (element.yMm as number) + (element.hauteurMm as number),
    };
  }
  const largeur = largeurTexteMm(element.texte as string, element.taillePt as number, element.gras as boolean);
  const ancre = element.xMm as number;
  const gauche = element.alignement === "centre" ? ancre - largeur / 2 : element.alignement === "droite" ? ancre - largeur : ancre;
  const base = element.yMm as number;
  const corps = pointsVersMm(element.taillePt as number);
  // Du haut des capitales au bas des jambages : c'est l'encre réelle.
  return { gauche, droite: gauche + largeur, haut: base - corps * 0.717, bas: base + corps * 0.21 };
}

test("aucun élément ne sort de la page, sur aucun format et aucun support", () => {
  for (const modele of Object.values(MODELES_OASIS)) {
    for (const support of ["rouleau", "a4"] as const) {
      const planche = composerPlanche([exemple(), exemple()], { modele, support, traitsDeCoupe: true });
      for (const page of planche.pages) {
        for (const element of page.elements) {
          const largeur = element.type === "texte" ? 0 : element.largeurMm;
          const hauteur = element.type === "texte" ? 0 : element.hauteurMm;
          assert.ok(element.xMm >= -MICRON, `${modele.nom}/${support} : x = ${element.xMm}`);
          assert.ok(element.yMm >= -MICRON, `${modele.nom}/${support} : y = ${element.yMm}`);
          assert.ok(
            element.xMm + largeur <= page.largeurMm + MICRON,
            `${modele.nom}/${support} : déborde à droite (${element.xMm + largeur} > ${page.largeurMm})`,
          );
          assert.ok(
            element.yMm + hauteur <= page.hauteurMm + MICRON,
            `${modele.nom}/${support} : déborde en bas (${element.yMm + hauteur} > ${page.hauteurMm})`,
          );
        }
      }
    }
  }
});

test("AUCUN TEXTE non plus ne sort de la page — règle de contrôle comprise", () => {
  const cas: { nom: string; planche: ReturnType<typeof composerPlanche> }[] = [
    { nom: "page de contrôle", planche: plancheDeControle() },
    {
      nom: "planche A4 avec règle",
      planche: composerPlanche(
        Array.from({ length: 30 }, () => exemple()),
        { modele: MODELES_OASIS.pepiniere, support: "a4", regleDeControle: true },
      ),
    },
    {
      nom: "rouleau 60 × 40",
      planche: composerPlanche([exemple()], { modele: MODELES_OASIS.jardins, support: "rouleau" }),
    },
  ];

  for (const { nom, planche } of cas) {
    for (const page of planche.pages) {
      for (const element of page.elements) {
        const e = etendue(element as never);
        assert.ok(e.gauche >= -MICRON, `${nom} : « ${apercu(element)} » commence à ${e.gauche} mm`);
        assert.ok(e.haut >= -MICRON, `${nom} : « ${apercu(element)} » commence à ${e.haut} mm de haut`);
        assert.ok(
          e.droite <= page.largeurMm + MICRON,
          `${nom} : « ${apercu(element)} » finit à ${e.droite} mm, la page en fait ${page.largeurMm}`,
        );
        assert.ok(
          e.bas <= page.hauteurMm + MICRON,
          `${nom} : « ${apercu(element)} » descend à ${e.bas} mm, la page en fait ${page.hauteurMm}`,
        );
      }
    }
  }
});

function apercu(element: { type: string } & Record<string, unknown>): string {
  return element.type === "texte" ? String(element.texte).slice(0, 40) : element.type;
}

test("la phrase de la règle de contrôle tient dans la largeur d'une A4", () => {
  const elements = elementsRegleDeControle((A4_LARGEUR_MM - LONGUEUR_REGLE_MM) / 2, 289);
  const phrase = elements.find((e) => e.type === "texte");
  assert.ok(phrase && phrase.type === "texte");
  const e = etendue(phrase as never);
  assert.ok(e.gauche > 0, `la phrase commence à ${e.gauche} mm`);
  assert.ok(e.droite < A4_LARGEUR_MM, `la phrase finit à ${e.droite} mm`);
  // Et elle est bien centrée : le même blanc de chaque côté.
  assert.ok(Math.abs(e.gauche - (A4_LARGEUR_MM - e.droite)) < 0.01);
});

test("une sélection vide est refusée par une phrase, pas par une erreur de bas niveau", () => {
  assert.throws(
    () => composerPlanche([], { modele: MODELES_OASIS.pepiniere, support: "a4" }),
    /la sélection est vide/,
  );
});
