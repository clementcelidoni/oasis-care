import test from "node:test";
import assert from "node:assert/strict";
import {
  planRectCorners,
  planCenterFromTopLeft,
  planTopLeftFromCenter,
  planCenter,
  pointInPlan,
  worldToPlanPixels,
  planPixelsToWorld,
  worldToScreen,
  type PlanPlacement,
  type Point,
  type Camera,
  type Viewport,
} from "./geometry.ts";

/**
 * L'ANCRAGE DU FOND DE PLAN.
 *
 * Bug signalé : « j'ai positionné sur le web le périmètre du terrain,
 * sur le téléphone il dépasse du terrain ». L'iPhone ancre le plan par
 * son CENTRE, le web l'ancrait par son COIN HAUT-GAUCHE. Ces tests
 * fixent la convention retenue — celle de l'iPhone — et prouvent que la
 * conversion depuis l'ancienne décrit exactement le même rectangle.
 */

const pt = (x: number, y: number): Point => ({ xMeters: x, yMeters: y });

/** Le plan de l'exemple : 20 × 15 m, posé sur l'origine, sans rotation. */
const plan20x15: PlanPlacement = {
  position: pt(0, 0),
  widthMeters: 20,
  heightMeters: 15,
  rotationRadians: 0,
};

/** Comparaison en mètres : un sinus ne rend jamais un zéro exact. */
function assertPoint(actual: Point, expected: Point, message: string) {
  assert.ok(
    Math.abs(actual.xMeters - expected.xMeters) < 1e-9 &&
      Math.abs(actual.yMeters - expected.yMeters) < 1e-9,
    `${message} — attendu (${expected.xMeters}, ${expected.yMeters}), obtenu (${actual.xMeters}, ${actual.yMeters})`,
  );
}

function assertPoints(actual: Point[], expected: Point[], message: string) {
  assert.equal(actual.length, expected.length, `${message} — nombre de sommets`);
  actual.forEach((p, i) => assertPoint(p, expected[i], `${message} — sommet ${i}`));
}

// ---------------------------------------------------------------
// Le rectangle occupé, convention CENTRE
// ---------------------------------------------------------------

test("ancré par le centre, un plan de 20 × 15 m sur l'origine va de -10 à +10 et de -7,5 à +7,5", () => {
  assertPoints(
    planRectCorners(plan20x15),
    [pt(-10, 7.5), pt(10, 7.5), pt(10, -7.5), pt(-10, -7.5)],
    "sommets du plan centré",
  );
});

test("les sommets sortent dans l'ordre de l'image : haut-gauche, haut-droit, bas-droit, bas-gauche", () => {
  const [hg, hd, bd, bg] = planRectCorners(plan20x15);
  // « Haut » de l'image = nord du terrain quand la rotation est nulle.
  assert.ok(hg.yMeters > bg.yMeters, "le haut de l'image doit être au nord du bas");
  assert.ok(hd.xMeters > hg.xMeters, "la droite de l'image doit être à l'est de la gauche");
  assert.equal(bd.xMeters, hd.xMeters);
  assert.equal(bg.xMeters, hg.xMeters);
});

// ---------------------------------------------------------------
// LES DEUX CONVENTIONS DÉCRIVENT LE MÊME RECTANGLE
// ---------------------------------------------------------------

test("le décalage entre les deux conventions vaut la moitié du plan : 10 m et 7,5 m", () => {
  // C'est exactement l'écart que l'utilisateur voyait entre les deux
  // applications, et la raison pour laquelle son périmètre « dépassait
  // du terrain » sur le téléphone.
  const center = planCenterFromTopLeft(pt(0, 0), 20, 15, 0);
  assertPoint(center, pt(10, -7.5), "centre déduit du coin haut-gauche");
});

test("une position lue en coin haut-gauche, convertie, donne le même rectangle qu'un centre", () => {
  for (const rotation of [0, 0.3, -1.1, Math.PI / 2, Math.PI, 2.7]) {
    const topLeftPlacement: PlanPlacement = {
      position: pt(-4.5, 12.25),
      widthMeters: 20,
      heightMeters: 15,
      rotationRadians: rotation,
    };
    const converted: PlanPlacement = {
      ...topLeftPlacement,
      position: planCenter(topLeftPlacement, "topLeft"),
    };
    assertPoints(
      planRectCorners(topLeftPlacement, "topLeft"),
      planRectCorners(converted, "center"),
      `même rectangle à ${rotation} rad`,
    );
  }
});

