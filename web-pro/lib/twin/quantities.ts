import { polygonArea, perimeter, formatArea, formatMeters, type Point } from "./geometry.ts";
import {
  AREA_TYPE_LABELS, OBJECT_TYPE_LABELS, PIPE_LINE_TYPE_LABELS, CABLE_TYPE_LABELS,
  VEGETATION,
  type TwinArea, type TwinObject, type TwinPipe, type TwinCable,
} from "./types.ts";

/**
 * §"QUANTITÉS AUTOMATIQUES" — `DigitalTwinQuantityService`.
 *
 * Le métré du plan, tel que la spec le montre :
 *
 *     Massif    36.4 m²
 *     Bordures  22.8 m
 *     Tuyau     41.2 m
 *     Olivier   3
 *     Lavande   12
 *
 * Trois natures de grandeur, donc trois unités qu'il ne faut jamais
 * additionner entre elles : des surfaces, des longueurs, des comptes.
 *
 * Tout est MESURÉ sur le dessin, jamais saisi à côté. §COVERAGE impose
 * de « toujours distinguer estimated / measured » : ici tout est
 * `measured` au sens strict — la géométrie que l'utilisateur a tracée.
 * Ce qui n'empêche pas le plan lui-même d'être approximatif, mais
 * l'approximation est la sienne, pas une invention du logiciel.
 *
 * Fonction pure, sans accès réseau ni React : c'est ce qui la rend
 * testable, et le métré est précisément ce qu'on ne veut pas voir se
 * tromper en silence — il part ensuite dans un devis (Milestone 5).
 */

export type QuantityLine = {
  /** Clé stable, pour React et pour un futur mapping vers une ligne de devis. */
  key: string;
  label: string;
  /** Valeur numérique brute, dans l'unité de `unit`. */
  value: number;
  unit: "m2" | "m" | "u";
  /** Déjà formatée en français, prête à afficher. */
  formatted: string;
};

export type QuantityReport = {
  surfaces: QuantityLine[];
  lengths: QuantityLine[];
  counts: QuantityLine[];
  /** Vrai si le plan ne contient rien de mesurable. */
  isEmpty: boolean;
};

function formatCount(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

function sortByValueDesc(lines: QuantityLine[]): QuantityLine[] {
  return [...lines].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "fr"));
}

/**
 * Le nom sous lequel un végétal est compté.
 *
 * L'étiquette d'abord — c'est le nom de la plante rattachée, repris
 * automatiquement au rattachement, ou celui que l'utilisateur a écrit.
 * C'est ce qui produit le « Olivier 3 / Lavande 12 » de la spec plutôt
 * qu'un « Arbre 15 » qui ne sert à rien dans un devis.
 */
function vegetationLabel(object: TwinObject): string {
  const label = object.label?.trim();
  return label && label.length > 0 ? label : OBJECT_TYPE_LABELS[object.objectType];
}

