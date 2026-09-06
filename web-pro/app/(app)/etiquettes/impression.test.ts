import test from "node:test";
import assert from "node:assert/strict";

import {
  FORMATS_ETIQUETTE,
  LONGUEUR_REGLE_MM,
  MODELES_OASIS,
  composerPlanche,
  lireCotesPdf,
  plancheVersPdf,
  plancheVersSvg,
  type DonneesEtiquette,
  type ModeleEtiquette,
} from "../../../lib/etiquettes/index.ts";

import { JETON_EXEMPLE, urlEtiquette } from "./adresse.ts";
import { lireRequete, optionsPlanche } from "./planche.ts";

/**
 * LES MILLIMÈTRES SONT DES MILLIMÈTRES — vérifié, pas promis.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER MESURE, ET POURQUOI ÇA COMPTE PLUS QUE LE RESTE
 * ══════════════════════════════════════════════════════════════════
 *
 * Une étiquette est un objet PHYSIQUE. Une planche dont les cotes
 * dérivent de deux pour cent ne colle pas sur son support : les
 * autocollants sont bons pour la poubelle, et on ne s'en aperçoit
 * qu'après les avoir imprimés. C'est la seule faute de ce module qui
 * se paye en matière et en temps plutôt qu'en clic de plus.
 *
 * On ne se contente donc pas de composer : ON RELIT LE FICHIER. Les
 * cotes de chaque page sont écrites dans le MediaBox du PDF, et
 * `lireCotesPdf` les en extrait. Le test ne vérifie pas ce que le code
 * a l'INTENTION d'écrire ; il vérifie ce qui est écrit.
 *
 * ══════════════════════════════════════════════════════════════════
 * IL PASSE PAR LE VRAI CHEMIN DE L'APPLICATION
 * ══════════════════════════════════════════════════════════════════
 *
 * `lireRequete` puis `optionsPlanche` : exactement les deux fonctions
 * que traversent la page d'aperçu et la route PDF. Recopier les
 * réglages ici aurait donné un test qui se vérifie lui-même — il aurait
 * continué de passer le jour où la page, elle, aurait changé.
 *
 * AUCUN APPEL RÉSEAU : la composition ne parle qu'à la bibliothèque.
 */

const UN = "3f2a1b4c-5d6e-7f80-9a1b-2c3d4e5f6071";
const BASE = "https://oasisrarecare.fr";

/**
 * LA TOLÉRANCE, ET POURQUOI ELLE N'EST PAS ZÉRO.
 *
 * Un PDF exprime ses cotes en POINTS (1 pt = 25,4/72 mm). Passer des
 * millimètres aux points puis revenir laisse un résidu de virgule
 * flottante : 50 mm relus font 49,9999. C'est un écart de UN
 * DIX-MILLIÈME DE MILLIMÈTRE.
 *
 * Mettre ce chiffre en perspective, parce que c'est cela qui décide de
 * la tolérance à retenir : une tête thermique à 300 dpi trace des
 * points de 0,085 mm, et à 203 dpi de 0,125 mm. L'écart mesuré est
 * donc HUIT CENT CINQUANTE FOIS plus petit qu'un seul point
 * d'impression. Aucune imprimante ne peut le rendre, aucune règle ne
 * peut le voir.
 *
 * On tolère un centième de millimètre — encore huit fois plus fin
 * qu'un point à 300 dpi, donc toujours physiquement indétectable, mais
 * assez serré pour attraper la seule dérive qui compte : celle des
 * pour-cent. Une planche fausse de 2 %, c'est 1 mm sur une étiquette
 * de 50 : elle ne colle plus sur son support, et ce test la refuserait
 * cent fois.
 */
const TOLERANCE_MM = 0.01;

