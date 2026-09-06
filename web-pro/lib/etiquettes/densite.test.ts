import { test } from "node:test";
import assert from "node:assert/strict";

import {
  POINT_203_DPI_MM,
  SEUIL_CONFORTABLE_MM,
  SEUIL_LIMITE_MM,
  coteQrMaximalMm,
  longueurContenuMaximale,
  mesurerDensiteQr,
  tableauDensite,
} from "./densite.ts";
import { SILENCE_QR_MODULES } from "./rendu.ts";

/**
 * CE QUE CES TESTS ÉPINGLENT.
 *
 * Pas une apparence : des NOMBRES, et les décisions qui en découlent.
 * « Le QR tient sur 25 × 15 mm » n'est ni vrai ni faux dans l'absolu —
 * cela dépend de la longueur de l'adresse, du mode d'encodage et de la
 * zone de silence. Ces tests fixent le calcul pour qu'on puisse
 * discuter du domaine sur des millimètres plutôt que sur des avis.
 *
 * LE JETON D'AUJOURD'HUI FAIT 32 CARACTÈRES HEXADÉCIMAUX MINUSCULES :
 * c'est ce que pose la migration 0090 (`encode(gen_random_bytes(16),
 * 'hex')`) et ce que son résolveur exige (`^[0-9a-f]{32}$`). Toute
 * mesure part de là.
 */

const DOMAINE = "https://oasisrarecare.fr/x/";
const JETON_32 = "3f8a1c4e9b2d7a604f5e1c8b3d9a2e70";
const ADRESSE = `${DOMAINE}${JETON_32}`;

test("l'adresse proposée fait 59 caractères, dont 27 de domaine et de chemin", () => {
  assert.equal(DOMAINE.length, 27);
  assert.equal(JETON_32.length, 32);
  assert.equal(ADRESSE.length, 59);
});

test("la zone de silence est COMPTÉE : c'est elle qui change la conclusion", () => {
  const mesure = mesurerDensiteQr(ADRESSE, 13);
  assert.equal(mesure.version, 4);
  assert.equal(mesure.modulesParCote, 33);
  assert.equal(mesure.modulesAvecSilence, 33 + 2 * SILENCE_QR_MODULES);

  // Le calcul naïf, qui oublie le silence, donne 13/33 = 0,394 mm et
  // conclut « ça passe ». Le vrai est 13/41 = 0,317 mm, et il conclut
  // l'inverse. C'est tout l'écart entre une étiquette qui se scanne et
  // une qui ne se scanne pas.
  assert.ok(Math.abs(mesure.tailleModuleMm - 13 / 41) < 1e-9);
  assert.ok(13 / 33 > SEUIL_LIMITE_MM, "le calcul naïf conclurait que ça passe");
  assert.ok(mesure.tailleModuleMm < SEUIL_LIMITE_MM, "le calcul juste conclut que ça ne passe pas");
});

test("sur les cinq formats du § 17, avec le jeton d'aujourd'hui", () => {
  const lignes = tableauDensite(ADRESSE);
  const parFormat = Object.fromEntries(lignes.map((l) => [l.format, l]));

  // Le côté du plus grand QR possible : la petite cote, moins deux
  // marges de 1,5 mm. C'est le MEILLEUR cas — il ne reste plus rien
  // pour le texte.
  assert.equal(parFormat["25 × 15 mm"].coteQrMm, 12);
  assert.equal(parFormat["40 × 20 mm"].coteQrMm, 17);
  assert.equal(parFormat["50 × 30 mm"].coteQrMm, 27);
  assert.equal(parFormat["60 × 40 mm"].coteQrMm, 37);
  assert.equal(parFormat["100 × 50 mm"].coteQrMm, 47);

  // Tous en version 4 : c'est la longueur de l'adresse qui décide, pas
  // la taille de l'étiquette.
  for (const ligne of lignes) assert.equal(ligne.mesure.version, 4, ligne.format);

  // LE VERDICT, FORMAT PAR FORMAT. Ce sont ces cinq lignes qui disent
  // au dirigeant ce qu'il peut coller sur quoi.
  assert.equal(parFormat["25 × 15 mm"].mesure.verdictAppareilPhoto, "illisible");
  assert.equal(parFormat["40 × 20 mm"].mesure.verdictAppareilPhoto, "limite");
  assert.equal(parFormat["50 × 30 mm"].mesure.verdictAppareilPhoto, "confortable");
  assert.equal(parFormat["60 × 40 mm"].mesure.verdictAppareilPhoto, "confortable");
  assert.equal(parFormat["100 × 50 mm"].mesure.verdictAppareilPhoto, "confortable");
});

