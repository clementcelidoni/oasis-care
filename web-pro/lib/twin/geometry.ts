/**
 * Géométrie du Digital Twin — fonctions pures, sans canvas ni React.
 *
 * §11C "COORDONNÉES" : le système local est en MÈTRES, x vers l'est,
 * y vers le nord. C'est exactement `GardenCoordinate` côté iOS, et les
 * deux applications lisent les mêmes lignes en base — donc rien ici ne
 * doit stocker de pixels. §"NE PAS stocker les objets uniquement en
 * pixels écran."
 *
 * Le canvas, lui, a son y qui descend. La conversion est faite dans un
 * seul endroit (`worldToScreen` / `screenToWorld`) plutôt que dispersée
 * dans le rendu : c'est le genre d'inversion de signe qui, oubliée une
 * fois, donne un jardin en miroir.
 *
 * ===============================================================
 * CONVENTION D'ANGLE — AZIMUT. Vaut pour les OBJETS ET pour le PLAN
 * IMPORTÉ, et pour rien d'autre dans ce fichier.
 * ===============================================================
 *
 * Tout `rotationRadians` lu ici est un AZIMUT : le CAP BOUSSOLE de
 * l'axe local +Y de l'élément — le HAUT de son empreinte.
 *
 *   • unité   : RADIANS dans la colonne et dans le code ; les deux
 *               interfaces saisissent et affichent des DEGRÉS, dans
 *               [0, 360[. C'est la seule conversion du trajet.
 *   • origine : 0 = NORD.
 *   • sens    : croissant dans le sens HORAIRE, sur un plan nord en
 *               haut. nord 0° · est 90° · sud 180° · ouest 270°.
 *
 * Trois vérifications qu'on doit pouvoir faire sans hésiter :
 *   (1) à 0° l'objet est droit — sa largeur court d'ouest en est, sa
 *       hauteur du sud vers le nord ;
 *   (2) tourner l'objet VERS LA DROITE à l'écran fait MONTER le nombre ;
 *   (3) à 90° le haut de l'objet pointe vers l'EST — un mur de
 *       4 m × 0,20 m y est donc couché nord-sud.
 *
 * Formules, dans le repère monde (x vers l'est, y vers le nord), pour
 * un azimut a :
 *       axe local +Y (la hauteur) = ( sin a,  cos a )
 *       axe local +X (la largeur) = ( cos a, -sin a )
 *
 * `rotateClockwise` est LA SEULE matrice autorisée sur cette colonne et
 * `unrotateClockwise` sa seule réciproque. N'en réécrivez aucune autre :
 * la matrice trigonométrique habituelle (`x·cos − y·sin`,
 * `x·sin + y·cos`) envoie le haut de l'objet sur (−sin a, cos a), soit
 * l'azimut −a. C'est très exactement le défaut que ce fichier a porté
 * pour les objets — un objet posé à +30° sur le web s'affichait à −30°
 * sur l'iPhone — pendant que le plan importé, lui, était déjà du bon
 * côté.
 *
 * NE PAS confondre avec les angles d'arroseur
 * (`sprinklerStartAngleDegrees` / `sprinklerEndAngleDegrees`) : ceux-là
 * sont une AUTRE convention, conservée volontairement — degrés,
 * 0 = est, sens ANTIHORAIRE — et aucun code de rotation ne les lit.
 */

export type Point = { xMeters: number; yMeters: number };

export type Camera = {
  /** Centre de la vue, en mètres monde. */
  centerX: number;
  centerY: number;
  /** Échelle : combien de pixels pour un mètre. */
  pixelsPerMeter: number;
};

export type Viewport = { width: number; height: number };

export function worldToScreen(p: Point, camera: Camera, view: Viewport) {
  return {
    x: view.width / 2 + (p.xMeters - camera.centerX) * camera.pixelsPerMeter,
    // y inversé : le nord est en haut de l'écran.
    y: view.height / 2 - (p.yMeters - camera.centerY) * camera.pixelsPerMeter,
  };
}

export function screenToWorld(
  s: { x: number; y: number },
  camera: Camera,
  view: Viewport,
): Point {
  return {
    xMeters: camera.centerX + (s.x - view.width / 2) / camera.pixelsPerMeter,
    yMeters: camera.centerY - (s.y - view.height / 2) / camera.pixelsPerMeter,
  };
}

// ---------------------------------------------------------------
// Mesures — §"MESURES : longueur, largeur, distance, surface,
// périmètre, angle."
// ---------------------------------------------------------------

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.xMeters - b.xMeters, a.yMeters - b.yMeters);
}

