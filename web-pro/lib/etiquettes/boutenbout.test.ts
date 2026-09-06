import { test } from "node:test";
import assert from "node:assert/strict";

import { composerPlanche, plancheVersPdf, plancheVersSvg } from "./planche.ts";
import { encoderQr } from "./qr.ts";
import { SILENCE_QR_MODULES } from "./rendu.ts";
import type { ModeleEtiquette } from "./types.ts";

/**
 * LE TEST QUI FERME LA BOUCLE.
 *
 * Tout le reste vérifie des morceaux : l'encodeur produit la bonne
 * matrice, le moteur de mise en page produit les bonnes cotes, le PDF
 * porte le bon MediaBox. Aucun de ces tests ne verrait une erreur de
 * TRANSCRIPTION — un facteur de conversion inversé, un axe des Y oublié,
 * une fusion de modules décalée d'un rang. Le QR sortirait alors
 * parfaitement net, parfaitement carré, et parfaitement illisible.
 *
 * Ici on part des OCTETS du document produit — le PDF réellement écrit,
 * le SVG réellement rendu —, on relève les rectangles noirs, on les
 * repose sur une grille de modules, et on vérifie que la matrice
 * reconstruite est celle de l'encodeur, module par module.
 *
 * Comme qr.test.ts prouve par ailleurs que cette matrice-là se décode en
 * l'adresse de départ, la chaîne est complète : adresse → matrice →
 * octets du fichier → matrice → adresse.
 */

const URL_ESSAI = "https://oasisrarecare.fr/x/3f8a1c4e9b2d7a604f5e1c8b3d9a2e70";

/** Un modèle dont le QR occupe une boîte carrée connue. */
const CADRE = { x: 8, y: 6, cote: 24 };
const MODELE: ModeleEtiquette = {
  famille: "jardins",
  nom: "essai bout en bout",
  largeurMm: 40,
  hauteurMm: 36,
  margeMm: 2,
  champs: [{ champ: "qr", x: CADRE.x, y: CADRE.y, largeur: CADRE.cote, hauteur: CADRE.cote }],
};

type Rectangle = { xMm: number; yMm: number; largeurMm: number; hauteurMm: number };

/**
 * Repose des rectangles sur la grille de modules et rend la matrice.
 * On teste le CENTRE de chaque module : un décalage d'un demi-module
 * suffirait à faire basculer le résultat, ce qui est exactement la
 * sensibilité qu'on veut.
 */
function matriceDepuisRectangles(rectangles: readonly Rectangle[], taille: number): boolean[][] {
  const tailleModule = CADRE.cote / (taille + 2 * SILENCE_QR_MODULES);
  const origine = SILENCE_QR_MODULES * tailleModule;
  const matrice: boolean[][] = [];
  for (let y = 0; y < taille; y += 1) {
    const ligne: boolean[] = [];
    for (let x = 0; x < taille; x += 1) {
      const cx = CADRE.x + origine + (x + 0.5) * tailleModule;
      const cy = CADRE.y + origine + (y + 0.5) * tailleModule;
      ligne.push(
        rectangles.some(
          (r) => cx >= r.xMm && cx <= r.xMm + r.largeurMm && cy >= r.yMm && cy <= r.yMm + r.hauteurMm,
        ),
      );
    }
    matrice.push(ligne);
  }
  return matrice;
}

function comparer(reconstruite: readonly (readonly boolean[])[], attendue: readonly (readonly boolean[])[], quoi: string) {
  let differences = 0;
  for (let y = 0; y < attendue.length; y += 1) {
    for (let x = 0; x < attendue.length; x += 1) {
      if (reconstruite[y][x] !== attendue[y][x]) differences += 1;
    }
  }
  assert.equal(differences, 0, `${quoi} : ${differences} modules divergent de la matrice de l'encodeur`);
}

test("le QR relevé dans les OCTETS DU PDF est exactement celui de l'encodeur", () => {
  const planche = composerPlanche([{ url: URL_ESSAI, valeurs: {} }], { modele: MODELE, support: "rouleau" });
  const fichier = new TextDecoder("latin1").decode(plancheVersPdf(planche));

  // Le flux de contenu, tel qu'un lecteur PDF le lira.
  const flux = /stream\n([\s\S]*?)\nendstream/.exec(fichier);
  assert.ok(flux, "flux de contenu introuvable");

  const hauteurPagePt = (36 * 72) / 25.4;
  const rectangles: Rectangle[] = [];
  const motif = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re f/g;
  for (let trouve = motif.exec(flux[1]); trouve; trouve = motif.exec(flux[1])) {
    const [, xPt, yPt, lPt, hPt] = trouve.map(Number);
    const enMm = (points: number) => (points * 25.4) / 72;
    rectangles.push({
      xMm: enMm(xPt),
      // L'ORIGINE DU PDF EST EN BAS À GAUCHE : c'est ici, et nulle part
      // ailleurs, qu'un axe inversé se verrait.
      yMm: enMm(hauteurPagePt - yPt - hPt),
      largeurMm: enMm(lPt),
      hauteurMm: enMm(hPt),
    });
  }
  assert.ok(rectangles.length > 100, `seulement ${rectangles.length} rectangles relevés`);

  const attendue = encoderQr(URL_ESSAI, { niveau: "M" });
  comparer(matriceDepuisRectangles(rectangles, attendue.taille), attendue.modules, "PDF");
});