function assertCotes(
  cote: { largeurMm: number; hauteurMm: number },
  largeurMm: number,
  hauteurMm: number,
  situation: string,
): void {
  for (const [nom, obtenu, attendu] of [
    ["largeur", cote.largeurMm, largeurMm],
    ["hauteur", cote.hauteurMm, hauteurMm],
  ] as const) {
    const ecart = Math.abs(obtenu - attendu);
    assert.ok(
      ecart <= TOLERANCE_MM,
      `${situation} : ${nom} de ${obtenu} mm au lieu de ${attendu} mm — ` +
        `${ecart.toFixed(4)} mm d'écart, soit ${((ecart / attendu) * 100).toFixed(3)} %.`,
    );
  }
}

/** Une entrée réaliste : la vraie adresse, avec un jeton de la vraie longueur. */
function entree(): DonneesEtiquette {
  return {
    url: urlEtiquette(BASE, JETON_EXEMPLE),
    valeurs: {
      nom: "Trachycarpus fortunei",
      numeroLot: "LOT-2026-004",
      date: "05/09/2026",
      quantite: "120 u",
      emplacement: "Serre 2 — B3",
      stade: "Multiplication",
      logo: "OASIS RARE CARE",
    },
  };
}

/** Le modèle d'une famille, redimensionné à un format du § 17. */
function modeleAuFormat(largeurMm: number, hauteurMm: number): ModeleEtiquette {
  // On part du modèle 25 × 15 le plus contraint qu'on puisse composer :
  // un nom et un QR. Ce qui nous intéresse ici, ce sont les COTES DE LA
  // PAGE, pas la composition — mais elle doit rester imprimable, sinon
  // `composerPlanche` lève et on ne mesure rien.
  const marge = 1;
  const coteQr = Math.min(hauteurMm - 2 * marge, largeurMm / 2);
  return {
    famille: "pepiniere",
    nom: `Test ${largeurMm} × ${hauteurMm}`,
    largeurMm,
    hauteurMm,
    margeMm: marge,
    champs: [
      {
        champ: "nom",
        x: marge,
        y: marge,
        largeur: largeurMm - coteQr - 2 * marge - 0.5,
        hauteur: hauteurMm - 2 * marge,
        taille: 6,
      },
      {
        champ: "qr",
        x: largeurMm - marge - coteQr,
        y: marge,
        largeur: coteQr,
        hauteur: coteQr,
      },
    ],
  };
}

// ══════════════════════════════════════════════════════════════════
// LE ROULEAU : UNE PAGE = UNE ÉTIQUETTE, AUX COTES EXACTES
// ══════════════════════════════════════════════════════════════════

test("les cinq formats du § 17 sortent du PDF aux cotes EXACTES, sur rouleau", () => {
  for (const format of FORMATS_ETIQUETTE) {
    const requete = lireRequete({ source: "nurseryLot", objets: UN, support: "rouleau" });
    assert.ok(requete);

    const modele = modeleAuFormat(format.largeurMm, format.hauteurMm);
    const planche = composerPlanche([entree()], optionsPlanche(requete, modele));
    const cotes = lireCotesPdf(plancheVersPdf(planche));

    assert.equal(cotes.length, 1, `${format.nom} : une étiquette devrait faire une page.`);
    // LA MESURE, RELUE DANS LE FICHIER. Pas « ce qu'on a demandé » :
    // ce que le MediaBox contient.
    assertCotes(cotes[0], format.largeurMm, format.hauteurMm, format.nom);
  }
});

test("le 25 × 15 mm, celui que la marge de 14 mm rendait impossible, sort juste", () => {
  // Sous `@page { margin: 14mm }` de globals.css, cette étiquette a une
  // surface imprimable NÉGATIVE : 14 + 14 = 28 mm de marges pour 15 mm
  // de hauteur. Le PDF ignore complètement cette feuille de style —
  // c'est précisément pourquoi il est le chemin d'impression retenu.
  const requete = lireRequete({ source: "plant", objets: UN, support: "rouleau" });
  assert.ok(requete);
  const planche = composerPlanche([entree()], optionsPlanche(requete, modeleAuFormat(25, 15)));
  const cotes = lireCotesPdf(plancheVersPdf(planche));
  assertCotes(cotes[0], 25, 15, "25 × 15 sur rouleau");
});