export function perimeter(points: Point[], closed = true): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += distance(points[i], points[i + 1]);
  if (closed && points.length > 2) total += distance(points[points.length - 1], points[0]);
  return total;
}

/**
 * Surface d'un polygone par la formule du lacet.
 *
 * Valeur absolue : le sens de saisie (horaire ou antihoraire) ne doit
 * pas produire une surface négative — l'utilisateur dessine dans le
 * sens qu'il veut.
 */
export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.xMeters * b.yMeters - b.xMeters * a.yMeters;
  }
  return Math.abs(sum) / 2;
}

/** Angle ABC en degrés, au sommet B. */
export function angleAt(a: Point, b: Point, c: Point): number {
  const v1 = { x: a.xMeters - b.xMeters, y: a.yMeters - b.yMeters };
  const v2 = { x: c.xMeters - b.xMeters, y: c.yMeters - b.yMeters };
  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);
  if (m1 === 0 || m2 === 0) return 0;
  const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function centroid(points: Point[]): Point {
  if (points.length === 0) return { xMeters: 0, yMeters: 0 };
  const sum = points.reduce(
    (acc, p) => ({ x: acc.x + p.xMeters, y: acc.y + p.yMeters }),
    { x: 0, y: 0 },
  );
  return { xMeters: sum.x / points.length, yMeters: sum.y / points.length };
}

export function boundsOf(points: Point[]) {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.xMeters);
    maxX = Math.max(maxX, p.xMeters);
    minY = Math.min(minY, p.yMeters);
    maxY = Math.max(maxY, p.yMeters);
  }
  return { minX, minY, maxX, maxY };
}

// ---------------------------------------------------------------
// Snapping — §"SNAPPING : grille, autres objets, guides, horizontal,
// vertical, 45°, 90°, sommets, limites. Activation/désactivation."
// ---------------------------------------------------------------

export type SnapSettings = {
  enabled: boolean;
  /** Pas de la grille, en mètres. */
  gridMeters: number;
  /** Distance d'accrochage aux sommets, en mètres. */
  vertexToleranceMeters: number;
  toGrid: boolean;
  toVertices: boolean;
  toAngles: boolean;
};

export const DEFAULT_SNAP: SnapSettings = {
  enabled: true,
  gridMeters: 0.5,
  vertexToleranceMeters: 0.4,
  toGrid: true,
  toVertices: true,
  toAngles: true,
};

export function snapToGrid(p: Point, gridMeters: number): Point {
  if (gridMeters <= 0) return p;
  return {
    xMeters: Math.round(p.xMeters / gridMeters) * gridMeters,
    yMeters: Math.round(p.yMeters / gridMeters) * gridMeters,
  };
}

/**
 * Accroche un point : d'abord aux sommets existants, sinon à la grille.
 *
 * Les sommets ont la priorité, et volontairement : quand on referme un
 * polygone, tomber pile sur le sommet de départ compte plus que d'être
 * aligné sur la grille. Un écart d'un centimètre laisse un trou.
 */
export function snapPoint(p: Point, vertices: Point[], settings: SnapSettings): Point {
  if (!settings.enabled) return p;

  if (settings.toVertices) {
    let best: Point | null = null;
    let bestDistance = settings.vertexToleranceMeters;
    for (const v of vertices) {
      const d = distance(p, v);
      if (d < bestDistance) {
        bestDistance = d;
        best = v;
      }
    }
    if (best) return { ...best };
  }

  if (settings.toGrid) return snapToGrid(p, settings.gridMeters);
  return p;
}

/**
 * Contraint un segment aux angles remarquables (0/45/90…), pour tracer
 * un mur droit sans lutter à la souris. C'est ce que fait Shift dans
 * n'importe quel outil de dessin.
 */
export function snapAngle(from: Point, to: Point, stepDegrees = 45): Point {
  const dx = to.xMeters - from.xMeters;
  const dy = to.yMeters - from.yMeters;
  const length = Math.hypot(dx, dy);
  if (length === 0) return to;

  const step = (stepDegrees * Math.PI) / 180;
  const snapped = Math.round(Math.atan2(dy, dx) / step) * step;
  return {
    xMeters: from.xMeters + Math.cos(snapped) * length,
    yMeters: from.yMeters + Math.sin(snapped) * length,
  };
}

