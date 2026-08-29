import type { Point } from "./geometry";

/**
 * Types du Digital Twin.
 *
 * Les valeurs des énumérations sont copiées TELLES QUELLES depuis
 * `GardenObjectType.swift` et `GardenAreaType.swift`. Les deux
 * applications écrivent dans les mêmes lignes : une valeur inventée ici
 * serait écrite en base puis refusée au décodage par l'iPhone, qui
 * cesserait d'afficher le jardin.
 */

export const OBJECT_TYPES = [
  "plant", "tree", "palm", "shrub",
  "house", "wall", "fence",
  "terrace", "pool", "pond", "greenhouse",
  "path", "stairs",
  "rock", "decorativeObject",
  "waterSource",
  "valve", "pump", "sensor", "filter",
  "sprinkler", "dripEmitter",
  "light", "electricalPoint",
  "birdhouse", "insectHotel", "wildlifeWaterPoint", "pollinatorZone", "wildlifeRefuge",
  "custom",
] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export const AREA_TYPES = [
  "lawn", "flowerBed", "vegetableGarden", "greenhouseArea", "pondArea",
  "terrace", "gravel", "mulch", "noGoZone", "technicalZone", "custom",
] as const;
export type AreaType = (typeof AREA_TYPES)[number];

export const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
  plant: "Plante", tree: "Arbre", palm: "Palmier", shrub: "Arbuste",
  house: "Maison", wall: "Mur", fence: "Clôture",
  terrace: "Terrasse", pool: "Piscine", pond: "Bassin", greenhouse: "Serre",
  path: "Allée", stairs: "Escalier",
  rock: "Rocher", decorativeObject: "Décoration",
  waterSource: "Point d'eau",
  valve: "Vanne", pump: "Pompe", sensor: "Capteur", filter: "Filtre",
  sprinkler: "Arroseur", dripEmitter: "Goutteur",
  light: "Éclairage", electricalPoint: "Point électrique",
  birdhouse: "Nichoir", insectHotel: "Hôtel à insectes",
  wildlifeWaterPoint: "Abreuvoir", pollinatorZone: "Zone pollinisateurs",
  wildlifeRefuge: "Refuge faune",
  custom: "Personnalisé",
};

export const AREA_TYPE_LABELS: Record<AreaType, string> = {
  lawn: "Pelouse", flowerBed: "Massif", vegetableGarden: "Potager",
  greenhouseArea: "Zone de serre", pondArea: "Zone de bassin",
  terrace: "Terrasse", gravel: "Gravier", mulch: "Paillage",
  noGoZone: "Zone interdite", technicalZone: "Zone technique",
  custom: "Personnalisée",
};

/** Palette du plan. Chaque zone doit rester lisible sur fond clair. */
export const AREA_COLORS: Record<AreaType, { fill: string; stroke: string }> = {
  lawn: { fill: "rgba(122,176,108,0.35)", stroke: "#5d8f4e" },
  flowerBed: { fill: "rgba(203,120,150,0.35)", stroke: "#a85375" },
  vegetableGarden: { fill: "rgba(212,145,74,0.35)", stroke: "#a86a2a" },
  greenhouseArea: { fill: "rgba(112,190,178,0.35)", stroke: "#3f8d82" },
  pondArea: { fill: "rgba(94,148,196,0.38)", stroke: "#3a6d96" },
  terrace: { fill: "rgba(174,164,150,0.40)", stroke: "#7d7264" },
  gravel: { fill: "rgba(186,186,182,0.40)", stroke: "#83837e" },
  mulch: { fill: "rgba(150,116,88,0.35)", stroke: "#6f5540" },
  noGoZone: { fill: "rgba(190,80,70,0.22)", stroke: "#a03b31" },
  technicalZone: { fill: "rgba(140,140,150,0.30)", stroke: "#6a6a76" },
  custom: { fill: "rgba(140,150,145,0.28)", stroke: "#6a7570" },
};

