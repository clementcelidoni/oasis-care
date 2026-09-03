import {
  FACTEUR_SINUOSITE,
  VITESSES_MOYENNES_KMH,
  type Coordonnees,
} from "./types.ts";

/**
 * §11V — la géométrie du trajet, et rien d'autre.
 *
 * AUCUN DISTANCIER N'EST INTERROGÉ ICI. Pas de Google Distance Matrix,
 * pas de Mapbox, pas de clé. Ce qu'on sait faire, c'est une distance à
 * vol d'oiseau entre deux points, corrigée d'un facteur de détour
 * documenté (`FACTEUR_SINUOSITE`). Le résultat est une ESTIMATION, et
 * tout ce qui sort d'ici le porte écrit.
 *
 * La différence entre une estimation et une mesure n'est pas une
 * nuance de vocabulaire : elle décide si un patron a le droit de
 * refacturer le déplacement au client sur la foi de ce chiffre. Il n'a
 * pas le droit. Il a le droit de s'en servir pour repérer un devis
 * sous-chiffré, ce qui est exactement l'usage que la spec en fait.
 */

/** Rayon moyen de la Terre, en kilomètres (sphère IUGG). */
const RAYON_TERRE_KM = 6371.0088;

const enRadians = (degres: number) => (degres * Math.PI) / 180;

/**
 * La distance orthodromique entre deux points, en kilomètres.
 *
 * Formule de haversine plutôt que loi des cosinus : sur des distances
 * de quelques kilomètres — le cas courant d'un chantier — la seconde
 * perd sa précision dans les erreurs d'arrondi en virgule flottante.
 */
export function distanceVolDoiseauKm(a: Coordonnees, b: Coordonnees): number {
  const dLat = enRadians(b.latitude - a.latitude);
  const dLon = enRadians(b.longitude - a.longitude);
  const lat1 = enRadians(a.latitude);
  const lat2 = enRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * RAYON_TERRE_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Arrondi au dixième de kilomètre : la précision que l'estimation mérite. */
export function arrondirKm(km: number): number {
  return Math.round(km * 10) / 10;
}

/**
 * La distance routière estimée : le vol d'oiseau, allongé du facteur de
 * détour.
 */
export function distanceRoutiereEstimeeKm(a: Coordonnees, b: Coordonnees): number {
  return arrondirKm(distanceVolDoiseauKm(a, b) * FACTEUR_SINUOSITE);
}

/**
 * La vitesse moyenne retenue pour une distance donnée.
 *
 * Rendue à part parce qu'elle doit apparaître dans la sortie : un temps
 * de trajet estimé sans la vitesse qui l'a produit est indiscutable, et
 * un chiffre indiscutable est un chiffre qu'on ne corrige jamais.
 */
export function vitesseMoyenneKmH(km: number): number {
  for (const palier of VITESSES_MOYENNES_KMH) {
    if (km <= palier.jusquaKm) return palier.vitesseKmH;
  }
  // Inatteignable : le dernier palier va jusqu'à l'infini. On ne rend
  // pas 0 pour autant — une vitesse nulle produirait une durée infinie.
  return VITESSES_MOYENNES_KMH[VITESSES_MOYENNES_KMH.length - 1].vitesseKmH;
}

/** Le temps de trajet estimé, en minutes entières. */
export function dureeEstimeeMinutes(km: number): number {
  if (km <= 0) return 0;
  return Math.round((km / vitesseMoyenneKmH(km)) * 60);
}