// ---------------------------------------------------------------
// Rotation — l'UNIQUE porteur du signe
//
// Une seule paire de fonctions pour les objets ET pour le plan
// importé. C'est délibéré : tant que ces deux-là sont les seules à
// écrire un cosinus et un sinus sur cette colonne, les deux familles
// ne peuvent plus diverger. Voir l'encadré « CONVENTION D'ANGLE » en
// tête de fichier.
// ---------------------------------------------------------------

/**
 * Applique un AZIMUT à un décalage local exprimé en mètres MONDE
 * (x vers l'est, y vers le nord).
 *
 * Le haut de l'élément — le vecteur local (0, 1) — part vers
 * (sin a, cos a) : c'est le cap `a` compté depuis le NORD dans le sens
 * HORAIRE, donc la définition même de l'azimut.
 */
export function rotateClockwise(ox: number, oy: number, rotationRadians: number) {
  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);
  return { x: ox * cos + oy * sin, y: -ox * sin + oy * cos };
}

/** L'inverse exact de `rotateClockwise`. */
export function unrotateClockwise(dx: number, dy: number, rotationRadians: number) {
  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

// ---------------------------------------------------------------
// Tests d'appartenance
// ---------------------------------------------------------------

/** Point dans polygone, par lancer de rayon. */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].xMeters, yi = polygon[i].yMeters;
    const xj = polygon[j].xMeters, yj = polygon[j].yMeters;
    const intersects =
      yi > p.yMeters !== yj > p.yMeters &&
      p.xMeters < ((xj - xi) * (p.yMeters - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Point dans un rectangle tourné (un objet placé).
 *
 * `rotationRadians` est un AZIMUT — 0 = nord, horaire, en radians ;
 * voir l'encadré en tête de fichier. On ramène le point dans le repère
 * de l'objet, ce qui transforme le test en un simple encadrement.
 *
 * `unrotateClockwise`, et non une matrice recopiée : ce test DOIT être
 * l'inverse exact de `rotatedRectCorners`. Les deux se corrigent
 * ensemble ou pas du tout — sinon on attrape l'objet là où il n'est pas
 * dessiné, un défaut plus déroutant que celui qu'on répare.
 */
export function pointInRotatedRect(
  p: Point,
  center: Point,
  widthMeters: number,
  heightMeters: number,
  rotationRadians: number,
): boolean {
  const local = unrotateClockwise(
    p.xMeters - center.xMeters,
    p.yMeters - center.yMeters,
    rotationRadians,
  );
  return (
    Math.abs(local.x) <= widthMeters / 2 && Math.abs(local.y) <= heightMeters / 2
  );
}

/**
 * Sommets du rectangle tourné : le dessin, les poignées et le contour
 * de sélection en dérivent tous, et suivront donc automatiquement.
 *
 * `rotationRadians` est un AZIMUT : 0 = NORD, croissant dans le sens
 * HORAIRE sur un plan nord en haut, en radians (encadré en tête de
 * fichier). D'où `rotateClockwise` — la même et unique matrice que le
 * plan importé. La matrice trigonométrique qui se trouvait ici tournait
 * les objets à l'envers de l'iPhone.
 */
export function rotatedRectCorners(
  center: Point,
  widthMeters: number,
  heightMeters: number,
  rotationRadians: number,
): Point[] {
  const hw = widthMeters / 2;
  const hh = heightMeters / 2;
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((c) => {
    const r = rotateClockwise(c.x, c.y, rotationRadians);
    return { xMeters: center.xMeters + r.x, yMeters: center.yMeters + r.y };
  });
}

/**
 * Distance d'un point à un segment, en mètres.
 *
 * Le cas dégénéré — un segment de longueur nulle, deux clics au même
 * endroit — retomberait sur une division par zéro ; on y renvoie la
 * distance au point, qui est la bonne réponse.
 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.xMeters - a.xMeters;
  const dy = b.yMeters - a.yMeters;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(p, a);

  let t = ((p.xMeters - a.xMeters) * dx + (p.yMeters - a.yMeters) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { xMeters: a.xMeters + t * dx, yMeters: a.yMeters + t * dy });
}

/**
 * Distance d'un point à une polyligne OUVERTE — un tuyau, un câble.
 * Ouverte : pas de segment de retour du dernier point au premier.
 */
export function distanceToPolyline(p: Point, points: Point[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return distance(p, points[0]);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]));
  }
  return best;
}

// ---------------------------------------------------------------
// Formatage
// ---------------------------------------------------------------