test("un format personnalisé au dixième de millimètre est respecté", () => {
  // « Formats personnalisés » du § 17. Un rouleau du commerce en
  // 38,1 mm (un pouce et demi) existe vraiment : arrondir au millimètre
  // décalerait chaque étiquette de la suivante.
  const requete = lireRequete({ source: "plant", objets: UN, support: "rouleau" });
  assert.ok(requete);
  const planche = composerPlanche([entree()], optionsPlanche(requete, modeleAuFormat(38.1, 21.2)));
  const cotes = lireCotesPdf(plancheVersPdf(planche));
  assertCotes(cotes[0], 38.1, 21.2, "format personnalisé 38,1 × 21,2");
});

test("les exemplaires font autant de pages, toutes aux mêmes cotes", () => {
  const requete = lireRequete({
    source: "plant",
    objets: UN,
    support: "rouleau",
    copies: "4",
  });
  assert.ok(requete);
  const planche = composerPlanche([entree()], optionsPlanche(requete, modeleAuFormat(50, 30)));
  const cotes = lireCotesPdf(plancheVersPdf(planche));
  assert.equal(cotes.length, 4);
  for (const cote of cotes) assertCotes(cote, 50, 30, "exemplaire 50 × 30");
});

// ══════════════════════════════════════════════════════════════════
// LA PLANCHE A4
// ══════════════════════════════════════════════════════════════════

test("une planche A4 sort en 210 × 297 mm, quel que soit le format des étiquettes", () => {
  for (const format of FORMATS_ETIQUETTE) {
    const requete = lireRequete({ source: "plant", objets: UN, support: "a4" });
    assert.ok(requete);
    const planche = composerPlanche(
      [entree()],
      optionsPlanche(requete, modeleAuFormat(format.largeurMm, format.hauteurMm)),
    );
    const cotes = lireCotesPdf(plancheVersPdf(planche));
    assertCotes(cotes[0], 210, 297, `planche A4 portant du ${format.nom}`);
  }
});

test("la règle de contrôle de la planche A4 mesure EXACTEMENT 50 mm", () => {
  // C'est elle qui transforme une promesse en mesure : le paysagiste
  // pose sa règle sur la barre imprimée et sait en trois secondes si
  // son imprimante a redimensionné la page. Encore faut-il que la
  // barre fasse vraiment 50 mm dans le fichier.
  const requete = lireRequete({ source: "plant", objets: UN, support: "a4" });
  assert.ok(requete);
  const planche = composerPlanche([entree()], optionsPlanche(requete, modeleAuFormat(50, 30)));

  const barres = planche.pages[0].elements.filter(
    (e) => e.type === "rectangle" && e.largeurMm === LONGUEUR_REGLE_MM,
  );
  assert.equal(barres.length, 1, "La barre de contrôle de 50 mm est absente de la planche A4.");
  assert.equal(LONGUEUR_REGLE_MM, 50);
});

test("sur rouleau, PAS de règle de contrôle : il n'y a pas la place, et rien à contrôler", () => {
  const requete = lireRequete({ source: "plant", objets: UN, support: "rouleau" });
  assert.ok(requete);
  const planche = composerPlanche([entree()], optionsPlanche(requete, modeleAuFormat(50, 30)));
  const barres = planche.pages[0].elements.filter(
    (e) => e.type === "rectangle" && e.largeurMm === LONGUEUR_REGLE_MM,
  );
  assert.deepEqual(barres, [], "Une barre de 50 mm a été posée sur une étiquette de 50 mm de large.");
});