test("le coin haut-gauche du rectangle EST la position de l'ancienne convention", () => {
  for (const rotation of [0, 0.7, -2.2]) {
    const topLeft = pt(3, 8);
    const placement: PlanPlacement = {
      position: topLeft, widthMeters: 12, heightMeters: 9, rotationRadians: rotation,
    };
    assertPoint(
      planRectCorners(placement, "topLeft")[0],
      topLeft,
      `le sommet 0 doit rester le coin stocké (${rotation} rad)`,
    );
  }
});

test("centre ↔ coin haut-gauche font l'aller-retour exactement", () => {
  for (const rotation of [0, 0.4, -1.9, Math.PI / 3]) {
    const center = pt(-7.25, 3.5);
    const topLeft = planTopLeftFromCenter(center, 20, 15, rotation);
    assertPoint(
      planCenterFromTopLeft(topLeft, 20, 15, rotation),
      center,
      `aller-retour à ${rotation} rad`,
    );
  }
});

// ---------------------------------------------------------------
// LE SIGNE DE LA ROTATION
// ---------------------------------------------------------------

test("une rotation positive tourne le plan dans le sens HORAIRE, comme l'iPhone", () => {
  // iOS : `imageContext.rotate(by: camera.rotationRadians +
  // planImage.rotationRadians)` dans un contexte dont le y descend —
  // positif = horaire à l'écran. Un quart de tour horaire envoie donc le
  // HAUT de l'image vers l'EST du terrain.
  const quart: PlanPlacement = { ...plan20x15, rotationRadians: Math.PI / 2 };
  const [hg, hd] = planRectCorners(quart);
  const milieuHaut = pt((hg.xMeters + hd.xMeters) / 2, (hg.yMeters + hd.yMeters) / 2);
  assertPoint(milieuHaut, pt(7.5, 0), "le haut de l'image part à l'est");
});

test("le rendu du canvas et planRectCorners décrivent le même rectangle à l'écran", () => {
  // Ce test remplace le canvas par sa matrice : `translate` au centre,
  // puis `rotate(+θ)`, puis un rectangle de -w/2,-h/2 à +w/2,+h/2 — la
  // séquence exacte de TwinEditor. S'il passe, le rendu ne peut plus
  // diverger de la géométrie sans casser ici d'abord.
  const camera: Camera = { centerX: 2, centerY: -3, pixelsPerMeter: 12 };
  const view: Viewport = { width: 800, height: 600 };

  for (const rotationRadians of [0, 0.6, -1.4, Math.PI / 2]) {
    const placement: PlanPlacement = {
      position: pt(5, 4), widthMeters: 20, heightMeters: 15, rotationRadians,
    };

    const screenCenter = worldToScreen(placement.position, camera, view);
    const halfWidthPixels = (placement.widthMeters * camera.pixelsPerMeter) / 2;
    const halfHeightPixels = (placement.heightMeters * camera.pixelsPerMeter) / 2;
    const cos = Math.cos(rotationRadians);
    const sin = Math.sin(rotationRadians);
    // ctx.rotate(θ) avec y vers le bas : [cos, -sin ; sin, cos].
    const drawn = [
      [-halfWidthPixels, -halfHeightPixels],
      [halfWidthPixels, -halfHeightPixels],
      [halfWidthPixels, halfHeightPixels],
      [-halfWidthPixels, halfHeightPixels],
    ].map(([u, v]) => ({
      x: screenCenter.x + u * cos - v * sin,
      y: screenCenter.y + u * sin + v * cos,
    }));

    const fromGeometry = planRectCorners(placement).map((p) => worldToScreen(p, camera, view));

    drawn.forEach((expected, i) => {
      assert.ok(
        Math.abs(fromGeometry[i].x - expected.x) < 1e-6 &&
          Math.abs(fromGeometry[i].y - expected.y) < 1e-6,
        `sommet ${i} à ${rotationRadians} rad — dessiné (${expected.x}, ${expected.y}), géométrie (${fromGeometry[i].x}, ${fromGeometry[i].y})`,
      );
    });
  }
});

