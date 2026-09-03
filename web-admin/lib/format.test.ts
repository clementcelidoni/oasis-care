import test from "node:test";
import assert from "node:assert/strict";

import { formatCents, formatCount, formatPercent, shortId } from "./format.ts";

/**
 * Un seul sujet ici : L'INCONNU NE DEVIENT JAMAIS ZÉRO.
 *
 * C'est la règle centrale de cette application (spec p.4, « aucune
 * valeur fictive en production »), et c'est aussi la plus facile à
 * casser sans s'en rendre compte : il suffit d'un `?? 0` ajouté pour
 * faire taire une erreur de type. Ces tests transforment cette
 * régression-là en échec de suite, au lieu d'un chiffre faux affiché en
 * grand sur le tableau de bord.
 */

test("un chiffre absent reste absent", () => {
  assert.equal(formatCount(null), null);
  assert.equal(formatCount(undefined), null);
  assert.equal(formatCents(null), null);
  assert.equal(formatPercent(null), null);
});

/**
 * Les séparateurs de `Intl` en français sont des espaces INSÉCABLES
 * (U+00A0, parfois U+202F selon la version d'ICU). Comparer à une
 * espace ordinaire donnerait un échec incompréhensible — « 49 € »
 * différent de « 49 € ». On compare donc avec `\s`, qui les couvre
 * toutes : ce qui est testé ici est la valeur, pas le codet exact que
 * la bibliothèque du système a choisi pour l'espace.
 */
function assertFormatted(actual: string | null, pattern: RegExp) {
  assert.ok(actual !== null, "valeur inattendue : inconnu");
  assert.match(actual, pattern);
}

test("zéro est un chiffre, et il s'affiche", () => {
  // L'inverse du piège : un vrai zéro mesuré ne doit pas se faire
  // passer pour un inconnu. « 0 inscription aujourd'hui » est une
  // information ; la confondre avec « on ne sait pas » ferait chercher
  // une panne là où il n'y a qu'une journée calme.
  assert.equal(formatCount(0), "0");
  assertFormatted(formatCents(0), /^0\s?€$/u);
  assertFormatted(formatPercent(0), /^0,0\s?%$/u);
});

test("NaN et l'infini sont des inconnus, pas des nombres", () => {
  // Une division ratée en amont ne doit pas s'afficher « NaN » à côté
  // de chiffres vrais : elle doit rejoindre les inconnus.
  assert.equal(formatCount(Number.NaN), null);
  assert.equal(formatCents(Number.POSITIVE_INFINITY), null);
  assert.equal(formatPercent(Number.NaN), null);
});

test("l'argent arrive en centimes entiers et sort en euros", () => {
  // 4 900 centimes = 49 €. La division par 100 se fait ici, une seule
  // fois, à la dernière seconde.
  assertFormatted(formatCents(4900), /^49\s?€$/u);
  assertFormatted(formatCents(4900, { decimals: true }), /^49,00\s?€$/u);
  // Un montant non rond ne se perd pas en route.
  assertFormatted(formatCents(4999, { decimals: true }), /^49,99\s?€$/u);
});

test("les grands nombres sont groupés", () => {
  assertFormatted(formatCount(18429), /^18\s?429$/u);
});

test("un identifiant absent ne devient pas une chaîne vide", () => {
  assert.equal(shortId(null), null);
  assert.equal(shortId(""), null);
  assert.equal(shortId("988fd6af-0000-0000-0000-000000000000"), "988fd6af…");
  // Court : rendu tel quel, sans ellipse mensongère.
  assert.equal(shortId("abcd"), "abcd");
});
