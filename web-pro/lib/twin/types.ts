import type { Point } from "./geometry.ts";

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

/**
 * §11C : « une plante placée peut être liée à SpeciesProfile, Plant,
 * NurseryCatalogItem, NurseryStock, QuoteItem. »
 *
 * Restreint à ce que l'iPhone sait décoder : GardenObjectLinkKind ne
 * connaît que `plant` et `sensor`. Écrire une autre valeur la ferait
 * refuser au décodage, et le jardin cesserait de s'afficher sur le
 * téléphone. Les autres cibles viendront quand l'enum Swift les aura.
 */
export type LinkKind = "plant" | "sensor";

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
  linkedEntityId: string | null;
  linkedEntityKind: LinkKind | null;
  /**
   * §SPRINKLER — « afficher graphiquement : radius, startAngle,
   * endAngle ». Portés par l'objet lui-même et non par une table à
   * part : côté Swift, un arroseur EST un `GardenMapObject` de type
   * `sprinkler`, même choix que le houppier pour les végétaux.
   *
   * Les angles sont en DEGRÉS, 0 = est, croissant dans le sens
   * trigonométrique — la convention de `GardenCoordinate`, et non
   * celle du canvas, dont l'axe y descend.
   */
  sprinklerRadiusMeters: number | null;
  sprinklerStartAngleDegrees: number | null;
  sprinklerEndAngleDegrees: number | null;
  sprinklerFlowRateLitersPerHour: number | null;
};

/** Une plante réelle de CE jardin, proposée au rattachement. */
export type LinkablePlant = {
  id: string;
  customName: string;
  commonName: string | null;
  scientificName: string | null;
};

export type TwinArea = {
  id: string;
  areaType: AreaType;
  name: string;
  points: Point[];
};

// ---------------------------------------------------------------
// Réseaux — §"IRRIGATION DIGITAL TWIN" et §LIGHTING
// ---------------------------------------------------------------

/**
 * « Un tuyau n'est PAS une simple ligne graphique. »
 *
 * Valeurs recopiées telles quelles depuis `PipeLineType.swift` et
 * `PipeMaterial.swift` : l'iPhone lit la même table depuis la Phase 6D.
 */
export const PIPE_LINE_TYPES = ["mainSupply", "secondary", "dripLine"] as const;
export type PipeLineType = (typeof PIPE_LINE_TYPES)[number];

export const PIPE_MATERIALS = ["pe", "pvc", "other"] as const;
export type PipeMaterial = (typeof PIPE_MATERIALS)[number];

export const PIPE_LINE_TYPE_LABELS: Record<PipeLineType, string> = {
  mainSupply: "Alimentation principale",
  secondary: "Secondaire",
  dripLine: "Goutte-à-goutte",
};

export const PIPE_MATERIAL_LABELS: Record<PipeMaterial, string> = {
  pe: "PE",
  pvc: "PVC",
  other: "Autre",
};

/**
 * Trait de chaque type de conduite. Le tireté reprend celui de
 * `PipeLineType.dashPattern` côté Swift, pour que le même réseau se lise
 * pareil sur les deux écrans — et parce qu'un trait plein, tireté ou
 * pointillé reste lisible là où la seule couleur ne suffit pas.
 */
export const PIPE_STYLE: Record<PipeLineType, { color: string; width: number; dash: number[] }> = {
  mainSupply: { color: "#2f6fb5", width: 3, dash: [] },
  secondary: { color: "#2f93b5", width: 2, dash: [6, 3] },
  dripLine: { color: "#2f9c92", width: 1.5, dash: [1, 3] },
};

export type TwinPipe = {
  id: string;
  points: Point[];
  diameterMM: number;
  material: PipeMaterial;
  lineType: PipeLineType;
  startNodeObjectId: string | null;
  endNodeObjectId: string | null;
};

/**
 * §LIGHTING. Nouveau côté web (table `garden_cables`, migration 0047) :
 * l'iPhone n'a pas encore de modèle pour les câbles, contrairement aux
 * tuyaux. Un câble tracé ici ne s'affichera donc pas encore sur le
 * téléphone — la ligne est bien écrite, seulement pas encore lue.
 */
