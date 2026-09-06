import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LIBELLE_CATEGORIE_PHOTO,
  LIBELLE_TYPE_COMPOSANT,
  LIBELLE_UNITE_CONCENTRATION,
  ORDRE_TYPE_COMPOSANT,
  SEUIL_TAUX,
  TYPES_COMPOSANT,
  direEffectif,
  direTaux,
  direTauxEnCarte,
  formaterDate,
  observer,
  observerDepuisTaux,
  severiteAtteinte,
} from "./referentiel.ts";
import { CONTAMINATION_LABELS, SEVERITE_LABELS, formatDateHeure, libelle } from "./cultures.ts";

/**
 * CE QUE CE FICHIER PROTÈGE.
 *
 * Trois façons de mentir avec un chiffre vrai, et le module BioLab les
 * rencontre toutes les trois :
 *
 *   1. AFFICHER ZÉRO POUR « JE NE SAIS PAS ». « 0 % de contamination »
 *      sur un laboratoire sans une seule inspection est la plus
 *      rassurante des faussetés.
 *   2. AFFICHER UN POURCENTAGE SUR TROIS LOTS. Il a l'air d'une
 *      tendance et n'est qu'un accident.
 *   3. COMPTER « INCONNU » COMME « ATTEINT ». Ne pas avoir regardé
 *      n'est pas avoir constaté.
 *
 * Et une quatrième, propre au travail à plusieurs : REDÉFINIR ICI un
 * vocabulaire que le socle porte déjà. Le dernier test s'en assure.
 */

test("un effectif nul ne rend pas zéro, il rend l'absence de réponse", () => {
  const rien = observer(0, 0);
  assert.equal(rien.taux, null, "une moyenne sur rien n'est pas zéro");
  assert.equal(rien.fiable, false);
  assert.equal(direTaux(rien), "Non disponible");
});

test("un vrai zéro mesuré s'affiche bien comme zéro", () => {
  // La distinction est le tout du sujet : zéro lot touché sur dix lots
  // inspectés est une bonne nouvelle qu'il faut pouvoir annoncer.
  const aucunTouche = observer(0, 10);
  assert.equal(aucunTouche.taux, 0);
  assert.equal(aucunTouche.fiable, true);
  assert.equal(direTaux(aucunTouche), "0 %");
});

test("sous le seuil, on rend les faits bruts et jamais un pourcentage", () => {
  const maigre = observer(2, 3);
  assert.equal(maigre.fiable, false);
  assert.equal(direTaux(maigre), "2 sur 3");
  // Le taux reste CALCULÉ : c'est lui qui trie la liste. Seule sa
  // prétention est cachée, pas sa valeur.
  assert.ok(maigre.taux !== null && Math.abs(maigre.taux - 2 / 3) < 1e-9);
});

test("le seuil s'applique à partir de l'effectif exact, pas au-dessus", () => {
  assert.equal(observer(1, SEUIL_TAUX - 1).fiable, false);
  assert.equal(observer(1, SEUIL_TAUX).fiable, true);
  assert.equal(direTaux(observer(1, 5)), "20 %");
});

test("« inconnue » ne compte pas comme un trouble constaté", () => {
  // `BioLabAnalyticsService` applique la même règle : une sévérité
  // `unknown` veut dire « je n'ai pas su juger », pas « c'est atteint ».
  assert.equal(severiteAtteinte("none"), false);
  assert.equal(severiteAtteinte("unknown"), false);
  assert.equal(severiteAtteinte("mild"), true);
  assert.equal(severiteAtteinte("moderate"), true);
  assert.equal(severiteAtteinte("severe"), true);
});

test("les composants se rangent dans l'ordre où on les verse", () => {
  // Le milieu de base d'abord, le gélifiant en dernier. Un ordre
  // alphabétique mettrait l'agar en tête, ce qui n'est l'ordre de rien.
  const rangs = TYPES_COMPOSANT.map((type) => ORDRE_TYPE_COMPOSANT[type]);
  assert.equal(new Set(rangs).size, TYPES_COMPOSANT.length, "deux composants ne peuvent pas partager un rang");
  assert.ok(ORDRE_TYPE_COMPOSANT.basalMedium < ORDRE_TYPE_COMPOSANT.plantGrowthRegulator);
  assert.ok(ORDRE_TYPE_COMPOSANT.plantGrowthRegulator < ORDRE_TYPE_COMPOSANT.gellingAgent);
});

test("chaque valeur du vocabulaire de la recette a un mot français", () => {
  for (const type of TYPES_COMPOSANT) {
    assert.ok(LIBELLE_TYPE_COMPOSANT[type], `le type ${type} n'a pas de libellé`);
  }
  assert.equal(LIBELLE_UNITE_CONCENTRATION.micromolar, "µM");
  assert.equal(LIBELLE_CATEGORIE_PHOTO.tissueDetail, "Détail tissus");
});

test("une valeur inconnue de la base se montre telle quelle, elle ne se tait pas", () => {
  // Les colonnes concernées sont du `text` libre : une version future
  // du téléphone peut y écrire un mot que ce fichier ignore. Un mot
  // étrange à l'écran se signale ; un tiret se confond avec un vide.
  assert.equal(libelle(LIBELLE_TYPE_COMPOSANT, "basalMedium"), "Milieu de base");
  assert.equal(libelle(LIBELLE_TYPE_COMPOSANT, "nanoparticule"), "nanoparticule");
});