test("les cases sautées décalent la première étiquette d'un pas entier de grille", () => {
  // Une planche prédécoupée à moitié entamée est la situation normale
  // d'un atelier. Si le décalage n'est pas un multiple EXACT du pas,
  // toutes les étiquettes suivantes tombent à côté de leur découpe.
  const modele = modeleAuFormat(50, 30);
  const sansSaut = composerPlanche(
    [entree()],
    optionsPlanche(lireRequete({ source: "plant", objets: UN })!, modele),
  );
  const avecSaut = composerPlanche(
    [entree()],
    optionsPlanche(lireRequete({ source: "plant", objets: UN, cases_sautees: "1" })!, modele),
  );

  const grille = sansSaut.grille;
  assert.ok(grille);
  const premier = (p: typeof sansSaut) =>
    p.pages[0].elements.filter((e) => e.type === "rectangle" && e.rempli)[0];

  const a = premier(sansSaut);
  const b = premier(avecSaut);
  assert.ok(a && b);
  // Une case de décalage, sur une grille de plus d'une colonne, déplace
  // d'un pas horizontal exactement.
  assert.equal(
    Math.round((b.xMm - a.xMm) * 100) / 100,
    grille.colonnes > 1 ? grille.pasXMm : 0,
  );
});

test("une planche PRÉDÉCOUPÉE du commerce tombe juste, au dixième près", () => {
  // L'ÉCRAN PROPOSAIT « SAUTER DES CASES » — un geste qui n'a de sens
  // que sur une planche prédécoupée — SANS AUCUN MOYEN DE CALER LA
  // GRILLE SUR CETTE PLANCHE. Les quatre réglages existaient dans
  // OptionsGrilleA4 ; `optionsPlanche` ne transmettait que la règle de
  // contrôle, donc marge 5, gouttières 2, bloc centré, toujours.
  //
  // MESURÉ SUR UNE PLANCHE TRÈS RÉPANDUE, 38,1 × 21,2 mm, 5 colonnes
  // de 13, marge gauche 4,75 mm, marge haut 10,7 mm, 2,5 mm entre
  // colonnes et rien entre les lignes : notre grille rendait 5 × 12,
  // origine (5,75 ; 10,3), pas 40,1 × 23,2 au lieu de 40,6 × 21,2.
  // Deux millimètres d'écart par ligne, c'est déjà deux centimètres au
  // dixième rang — aucune étiquette sur sa découpe.
  //
  // ET LES DEUX MARGES SONT DIFFÉRENTES, 4,75 contre 10,7 : avec une
  // marge unique, aucune valeur ne visait juste sur les deux axes.
  //
  // Le vrai chemin, comme tout ce fichier : lireRequete puis
  // optionsPlanche, exactement ce que traversent l'écran et le PDF.
  const modele = modeleAuFormat(38.1, 21.2);
  const requete = lireRequete({
    source: "plant",
    objets: UN,
    largeur_mm: "38.1",
    hauteur_mm: "21.2",
    mx_mm: "4.75",
    my_mm: "10.7",
    gx_mm: "2.5",
    gy_mm: "0",
    origine: "coin",
  });
  assert.ok(requete);
  const planche = composerPlanche([entree()], optionsPlanche(requete, modele));
  const grille = planche.grille;
  assert.ok(grille, "une planche A4 doit avoir une grille");

  assert.equal(grille.colonnes, 5, "la planche du commerce a cinq colonnes");
  assert.equal(grille.lignes, 13, "elle en a treize rangs");
  assert.ok(Math.abs(grille.pasXMm - 40.6) < TOLERANCE_MM, `pas horizontal ${grille.pasXMm}`);
  assert.ok(Math.abs(grille.pasYMm - 21.2) < TOLERANCE_MM, `pas vertical ${grille.pasYMm}`);
  // ORIGINE AU COIN, PAS CENTRÉE : une prédécoupe impose son point de
  // départ, et un bloc recentré sur ce qui reste de feuille tomberait
  // à côté dès la première case.
  assert.ok(Math.abs(grille.origineXMm - 4.75) < TOLERANCE_MM, `origine X ${grille.origineXMm}`);
  assert.ok(Math.abs(grille.origineYMm - 10.7) < TOLERANCE_MM, `origine Y ${grille.origineYMm}`);

  // Et la contre-épreuve : sans ces réglages, on retombe sur la grille
  // aux ciseaux, qui ne tombe PAS sur cette planche.
  const parDefaut = composerPlanche(
    [entree()],
    optionsPlanche(
      lireRequete({ source: "plant", objets: UN, largeur_mm: "38.1", hauteur_mm: "21.2" })!,
      modele,
    ),
  );
  assert.ok(parDefaut.grille);
  assert.notEqual(parDefaut.grille.lignes, 13);
});

