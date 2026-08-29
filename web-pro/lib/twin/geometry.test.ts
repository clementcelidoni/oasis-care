import test from "node:test";
import assert from "node:assert/strict";
import {
  worldToScreen,
  screenToWorld,
  distance,
  perimeter,
  polygonArea,
  angleAt,
  snapToGrid,
  snapPoint,
  snapAngle,
  pointInPolygon,
  pointInRotatedRect,
  rotatedRectCorners,
  DEFAULT_SNAP,
  type Camera,
  type Viewport,
} from "./geometry.ts";

const camera: Camera = { centerX: 0, centerY: 0, pixelsPerMeter: 10 };
const view: Viewport = { width: 800, height: 600 };

test("le nord est en haut de l'écran", () => {
  // y monde positif = nord ⇒ doit être AU-DESSUS du centre écran.
  const nord = worldToScreen({ xMeters: 0, yMeters: 10 }, camera, view);
  assert.equal(nord.x, 400);
  assert.ok(nord.y < 300, `attendu au-dessus du centre, obtenu y=${nord.y}`);
  assert.equal(nord.y, 200);
});

test("l'est est à droite de l'écran", () => {
  const est = worldToScreen({ xMeters: 10, yMeters: 0 }, camera, view);
  assert.equal(est.x, 500);
  assert.equal(est.y, 300);
});

test("screenToWorld est l'inverse exact de worldToScreen", () => {
  for (const p of [
    { xMeters: 0, yMeters: 0 },
    { xMeters: 12.34, yMeters: -56.78 },
    { xMeters: -3, yMeters: 9 },
  ]) {
    const round = screenToWorld(worldToScreen(p, camera, view), camera, view);
    assert.ok(Math.abs(round.xMeters - p.xMeters) < 1e-9);
    assert.ok(Math.abs(round.yMeters - p.yMeters) < 1e-9);
  }
});

test("distance et périmètre", () => {
  assert.equal(distance({ xMeters: 0, yMeters: 0 }, { xMeters: 3, yMeters: 4 }), 5);

  const carre = [
    { xMeters: 0, yMeters: 0 },
    { xMeters: 4, yMeters: 0 },
    { xMeters: 4, yMeters: 4 },
    { xMeters: 0, yMeters: 4 },
  ];
  assert.equal(perimeter(carre), 16);
  // Ouvert : le segment de fermeture ne compte pas.
  assert.equal(perimeter(carre, false), 12);
});

test("surface d'un carré de 4 m", () => {
  const carre = [
    { xMeters: 0, yMeters: 0 },
    { xMeters: 4, yMeters: 0 },
    { xMeters: 4, yMeters: 4 },
    { xMeters: 0, yMeters: 4 },
  ];
  assert.equal(polygonArea(carre), 16);
});

test("la surface ne dépend pas du sens de saisie", () => {
  const horaire = [
    { xMeters: 0, yMeters: 0 },
    { xMeters: 0, yMeters: 4 },
    { xMeters: 4, yMeters: 4 },
    { xMeters: 4, yMeters: 0 },
  ];
  // Sans valeur absolue, ce cas renverrait -16 : un massif à surface
  // négative se retrouverait dans un devis.
  assert.equal(polygonArea(horaire), 16);
});

test("surface d'un triangle", () => {
  assert.equal(
    polygonArea([
      { xMeters: 0, yMeters: 0 },
      { xMeters: 6, yMeters: 0 },
      { xMeters: 0, yMeters: 4 },
    ]),
    12,
  );
});

test("un polygone dégénéré a une surface nulle", () => {
  assert.equal(polygonArea([]), 0);
  assert.equal(polygonArea([{ xMeters: 1, yMeters: 1 }]), 0);
  assert.equal(polygonArea([{ xMeters: 0, yMeters: 0 }, { xMeters: 1, yMeters: 1 }]), 0);
});

test("angle droit mesuré à 90°", () => {
  const a = { xMeters: 0, yMeters: 1 };
  const b = { xMeters: 0, yMeters: 0 };
  const c = { xMeters: 1, yMeters: 0 };
  assert.ok(Math.abs(angleAt(a, b, c) - 90) < 1e-9);
});