test("une date sans valeur rend un tiret, pas la date d'aujourd'hui", () => {
  assert.equal(formaterDate(null), "—");
  assert.equal(formaterDate(undefined), "—");
  assert.ok(formaterDate("2026-08-24T09:00:00Z").includes("2026"));
});

test("le référentiel ne redéfinit AUCUN libellé que le socle porte déjà", () => {
  // Le piège du travail à plusieurs : deux tables de libellés qui
  // divergent en silence. Le socle `cultures.ts` porte la contamination
  // et la sévérité ; ce lot ne doit surtout pas en avoir une copie.
  const referentiel = Object.keys(LIBELLE_TYPE_COMPOSANT);
  for (const commun of [...Object.keys(CONTAMINATION_LABELS), ...Object.keys(SEVERITE_LABELS)]) {
    assert.ok(
      !referentiel.includes(commun),
      `« ${commun} » appartient au vocabulaire du socle : il ne doit pas être redéfini ici`,
    );
  }
  assert.equal(CONTAMINATION_LABELS.confirmed, "Confirmée");
  assert.equal(SEVERITE_LABELS.severe, "Sévère");
});

// ==================================================================
// 4. LE DÉNOMINATEUR QUE LA BASE REND — LES CARTES AUSSI
// ==================================================================
//
// La règle du seuil existait, elle n'était appliquée qu'aux tableaux :
// les huit cartes du haut affichaient « 100 % de contamination » sur
// une seule inspection exactement comme sur quarante, faute de savoir
// sur combien de lignes le chiffre portait. Les fonctions de 0087
// rendent désormais le dénominateur ; ces cas fixent ce qu'on en fait.

test("un taux reconstruit depuis la base retrouve son numérateur entier", () => {
  const observe = observerDepuisTaux(0.25, 8);
  assert.equal(observe.touches, 2);
  assert.equal(observe.effectif, 8);
  assert.equal(observe.fiable, true);
});

test("sous le seuil, la carte montre les faits bruts et pas un pourcentage", () => {
  assert.equal(direTauxEnCarte(observerDepuisTaux(1, 1)), "1 sur 1");
  assert.equal(direTauxEnCarte(observerDepuisTaux(0.5, 2)), "1 sur 2");
});

test("au-dessus du seuil, le pourcentage revient", () => {
  assert.equal(direTauxEnCarte(observerDepuisTaux(0.2, 10)), "20 %");
});

test("un vrai zéro mesuré reste « 0 % » — il n'est pas un inconnu", () => {
  assert.equal(direTauxEnCarte(observerDepuisTaux(0, 12)), "0 %");
});

test("un taux nul ou un effectif nul rend null, pour que la carte affiche un tiret", () => {
  assert.equal(direTauxEnCarte(observerDepuisTaux(null, 10)), null);
  assert.equal(direTauxEnCarte(observerDepuisTaux(0.3, 0)), null);
});

test("la base rend parfois le taux en chaîne : il est lu comme un nombre", () => {
  // PostgREST sérialise un `numeric` en chaîne. Le confondre avec un
  // inconnu ferait disparaître un chiffre exact.
  assert.equal(direTauxEnCarte(observerDepuisTaux("0.5000000000", 10)), "50 %");
});

test("une MOYENNE dit sur combien de mesures elle porte, et le signale quand c'est peu", () => {
  assert.match(direEffectif(2, "lot", "lots"), /2 lots seulement/);
  assert.match(direEffectif(12, "lot", "lots"), /moyenne sur 12 lots/);
  assert.doesNotMatch(direEffectif(12, "lot", "lots"), /seulement/);
  assert.match(direEffectif(0, "lot", "lots"), /aucune mesure/);
  assert.match(direEffectif(1, "passage", "passages"), /1 passage seulement/);
});

// ==================================================================
// 5. LE FUSEAU — UNE DATE SANS FUSEAU SE LIT À L'HEURE DU SERVEUR
// ==================================================================
//
// Le module passe explicitement `Europe/Paris` à la base pour compter
// « les gestes du jour » comme le téléphone les compte, puis rendait
// ses horodatages dans le fuseau du processus Node — inconnu et non
// garanti. La même page mélangeait deux horloges.

test("une date est rendue à l'heure de Paris, quel que soit le fuseau du serveur", () => {
  // La valeur réelle de production : 15:03 UTC, donc 17:03 à Paris.
  assert.equal(formaterDate("2026-09-02T15:03:52.207Z"), "02 sept. 2026");
  assert.match(formatDateHeure("2026-09-02T15:03:52.207Z"), /17:03/);
  // Et le cas qui fait basculer le JOUR : 23:30 à Paris le 5 septembre
  // est 21:30 UTC le même jour ; 23:30 UTC serait déjà le 6 à Paris.
  assert.match(formatDateHeure("2026-09-05T23:30:00Z"), /06 sept\. 2026, 01:30/);
});
