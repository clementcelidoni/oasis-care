import { test } from "node:test";
import assert from "node:assert/strict";

import { MODELES_OASIS } from "./modeles.ts";
import { arrondiMm, largeurTexteMm, pointsVersMm } from "./mesures.ts";
import { ecrirePdf, lireCotesPdf, versWinAnsi } from "./pdf.ts";
import { CORPS_MINIMAL_PT, donneesExemple, rendreEtiquette, verifierModele } from "./rendu.ts";
import { documentSvg, elementsVersSvg } from "./svg.ts";
import type { DonneesEtiquette, ModeleEtiquette } from "./types.ts";

/**
 * CE QUE CES TESTS DÉFENDENT.
 *
 * L'idée qu'il n'y a QU'UN moteur de mise en page. Tout ce qui suit
 * porte sur la liste d'éléments — des millimètres —, jamais sur des
 * balises. Si le rendu SVG et le rendu PDF étaient deux moteurs
 * séparés, aucun de ces tests ne le verrait ; c'est précisément
 * pourquoi ils n'en sont pas deux.
 *
 * Et l'idée que RIEN N'EST SILENCIEUX. Un texte réduit, un texte coupé,
 * un code-barres translittéré, un QR trop dense : chacun laisse une
 * trace dans `avertissements`. Une étiquette ratée coûte un autocollant
 * et un aller-retour au jardin.
 */

const URL_ESSAI = "https://oasisrarecare.fr/x/3f8a1c4e9b2d7a604f5e1c8b3d9a2e70";

function donnees(valeurs: Record<string, string> = {}): DonneesEtiquette {
  return { url: URL_ESSAI, valeurs };
}

// ==================================================================
// LES TROIS MODÈLES FOURNIS PAR 0090
// ==================================================================

test("les trois modèles fournis sont valides et tiennent dans leurs cotes", () => {
  for (const modele of Object.values(MODELES_OASIS)) {
    assert.deepEqual(verifierModele(modele), [], modele.nom);
  }
});

test("les trois modèles fournis se rendent, et toute leur encre reste sur l'étiquette", () => {
  for (const modele of Object.values(MODELES_OASIS)) {
    const rendue = rendreEtiquette(modele, donneesExemple(URL_ESSAI));
    assert.equal(rendue.largeurMm, modele.largeurMm);
    assert.equal(rendue.hauteurMm, modele.hauteurMm);
    assert.ok(rendue.elements.length > 20, `${modele.nom} : rendu suspicieusement vide`);

    for (const element of rendue.elements) {
      if (element.type === "texte") continue; // l'ancrage n'est pas un coin
      assert.ok(element.xMm >= -1e-6, `${modele.nom} : x négatif`);
      assert.ok(element.yMm >= -1e-6, `${modele.nom} : y négatif`);
      assert.ok(element.xMm + element.largeurMm <= modele.largeurMm + 1e-6, `${modele.nom} : déborde à droite`);
      assert.ok(element.yMm + element.hauteurMm <= modele.hauteurMm + 1e-6, `${modele.nom} : déborde en bas`);
    }
  }
});

test("les cotes des trois modèles sont bien celles de la migration 0090", () => {
  // Une divergence ici veut dire que la base et le web n'imprimeraient
  // pas la même étiquette : la planche sortirait juste, mais différente
  // de ce que l'éditeur a enregistré.
  assert.deepEqual(
    Object.values(MODELES_OASIS).map((m) => [m.famille, m.largeurMm, m.hauteurMm, m.margeMm, m.champs.length]),
    [
      ["jardins", 60, 40, 2, 6],
      ["pepiniere", 50, 30, 2, 7],
      ["biolab", 40, 20, 1.5, 5],
    ],
  );
});

// ==================================================================
// LA VÉRIFICATION DES MODÈLES
// ==================================================================

