import { test } from "node:test";
import assert from "node:assert/strict";
import { periodRange, formatPercentOrDash, thresholdTone, isPeriod } from "./types.ts";

/**
 * Les bornes de période et le tiret.
 *
 * Deux choses seulement, mais ce sont les deux qui font mentir un
 * tableau de bord : une période décalée d'un jour, et un « 0 % » là où
 * il n'y a pas de réponse.
 */

test("le mois commence le premier, en heure locale", () => {
  // Un 1er janvier converti en UTC depuis Paris repart au 31 décembre :
  // le premier jour du mois sortirait du mois. C'est le même piège que
  // les deux heures de décalage trouvées sur les interventions.
  const range = periodRange("month", new Date(2026, 0, 1, 0, 30));
  assert.equal(range.from, "2026-01-01");
  assert.equal(range.to, "2026-01-01");
});

test("le trimestre commence au premier mois du trimestre", () => {
  assert.equal(periodRange("quarter", new Date(2026, 4, 17)).from, "2026-04-01");
  assert.equal(periodRange("quarter", new Date(2026, 11, 31)).from, "2026-10-01");
  assert.equal(periodRange("quarter", new Date(2026, 0, 5)).from, "2026-01-01");
});

test("l'année et les douze mois glissants ne sont pas la même période", () => {
  const today = new Date(2026, 2, 15);
  assert.equal(periodRange("year", today).from, "2026-01-01");
  assert.equal(periodRange("twelveMonths", today).from, "2025-03-15");
});

test("un pourcentage inconnu s'affiche en tiret, jamais en zéro", () => {
  assert.equal(formatPercentOrDash(null), "—");
  assert.equal(formatPercentOrDash(undefined), "—");
  // Zéro reste zéro : c'est une réponse, et une réponse différente.
  assert.equal(formatPercentOrDash(0), "0 %");
  assert.equal(formatPercentOrDash(83.3), "83,3 %");
});

test("les seuils colorent dans le bon sens", () => {
  // Une marge : plus c'est haut, mieux c'est.
  assert.equal(thresholdTone(45, { good: 30, warn: 20 }), "positive");
  assert.equal(thresholdTone(25, { good: 30, warn: 20 }), "warning");
  assert.equal(thresholdTone(5, { good: 30, warn: 20 }), "critical");

  // Un taux de perte : l'inverse.
  assert.equal(thresholdTone(3, { good: 5, warn: 10, inverted: true }), "positive");
  assert.equal(thresholdTone(8, { good: 5, warn: 10, inverted: true }), "warning");
  assert.equal(thresholdTone(20, { good: 5, warn: 10, inverted: true }), "critical");

  // Inconnu ne se colore pas : un tiret rouge accuserait sans savoir.
  assert.equal(thresholdTone(null, { good: 30, warn: 20 }), "neutral");
});

test("une période inventée dans l'URL est rejetée", () => {
  assert.equal(isPeriod("month"), true);
  assert.equal(isPeriod("decennie"), false);
  assert.equal(isPeriod(undefined), false);
});