export const CABLE_TYPES = ["lowVoltage", "mains", "other"] as const;
export type CableType = (typeof CABLE_TYPES)[number];

export const CABLE_TYPE_LABELS: Record<CableType, string> = {
  lowVoltage: "Très basse tension",
  mains: "Secteur 230 V",
  other: "Autre",
};

export const CABLE_STYLE: Record<CableType, { color: string; width: number; dash: number[] }> = {
  lowVoltage: { color: "#b58a2f", width: 2, dash: [4, 3] },
  mains: { color: "#a8532f", width: 2.5, dash: [] },
  other: { color: "#8a7a5a", width: 1.5, dash: [2, 3] },
};

export type TwinCable = {
  id: string;
  points: Point[];
  cableType: CableType;
  sectionMM2: number | null;
  startNodeObjectId: string | null;
  endNodeObjectId: string | null;
};

export type TwinBoundary = {
  id: string;
  points: Point[];
};

export type TwinDocument = {
  gardenId: string;
  gardenName: string;
  /** Origine du repère local. Sans elle, aucun fond satellite possible. */
  latitude: number | null;
  longitude: number | null;
  boundary: TwinBoundary | null;
  areas: TwinArea[];
  objects: TwinObject[];
  pipes: TwinPipe[];
  cables: TwinCable[];
};

// ---------------------------------------------------------------
// Calques — §"CALQUES", repris de GardenMapLayer.swift
// ---------------------------------------------------------------

/**
 * Les calques que le web sait réellement éteindre et allumer.
 *
 * L'enum Swift en compte seize, mais la moitié gouverne des données que
 * l'éditeur web n'affiche pas encore (santé, humidité, température,
 * consommation, alertes, interventions, QR/NFC). Un interrupteur qui ne
 * change rien à l'écran est pire que son absence : il fait douter de
 * tous les autres. Les noms des calques communs sont ceux de Swift, à
 * l'identique, pour que les deux produits parlent de la même chose.
 *
 * `areas` et `coverage` n'existent pas côté iOS : le premier parce que
 * l'iPhone n'a pas d'outil de dessin de zones à masquer, le second parce
 * que la couverture d'arrosage est une vue propre à cet éditeur.
 */
