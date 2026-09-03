import { test } from "node:test";
import assert from "node:assert/strict";
import { lireReponseBan } from "./geocodage.ts";
import { distanceVolDoiseauKm } from "./distance.ts";

/**
 * La lecture de la réponse du géocodeur.
 *
 * Aucun de ces tests ne touche le réseau : ils portent sur ce qu'on
 * fait d'un corps déjà reçu. C'est là que sont les vraies erreurs.
 *
 * LA PREMIÈRE D'ENTRE ELLES, ET ELLE EST SILENCIEUSE : GeoJSON range la
 * LONGITUDE avant la latitude, à l'inverse de la façon dont tout le
 * monde énonce une position. Inverser les deux place Cannes au large de
 * la Somalie — et rend une distance de 4 700 km parfaitement plausible
 * pour qui ne regarde que le nombre affiché.
 */

// La réponse réelle de la BAN pour « Cannes », réduite à ce qu'on lit.
const REPONSE_CANNES = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [7.004585, 43.555468] },
      properties: { label: "Cannes", postcode: "06150", type: "municipality" },
    },
  ],
};

test("la longitude vient en premier dans le GeoJSON, et on ne l'inverse pas", () => {
  const situee = lireReponseBan(REPONSE_CANNES);
  assert.ok(situee);
  assert.equal(situee.coordonnees.latitude, 43.555468);
  assert.equal(situee.coordonnees.longitude, 7.004585);
  assert.equal(situee.commune, "Cannes");
  assert.equal(situee.codePostal, "06150");

  // Le garde-fou qui rendrait l'inversion visible : Cannes est à moins
  // de cent kilomètres de Nice, pas à quatre mille.
  const nice = { latitude: 43.7031, longitude: 7.2661 };
  assert.ok(distanceVolDoiseauKm(situee.coordonnees, nice) < 100);
});

test("une réponse vide ne produit pas un point à zéro degré", () => {
  assert.equal(lireReponseBan({ type: "FeatureCollection", features: [] }), null);
  assert.equal(lireReponseBan({}), null);
  assert.equal(lireReponseBan(null), null);
  assert.equal(lireReponseBan("erreur 500"), null);
});

test("des coordonnées qui ne sont pas des nombres sont refusées", () => {
  const abime = {
    features: [{ geometry: { coordinates: ["7.0", "43.5"] }, properties: {} }],
  };
  assert.equal(lireReponseBan(abime), null);
});

test("des coordonnées hors du globe sont refusées", () => {
  const abime = {
    features: [{ geometry: { coordinates: [7.0, 943.5] }, properties: {} }],
  };
  assert.equal(lireReponseBan(abime), null);
});

test("un point sans libellé reste utilisable : c'est la position qui compte", () => {
  const sansLibelle = {
    features: [{ geometry: { coordinates: [7.0, 43.5] }, properties: {} }],
  };
  const situee = lireReponseBan(sansLibelle);
  assert.ok(situee);
  assert.equal(situee.commune, "");
  assert.equal(situee.codePostal, null);
});
