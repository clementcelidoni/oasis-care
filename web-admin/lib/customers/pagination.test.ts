import test from "node:test";
import assert from "node:assert/strict";

import { isBeyondLastPage, parsePage, parseSearch, toPage } from "./pagination.ts";

/**
 * ==================================================================
 * LE SUJET DE CE FICHIER : UN TOTAL ABSENT N'EST PAS UN TOTAL NUL
 * ==================================================================
 *
 * `total_count` voyage sur les lignes rendues par la base. Une page qui
 * ne rend aucune ligne ne rend donc aucun total — et la tentation
 * d'écrire `total ?? 0` pour faire taire le typeur afficherait
 * « 0 à 0 sur 0 » à un administrateur qui vient simplement de dépasser
 * la fin d'une liste de mille comptes.
 *
 * C'est le `?? 0` que ce projet s'interdit, appliqué cette fois à un
 * compteur de personnes. Ces tests transforment cette régression en
 * échec de suite.
 */

test("le total est absent quand la page est vide, pas nul", () => {
  const paged = toPage([], 3, 50);
  assert.equal(paged.total, null);
  assert.notEqual(paged.total, 0);
});

test("le total se lit sur les lignes", () => {
  const paged = toPage([{ total_count: 1_240 }, { total_count: 1_240 }], 1, 50);
  assert.equal(paged.total, 1_240);
});

/**
 * Un total réellement nul EXISTE : c'est « aucun résultat », et il se
 * distingue de « je ne sais pas ». La base ne rendrait cependant aucune
 * ligne dans ce cas — ce test documente le comportement pour le jour où
 * une fonction rendrait une ligne de total à part.
 */
test("un total de zéro rendu par la base reste zéro", () => {
  assert.equal(toPage([{ total_count: 0 }], 1, 50).total, 0);
});

test("une page vide au-delà de la première est un dépassement, pas une absence", () => {
  assert.equal(isBeyondLastPage(toPage([], 4, 50)), true);
  // Page 1 sans ligne : il n'y a vraiment aucun résultat.
  assert.equal(isBeyondLastPage(toPage([], 1, 50)), false);
  assert.equal(isBeyondLastPage(toPage([{ total_count: 2 }], 1, 50)), false);
});

/**
 * Le numéro de page vient de l'URL, donc de n'importe où : un lien
 * tronqué, un copier-coller, un robot. Rien de tout cela ne doit
 * produire une erreur — ni un `offset` de cinq mille milliards que
 * PostgreSQL accepterait de calculer en balayant la table.
 */
test("une page illisible vaut 1", () => {
  assert.equal(parsePage(undefined), 1);
  assert.equal(parsePage(""), 1);
  assert.equal(parsePage("abc"), 1);
  assert.equal(parsePage("0"), 1);
  assert.equal(parsePage("-4"), 1);
  assert.equal(parsePage("1.9"), 1);
});

test("une page démesurée est plafonnée", () => {
  assert.equal(parsePage("99999999999"), 100_000);
});

test("un paramètre répété prend la première valeur", () => {
  // `?page=2&page=9` arrive en tableau. Prendre la dernière valeur
  // laisserait un lien forgé écraser celle qu'on vient de cliquer.
  assert.equal(parsePage(["2", "9"]), 2);
});

test("une recherche vide ou blanche est absente, pas une chaîne vide", () => {
  // La distinction compte jusque dans le SQL : `p_search` à `null`
  // désactive la clause de recherche, une chaîne vide la ferait porter
  // sur « %% ».
  assert.equal(parseSearch(undefined), null);
  assert.equal(parseSearch(""), null);
  assert.equal(parseSearch("   "), null);
  assert.equal(parseSearch("  dupont "), "dupont");
});