test("raccourcir le DOMAINE ne change RIEN ; raccourcir le jeton change tout", () => {
  // LE RÉSULTAT LE PLUS UTILE DE TOUT CE FICHIER, ET IL EST
  // CONTRE-INTUITIF. La version d'un QR est un ESCALIER, pas une pente :
  // tant qu'on ne franchit pas une marche, économiser des caractères ne
  // rapporte pas un micron.
  const cote = 12; // le plus grand QR d'une étiquette de 25 × 15 mm
  const moduleMm = (contenu: string) => mesurerDensiteQr(contenu, cote).tailleModuleMm;

  const actuel = moduleMm(ADRESSE);
  // « oasisrare.app » au lieu de « oasisrarecare.fr » : trois
  // caractères de moins, et un domaine à acheter.
  const domaineCourt = moduleMm(`https://oasisrare.app/x/${JETON_32}`);
  assert.equal(domaineCourt, actuel, "trois caractères de domaine ne changent pas la version, donc pas le module");

  // ET AUCUN DOMAINE NE PEUT RIEN Y CHANGER. Pour tomber en version 3
  // au niveau M en mode octet, il faut 42 caractères en tout ; avec un
  // jeton de 32, il resterait DIX caractères pour « https:// » plus un
  // domaine plus un chemin. C'est impossible.
  assert.equal(mesurerDensiteQr(`https://a.fr/x/${JETON_32}`, cote).version, 4);
  assert.equal(mesurerDensiteQr(`https://a.fr/${JETON_32}`, cote).version, 4);

  // LE JETON, LUI, FRANCHIT LA MARCHE — mais il faut savoir OÙ elle est.
  // La version 3 au niveau M accepte 42 caractères en mode octet. Avec
  // 27 caractères d'adresse, il reste QUINZE caractères de jeton, pas
  // seize : un jeton de 16 reste en version 4, exactement comme celui
  // de 32. Un « on coupe le jeton en deux » décidé à vue ne gagnerait
  // donc rien du tout.
  assert.equal(mesurerDensiteQr(`${DOMAINE}${JETON_32.slice(0, 16)}`, cote).version, 4);
  assert.equal(mesurerDensiteQr(`${DOMAINE}${JETON_32.slice(0, 15)}`, cote).version, 3);
  assert.ok(moduleMm(`${DOMAINE}${JETON_32.slice(0, 15)}`) > actuel);

  // ET LA MARCHE SUIVANTE, celle qui compte vraiment pour le 25 × 15 :
  // la version 2 demande 38 caractères en alphanumérique, soit un jeton
  // de ONZE caractères en majuscules.
  assert.equal(mesurerDensiteQr(`${DOMAINE}${JETON_32.slice(0, 11)}`.toUpperCase(), cote).version, 2);
});

test("le 25 × 15 mm du § 17 est ILLISIBLE avec l'adresse d'aujourd'hui", () => {
  // C'est le résultat le plus dur de ce fichier, et il faut qu'il soit
  // écrit noir sur blanc quelque part : le plus petit format demandé par
  // le § 17 ne peut pas porter le jeton actuel de façon scannable.
  const cote = 12; // 15 mm de haut, moins deux marges de 1,5 mm
  const mesure = mesurerDensiteQr(ADRESSE, cote);
  assert.equal(mesure.verdictAppareilPhoto, "illisible");
  assert.ok(mesure.tailleModuleMm < 0.3);

  // Ce qu'il faudrait pour y arriver : descendre en version 2, donc à
  // 38 caractères en alphanumérique — et même là, on n'atteint que le
  // seuil bas, jamais le confort.
  const version2 = mesurerDensiteQr(`${DOMAINE}${JETON_32.slice(0, 11)}`.toUpperCase(), cote);
  assert.equal(version2.version, 2);
  assert.equal(version2.verdictAppareilPhoto, "limite");

  // Et AUCUN contenu, si court soit-il, ne rend ce format confortable :
  // une version 1 fait déjà 21 + 8 = 29 modules, soit 0,41 mm sur 12 mm.
  assert.equal(longueurContenuMaximale(cote, { seuilMm: SEUIL_CONFORTABLE_MM, modele: ADRESSE }), null);
});

test("les MAJUSCULES font gagner une version, parce qu'elles ouvrent le mode alphanumérique", () => {
  const cote = 12;
  const minuscule = mesurerDensiteQr(ADRESSE, cote);
  const majuscule = mesurerDensiteQr(ADRESSE.toUpperCase(), cote);

  assert.deepEqual([...minuscule.modes], ["octet"]);
  assert.deepEqual([...majuscule.modes], ["alphanumerique"]);
  assert.equal(minuscule.version, 4);
  assert.equal(majuscule.version, 3);
  assert.ok(majuscule.tailleModuleMm > minuscule.tailleModuleMm);

  // MAIS LE GAIN EST MAIGRE : 33 + 8 = 41 modules contre 29 + 8 = 37,
  // soit 11 % de plus par module. Pas de quoi rendre lisible un format
  // qui ne l'était pas, et cela impose un jeton en majuscules ET une
  // route qui accepte « /X/ ». Le calcul est là pour que la décision se
  // prenne sur ce chiffre-là et pas sur une intuition.
  assert.ok(majuscule.tailleModuleMm / minuscule.tailleModuleMm < 1.15);
  assert.equal(minuscule.modulesAvecSilence, 41);
  assert.equal(majuscule.modulesAvecSilence, 37);
});

