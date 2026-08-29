import type { Point } from "./geometry";

/**
 * Fond cartographique raster (tuiles XYZ).
 *
 * §"FOND CARTOGRAPHIQUE" : « préférer une architecture indépendante du
 * fournisseur… Le fournisseur de tuiles doit pouvoir être changé. NE PAS
 * enfermer les données Digital Twin dans un format propriétaire Mapbox. »
 *
 * Le fond est donc purement décoratif : aucune donnée du jumeau
 * numérique ne transite par le fournisseur, et changer d'URL suffit à en
 * changer. Les objets restent stockés en mètres locaux, jamais en
 * coordonnées de tuiles.
 *
 * §SECURITY : « aucun secret fournisseur cartographique privé exposé. »
 * Le fournisseur par défaut ne demande AUCUNE clé. Si vous passez à un
 * service qui en exige une, elle ne doit pas arriver ici — il faudra un
 * relais côté serveur, sinon la clé part dans le navigateur de chaque
 * visiteur.
 */

export type TileProvider = {
  id: string;
  label: string;
  urlTemplate: string;
  attribution: string;
  maxZoom: number;
};

/**
 * Orthophotographies de l'IGN, sans clé depuis l'ouverture de la
 * Géoplateforme. Choisi par défaut parce que l'app vise des paysagistes
 * français : la résolution sur la France y est bien meilleure que celle
 * des fonds mondiaux.
 */
export const IGN_ORTHO: TileProvider = {
  id: "ign",
  label: "IGN — orthophotographies",
  urlTemplate:
    "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
    "&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM" +
    "&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
  attribution: "© IGN / Géoplateforme",
  maxZoom: 19,
};

/** Repli mondial, pour un terrain hors de France. */
export const ESRI_WORLD_IMAGERY: TileProvider = {
  id: "esri",
  label: "Esri World Imagery",
  urlTemplate:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "© Esri, Maxar, Earthstar Geographics",
  maxZoom: 19,
};

export const TILE_PROVIDERS = [IGN_ORTHO, ESRI_WORLD_IMAGERY];

/**
 * Fournisseur actif. Surchargeable sans toucher au code — c'est ce que
 * demande « le fournisseur doit pouvoir être changé ».
 */
export function activeProvider(): TileProvider {
  const url = process.env.NEXT_PUBLIC_TILE_URL_TEMPLATE;
  if (url) {
    return {
      id: "custom",
      label: process.env.NEXT_PUBLIC_TILE_LABEL ?? "Fond personnalisé",
      urlTemplate: url,
      attribution: process.env.NEXT_PUBLIC_TILE_ATTRIBUTION ?? "",
      maxZoom: Number(process.env.NEXT_PUBLIC_TILE_MAX_ZOOM ?? 19),
    };
  }
  const id = process.env.NEXT_PUBLIC_TILE_PROVIDER;
  return TILE_PROVIDERS.find((p) => p.id === id) ?? IGN_ORTHO;
}

// ---------------------------------------------------------------
// Géoréférencement
// ---------------------------------------------------------------

/**
 * Conversion mètres locaux ↔ WGS84, identique à
 * `GardenCoordinateSystem` côté Swift : approximation par plan tangent.
 *
 * Précise au centimètre à l'échelle d'un jardin (bien moins d'un
 * kilomètre), et fausse sur des dizaines de kilomètres — ce qu'un
 * jardin n'atteint jamais. Utiliser la même approximation que l'app iOS
 * garantit surtout que les deux affichent le même objet au même endroit.
 */
const METERS_PER_DEGREE_LATITUDE = 111_320;

export type GeoOrigin = { latitude: number; longitude: number };

export function localToGeographic(p: Point, origin: GeoOrigin) {
  const metersPerDegreeLongitude =
    METERS_PER_DEGREE_LATITUDE * Math.cos((origin.latitude * Math.PI) / 180);
  return {
    latitude: origin.latitude + p.yMeters / METERS_PER_DEGREE_LATITUDE,
    longitude: origin.longitude + p.xMeters / metersPerDegreeLongitude,
  };
}

export function geographicToLocal(
  coord: { latitude: number; longitude: number },
  origin: GeoOrigin,
): Point {
  const metersPerDegreeLongitude =
    METERS_PER_DEGREE_LATITUDE * Math.cos((origin.latitude * Math.PI) / 180);
  return {
    xMeters: (coord.longitude - origin.longitude) * metersPerDegreeLongitude,
    yMeters: (coord.latitude - origin.latitude) * METERS_PER_DEGREE_LATITUDE,
  };
}

// ---------------------------------------------------------------
// Tuiles Web Mercator
// ---------------------------------------------------------------

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z);
}

export function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z)
  );
}

export function tileXToLon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Niveau de zoom dont la résolution colle le mieux à l'échelle
 * actuelle. Un niveau trop bas donne une image floue, trop haut fait
 * télécharger des centaines de tuiles pour rien.
 */
export function bestZoom(
  pixelsPerMeter: number,
  latitude: number,
  maxZoom: number,
): number {
  // Résolution d'une tuile de 256 px au niveau z, en mètres/pixel.
  const equatorMeters = 40_075_016.686;
  const cos = Math.cos((latitude * Math.PI) / 180);
  for (let z = maxZoom; z >= 1; z--) {
    const metersPerPixel = (equatorMeters * cos) / (256 * Math.pow(2, z));
    if (1 / metersPerPixel <= pixelsPerMeter * 2) return z;
  }
  return 1;
}

export function buildTileUrl(provider: TileProvider, x: number, y: number, z: number): string {
  return provider.urlTemplate
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace("{z}", String(z));
}
