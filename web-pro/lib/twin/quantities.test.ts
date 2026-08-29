import { test } from "node:test";
import assert from "node:assert/strict";
import { computeQuantities } from "./quantities.ts";
import type { TwinArea, TwinObject, TwinPipe, TwinCable } from "./types.ts";

/**
 * Le métré part dans un devis. Une erreur ici se transforme en argent,
 * et personne ne la verra à l'écran : 41 m de tuyau au lieu de 14 m
 * ressemble tout autant à un chiffre plausible.
 *
 * `node --test` sur ce fichier — voir package.json.
 */

const p = (x: number, y: number) => ({ xMeters: x, yMeters: y });

function object(over: Partial<TwinObject> = {}): TwinObject {
  return {
    id: crypto.randomUUID(),
    objectType: "tree",
    position: p(0, 0),
    rotationRadians: 0,
    widthMeters: 4,
    heightMeters: 4,
    zIndex: 0,
    label: null,
    canopyDiameterMeters: 4,
    linkedEntityId: null,
    linkedEntityKind: null,
    sprinklerRadiusMeters: null,
    sprinklerStartAngleDegrees: null,
    sprinklerEndAngleDegrees: null,
    sprinklerFlowRateLitersPerHour: null,
    ...over,
  };
}

const empty = { boundaryPoints: [], areas: [], objects: [], pipes: [], cables: [] };

test("un plan vide ne fabrique aucune ligne", () => {
  const r = computeQuantities(empty);
  assert.equal(r.isEmpty, true);
  assert.deepEqual(r.surfaces, []);
  assert.deepEqual(r.lengths, []);
  assert.deepEqual(r.counts, []);
});

test("une zone donne sa surface ET son linéaire de bordure", () => {
  const areas: TwinArea[] = [
    { id: "a", areaType: "flowerBed", name: "Massif", points: [p(0, 0), p(10, 0), p(10, 4), p(0, 4)] },
  ];
  const r = computeQuantities({ ...empty, areas });

  const surface = r.surfaces.find((l) => l.key === "area-flowerBed");
  assert.ok(surface);
  assert.equal(surface.value, 40);
  assert.equal(surface.unit, "m2");

  const edge = r.lengths.find((l) => l.key === "edge-flowerBed");
  assert.ok(edge);
  assert.equal(edge.value, 28); // 2 x (10 + 4), fermé
});

test("deux zones de même type sont cumulées, et leur nombre indiqué", () => {
  const square = (dx: number) => [p(dx, 0), p(dx + 2, 0), p(dx + 2, 2), p(dx, 2)];
  const areas: TwinArea[] = [
    { id: "a", areaType: "lawn", name: "", points: square(0) },
    { id: "b", areaType: "lawn", name: "", points: square(10) },
  ];
  const r = computeQuantities({ ...empty, areas });
  const line = r.surfaces.find((l) => l.key === "area-lawn");
  assert.ok(line);
  assert.equal(line.value, 8);
  assert.match(line.label, /\(2\)/);
});

test("le terrain est compté à part et n'est jamais fondu dans les zones", () => {
  const r = computeQuantities({
    ...empty,
    boundaryPoints: [p(0, 0), p(20, 0), p(20, 10), p(0, 10)],
    areas: [{ id: "a", areaType: "lawn", name: "", points: [p(0, 0), p(2, 0), p(2, 2), p(0, 2)] }],
  });
  const terrain = r.surfaces.find((l) => l.key === "boundary-area");
  const pelouse = r.surfaces.find((l) => l.key === "area-lawn");
  assert.equal(terrain?.value, 200);
  assert.equal(pelouse?.value, 4);
  // Le total des surfaces n'a de sens que si les deux restent séparées.
  assert.equal(r.surfaces.length, 2);
});

test("la longueur d'un tuyau suit ses points, coudes compris", () => {
  const pipes: TwinPipe[] = [
    {
      id: "p1", points: [p(0, 0), p(3, 0), p(3, 4)],
      diameterMM: 25, material: "pe", lineType: "mainSupply",
      startNodeObjectId: null, endNodeObjectId: null,
    },
  ];
  const r = computeQuantities({ ...empty, pipes });
  const line = r.lengths.find((l) => l.key.startsWith("pipe-"));
  assert.ok(line);
  assert.equal(line.value, 7); // 3 + 4, et surtout PAS les 5 de la diagonale
  assert.match(line.label, /Ø 25 mm/);
});

test("un tuyau ne se referme pas sur lui-même", () => {
  // Le piège : perimeter() ferme par défaut. Un tuyau en L de 3 + 4
  // mesure 7 m, pas 12 m — il n'y a pas de retour au point de départ.
  const pipes: TwinPipe[] = [
    {
      id: "p1", points: [p(0, 0), p(3, 0), p(3, 4)],
      diameterMM: 16, material: "pe", lineType: "dripLine",
      startNodeObjectId: null, endNodeObjectId: null,
    },
  ];
  const r = computeQuantities({ ...empty, pipes });
  assert.equal(r.lengths[0].value, 7);
});