/**
 * En français la virgule sépare les décimales, pas le point. Ces
 * chaînes sortent du plan pour aller dans un métré puis dans un devis
 * remis à un client : « 36.4 m² » y passerait pour une faute.
 *
 * `Intl` supprime déjà les zéros inutiles et pose l'espace des milliers.
 */
const METERS = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const AREA = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export function formatMeters(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1) return `${Math.round(value * 100)} cm`;
  return `${METERS.format(value)} m`;
}

export function formatArea(squareMeters: number): string {
  if (!Number.isFinite(squareMeters)) return "—";
  return `${AREA.format(squareMeters)} m²`;
}

// ---------------------------------------------------------------
// Plan importé — ANCRAGE ET ROTATION DU FOND DE PLAN
// ---------------------------------------------------------------

/**
 * Deux conventions se disputaient la même colonne `position_x_meters`.
 *
 * L'iPhone (`OasisPlanView.drawPlanImage`, Phase 6K) traite la position
 * stockée comme le CENTRE de l'image : il translate le contexte jusqu'à
 * ce point puis dessine un rectangle de `-w/2, -h/2` à `+w/2, +h/2`.
 * Le web, lui, la traitait comme le COIN HAUT-GAUCHE et dessinait à
 * partir de `0, 0`. Un plan de 20 × 15 m se retrouvait donc décalé de
 * 10 m en x et de 7,5 m en y d'une application à l'autre : le périmètre
 * tracé sur le web sur ce fond-là tombait à côté du terrain sur le
 * téléphone.
 *
 * La convention retenue est celle de l'iPhone — le CENTRE. C'est
 * l'application publiée, dont les plans sont alignés à la main sur
 * l'appareil de chaque utilisateur ; en changer le sens déplacerait le
 * plan de tout le monde. Tout ce qui suit convertit donc vers ce
 * centre-là, et `planCenterFromTopLeft` existe précisément pour
 * rattraper une valeur écrite sous l'ancienne convention.
 *
 * ROTATION : voir l'encadré « CONVENTION D'ANGLE » en tête de fichier.
 * Le plan importé la suit déjà, et il l'a suivie LE PREMIER — le signe
 * y avait été établi par le calcul lors d'un correctif antérieur, et
 * c'est ce raisonnement-là, rangé sous le seul chapitre du plan, qui
 * avait laissé les objets y échapper :
 *
 *  • iOS additionne la rotation du plan à celle de la caméra dans
 *    l'ESPACE ÉCRAN (`imageContext.rotate(by: camera.rotationRadians +
 *    planImage.rotationRadians)`), et l'écran a son y vers le BAS. Une
 *    valeur positive y tourne donc l'image dans le sens HORAIRE.
 *  • `ctx.rotate(θ)` du canvas se comporte exactement pareil, pour la
 *    même raison : y vers le bas, positif = horaire.
 *
 * Le web écrivait `ctx.rotate(-plan.rotationRadians)` en invoquant
 * l'inversion du y — un raisonnement juste pour un angle exprimé dans
 * le repère MONDE (y vers le haut, sens trigonométrique), mais la
 * valeur stockée ne l'est pas : elle vient d'un `rotate` écran. Les
 * deux applications tournaient donc le même plan en sens contraire. Le
 * signe correct est `+`.
 *
 * Conséquence pour les fonctions ci-dessous : dans le repère monde
 * (y vers le haut), une rotation positive est HORAIRE, donc d'angle
 * mathématique `-θ`. Le plan est la RÉFÉRENCE et non le retardataire :
 * ne pas « l'harmoniser » à l'envers. Deux tests verrouillent son sens
 * (planGeometry.test.ts:135 et 187).
 */
export type PlanAnchorMode = "center" | "topLeft";

/** Le plan tel qu'il occupe le terrain : où, quelle taille, quel angle. */
export type PlanPlacement = {
  /** Valeur stockée en base, interprétée selon `mode`. */
  position: Point;
  widthMeters: number;
  heightMeters: number;
  /**
   * AZIMUT : 0 = nord, croissant dans le sens HORAIRE, en radians.
   * Voir l'encadré « CONVENTION D'ANGLE » en tête de fichier.
   */
  rotationRadians: number;
};

/**
 * Centre du plan à partir de la position de son coin haut-gauche —
 * l'ancienne convention web. Sert à convertir une valeur héritée.
 */
export function planCenterFromTopLeft(
  topLeft: Point,
  widthMeters: number,
  heightMeters: number,
  rotationRadians: number,
): Point {
  // Le coin haut-gauche est à (-w/2, +h/2) du centre : l'image s'étend
  // vers l'est et vers le SUD, son y descend quand celui du monde monte.
  const offset = rotateClockwise(-widthMeters / 2, heightMeters / 2, rotationRadians);
  return { xMeters: topLeft.xMeters - offset.x, yMeters: topLeft.yMeters - offset.y };
}