export const MAP_LAYERS = [
  "vegetation", "canopies", "areas",
  "irrigation", "coverage",
  "sensorsLayer", "devices",
  "constructions", "amenities", "biodiversity",
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

export const LAYER_LABELS: Record<MapLayer, string> = {
  vegetation: "Végétaux",
  canopies: "Houppiers",
  areas: "Zones",
  irrigation: "Irrigation",
  coverage: "Couverture d'arrosage",
  sensorsLayer: "Capteurs",
  devices: "Éclairage et électricité",
  constructions: "Constructions",
  amenities: "Aménagements",
  biodiversity: "Biodiversité",
};

/**
 * Quels types d'objets chaque calque gouverne — copie de
 * `GardenMapLayer.gatedObjectTypes`. Les calques absents d'ici agissent
 * autrement (les houppiers changent le dessin, la couverture ajoute les
 * arcs, les zones ne sont pas des objets).
 */
export const LAYER_OBJECT_TYPES: Partial<Record<MapLayer, ObjectType[]>> = {
  vegetation: ["plant", "tree", "palm", "shrub"],
  irrigation: ["waterSource", "valve", "pump", "filter", "sprinkler", "dripEmitter"],
  sensorsLayer: ["sensor"],
  devices: ["light", "electricalPoint"],
  constructions: ["house", "wall", "fence", "stairs"],
  amenities: ["terrace", "pool", "pond", "greenhouse", "path", "rock", "decorativeObject", "custom"],
  biodiversity: ["birdhouse", "insectHotel", "wildlifeWaterPoint", "pollinatorZone", "wildlifeRefuge"],
};

/** Le calque qui gouverne un type d'objet, ou `null` s'il est toujours visible. */
export function layerForObjectType(type: ObjectType): MapLayer | null {
  for (const [layer, types] of Object.entries(LAYER_OBJECT_TYPES)) {
    if (types?.includes(type)) return layer as MapLayer;
  }
  return null;
}

/**
 * §"PROFILS DE CALQUES" — un clic au lieu de dix interrupteurs.
 *
 * Le profil « Santé » de l'app iPhone n'est pas repris : il repose sur
 * l'état sanitaire des végétaux, que cet éditeur n'affiche pas encore.
 */
export const LAYER_PROFILES = {
  normal: {
    label: "Vue normale",
    layers: ["vegetation", "canopies", "areas", "constructions", "amenities"],
  },
  watering: {
    label: "Arrosage",
    layers: ["vegetation", "areas", "irrigation", "coverage"],
  },
  technical: {
    label: "Technique",
    layers: ["irrigation", "devices", "sensorsLayer", "constructions"],
  },
  sensors: {
    label: "Capteurs",
    layers: ["sensorsLayer", "areas"],
  },
} as const satisfies Record<string, { label: string; layers: readonly MapLayer[] }>;

export type LayerProfile = keyof typeof LAYER_PROFILES;

/**
 * Tout est allumé au départ, sauf la couverture d'arrosage : les arcs
 * des arroseurs se recouvrent largement et masqueraient le plan qu'on
 * vient d'ouvrir. C'est une vue de vérification, pas une vue de travail.
 */
export const DEFAULT_LAYERS: Record<MapLayer, boolean> = Object.fromEntries(
  MAP_LAYERS.map((l) => [l, l !== "coverage"]),
) as Record<MapLayer, boolean>;

/**
 * §"VERSIONS DU PROJET". Ces libellés vivent ici et non dans
 * `actions.ts` : un fichier `"use server"` ne peut exporter que des
 * fonctions async, jamais un objet.
 */
export type RevisionState = "existing" | "proposal" | "approved" | "asBuilt";

export const REVISION_STATE_LABELS: Record<RevisionState, string> = {
  existing: "Existant",
  proposal: "Projet",
  approved: "Validé",
  asBuilt: "Réalisé",
};

export type RevisionSummary = {
  id: string;
  label: string;
  state: RevisionState;
  createdAt: string;
  objectCount: number;
  areaCount: number;
};

/**
 * Plan importé sous le jumeau numérique.
 *
 * Le calibrage est stocké en PIXELS de l'image : deux repères sur le
 * document scanné, plus la distance réelle qui les sépare. L'échelle
 * (`metersPerPixel`) en découle — voir `planScale`. Stocker directement
 * une échelle empêcherait de la recalculer si l'utilisateur corrige un
 * de ses deux points.
 */
export type PlanCalibration = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  realDistanceMeters: number;
};

export type PlanImage = {
  id: string;
  /** URL signée, valable une heure. Nulle si la signature a échoué. */
  url: string | null;
  positionX: number;
  positionY: number;
  rotationRadians: number;
  opacity: number;
  isVisible: boolean;
  calibration: PlanCalibration | null;
  originalFilename: string | null;
};

/**
 * Mètres par pixel d'image. `null` tant que le plan n'est pas calibré —
 * et dans ce cas il ne doit surtout pas être dessiné à une échelle
 * inventée, sous peine de faire mesurer un terrain sur un plan faux.
 */
export function planScale(calibration: PlanCalibration | null): number | null {
  if (!calibration) return null;
  const pixels = Math.hypot(
    calibration.bx - calibration.ax,
    calibration.by - calibration.ay,
  );
  if (pixels <= 0 || calibration.realDistanceMeters <= 0) return null;
  return calibration.realDistanceMeters / pixels;
}

export type MapMode = "oasisPlan" | "satellite" | "hybrid" | "standard";

export const MAP_MODE_LABELS: Record<MapMode, string> = {
  oasisPlan: "Plan Oasis",
  satellite: "Satellite",
  hybrid: "Hybride",
  standard: "Standard",
};
