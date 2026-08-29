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
 * On ramène le point dans le repère de l'objet en le tournant de
 * -rotation autour du centre, ce qui transforme le test en un simple
 * encadrement.
 */
export function pointInRotatedRect(
  p: Point,
  center: Point,
  widthMeters: number,
  heightMeters: number,
  rotationRadians: number,
): boolean {
  const dx = p.xMeters - center.xMeters;
  const dy = p.yMeters - center.yMeters;
  const cos = Math.cos(-rotationRadians);
  const sin = Math.sin(-rotationRadians);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return (
    Math.abs(localX) <= widthMeters / 2 && Math.abs(localY) <= heightMeters / 2
  );
}

/** Sommets du rectangle tourné, pour le dessin et les poignées. */
export function rotatedRectCorners(
  center: Point,
  widthMeters: number,
  heightMeters: number,
  rotationRadians: number,
): Point[] {
  const hw = widthMeters / 2;
  const hh = heightMeters / 2;
  const cos = Math.cos(rotationRadians);
  const sin = Math.sin(rotationRadians);
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((c) => ({
    xMeters: center.xMeters + c.x * cos - c.y * sin,
    yMeters: center.yMeters + c.x * sin + c.y * cos,
  }));
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