export function computeQuantities(input: {
  boundaryPoints: Point[];
  areas: TwinArea[];
  objects: TwinObject[];
  pipes: TwinPipe[];
  cables: TwinCable[];
}): QuantityReport {
  const surfaces: QuantityLine[] = [];
  const lengths: QuantityLine[] = [];
  const counts: QuantityLine[] = [];

  // --- Limite de propriété -------------------------------------
  // Comptée à part et jamais fondue dans les zones : c'est le terrain,
  // pas un ouvrage à réaliser. La confondre gonflerait tout devis
  // calculé sur les surfaces.
  if (input.boundaryPoints.length >= 3) {
    surfaces.push({
      key: "boundary-area",
      label: "Terrain (limite de propriété)",
      value: polygonArea(input.boundaryPoints),
      unit: "m2",
      formatted: formatArea(polygonArea(input.boundaryPoints)),
    });
    lengths.push({
      key: "boundary-perimeter",
      label: "Périmètre du terrain",
      value: perimeter(input.boundaryPoints, true),
      unit: "m",
      formatted: formatMeters(perimeter(input.boundaryPoints, true)),
    });
  }

  // --- Zones : surface ET périmètre ----------------------------
  // Le périmètre n'est pas décoratif : c'est le linéaire de bordure du
  // « Bordures 22.8 m » de la spec. Une zone sans bordure existe, mais
  // on ne peut pas la deviner — on donne la mesure, le devis tranche.
  const areaBuckets = new Map<string, { label: string; area: number; edge: number; n: number }>();
  for (const area of input.areas) {
    if (area.points.length < 3) continue;
    const key = area.areaType;
    const bucket = areaBuckets.get(key) ?? {
      label: AREA_TYPE_LABELS[area.areaType] ?? area.areaType,
      area: 0, edge: 0, n: 0,
    };
    bucket.area += polygonArea(area.points);
    bucket.edge += perimeter(area.points, true);
    bucket.n += 1;
    areaBuckets.set(key, bucket);
  }
  for (const [key, b] of areaBuckets) {
    surfaces.push({
      key: `area-${key}`,
      label: b.n > 1 ? `${b.label} (${b.n})` : b.label,
      value: b.area, unit: "m2", formatted: formatArea(b.area),
    });
    lengths.push({
      key: `edge-${key}`,
      label: `Bordure — ${b.label.toLowerCase()}`,
      value: b.edge, unit: "m", formatted: formatMeters(b.edge),
    });
  }

  // --- Réseaux -------------------------------------------------
  // « La longueur est calculée automatiquement » : elle se lit sur les
  // points, elle n'est jamais stockée. Une longueur enregistrée à côté
  // du tracé finit toujours par le contredire.
  const pipeBuckets = new Map<string, { label: string; length: number }>();
  for (const pipe of input.pipes) {
    if (pipe.points.length < 2) continue;
    const key = `${pipe.lineType}-${pipe.diameterMM}`;
    const bucket = pipeBuckets.get(key) ?? {
      label: `${PIPE_LINE_TYPE_LABELS[pipe.lineType]} — Ø ${pipe.diameterMM} mm`,
      length: 0,
    };
    bucket.length += perimeter(pipe.points, false);
    pipeBuckets.set(key, bucket);
  }
  for (const [key, b] of pipeBuckets) {
    lengths.push({
      key: `pipe-${key}`, label: b.label,
      value: b.length, unit: "m", formatted: formatMeters(b.length),
    });
  }

  const cableBuckets = new Map<string, { label: string; length: number }>();
  for (const cable of input.cables) {
    if (cable.points.length < 2) continue;
    const key = `${cable.cableType}-${cable.sectionMM2 ?? "na"}`;
    const section = cable.sectionMM2 ? ` — ${cable.sectionMM2} mm²` : "";
    const bucket = cableBuckets.get(key) ?? {
      label: `Câble ${CABLE_TYPE_LABELS[cable.cableType].toLowerCase()}${section}`,
      length: 0,
    };
    bucket.length += perimeter(cable.points, false);
    cableBuckets.set(key, bucket);
  }
  for (const [key, b] of cableBuckets) {
    lengths.push({
      key: `cable-${key}`, label: b.label,
      value: b.length, unit: "m", formatted: formatMeters(b.length),
    });
  }

  // --- Comptes -------------------------------------------------
  // Les végétaux par NOM (Olivier 3, Lavande 12), tout le reste par
  // type. Deux regroupements différents parce qu'on n'achète pas de la
  // même façon : trois oliviers ne sont pas « trois arbres ».
  const vegetation = new Map<string, number>();
  const equipment = new Map<string, number>();
  for (const object of input.objects) {
    if (VEGETATION.has(object.objectType)) {
      const name = vegetationLabel(object);
      vegetation.set(name, (vegetation.get(name) ?? 0) + 1);
    } else {
      const name = OBJECT_TYPE_LABELS[object.objectType];
      equipment.set(name, (equipment.get(name) ?? 0) + 1);
    }
  }
  for (const [name, n] of vegetation) {
    counts.push({
      key: `veg-${name}`, label: name, value: n, unit: "u", formatted: formatCount(n),
    });
  }
  for (const [name, n] of equipment) {
    counts.push({
      key: `obj-${name}`, label: name, value: n, unit: "u", formatted: formatCount(n),
    });
  }

  return {
    surfaces: sortByValueDesc(surfaces),
    lengths: sortByValueDesc(lengths),
    counts: sortByValueDesc(counts),
    isEmpty: surfaces.length === 0 && lengths.length === 0 && counts.length === 0,
  };
}