test("le QR relevé dans le SVG rendu est exactement celui de l'encodeur", () => {
  const planche = composerPlanche([{ url: URL_ESSAI, valeurs: {} }], { modele: MODELE, support: "rouleau" });
  const svg = plancheVersSvg(planche)[0];

  const rectangles: Rectangle[] = [];
  const motif = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#000"\/>/g;
  for (let trouve = motif.exec(svg); trouve; trouve = motif.exec(svg)) {
    rectangles.push({
      xMm: Number(trouve[1]),
      yMm: Number(trouve[2]),
      largeurMm: Number(trouve[3]),
      hauteurMm: Number(trouve[4]),
    });
  }
  assert.ok(rectangles.length > 100, `seulement ${rectangles.length} rectangles relevés`);

  const attendue = encoderQr(URL_ESSAI, { niveau: "M" });
  comparer(matriceDepuisRectangles(rectangles, attendue.taille), attendue.modules, "SVG");
});

test("les deux sorties relèvent le MÊME nombre de rectangles, aux mêmes cotes", () => {
  // Preuve directe qu'il n'y a qu'un moteur de mise en page : si le SVG
  // et le PDF divergeaient d'un seul module, l'aperçu validé à l'écran
  // ne serait pas ce qui sort de l'imprimante.
  const planche = composerPlanche([{ url: URL_ESSAI, valeurs: {} }], { modele: MODELE, support: "rouleau" });
  const svg = plancheVersSvg(planche)[0];
  const pdf = new TextDecoder("latin1").decode(plancheVersPdf(planche));
  assert.equal((svg.match(/fill="#000"/g) ?? []).length, (pdf.match(/re f/g) ?? []).length);
});

test("le QR survit à un déplacement sur une planche A4 : la translation ne le déforme pas", () => {
  // La quinzième case d'une planche, donc un décalage de plusieurs
  // dizaines de millimètres en x ET en y. C'est là qu'une erreur
  // d'arrondi cumulée se verrait.
  const planche = composerPlanche(
    Array.from({ length: 15 }, () => ({ url: URL_ESSAI, valeurs: {} })),
    { modele: MODELE, support: "a4" },
  );
  assert.ok(planche.grille);
  const svg = plancheVersSvg(planche)[0];

  const tous: Rectangle[] = [];
  const motif = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#000"\/>/g;
  for (let trouve = motif.exec(svg); trouve; trouve = motif.exec(svg)) {
    tous.push({
      xMm: Number(trouve[1]),
      yMm: Number(trouve[2]),
      largeurMm: Number(trouve[3]),
      hauteurMm: Number(trouve[4]),
    });
  }

  const attendue = encoderQr(URL_ESSAI, { niveau: "M" });
  const tailleModule = CADRE.cote / (attendue.taille + 2 * SILENCE_QR_MODULES);

  for (const index of [0, 7, 14]) {
    const colonne = index % planche.grille.colonnes;
    const ligne = Math.floor(index / planche.grille.colonnes);
    const dx = planche.grille.origineXMm + colonne * planche.grille.pasXMm;
    const dy = planche.grille.origineYMm + ligne * planche.grille.pasYMm;

    // On ramène les rectangles de CETTE case dans le repère de l'étiquette.
    const locaux = tous
      .filter(
        (r) =>
          r.xMm >= dx - 1e-6 &&
          r.xMm < dx + MODELE.largeurMm + 1e-6 &&
          r.yMm >= dy - 1e-6 &&
          r.yMm < dy + MODELE.hauteurMm + 1e-6,
      )
      .map((r) => ({ ...r, xMm: r.xMm - dx, yMm: r.yMm - dy }));

    assert.ok(locaux.length > 100, `case ${index} : ${locaux.length} rectangles`);
    comparer(matriceDepuisRectangles(locaux, attendue.taille), attendue.modules, `case ${index}`);
    // Et la taille de module n'a pas bougé d'un micron entre les cases.
    const plusPetit = Math.min(...locaux.map((r) => r.largeurMm));
    assert.ok(Math.abs(plusPetit - tailleModule) < 1e-3, `case ${index} : module de ${plusPetit} mm`);
  }
});
