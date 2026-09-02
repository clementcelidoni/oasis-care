import { test } from "node:test";
import assert from "node:assert/strict";
import { computeQuantities } from "../twin/quantities.ts";
import { proposeQuoteLines, usedSections } from "./fromTwin.ts";
import type { TwinArea, TwinObject, TwinPipe } from "../twin/types.ts";

/**
 * §"NE PAS ajouter silencieusement des coûts."
 *
 * Ces tests portent surtout sur ce que la proposition NE fait PAS :
 * facturer le terrain, inventer une quantité, cacher une hypothèse.
 */

const p = (x: number, y: number) => ({ xMeters: x, yMeters: y });

function object(over: Partial<TwinObject> = {}): TwinObject {
  return {
    id: crypto.randomUUID(), objectType: "tree", position: p(0, 0),
    rotationRadians: 0, widthMeters: 4, heightMeters: 4, zIndex: 0,
    label: null, canopyDiameterMeters: 4,
    linkedEntityId: null, linkedEntityKind: null,
    sprinklerRadiusMeters: null, sprinklerStartAngleDegrees: null,
    sprinklerEndAngleDegrees: null, sprinklerFlowRateLitersPerHour: null,
    ...over,
  };
}

const empty = { boundaryPoints: [], areas: [], objects: [], pipes: [], cables: [] };

/** Le massif de la spec : 36,4 m², bordure 26,2 m. */
const massif: TwinArea = {
  id: "a", areaType: "flowerBed", name: "Massif Méditerranéen",
  points: [p(0, 0), p(9.1, 0), p(9.1, 4), p(0, 4)],
};

test("un plan vide ne propose rien", () => {
  assert.deepEqual(proposeQuoteLines(computeQuantities(empty)), []);
});

test("un massif engendre préparation, géotextile et paillage", () => {
  const lines = proposeQuoteLines(computeQuantities({ ...empty, areas: [massif] }));
  const prep = lines.find((l) => l.key.startsWith("prep-"));
  const geo = lines.find((l) => l.key.startsWith("geo-"));

  assert.equal(prep?.quantity, 36.4);
  assert.equal(prep?.unit, "m²");
  assert.equal(geo?.quantity, 36.4);
  assert.equal(prep?.section, "Préparation");
});

test("le volume de paillage affiche l'épaisseur qu'il suppose", () => {
  const lines = proposeQuoteLines(computeQuantities({ ...empty, areas: [massif] }));
  const mulch = lines.find((l) => l.key.startsWith("mulch-"));

  assert.ok(mulch);
  assert.equal(mulch.unit, "m³");
  assert.equal(mulch.quantity, 1.82); // 36,4 × 0,05
  // L'hypothèse doit être lisible : sans elle, personne ne peut savoir
  // pourquoi 36 m² donnent 1,82 m³.
  assert.match(mulch.description, /5 cm/);
  assert.match(mulch.origin, /corrigez la quantité/);
});

test("la bordure vient du périmètre de la zone", () => {
  const lines = proposeQuoteLines(computeQuantities({ ...empty, areas: [massif] }));
  const edge = lines.find((l) => l.key.startsWith("edge-"));
  assert.equal(edge?.quantity, 26.2); // 2 × (9,1 + 4)
  assert.equal(edge?.unit, "m");
});

test("le TERRAIN n'est jamais proposé au chiffrage", () => {
  // Facturer la parcelle entière comme une surface à préparer serait
  // l'erreur la plus coûteuse que cet écran puisse commettre.
  const lines = proposeQuoteLines(computeQuantities({
    ...empty,
    boundaryPoints: [p(0, 0), p(50, 0), p(50, 30), p(0, 30)],
    areas: [massif],
  }));
  assert.equal(lines.some((l) => l.key.includes("boundary")), false);
  assert.equal(lines.some((l) => l.quantity === 1500), false);
  // La bordure du terrain non plus : personne ne borde toute sa parcelle.
  assert.equal(lines.some((l) => l.description.includes("terrain")), false);
});