test("à partir de quelle longueur d'adresse ça ne passe plus, format par format", () => {
  // Le seuil « limite » : ça se lit encore, de près.
  const limites = [12, 17, 27, 37, 47].map((cote) => ({
    cote,
    limite: longueurContenuMaximale(cote, { seuilMm: SEUIL_LIMITE_MM, modele: ADRESSE }),
    confort: longueurContenuMaximale(cote, { seuilMm: SEUIL_CONFORTABLE_MM, modele: ADRESSE }),
  }));

  // Sur 25 × 15 mm (carré de 12 mm), MÊME UNE ADRESSE D'UN SEUL
  // CARACTÈRE ne descend pas sous le seuil de confort : une version 1
  // fait 21 + 8 = 29 modules, soit 12/29 = 0,41 mm. Le format est trop
  // petit pour un QR confortable, quoi qu'on encode.
  assert.equal(limites[0].confort, null);
  assert.ok(limites[0].limite && limites[0].limite.longueurMax >= 20);

  // Sur 40 × 20 (17 mm), l'adresse actuelle de 59 caractères passe tout
  // juste au seuil bas, et rien de plus long ne passe.
  assert.ok(limites[1].limite && limites[1].limite.longueurMax >= 59);

  // Sur 50 × 30 (27 mm) et au-delà, la question ne se pose plus.
  assert.ok(limites[2].confort && limites[2].confort.longueurMax >= 59);

  // La longueur maximale croît avec la taille de la boîte : une
  // inversion signalerait un bogue de recherche.
  for (let i = 1; i < limites.length; i += 1) {
    const precedent = limites[i - 1].limite?.longueurMax ?? 0;
    const courant = limites[i].limite?.longueurMax ?? 0;
    assert.ok(courant >= precedent, `${limites[i].cote} mm accepte moins que ${limites[i - 1].cote} mm`);
  }
});

test("la tête thermique est mesurée à part : deux points par module au minimum", () => {
  assert.ok(Math.abs(POINT_203_DPI_MM - 25.4 / 203) < 1e-12);

  // 25 × 15 mm : sous les deux points par module à 203 dpi.
  const petite = mesurerDensiteQr(ADRESSE, 12);
  assert.ok(petite.pointsParModule203 < 2.5);
  assert.match(petite.remarques.join(" "), /203 dpi/);

  // 60 × 40 mm : largement au-dessus.
  const grande = mesurerDensiteQr(ADRESSE, 37);
  assert.ok(grande.pointsParModule203 > 6);

  // L'irrégularité est bornée par construction : c'est un écart à
  // l'entier le plus proche.
  for (const cote of [12, 17, 27, 37, 47]) {
    const mesure = mesurerDensiteQr(ADRESSE, cote);
    assert.ok(mesure.irregularite203 >= 0 && mesure.irregularite203 <= 0.5, `${cote} mm`);
  }
});

test("chaque remarque dit quoi faire, pas seulement ce qui ne va pas", () => {
  const mesure = mesurerDensiteQr(ADRESSE, 10);
  assert.ok(mesure.remarques.length > 0);
  const tout = mesure.remarques.join(" ");
  assert.match(tout, /ne se scanne pas|se lit de près/);
});

test("un cadre de QR plus grand ne change jamais la version, seulement le module", () => {
  // Évident, mais c'est le cœur du raisonnement : la version dépend du
  // CONTENU, la lisibilité de la TAILLE. Confondre les deux fait croire
  // qu'agrandir l'étiquette permet d'allonger l'adresse.
  const versions = [8, 12, 20, 40, 80].map((cote) => mesurerDensiteQr(ADRESSE, cote).version);
  assert.deepEqual(versions, [4, 4, 4, 4, 4]);
  const modules = [8, 12, 20, 40, 80].map((cote) => mesurerDensiteQr(ADRESSE, cote).tailleModuleMm);
  for (let i = 1; i < modules.length; i += 1) assert.ok(modules[i] > modules[i - 1]);
});

test("coteQrMaximalMm retire bien les deux marges", () => {
  assert.equal(coteQrMaximalMm(25, 15, 1.5), 12);
  assert.equal(coteQrMaximalMm(100, 50, 0), 50);
  assert.equal(coteQrMaximalMm(60, 40, 2), 36);
});
