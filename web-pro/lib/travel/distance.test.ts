import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arrondirKm,
  distanceRoutiereEstimeeKm,
  distanceVolDoiseauKm,
  dureeEstimeeMinutes,
  vitesseMoyenneKmH,
} from "./distance.ts";
import { FACTEUR_SINUOSITE } from "./types.ts";

/**
 * La géométrie du trajet. Ces tests protègent surtout deux choses : que
 * la distance rendue soit bien une distance ROUTIÈRE ESTIMÉE et non un
 * vol d'oiseau déguisé, et qu'un trajet nul reste nul sans devenir une
 * division par une vitesse imaginaire.
 */

// Les deux communes de l'exemple de la spec, telles que la Base
// Adresse Nationale les situe (centres de commune).
const CAGNES_SUR_MER = { latitude: 43.675413, longitude: 7.150354 };
const CANNES = { latitude: 43.555468, longitude: 7.004585 };

test("Cagnes-sur-Mer → Cannes : un vol d'oiseau d'environ 17,8 km", () => {
  const km = distanceVolDoiseauKm(CAGNES_SUR_MER, CANNES);
  // Tolérance de 200 m : on teste la formule, pas la sixième décimale
  // d'un centre de commune.
  assert.ok(Math.abs(km - 17.77) < 0.2, `obtenu ${km} km`);
});

test("la distance routière est le vol d'oiseau allongé du facteur de détour", () => {
  const volDoiseau = distanceVolDoiseauKm(CAGNES_SUR_MER, CANNES);
  const routiere = distanceRoutiereEstimeeKm(CAGNES_SUR_MER, CANNES);
  assert.equal(routiere, arrondirKm(volDoiseau * FACTEUR_SINUOSITE));
  assert.ok(routiere > volDoiseau, "une route est plus longue qu'une ligne droite");
  // Et pas « un peu plus longue » : le détour vaut au moins un quart de
  // la distance. Sans cette borne, ramener le facteur à 1 passerait
  // inaperçu — et une distance à vol d'oiseau présentée comme routière
  // sous-estime tous les coûts de déplacement de l'entreprise.
  assert.ok(routiere >= volDoiseau * 1.25, `${routiere} km n'est pas un détour crédible`);
  assert.ok(FACTEUR_SINUOSITE >= 1.25 && FACTEUR_SINUOSITE <= 1.35);
});

test("la distance est symétrique", () => {
  assert.equal(
    distanceRoutiereEstimeeKm(CAGNES_SUR_MER, CANNES),
    distanceRoutiereEstimeeKm(CANNES, CAGNES_SUR_MER),
  );
});

test("un chantier au pied du dépôt ne coûte aucun trajet", () => {
  assert.equal(distanceVolDoiseauKm(CANNES, CANNES), 0);
  assert.equal(distanceRoutiereEstimeeKm(CANNES, CANNES), 0);
  assert.equal(dureeEstimeeMinutes(0), 0);
});

test("les vitesses moyennes montent par paliers, sans jamais valoir zéro", () => {
  assert.equal(vitesseMoyenneKmH(3), 25);
  assert.equal(vitesseMoyenneKmH(5), 25);
  assert.equal(vitesseMoyenneKmH(5.1), 40);
  assert.equal(vitesseMoyenneKmH(20), 40);
  assert.equal(vitesseMoyenneKmH(50), 55);
  assert.equal(vitesseMoyenneKmH(400), 70);
  assert.ok(vitesseMoyenneKmH(10_000) > 0, "une vitesse nulle produirait une durée infinie");
});

test("la durée estimée suit la vitesse du palier", () => {
  // 20 km à 40 km/h = une demi-heure.
  assert.equal(dureeEstimeeMinutes(20), 30);
  // 55 km à 70 km/h ≈ 47 min.
  assert.equal(dureeEstimeeMinutes(55), Math.round((55 / 70) * 60));
});

test("l'arrondi kilométrique s'arrête au dixième", () => {
  assert.equal(arrondirKm(17.765432), 17.8);
  assert.equal(arrondirKm(0.04), 0);
});