/** Objets rendus comme un cercle (couronne ou petit équipement). */
export const ROUND_OBJECTS = new Set<ObjectType>([
  "plant", "tree", "palm", "shrub", "rock", "waterSource", "valve", "pump",
  "sensor", "filter", "sprinkler", "dripEmitter", "light", "electricalPoint",
  "birdhouse", "insectHotel", "wildlifeWaterPoint", "wildlifeRefuge",
]);

export const VEGETATION = new Set<ObjectType>(["plant", "tree", "palm", "shrub"]);

export const OBJECT_COLORS: Record<string, { fill: string; stroke: string }> = {
  vegetation: { fill: "rgba(90,150,90,0.45)", stroke: "#3f7a45" },
  structure: { fill: "rgba(150,145,135,0.55)", stroke: "#6b6459" },
  water: { fill: "rgba(90,150,200,0.45)", stroke: "#38678f" },
  technical: { fill: "rgba(160,120,190,0.45)", stroke: "#6f4d8a" },
  wildlife: { fill: "rgba(200,170,90,0.45)", stroke: "#8a7233" },
  default: { fill: "rgba(140,140,140,0.40)", stroke: "#6a6a6a" },
};

export function colorForObject(type: ObjectType) {
  if (VEGETATION.has(type) || type === "pollinatorZone") return OBJECT_COLORS.vegetation;
  if (["house", "wall", "fence", "terrace", "path", "stairs", "greenhouse", "rock", "decorativeObject"].includes(type))
    return OBJECT_COLORS.structure;
  if (["pool", "pond", "waterSource"].includes(type)) return OBJECT_COLORS.water;
  if (["valve", "pump", "sensor", "filter", "sprinkler", "dripEmitter", "light", "electricalPoint"].includes(type))
    return OBJECT_COLORS.technical;
  if (["birdhouse", "insectHotel", "wildlifeWaterPoint", "wildlifeRefuge"].includes(type))
    return OBJECT_COLORS.wildlife;
  return OBJECT_COLORS.default;
}

/** Dimensions par défaut, en mètres, à la création. */
export const DEFAULT_SIZE: Partial<Record<ObjectType, { w: number; h: number }>> = {
  tree: { w: 4, h: 4 },
  palm: { w: 3, h: 3 },
  shrub: { w: 1.2, h: 1.2 },
  plant: { w: 0.6, h: 0.6 },
  house: { w: 10, h: 8 },
  wall: { w: 4, h: 0.3 },
  fence: { w: 4, h: 0.1 },
  terrace: { w: 6, h: 4 },
  pool: { w: 8, h: 4 },
  pond: { w: 3, h: 2 },
  greenhouse: { w: 6, h: 3 },
  path: { w: 5, h: 1.2 },
  stairs: { w: 2, h: 1 },
  rock: { w: 1, h: 0.8 },
  sprinkler: { w: 0.3, h: 0.3 },
  valve: { w: 0.3, h: 0.3 },
  light: { w: 0.3, h: 0.3 },
  sensor: { w: 0.25, h: 0.25 },
};

export function defaultSizeFor(type: ObjectType) {
  return DEFAULT_SIZE[type] ?? { w: 1, h: 1 };
}

// ---------------------------------------------------------------
// Entités, telles qu'elles existent en base depuis la Phase 6
// ---------------------------------------------------------------

export type TwinObject = {
  id: string;
  objectType: ObjectType;
  position: Point;
  rotationRadians: number;
  widthMeters: number;
  heightMeters: number;
  zIndex: number;
  label: string | null;
  canopyDiameterMeters: number | null;
};

export type TwinArea = {
  id: string;
  areaType: AreaType;
  name: string;
  points: Point[];
};

export type TwinBoundary = {
  id: string;
  points: Point[];
};

export type TwinDocument = {
  gardenId: string;
  gardenName: string;
  boundary: TwinBoundary | null;
  areas: TwinArea[];
  objects: TwinObject[];
};

export type MapMode = "oasisPlan" | "satellite" | "hybrid" | "standard";

export const MAP_MODE_LABELS: Record<MapMode, string> = {
  oasisPlan: "Plan Oasis",
  satellite: "Satellite",
  hybrid: "Hybride",
  standard: "Standard",
};