test("accrochage à la grille", () => {
  assert.deepEqual(snapToGrid({ xMeters: 1.2, yMeters: 3.4 }, 0.5), {
    xMeters: 1,
    yMeters: 3.5,
  });
  // Une grille nulle ne doit pas produire NaN.
  const p = { xMeters: 1.23, yMeters: 4.56 };
  assert.deepEqual(snapToGrid(p, 0), p);
});

test("un sommet proche l'emporte sur la grille", () => {
  const sommet = { xMeters: 2.03, yMeters: 2.03 };
  const resultat = snapPoint({ xMeters: 2.1, yMeters: 2.1 }, [sommet], DEFAULT_SNAP);
  // Fermer un polygone exactement compte plus qu'être aligné : la
  // grille aurait renvoyé 2.0 et laissé un trou de 3 cm.
  assert.deepEqual(resultat, sommet);
});

test("un sommet lointain n'attire pas", () => {
  const resultat = snapPoint(
    { xMeters: 2.1, yMeters: 2.1 },
    [{ xMeters: 50, yMeters: 50 }],
    DEFAULT_SNAP,
  );
  assert.deepEqual(resultat, { xMeters: 2, yMeters: 2 });
});

test("snapping désactivé laisse le point intact", () => {
  const p = { xMeters: 1.234, yMeters: 5.678 };
  assert.deepEqual(snapPoint(p, [], { ...DEFAULT_SNAP, enabled: false }), p);
});

test("contrainte d'angle à 45°", () => {
  const from = { xMeters: 0, yMeters: 0 };
  // 10° au-dessus de l'horizontale doit retomber sur 0°.
  const to = { xMeters: 10, yMeters: 1.76 };
  const snapped = snapAngle(from, to, 45);
  assert.ok(Math.abs(snapped.yMeters) < 1e-9, `y=${snapped.yMeters}`);
  // La longueur est préservée : on contraint la direction, pas la taille.
  assert.ok(Math.abs(distance(from, snapped) - distance(from, to)) < 1e-9);
});

test("point dans polygone", () => {
  const carre = [
    { xMeters: 0, yMeters: 0 },
    { xMeters: 4, yMeters: 0 },
    { xMeters: 4, yMeters: 4 },
    { xMeters: 0, yMeters: 4 },
  ];
  assert.equal(pointInPolygon({ xMeters: 2, yMeters: 2 }, carre), true);
  assert.equal(pointInPolygon({ xMeters: 5, yMeters: 2 }, carre), false);
  assert.equal(pointInPolygon({ xMeters: -1, yMeters: -1 }, carre), false);
});

test("sélection d'un objet tourné", () => {
  const centre = { xMeters: 0, yMeters: 0 };
  const quart = Math.PI / 2;
  // Objet 4 m × 1 m tourné d'un quart de tour : il devient haut et
  // étroit. Un point à 1,5 m au nord est donc DEDANS, et le même à
  // l'est est DEHORS — l'inverse de l'objet non tourné.
  assert.equal(pointInRotatedRect({ xMeters: 0, yMeters: 1.5 }, centre, 4, 1, quart), true);
  assert.equal(pointInRotatedRect({ xMeters: 1.5, yMeters: 0 }, centre, 4, 1, quart), false);
});

test("les coins d'un rectangle non tourné sont aux bons endroits", () => {
  const coins = rotatedRectCorners({ xMeters: 0, yMeters: 0 }, 4, 2, 0);
  assert.deepEqual(coins[0], { xMeters: -2, yMeters: -1 });
  assert.deepEqual(coins[2], { xMeters: 2, yMeters: 1 });
});

test("la rotation conserve les distances au centre", () => {
  const centre = { xMeters: 5, yMeters: 5 };
  const droits = rotatedRectCorners(centre, 4, 2, 0);
  const tournes = rotatedRectCorners(centre, 4, 2, 0.7);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(distance(centre, droits[i]) - distance(centre, tournes[i])) < 1e-9);
  }
});
