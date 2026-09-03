import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEPENSE_VIDE,
  PLAFOND_MAX_CENTIMES,
  ajouterAppel,
  estMinorant,
  lireMontantEuros,
  moyenneCents,
} from "./montants.ts";

/**
 * §11V — LE FICHIER QUI EMPÊCHE UNE FAUTE DE FRAPPE D'ÉTEINDRE L'IA.
 *
 * La distinction vide / zéro / illisible n'est pas une élégance : c'est
 * la seule chose qui sépare « je n'ai pas fixé de plafond » de « j'ai
 * fixé un plafond à zéro », donc d'une IA coupée. Ces tests figent les
 * trois réponses, et surtout le fait que la troisième n'écrit rien.
 */

// ==================================================================
// Vide, zéro, illisible
// ==================================================================

test("un champ vide veut dire « aucun plafond », pas « plafond à zéro »", () => {
  for (const saisie of ["", "   ", null, undefined]) {
    assert.deepEqual(lireMontantEuros(saisie), { etat: "aucune" }, `saisie : ${String(saisie)}`);
  }
});

test("un zéro délibéré est un montant, et il vaut zéro", () => {
  assert.deepEqual(lireMontantEuros("0"), { etat: "montant", cents: 0 });
  assert.deepEqual(lireMontantEuros("0,00"), { etat: "montant", cents: 0 });
});

test("une saisie illisible n'est PAS zéro", () => {
  // Le scénario exact : la lettre O à la place du chiffre 0. Avec
  // `inputToCents` (lib/quotes/types.ts), « 12,5O » rend 0, c'est-à-dire
  // « couper l'IA ». Ici, il rend « illisible », et l'appelant n'écrit rien.
  for (const saisie of ["12,5O", "abc", "1e3", "12,345", "-5", "12,50,50", "€", "1 2 , 3 4 5"]) {
    const lecture = lireMontantEuros(saisie);
    assert.equal(lecture.etat, "illisible", `« ${saisie} » aurait dû être refusé`);
  }
});

test("la virgule française, le point, les espaces et l'euro sont acceptés", () => {
  assert.deepEqual(lireMontantEuros("12,50"), { etat: "montant", cents: 1250 });
  assert.deepEqual(lireMontantEuros("12.50"), { etat: "montant", cents: 1250 });
  assert.deepEqual(lireMontantEuros("1 200"), { etat: "montant", cents: 120_000 });
  // Espace insécable, puis insécable fin : ce que collent Windows et les tableurs.
  assert.deepEqual(lireMontantEuros("1 200,05"), { etat: "montant", cents: 120_005 });
  assert.deepEqual(lireMontantEuros("1 200"), { etat: "montant", cents: 120_000 });
  assert.deepEqual(lireMontantEuros("25 €"), { etat: "montant", cents: 2500 });
});

test("une décimale seule vaut des dizaines de centimes, pas des unités", () => {
  // « 12,5 » veut dire douze euros cinquante, pas douze euros cinq.
  assert.deepEqual(lireMontantEuros("12,5"), { etat: "montant", cents: 1250 });
});

test("trois décimales sont refusées plutôt qu'arrondies", () => {
  const lecture = lireMontantEuros("10,005");
  assert.equal(lecture.etat, "illisible");
  // Arrondir choisirait à la place de quelqu'un sur un montant qu'il n'a
  // pas relu — et « 10,005 » est bien plus souvent une faute de frappe
  // qu'une intention.
});

test("un plafond absurdement grand est refusé : c'est une virgule oubliée", () => {
  const juste = lireMontantEuros(String(PLAFOND_MAX_CENTIMES / 100));
  assert.deepEqual(juste, { etat: "montant", cents: PLAFOND_MAX_CENTIMES });

  const trop = lireMontantEuros(String(PLAFOND_MAX_CENTIMES / 100 + 1));
  assert.equal(trop.etat, "illisible");
});

test("le message d'erreur dit comment obtenir chacun des trois états", () => {
  const lecture = lireMontantEuros("abc");
  assert.equal(lecture.etat, "illisible");
  if (lecture.etat !== "illisible") return;
  assert.match(lecture.raison, /vide/, "il doit dire comment ne poser aucun plafond");
  assert.match(lecture.raison, /0/, "il doit dire comment couper l'IA délibérément");
  assert.equal(lecture.saisie, "abc", "la saisie est rendue telle quelle, pour la citer");
});

// ==================================================================
// Une dépense qui sait ce qu'elle ignore
// ==================================================================

test("un appel non tarifé ne compte pas pour zéro : il se compte à part", () => {
  let depense = DEPENSE_VIDE;
  depense = ajouterAppel(depense, 1200);
  depense = ajouterAppel(depense, null);
  depense = ajouterAppel(depense, 300);

  assert.equal(depense.centsConnus, 1500);
  assert.equal(depense.appelsSansTarif, 1);
  assert.equal(depense.appels, 3);
  assert.equal(estMinorant(depense), true, "1 500 centimes est un plancher, pas un total");
});

test("sans appel non tarifé, la somme est un vrai total", () => {
  const depense = ajouterAppel(ajouterAppel(DEPENSE_VIDE, 100), 200);
  assert.equal(depense.centsConnus, 300);
  assert.equal(estMinorant(depense), false);
});

test("tous les appels non tarifés : zéro connu, et on le sait", () => {
  const depense = ajouterAppel(ajouterAppel(DEPENSE_VIDE, null), null);
  assert.equal(depense.centsConnus, 0);
  assert.equal(depense.appelsSansTarif, 2);
  assert.equal(
    estMinorant(depense),
    true,
    "« 0,00 € » sans mention serait le pire affichage possible : faux et rassurant",
  );
});

test("une moyenne sans rien à moyenner vaut null, jamais zéro", () => {
  assert.equal(moyenneCents(DEPENSE_VIDE, 0), null);
  assert.equal(moyenneCents({ centsConnus: 1000, appelsSansTarif: 0, appels: 4 }, 0), null);
  assert.equal(moyenneCents({ centsConnus: 1000, appelsSansTarif: 0, appels: 4 }, 4), 250);
  // Arrondi au centime : une moyenne de 333,33… centimes ne s'écrit pas.
  assert.equal(moyenneCents({ centsConnus: 1000, appelsSansTarif: 0, appels: 3 }, 3), 333);
});

test("`ajouterAppel` ne mute pas la dépense qu'on lui donne", () => {
  const depart = DEPENSE_VIDE;
  ajouterAppel(depart, 5000);
  assert.deepEqual(depart, { centsConnus: 0, appelsSansTarif: 0, appels: 0 });
});