/** Coin haut-gauche de l'image, connaissant son centre. La réciproque. */
export function planTopLeftFromCenter(
  center: Point,
  widthMeters: number,
  heightMeters: number,
  rotationRadians: number,
): Point {
  const offset = rotateClockwise(-widthMeters / 2, heightMeters / 2, rotationRadians);
  return { xMeters: center.xMeters + offset.x, yMeters: center.yMeters + offset.y };
}

/** Le centre du plan, quelle que soit la convention de la valeur reçue. */
export function planCenter(placement: PlanPlacement, mode: PlanAnchorMode = "center"): Point {
  if (mode === "center") return placement.position;
  return planCenterFromTopLeft(
    placement.position,
    placement.widthMeters,
    placement.heightMeters,
    placement.rotationRadians,
  );
}

/**
 * LE RECTANGLE OCCUPÉ PAR LE PLAN, en mètres monde.
 *
 * Quatre sommets dans l'ordre de l'image : haut-gauche, haut-droit,
 * bas-droit, bas-gauche. C'est la fonction de référence — le rendu, le
 * test d'appartenance et le calibrage en découlent tous, et le test
 * unitaire s'en sert pour prouver que les deux conventions décrivent
 * bien le même rectangle.
 */
export function planRectCorners(
  placement: PlanPlacement,
  mode: PlanAnchorMode = "center",
): Point[] {
  const center = planCenter(placement, mode);
  const hw = placement.widthMeters / 2;
  const hh = placement.heightMeters / 2;
  return [
    { ox: -hw, oy: hh },
    { ox: hw, oy: hh },
    { ox: hw, oy: -hh },
    { ox: -hw, oy: -hh },
  ].map(({ ox, oy }) => {
    const r = rotateClockwise(ox, oy, placement.rotationRadians);
    return { xMeters: center.xMeters + r.x, yMeters: center.yMeters + r.y };
  });
}

/** Le point est-il sur le plan ? Utilisé pour l'attraper à la souris. */
export function pointInPlan(
  p: Point,
  placement: PlanPlacement,
  mode: PlanAnchorMode = "center",
): boolean {
  const center = planCenter(placement, mode);
  const local = unrotateClockwise(p.xMeters - center.xMeters, p.yMeters - center.yMeters, placement.rotationRadians);
  return (
    Math.abs(local.x) <= placement.widthMeters / 2 &&
    Math.abs(local.y) <= placement.heightMeters / 2
  );
}

/**
 * Un point du monde ramené en PIXELS de l'image source — origine au
 * coin haut-gauche, y vers le bas, comme n'importe quel bitmap.
 *
 * C'est ce que le calibrage doit stocker : deux repères sur le
 * document, pas deux points du terrain. La taille en pixels de l'image
 * est nécessaire parce que l'origine du bitmap est son coin, alors que
 * la position stockée est son centre.
 */
export function worldToPlanPixels(
  p: Point,
  placement: PlanPlacement,
  imageWidthPixels: number,
  imageHeightPixels: number,
  metersPerPixel: number,
  mode: PlanAnchorMode = "center",
): { x: number; y: number } {
  if (!(metersPerPixel > 0)) return { x: 0, y: 0 };
  const center = planCenter(placement, mode);
  const local = unrotateClockwise(p.xMeters - center.xMeters, p.yMeters - center.yMeters, placement.rotationRadians);
  return {
    x: imageWidthPixels / 2 + local.x / metersPerPixel,
    y: imageHeightPixels / 2 - local.y / metersPerPixel,
  };
}

/** La réciproque : un pixel de l'image, replacé sur le terrain. */
export function planPixelsToWorld(
  pixel: { x: number; y: number },
  placement: PlanPlacement,
  imageWidthPixels: number,
  imageHeightPixels: number,
  metersPerPixel: number,
  mode: PlanAnchorMode = "center",
): Point {
  const center = planCenter(placement, mode);
  const ox = (pixel.x - imageWidthPixels / 2) * metersPerPixel;
  const oy = (imageHeightPixels / 2 - pixel.y) * metersPerPixel;
  const r = rotateClockwise(ox, oy, placement.rotationRadians);
  return { xMeters: center.xMeters + r.x, yMeters: center.yMeters + r.y };
}