test("un tuyau devient une ligne d'irrigation, au mètre", () => {
  const pipes: TwinPipe[] = [{
    id: "p", points: [p(0, 0), p(41.2, 0)], diameterMM: 25, material: "pe",
    lineType: "dripLine", startNodeObjectId: null, endNodeObjectId: null,
  }];
  const lines = proposeQuoteLines(computeQuantities({ ...empty, pipes }));
  const irrigation = lines.find((l) => l.section === "Irrigation");
  assert.equal(irrigation?.quantity, 41.2);
  assert.equal(irrigation?.unit, "m");
});

test("les végétaux sont proposés par nom et en unités", () => {
  const objects = [
    ...Array.from({ length: 3 }, () => object({ label: "Olivier" })),
    ...Array.from({ length: 12 }, () => object({ objectType: "shrub", label: "Lavande" })),
  ];
  const lines = proposeQuoteLines(computeQuantities({ ...empty, objects }));
  const olivier = lines.find((l) => l.description.includes("Olivier"));
  assert.equal(olivier?.quantity, 3);
  assert.equal(olivier?.unit, "u");
  assert.equal(olivier?.section, "Plantation");
  assert.equal(olivier?.itemType, "plant");
});

test("un arroseur va en Irrigation, un nichoir n'y va pas", () => {
  const objects = [
    object({ objectType: "sprinkler", canopyDiameterMeters: null }),
    object({ objectType: "birdhouse", canopyDiameterMeters: null }),
  ];
  const lines = proposeQuoteLines(computeQuantities({ ...empty, objects }));
  assert.equal(lines.find((l) => l.description.includes("Arroseur"))?.section, "Irrigation");
  assert.equal(lines.find((l) => l.description.includes("Nichoir"))?.section, "Finitions");
});

test("aucune ligne proposée ne porte de prix", () => {
  // Le prix vient du catalogue au moment de l'insertion, jamais d'ici.
  const lines = proposeQuoteLines(computeQuantities({ ...empty, areas: [massif] }));
  for (const line of lines) {
    assert.equal("price" in line, false);
    assert.equal("unitSalePriceCents" in line, false);
  }
});

test("chaque ligne dit d'où vient sa quantité", () => {
  const lines = proposeQuoteLines(computeQuantities({
    ...empty, areas: [massif], objects: [object({ label: "Olivier" })],
  }));
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.ok(line.origin.length > 0, `ligne sans origine : ${line.description}`);
  }
});

test("les sections sortent dans l'ordre du chantier", () => {
  const lines = proposeQuoteLines(computeQuantities({
    ...empty,
    areas: [massif],
    objects: [object({ label: "Olivier" })],
    pipes: [{
      id: "p", points: [p(0, 0), p(10, 0)], diameterMM: 25, material: "pe",
      lineType: "dripLine", startNodeObjectId: null, endNodeObjectId: null,
    }],
  }));
  // On prépare avant de planter, on plante avant d'arroser, on paille en
  // dernier. Un devis dans le désordre se relit mal.
  assert.deepEqual(usedSections(lines), ["Préparation", "Plantation", "Irrigation", "Finitions"]);
});

test("l'exemple complet de la spec", () => {
  const lines = proposeQuoteLines(computeQuantities({
    ...empty,
    areas: [massif],
    pipes: [{
      id: "p", points: [p(0, 0), p(41.2, 0)], diameterMM: 16, material: "pe",
      lineType: "dripLine", startNodeObjectId: null, endNodeObjectId: null,
    }],
    objects: [
      ...Array.from({ length: 3 }, () => object({ label: "Olivier" })),
      ...Array.from({ length: 12 }, () => object({ objectType: "shrub", label: "Lavande" })),
    ],
  }));

  const byPrefix = (prefix: string) => lines.find((l) => l.key.startsWith(prefix));
  assert.equal(byPrefix("prep-")?.quantity, 36.4);
  assert.equal(byPrefix("geo-")?.quantity, 36.4);
  assert.equal(byPrefix("edge-")?.quantity, 26.2);
  assert.equal(byPrefix("pipe-")?.quantity, 41.2);
  assert.equal(lines.find((l) => l.description.includes("Olivier"))?.quantity, 3);
  assert.equal(lines.find((l) => l.description.includes("Lavande"))?.quantity, 12);
});