test("les deux sens de rotation ne coïncident pas — un « -θ » rétabli casserait ici", () => {
  // Garde-fou : les autres tests emploient le même signe des deux côtés
  // et passeraient encore si le signe était inversé PARTOUT. Celui-ci
  // compare explicitement les deux sens sur une valeur connue.
  const horaire = planRectCorners({ ...plan20x15, rotationRadians: Math.PI / 2 });
  const [hg, hd] = horaire;
  const milieuHaut = pt((hg.xMeters + hd.xMeters) / 2, (hg.yMeters + hd.yMeters) / 2);
  assert.ok(
    milieuHaut.xMeters > 0,
    `le haut de l'image doit partir vers l'EST (x > 0), obtenu x=${milieuHaut.xMeters}`,
  );
});

// ---------------------------------------------------------------
// Appartenance et calibrage
// ---------------------------------------------------------------

test("pointInPlan suit l'ancrage par le centre", () => {
  assert.equal(pointInPlan(pt(0, 0), plan20x15), true, "le centre est sur le plan");
  assert.equal(pointInPlan(pt(9.9, 7.4), plan20x15), true, "juste à l'intérieur du coin");
  assert.equal(pointInPlan(pt(10.1, 0), plan20x15), false, "au-delà du bord est");
  assert.equal(pointInPlan(pt(0, 7.6), plan20x15), false, "au-delà du bord nord");
  // Sous l'ANCIENNE convention le même point tombait ailleurs : c'est
  // toute la différence que l'utilisateur constatait.
  assert.equal(pointInPlan(pt(15, -3), plan20x15, "topLeft"), true);
  assert.equal(pointInPlan(pt(15, -3), plan20x15, "center"), false);
});

test("le coin haut-gauche du plan est le pixel (0, 0) de l'image", () => {
  const metersPerPixel = 0.02; // 1000 × 750 px pour 20 × 15 m
  const corner = planRectCorners(plan20x15)[0];
  const pixel = worldToPlanPixels(corner, plan20x15, 1000, 750, metersPerPixel);
  assert.ok(
    Math.abs(pixel.x) < 1e-6 && Math.abs(pixel.y) < 1e-6,
    `attendu (0, 0), obtenu (${pixel.x}, ${pixel.y})`,
  );
});

test("monde ↔ pixels image fait l'aller-retour, rotation comprise", () => {
  const metersPerPixel = 0.02;
  for (const rotationRadians of [0, 0.9, -2.1]) {
    const placement: PlanPlacement = {
      position: pt(-6, 11), widthMeters: 20, heightMeters: 15, rotationRadians,
    };
    for (const pixel of [{ x: 0, y: 0 }, { x: 1000, y: 750 }, { x: 137, y: 642 }]) {
      const world = planPixelsToWorld(pixel, placement, 1000, 750, metersPerPixel);
      const back = worldToPlanPixels(world, placement, 1000, 750, metersPerPixel);
      assert.ok(
        Math.abs(back.x - pixel.x) < 1e-6 && Math.abs(back.y - pixel.y) < 1e-6,
        `aller-retour du pixel (${pixel.x}, ${pixel.y}) à ${rotationRadians} rad`,
      );
    }
  }
});

test("le calibrage mesure la même distance quelle que soit la convention d'ancrage", () => {
  // Rassurant pour les plans déjà calibrés : seule la DISTANCE entre les
  // deux repères entre dans l'échelle, et une translation ne la change
  // pas. Le correctif ne dérègle donc pas une échelle déjà saisie.
  const metersPerPixel = 0.02;
  const a = pt(1, 2);
  const b = pt(4, -3);
  const asCenter = [a, b].map((p) => worldToPlanPixels(p, plan20x15, 1000, 750, metersPerPixel, "center"));
  const asTopLeft = [a, b].map((p) => worldToPlanPixels(p, plan20x15, 1000, 750, metersPerPixel, "topLeft"));
  const span = (q: { x: number; y: number }[]) => Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y);
  assert.ok(Math.abs(span(asCenter) - span(asTopLeft)) < 1e-9);
});

test("une échelle nulle ne produit pas de NaN", () => {
  // Un plan non calibré passe ici avant que l'utilisateur ait donné sa
  // distance : mieux vaut un (0, 0) franc qu'un NaN qui se propage
  // silencieusement dans la position enregistrée.
  const pixel = worldToPlanPixels(pt(3, 3), plan20x15, 1000, 750, 0);
  assert.equal(Number.isFinite(pixel.x), true);
  assert.equal(Number.isFinite(pixel.y), true);
});