test("un champ qui déborde est refusé, en disant OÙ il finit", () => {
  const modele: ModeleEtiquette = {
    famille: "biolab",
    nom: "faux",
    largeurMm: 40,
    hauteurMm: 20,
    margeMm: 1.5,
    champs: [{ champ: "nom", x: 30, y: 2, largeur: 20, hauteur: 5 }],
  };
  const fautes = verifierModele(modele);
  assert.equal(fautes.length, 1);
  assert.match(fautes[0], /déborde de l'étiquette/);
  assert.match(fautes[0], /50/); // 30 + 20
  assert.match(fautes[0], /38\.5/); // la limite imprimable
  assert.throws(() => rendreEtiquette(modele, donnees()), /ne peut pas être imprimé/);
});

test("un champ dans la marge est refusé : la tête d'impression la mordrait", () => {
  const fautes = verifierModele({
    famille: "biolab",
    nom: "faux",
    largeurMm: 40,
    hauteurMm: 20,
    margeMm: 3,
    champs: [{ champ: "nom", x: 1, y: 4, largeur: 10, hauteur: 5 }],
  });
  assert.equal(fautes.length, 1);
  assert.match(fautes[0], /entre dans la marge/);
});

test("une marge qui mange l'étiquette est refusée", () => {
  const fautes = verifierModele({
    famille: "biolab",
    nom: "faux",
    largeurMm: 40,
    hauteurMm: 20,
    margeMm: 10,
    champs: [],
  });
  assert.match(fautes.join(" "), /mange l'étiquette entière/);
});

// ==================================================================
// LE TEXTE
// ==================================================================

test("un texte trop long est réduit, et la réduction est signalée", () => {
  const modele: ModeleEtiquette = {
    famille: "jardins",
    nom: "essai",
    largeurMm: 60,
    hauteurMm: 40,
    margeMm: 2,
    champs: [{ champ: "nom", x: 2, y: 2, largeur: 20, hauteur: 8, taille: 12 }],
  };
  const rendue = rendreEtiquette(modele, donnees({ nom: "Trachycarpus" }));
  const texte = rendue.elements.find((e) => e.type === "texte");
  assert.ok(texte && texte.type === "texte");
  assert.ok(texte.taillePt < 12, "le corps aurait dû être réduit");
  assert.equal(texte.texte, "Trachycarpus", "réduire vaut mieux que couper : le nom doit rester entier");
  assert.match(rendue.avertissements.map((a) => a.message).join(" "), /a été réduit de 12 à/);
  // Et le résultat TIENT vraiment dans le cadre.
  assert.ok(largeurTexteMm(texte.texte, texte.taillePt, texte.gras) <= 20);
});

test("un texte qui ne tient pas même au corps minimal est coupé, avec des points de suspension", () => {
  const modele: ModeleEtiquette = {
    famille: "biolab",
    nom: "essai",
    largeurMm: 40,
    hauteurMm: 20,
    margeMm: 1,
    champs: [{ champ: "nom", x: 1, y: 1, largeur: 6, hauteur: 4, taille: 8 }],
  };
  const rendue = rendreEtiquette(modele, donnees({ nom: "Trachycarpus fortunei Wagnerianus" }));
  const texte = rendue.elements.find((e) => e.type === "texte");
  assert.ok(texte && texte.type === "texte");
  assert.match(texte.texte, /…$/);
  assert.equal(texte.taillePt, CORPS_MINIMAL_PT);
  assert.match(rendue.avertissements.map((a) => a.message).join(" "), /a dû être coupé/);
});

test("un champ vide n'imprime rien du tout, sans avertissement", () => {
  const rendue = rendreEtiquette(MODELES_OASIS.biolab, donnees({ numeroLot: "  " }));
  assert.equal(rendue.elements.filter((e) => e.type === "texte").length, 0);
  assert.deepEqual(
    rendue.avertissements.filter((a) => a.champ !== "qr"),
    [],
  );
});

test("LE MODÈLE BIOLAB TIENT MAINTENANT SON QR — et la mesure dit pourquoi", () => {
  // Ce test a d'abord constaté un défaut, il garde maintenant la porte
  // fermée. Le modèle « BioLab — étiquette de lot 40 × 20 » réservait
  // 13 mm au QR. Avec le jeton de 32 caractères hexadécimaux que 0090
  // engendre, l'adresse fait 59 caractères, donc une version 4, donc
  // 33 + 8 = 41 modules : 0,317 mm par module, sous le seuil de 0,33 —
  // un autocollant parfait à l'œil et illisible à la caméra.
  //
  // Le cadre est passé à 15 mm des DEUX côtés à la fois (ici et dans
  // 0090 § 8.b), ce qui donne 0,366 mm.
  const rendue = rendreEtiquette(MODELES_OASIS.biolab, donneesExemple(URL_ESSAI));
  assert.deepEqual(
    rendue.avertissements.filter((a) => a.champ === "qr" && (a.niveau ?? "defaut") === "defaut"),
    [],
    "le modèle BioLab fourni ne doit plus produire de QR sous le plancher",
  );
  // Ce qui RESTE, et qui est vrai : à 0,366 mm on lit de près. Le
  // moteur le remonte en « remarque », et c'est l'argument chiffré pour
  // raccourcir le jeton.
  assert.ok(
    rendue.avertissements.some((a) => a.champ === "qr" && a.niveau === "remarque"),
    "le confort de lecture doit remonter, même quand le plancher est franchi",
  );

  // ET LA PREUVE QUE LE SEUIL MORD VRAIMENT : ramené à 13 mm, il parle.
  const resserre = rendreEtiquette(
    {
      ...MODELES_OASIS.biolab,
      champs: MODELES_OASIS.biolab.champs.map((c) =>
        c.champ === "qr" ? { ...c, x: 25, y: 2.5, largeur: 13, hauteur: 13 } : c,
      ),
    },
    donneesExemple(URL_ESSAI),
  );
  const alerte = resserre.avertissements.find((a) => a.champ === "qr");
  assert.ok(alerte, "le plancher de lisibilité ne mord plus");
  assert.match(alerte.message, /0.317/);
});

/**
 * LE DÉBORDEMENT EN HAUTEUR — celui que personne ne signalait.
 *
 * `ajusterTexte` n'ajuste que la largeur ; `verifierModele` ne contrôle
 * que le rectangle du cadre. Un corps trop grand sortait donc sans un
 * mot, et le SVG le montrait entier là où le PDF le tranchait.
 */
test("un corps trop grand pour son cadre est signalé, avec le débord en millimètres", () => {
  const modele: ModeleEtiquette = {
    famille: "jardins",
    nom: "essai",
    largeurMm: 60,
    hauteurMm: 40,
    margeMm: 2,
    champs: [{ champ: "nom", x: 2, y: 2, largeur: 34, hauteur: 4, taille: 24 }],
  };
  const rendue = rendreEtiquette(modele, donnees({ nom: "Ilex" }));
  const alerte = rendue.avertissements.find((a) => a.champ === "nom");
  assert.ok(alerte, "un corps de 24 points dans 4 mm doit être signalé");
  assert.match(alerte.message, /déborde de son cadre en hauteur/);
});

test("un corps qui tient ne déclenche aucun avertissement de hauteur", () => {
  // La borne mesurée est 2,485 point par millimètre de cadre : 4 mm
  // tiennent 9,9 points. On reste juste en dessous.
  const modele: ModeleEtiquette = {
    famille: "jardins",
    nom: "essai",
    largeurMm: 60,
    hauteurMm: 40,
    margeMm: 2,
    champs: [{ champ: "nom", x: 2, y: 2, largeur: 34, hauteur: 4, taille: 9 }],
  };
  const rendue = rendreEtiquette(modele, donnees({ nom: "Ilex" }));
  assert.deepEqual(rendue.avertissements, []);
});

test("le texte libre passe à la ligne, et sa troncature se signale", () => {
  const modele: ModeleEtiquette = {
    famille: "jardins",
    nom: "essai",
    largeurMm: 60,
    hauteurMm: 40,
    margeMm: 2,
    champs: [{ champ: "texteLibre", x: 2, y: 2, largeur: 30, hauteur: 10, taille: 7 }],
  };
  const court = rendreEtiquette(modele, donnees({ texteLibre: "Arrosage modéré, exposition plein soleil." }));
  assert.ok(court.elements.filter((e) => e.type === "texte").length >= 2, "le texte aurait dû passer à la ligne");

  const long = rendreEtiquette(
    modele,
    donnees({ texteLibre: "Arrosage modéré, exposition plein soleil, sol drainant, protéger du gel en dessous de moins cinq degrés, tailler au printemps." }),
  );
  assert.match(long.avertissements.map((a) => a.message).join(" "), /a été tronqué/);
});

test("l'alignement déplace l'ancrage, pas le cadre de découpe", () => {
  const cadre = { x: 10, y: 5, largeur: 20, hauteur: 6, taille: 7 } as const;
  const ancrage = (alignement: "gauche" | "centre" | "droite") => {
    const rendue = rendreEtiquette(
      {
        famille: "jardins",
        nom: "essai",
        largeurMm: 60,
        hauteurMm: 40,
        margeMm: 2,
        champs: [{ champ: "nom", ...cadre, alignement }],
      },
      donnees({ nom: "Palmier" }),
    );
    const texte = rendue.elements.find((e) => e.type === "texte");
    assert.ok(texte && texte.type === "texte");
    return texte;
  };

  assert.equal(ancrage("gauche").xMm, 10);
  assert.equal(ancrage("centre").xMm, 20);
  assert.equal(ancrage("droite").xMm, 30);
  for (const alignement of ["gauche", "centre", "droite"] as const) {
    assert.deepEqual(ancrage(alignement).decoupe, { xMm: 10, yMm: 5, largeurMm: 20, hauteurMm: 6 });
  }
});

test("la ligne de base est centrée sur la hauteur de capitale, pas sur la police entière", () => {
  const rendue = rendreEtiquette(
    {
      famille: "jardins",
      nom: "essai",
      largeurMm: 60,
      hauteurMm: 40,
      margeMm: 2,
      champs: [{ champ: "nom", x: 2, y: 10, largeur: 30, hauteur: 10, taille: 10 }],
    },
    donnees({ nom: "Palmier" }),
  );
  const texte = rendue.elements.find((e) => e.type === "texte");
  assert.ok(texte && texte.type === "texte");
  const capitale = pointsVersMm(10) * 0.717;
  assert.ok(Math.abs(texte.yMm - arrondiMm(10 + (10 + capitale) / 2)) < 1e-6);
  // Le texte reste dans son cadre : la ligne de base est entre le haut
  // et le bas, jamais dessous.
  assert.ok(texte.yMm > 10 && texte.yMm < 20);
});

// ==================================================================
// LE QR
// ==================================================================

test("le QR est carré et centré, même dans un cadre rectangulaire", () => {
  const rendue = rendreEtiquette(
    {
      famille: "jardins",
      nom: "essai",
      largeurMm: 60,
      hauteurMm: 40,
      margeMm: 2,
      champs: [{ champ: "qr", x: 10, y: 5, largeur: 30, hauteur: 20 }],
    },
    donnees(),
  );
  const modules = rendue.elements.filter((e) => e.type === "rectangle");
  const gauche = Math.min(...modules.map((e) => (e.type === "rectangle" ? e.xMm : 0)));
  const droite = Math.max(...modules.map((e) => (e.type === "rectangle" ? e.xMm + e.largeurMm : 0)));
  const haut = Math.min(...modules.map((e) => (e.type === "rectangle" ? e.yMm : 0)));
  const bas = Math.max(...modules.map((e) => (e.type === "rectangle" ? e.yMm + e.hauteurMm : 0)));

  // Le côté utile est celui de la petite cote : 20 mm, pas 30.
  // Le QR ne s'ÉTIRE PAS — un QR étiré ne se scanne pas.
  assert.ok(Math.abs((droite - gauche) - (bas - haut)) < 0.01, "le QR n'est pas carré");
  // Et il est centré horizontalement dans les 30 mm du cadre.
  const margeGauche = gauche - 10;
  const margeDroite = 40 - droite;
  assert.ok(Math.abs(margeGauche - margeDroite) < 0.01, `${margeGauche} ≠ ${margeDroite}`);
});

test("la zone de silence est réellement laissée vide autour du QR", () => {
  const cote = 20;
  const rendue = rendreEtiquette(
    {
      famille: "jardins",
      nom: "essai",
      largeurMm: 60,
      hauteurMm: 40,
      margeMm: 2,
      champs: [{ champ: "qr", x: 10, y: 5, largeur: cote, hauteur: cote }],
    },
    donnees(),
  );
  const modules = rendue.elements.filter((e) => e.type === "rectangle");
  const gauche = Math.min(...modules.map((e) => (e.type === "rectangle" ? e.xMm : 0)));
  // Version 4 : 33 modules plus 4 de silence de chaque côté = 41.
  const tailleModule = cote / 41;
  assert.ok(Math.abs(gauche - (10 + 4 * tailleModule)) < 0.01, `le silence gauche fait ${gauche - 10} mm`);
});

test("un QR trop dense est signalé, avec la mesure et la consigne", () => {
  const rendue = rendreEtiquette(
    {
      famille: "biolab",
      nom: "essai",
      largeurMm: 25,
      hauteurMm: 15,
      margeMm: 1.5,
      champs: [{ champ: "qr", x: 1.5, y: 1.5, largeur: 12, hauteur: 12 }],
    },
    donnees(),
  );
  const message = rendue.avertissements.map((a) => a.message).join(" ");
  assert.match(message, /mm par module/);
  assert.match(message, /Agrandissez le cadre du QR|raccourcissez l'adresse/);
});

test("les modules sombres consécutifs sont fusionnés en un seul rectangle", () => {
  const rendue = rendreEtiquette(
    {
      famille: "jardins",
      nom: "essai",
      largeurMm: 60,
      hauteurMm: 40,
      margeMm: 2,
      champs: [{ champ: "qr", x: 10, y: 5, largeur: 30, hauteur: 30 }],
    },
    donnees(),
  );
  const rectangles = rendue.elements.filter((e) => e.type === "rectangle");
  // Une version 4 compte 1089 modules, dont grossièrement la moitié
  // sont sombres. La fusion doit descendre nettement sous 500.
  assert.ok(rectangles.length < 400, `${rectangles.length} rectangles : la fusion n'a pas eu lieu`);
  assert.ok(rectangles.length > 100, `${rectangles.length} rectangles : le QR semble vide`);
  // Les motifs de recherche font 7 modules de large : au moins un
  // rectangle doit valoir sept fois le module.
  const tailleModule = 30 / 41;
  assert.ok(
    rectangles.some((e) => e.type === "rectangle" && Math.abs(e.largeurMm - 7 * tailleModule) < 0.01),
    "aucun rectangle de sept modules : les motifs de recherche n'ont pas été fusionnés",
  );
});

test("sans adresse, le QR n'est pas imprimé et on le dit", () => {
  const rendue = rendreEtiquette(MODELES_OASIS.biolab, { url: "", valeurs: {} });
  assert.equal(rendue.elements.length, 0);
  assert.match(rendue.avertissements.map((a) => a.message).join(" "), /Aucune adresse à encoder/);
});

// ==================================================================
// LE CODE-BARRES
// ==================================================================

test("le code-barres prend le numéro de lot à défaut de valeur propre", () => {
  const modele: ModeleEtiquette = {
    famille: "pepiniere",
    nom: "essai",
    largeurMm: 60,
    hauteurMm: 40,
    margeMm: 2,
    champs: [{ champ: "codeBarres", x: 5, y: 5, largeur: 50, hauteur: 8 }],
  };
  const avecLot = rendreEtiquette(modele, donnees({ numeroLot: "LOT-2026-004" }));
  assert.ok(avecLot.elements.length > 20, "aucune barre");

  const sansRien = rendreEtiquette(modele, donnees());
  assert.equal(sansRien.elements.length, 0);
});

test("une saisie minuscule ou accentuée est translittérée, et on le dit", () => {
  const rendue = rendreEtiquette(
    {
      famille: "pepiniere",
      nom: "essai",
      largeurMm: 60,
      hauteurMm: 40,
      margeMm: 2,
      champs: [{ champ: "codeBarres", x: 5, y: 5, largeur: 50, hauteur: 8 }],
    },
    donnees({ codeBarres: "Lot n°4" }),
  );
  assert.match(rendue.avertissements.map((a) => a.message).join(" "), /LOT N-4/);
});

// ==================================================================
// LE LOGO
// ==================================================================

test("sans image, le logo s'imprime en texte ; avec image, en image", () => {
  const modele: ModeleEtiquette = {
    famille: "jardins",
    nom: "essai",
    largeurMm: 60,
    hauteurMm: 40,
    margeMm: 2,
    champs: [{ champ: "logo", x: 5, y: 5, largeur: 30, hauteur: 8, taille: 8 }],
  };
  const texte = rendreEtiquette(modele, donnees({ logo: "OASIS RARE CARE" }));
  assert.equal(texte.elements.filter((e) => e.type === "texte").length, 1);
  assert.equal(texte.elements.filter((e) => e.type === "image").length, 0);

  const image = rendreEtiquette(modele, {
    url: URL_ESSAI,
    valeurs: { logo: "OASIS RARE CARE" },
    logoDataUri: "data:image/png;base64,iVBORw0KGgo=",
  });
  assert.equal(image.elements.filter((e) => e.type === "image").length, 1);
});

// ==================================================================
// LA TRANSCRIPTION
// ==================================================================

test("le SVG échappe ce qu'il faut : un nom de cultivar ne casse pas le document", () => {
  const rendue = rendreEtiquette(
    {
      famille: "jardins",
      nom: "essai",
      largeurMm: 60,
      hauteurMm: 40,
      margeMm: 2,
      champs: [{ champ: "cultivar", x: 5, y: 5, largeur: 50, hauteur: 6, taille: 7 }],
    },
    donnees({ cultivar: '<script>&"Wagnerianus"' }),
  );
  const svg = documentSvg(60, 40, elementsVersSvg(rendue.elements, "x"));
  assert.ok(!svg.includes("<script>"), "le SVG contient une balise injectée");
  assert.match(svg, /&lt;script&gt;&amp;/);
});

test("le PDF encode les accents en WinAnsi, et remplace l'inconnu par un point d'interrogation", () => {
  assert.deepEqual(versWinAnsi("é"), [0xe9]);
  assert.deepEqual(versWinAnsi("«»"), [0xab, 0xbb]);
  assert.deepEqual(versWinAnsi("œ"), [0x9c]);
  assert.deepEqual(versWinAnsi("’"), [0x92]);
  assert.deepEqual(versWinAnsi("—"), [0x97]);
  // Un idéogramme ou un émoji n'existe pas dans CP1252 : il devient
  // « ? », visiblement, plutôt que de casser le fichier.
  assert.deepEqual(versWinAnsi("漢"), [0x3f]);
});

test("le PDF produit s'ouvre : en-tête, xref, trailer et un seul %%EOF", () => {
  const rendue = rendreEtiquette(MODELES_OASIS.jardins, donneesExemple(URL_ESSAI));
  const fichier = ecrirePdf([{ largeurMm: 60, hauteurMm: 40, elements: rendue.elements }]);
  const texte = new TextDecoder("latin1").decode(fichier);

  assert.ok(texte.startsWith("%PDF-1.4\n"), "en-tête absent");
  assert.equal((texte.match(/%%EOF/g) ?? []).length, 1);
  assert.match(texte, /\/Type \/Catalog/);
  assert.match(texte, /\/Type \/Pages/);
  assert.match(texte, /\/BaseFont \/Helvetica\b/);
  assert.match(texte, /\/Encoding \/WinAnsiEncoding/);

  // LE POINT LE PLUS FRAGILE D'UN PDF ÉCRIT À LA MAIN : les décalages
  // de la table de références croisées. On les relit et on vérifie que
  // chacun tombe bien sur « N 0 obj ».
  const startxref = Number(/startxref\n(\d+)/.exec(texte)?.[1]);
  assert.ok(Number.isFinite(startxref));
  assert.equal(texte.slice(startxref, startxref + 4), "xref");

  const entetesXref = /xref\n0 (\d+)\n/.exec(texte.slice(startxref));
  assert.ok(entetesXref);
  const nombreObjets = Number(entetesXref[1]);
  // La table commence par l'entrée de l'objet 0, l'entrée libre :
  // l'enregistrement de l'objet n est donc le n-ième, pas le (n−1)-ième.
  const table = texte.slice(startxref + entetesXref[0].length);
  for (let n = 1; n < nombreObjets; n += 1) {
    const decalage = Number(table.slice(n * 20, n * 20 + 10));
    assert.equal(texte.slice(decalage, decalage + `${n} 0 obj`.length), `${n} 0 obj`, `objet ${n} mal référencé`);
  }
});

test("la longueur déclarée du flux de contenu est celle des octets, accents compris", () => {
  const rendue = rendreEtiquette(
    {
      famille: "jardins",
      nom: "essai",
      largeurMm: 60,
      hauteurMm: 40,
      margeMm: 2,
      champs: [{ champ: "nom", x: 5, y: 5, largeur: 50, hauteur: 6, taille: 8 }],
    },
    donnees({ nom: "Chamærops humilis « Vulcano » — pépinière" }),
  );
  const texte = new TextDecoder("latin1").decode(ecrirePdf([{ largeurMm: 60, hauteurMm: 40, elements: rendue.elements }]));
  const trouve = /\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(texte);
  assert.ok(trouve, "flux de contenu introuvable");
  assert.equal(trouve[2].length, Number(trouve[1]));
});

test("un PDF sans page est refusé plutôt que produit vide", () => {
  assert.throws(() => ecrirePdf([]), /ne s'ouvre nulle part/);
});

test("le rognage du texte est bien posé dans le PDF, autour de chaque champ", () => {
  const rendue = rendreEtiquette(MODELES_OASIS.pepiniere, donneesExemple(URL_ESSAI));
  const texte = new TextDecoder("latin1").decode(ecrirePdf([{ largeurMm: 50, hauteurMm: 30, elements: rendue.elements }]));
  const rognages = (texte.match(/re W n/g) ?? []).length;
  const textes = (texte.match(/ Tj ET/g) ?? []).length;
  assert.equal(rognages, textes, "chaque texte doit être rogné à son champ");
  assert.equal((texte.match(/^q$/gm) ?? []).length, (texte.match(/^Q$/gm) ?? []).length);
  assert.equal(lireCotesPdf(ecrirePdf([{ largeurMm: 50, hauteurMm: 30, elements: rendue.elements }])).length, 1);
});