test("les tuyaux sont séparés par type ET par diamètre", () => {
  const base = { material: "pe" as const, startNodeObjectId: null, endNodeObjectId: null };
  const pipes: TwinPipe[] = [
    { id: "1", points: [p(0, 0), p(10, 0)], diameterMM: 32, lineType: "mainSupply", ...base },
    { id: "2", points: [p(0, 1), p(5, 1)], diameterMM: 25, lineType: "mainSupply", ...base },
    { id: "3", points: [p(0, 2), p(4, 2)], diameterMM: 25, lineType: "mainSupply", ...base },
  ];
  const r = computeQuantities({ ...empty, pipes });
  const lines = r.lengths.filter((l) => l.key.startsWith("pipe-"));
  assert.equal(lines.length, 2); // on n'achète pas du 25 et du 32 au même prix
  assert.equal(lines.find((l) => l.label.includes("32"))?.value, 10);
  assert.equal(lines.find((l) => l.label.includes("25"))?.value, 9);
});

test("un tuyau à un seul point est ignoré, pas compté zéro", () => {
  const pipes: TwinPipe[] = [
    {
      id: "p1", points: [p(0, 0)], diameterMM: 25, material: "pe", lineType: "secondary",
      startNodeObjectId: null, endNodeObjectId: null,
    },
  ];
  const r = computeQuantities({ ...empty, pipes });
  assert.equal(r.lengths.length, 0);
});

test("les végétaux sont comptés par nom, pas par type", () => {
  // C'est l'exemple de la spec : Olivier 3, Lavande 12 — et surtout pas
  // « Arbre 15 », qui ne veut rien dire dans un devis.
  const objects: TwinObject[] = [
    ...Array.from({ length: 3 }, () => object({ label: "Olivier" })),
    ...Array.from({ length: 12 }, () => object({ objectType: "shrub", label: "Lavande" })),
  ];
  const r = computeQuantities({ ...empty, objects });
  assert.equal(r.counts.find((l) => l.label === "Lavande")?.value, 12);
  assert.equal(r.counts.find((l) => l.label === "Olivier")?.value, 3);
  assert.equal(r.counts.length, 2);
});

test("un végétal sans étiquette retombe sur son type", () => {
  const r = computeQuantities({ ...empty, objects: [object({ label: null })] });
  assert.equal(r.counts[0].label, "Arbre");
});

test("les équipements sont comptés par type même s'ils portent une étiquette", () => {
  // Une vanne nommée « Vanne nord » reste une vanne à commander.
  const objects: TwinObject[] = [
    object({ objectType: "valve", label: "Vanne nord", canopyDiameterMeters: null }),
    object({ objectType: "valve", label: "Vanne sud", canopyDiameterMeters: null }),
  ];
  const r = computeQuantities({ ...empty, objects });
  assert.equal(r.counts.length, 1);
  assert.equal(r.counts[0].label, "Vanne");
  assert.equal(r.counts[0].value, 2);
});

test("les câbles sont mesurés et regroupés par type et section", () => {
  const cables: TwinCable[] = [
    {
      id: "c1", points: [p(0, 0), p(6, 0)], cableType: "lowVoltage", sectionMM2: 2.5,
      startNodeObjectId: null, endNodeObjectId: null,
    },
    {
      id: "c2", points: [p(0, 1), p(4, 1)], cableType: "lowVoltage", sectionMM2: 2.5,
      startNodeObjectId: null, endNodeObjectId: null,
    },
  ];
  const r = computeQuantities({ ...empty, cables });
  assert.equal(r.lengths.length, 1);
  assert.equal(r.lengths[0].value, 10);
  assert.match(r.lengths[0].label, /2\.5 mm²/);
});

test("les lignes sont triées de la plus grande à la plus petite", () => {
  const objects: TwinObject[] = [
    object({ label: "Rare" }),
    ...Array.from({ length: 9 }, () => object({ label: "Courant" })),
  ];
  const r = computeQuantities({ ...empty, objects });
  assert.equal(r.counts[0].label, "Courant");
});

test("l'exemple de la spec, bout à bout", () => {
  const r = computeQuantities({
    boundaryPoints: [],
    // 36.4 m² : un rectangle de 9.1 x 4
    areas: [{ id: "a", areaType: "flowerBed", name: "Massif", points: [p(0, 0), p(9.1, 0), p(9.1, 4), p(0, 4)] }],
    // 41.2 m de tuyau
    pipes: [{
      id: "p", points: [p(0, 0), p(41.2, 0)], diameterMM: 25, material: "pe",
      lineType: "dripLine", startNodeObjectId: null, endNodeObjectId: null,
    }],
    cables: [],
    objects: [
      ...Array.from({ length: 3 }, () => object({ label: "Olivier" })),
      ...Array.from({ length: 12 }, () => object({ objectType: "shrub", label: "Lavande" })),
    ],
  });

  assert.equal(r.surfaces.find((l) => l.key === "area-flowerBed")?.formatted, "36,4 m²");
  // La bordure du massif : 2 x (9.1 + 4) = 26.2 m
  assert.equal(r.lengths.find((l) => l.key === "edge-flowerBed")?.value.toFixed(1), "26.2");
  assert.equal(r.lengths.find((l) => l.key.startsWith("pipe-"))?.formatted, "41,2 m");
  assert.equal(r.counts.find((l) => l.label === "Olivier")?.formatted, "3");
  assert.equal(r.counts.find((l) => l.label === "Lavande")?.formatted, "12");
});
