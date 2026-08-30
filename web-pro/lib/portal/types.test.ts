import { test } from "node:test";
import assert from "node:assert/strict";
import { clientQuoteTotals, projectProgress } from "./types.ts";

/**
 * Le portail refait un calcul que la base sait déjà faire.
 *
 * C'est délibéré — la vue `quote_totals` porte la marge dans les mêmes
 * lignes que le total — mais ça crée un risque précis : deux formules
 * pour un même montant, et un client qui lit sur son écran un chiffre
 * différent de celui du devis imprimé.
 *
 * Ces tests fixent la formule de la migration 0049 : TVA par tranche,
 * remise globale au prorata, arrondi à la Postgres.
 */

const line = (rate: number, sale: number) => ({ vat_rate: rate, sale_total_cents: sale });

test("la TVA se calcule par taux, jamais sur le total", () => {
  // 10 000 à 20 % et 10 000 à 5,5 %. Un taux moyen sur 20 000 donnerait
  // 2 550 — la ventilation juste donne 2 000 + 550.
  const totals = clientQuoteTotals([line(20, 10_000), line(5.5, 10_000)], 0);

  assert.equal(totals.totalExcludingVatCents, 20_000);
  assert.equal(totals.totalVatCents, 2_550);
  assert.equal(totals.totalIncludingVatCents, 22_550);

  assert.deepEqual(totals.byRate, [
    { rate: 20, baseCents: 10_000, vatCents: 2_000 },
    { rate: 5.5, baseCents: 10_000, vatCents: 550 },
  ]);
});

test("les lignes d'un même taux sont regroupées", () => {
  const grouped = clientQuoteTotals([line(20, 1_000), line(20, 2_000), line(10, 500)], 0);
  assert.equal(grouped.byRate.length, 2);
  assert.deepEqual(grouped.byRate[0], { rate: 20, baseCents: 3_000, vatCents: 600 });
});

test("la remise globale s'applique à chaque tranche, pas au total", () => {
  // 10 % de remise. Si on l'appliquait après la TVA, la ventilation
  // remontée à l'administration fiscale serait fausse.
  const totals = clientQuoteTotals([line(20, 10_000), line(10, 10_000)], 10);

  assert.deepEqual(totals.byRate, [
    { rate: 20, baseCents: 9_000, vatCents: 1_800 },
    { rate: 10, baseCents: 9_000, vatCents: 900 },
  ]);
  assert.equal(totals.totalIncludingVatCents, 20_700);
});

test("une remise qui tombe sur une demi-part s'arrondit comme en base", () => {
  // 333 centimes moins 5 % = 316,35 → 316. Puis 20 % de 316 = 63,2 → 63.
  const totals = clientQuoteTotals([line(20, 333)], 5);
  assert.deepEqual(totals.byRate, [{ rate: 20, baseCents: 316, vatCents: 63 }]);
});

test("un devis sans ligne vaut zéro, pas NaN", () => {
  const empty = clientQuoteTotals([], 0);
  assert.equal(empty.totalIncludingVatCents, 0);
  assert.deepEqual(empty.byRate, []);
});

test("un taux à 0 apparaît quand même dans la ventilation", () => {
  // Une prestation exonérée doit se lire sur le devis : l'omettre
  // laisserait croire à une erreur de total.
  const totals = clientQuoteTotals([line(0, 5_000), line(20, 1_000)], 0);
  assert.deepEqual(totals.byRate, [
    { rate: 20, baseCents: 1_000, vatCents: 200 },
    { rate: 0, baseCents: 5_000, vatCents: 0 },
  ]);
});

test("l'avancement est la moyenne des phases", () => {
  assert.equal(projectProgress([{ progress_percent: 100 }, { progress_percent: 0 }]), 50);
  assert.equal(projectProgress([{ progress_percent: 33 }, { progress_percent: 34 }]), 34);
  // Sans phase, pas d'avancement — et surtout pas une division par zéro
  // affichée « NaN % » au client.
  assert.equal(projectProgress([]), 0);
});