test("la pagination A4 remplit chaque feuille avant d'en entamer une autre", () => {
  const modele = modeleAuFormat(50, 30);
  const requete = lireRequete({ source: "plant", objets: UN, copies: "50" });
  assert.ok(requete);
  const planche = composerPlanche([entree()], optionsPlanche(requete, modele));
  assert.ok(planche.grille);

  const parPage = planche.grille.parPage;
  assert.equal(planche.nombreEtiquettes, 50);
  assert.equal(planche.pages.length, Math.ceil(50 / parPage));
  // Toutes les pages sont pleines sauf la dernière.
  planche.pages.slice(0, -1).forEach((page, index) => {
    assert.equal(page.nombreEtiquettes, parPage, `La page ${index + 1} n'est pas pleine.`);
  });
});

// ══════════════════════════════════════════════════════════════════
// L'APERÇU ET LE FICHIER DISENT LA MÊME CHOSE
// ══════════════════════════════════════════════════════════════════

test("le SVG de l'aperçu porte les mêmes cotes en millimètres que le PDF", () => {
  // Un aperçu qui mentirait sur la taille serait pire que pas
  // d'aperçu : on validerait à l'écran une planche fausse.
  const requete = lireRequete({ source: "plant", objets: UN, support: "rouleau" });
  assert.ok(requete);
  const planche = composerPlanche([entree()], optionsPlanche(requete, modeleAuFormat(60, 40)));

  const svg = plancheVersSvg(planche)[0];
  assert.match(svg, /width="60mm"/);
  assert.match(svg, /height="40mm"/);
  assertCotes(lireCotesPdf(plancheVersPdf(planche))[0], 60, 40, "aperçu contre PDF");
});

test("le PDF contient bien des modules de QR, pas un carré vide", () => {
  // Le défaut le plus coûteux serait un autocollant d'apparence
  // parfaite dont le QR n'a pas été tracé. Un QR de version 4 compte
  // plus de cinq cents modules sombres, fusionnés en bandes ; on
  // vérifie qu'il en reste largement de quoi former un code.
  const requete = lireRequete({ source: "plant", objets: UN, support: "rouleau" });
  assert.ok(requete);
  const planche = composerPlanche([entree()], optionsPlanche(requete, modeleAuFormat(50, 30)));
  const remplis = planche.pages[0].elements.filter((e) => e.type === "rectangle" && e.rempli);
  assert.ok(
    remplis.length > 100,
    `Seulement ${remplis.length} rectangles pleins : le QR n'a pas été tracé.`,
  );
});

test("le modèle Pépinière d'Oasis, tel quel, sort à ses cotes annoncées", () => {
  // Le cas réel : le modèle fourni, sur son support par défaut.
  const requete = lireRequete({ source: "nurseryLot", objets: UN, support: "rouleau" });
  assert.ok(requete);
  const planche = composerPlanche([entree()], optionsPlanche(requete, MODELES_OASIS.pepiniere));
  assertCotes(lireCotesPdf(plancheVersPdf(planche))[0], 50, 30, "modèle Pépinière d'Oasis");
});
