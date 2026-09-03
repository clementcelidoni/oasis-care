import type { Coordonnees } from "./types.ts";

/**
 * §11V — situer une commune, sans distancier et sans clé.
 *
 * POURQUOI CE FICHIER EXISTE. Le siège de l'entreprise
 * (`business_organizations`) ne porte QUE une adresse postale : ni
 * latitude ni longitude. Le site du client en porte, mais elles sont
 * nulles sur toutes les fiches réelles d'aujourd'hui. Sans un point de
 * chaque côté, il n'y a pas de distance du tout — et l'écran ne
 * saurait afficher qu'un « inconnu » définitif.
 *
 * CE QU'ON INTERROGE, ET CE QU'ON N'ENVOIE PAS. La Base Adresse
 * Nationale (adresse.data.gouv.fr) est le service public français de
 * géocodage : gratuit, sans compte, sans clé, sans quota contractuel.
 * L'appel part du SERVEUR — le navigateur ne voit jamais cette URL.
 *
 * Et surtout : on ne lui envoie QUE le code postal et le nom de la
 * commune. Jamais le numéro et la rue du client, jamais son nom. Deux
 * raisons, et la seconde est la vraie :
 *
 *   — l'adresse d'un particulier est une donnée personnelle, et un
 *     calcul de distance interurbain n'a aucun besoin de la connaître
 *     à la porte près ;
 *   — la précision annoncée doit correspondre à la précision obtenue.
 *     Un point « centre de la commune » se DIT centre de commune. Une
 *     rue géocodée donnerait l'illusion d'un trajet mesuré, alors que
 *     le facteur de détour de 1,3 qu'on lui applique ensuite pèse bien
 *     plus lourd que l'écart entre la mairie et le portail.
 *
 * PANNE = INCONNU. Time-out, service indisponible, commune
 * introuvable : la fonction rend `null`, l'appelant rend « distance
 * inconnue », et personne n'affiche un zéro. Aucune exception ne
 * remonte : une fiche de devis ne doit pas tomber parce qu'un service
 * externe tousse.
 */

const RACINE_BAN = "https://api-adresse.data.gouv.fr/search/";
const DELAI_MAX_MS = 3000;

export type CommuneSituee = {
  coordonnees: Coordonnees;
  /** Le libellé rendu par la BAN : « Cannes », « Cagnes-sur-Mer ». */
  commune: string;
  codePostal: string | null;
};

/**
 * Un cache de processus, volontairement sans expiration.
 *
 * Le centre d'une commune ne bouge pas. Ce qui bouge, c'est le nombre
 * d'appels : sans cache, ouvrir dix devis du même client interroge dix
 * fois le même service pour le même résultat. Le cache meurt avec le
 * processus, ce qui est exactement la durée de vie souhaitable pour
 * une donnée qu'on peut toujours redemander.
 */
const cache = new Map<string, CommuneSituee | null>();

/**
 * Le centre d'une commune française, à partir de ce qu'on a d'elle.
 *
 * `commune` seule suffit ; le code postal, quand il existe, lève les
 * homonymies (il y a plusieurs Sainte-Marie en France).
 */
export async function situerCommune(
  commune: string | null,
  codePostal: string | null,
): Promise<CommuneSituee | null> {
  const nom = (commune ?? "").trim();
  const cp = (codePostal ?? "").trim();
  // Un code postal sans nom de commune ne suffit pas à la recherche
  // « municipality » de la BAN : on ne tente pas un appel voué à rien.
  if (nom.length < 2) return null;

  const cle = `${nom.toLowerCase()}|${cp}`;
  const enCache = cache.get(cle);
  if (enCache !== undefined) return enCache;

  const resultat = await interrogerBan(nom, cp);
  cache.set(cle, resultat);
  return resultat;
}

async function interrogerBan(nom: string, codePostal: string): Promise<CommuneSituee | null> {
  const url = new URL(RACINE_BAN);
  url.searchParams.set("q", nom);
  url.searchParams.set("type", "municipality");
  url.searchParams.set("limit", "1");
  if (codePostal) url.searchParams.set("postcode", codePostal);

  try {
    const reponse = await fetch(url, {
      signal: AbortSignal.timeout(DELAI_MAX_MS),
      headers: { Accept: "application/json" },
      // Le centre d'une commune est stable : on laisse le cache HTTP de
      // Next le garder une journée plutôt que de rappeler à chaque rendu.
      next: { revalidate: 86_400 },
    });
    if (!reponse.ok) return null;

    const corps: unknown = await reponse.json();
    const premier = lireReponseBan(corps);
    if (!premier) return null;
    return premier;
  } catch {
    // Réseau coupé, time-out, JSON illisible : on ne sait pas situer
    // cette commune, et c'est tout ce que l'appelant a besoin de savoir.
    return null;
  }
}

/**
 * La première entité du GeoJSON rendu par la BAN, validée à la main.
 *
 * Le corps vient d'un service externe : on ne le caste pas, on le
 * VÉRIFIE. Une latitude qui arriverait sous forme de chaîne
 * produirait, castée, une distance de NaN — c'est-à-dire un « — » à
 * l'écran sans que personne comprenne pourquoi.
 */
export function lireReponseBan(corps: unknown): CommuneSituee | null {
  if (typeof corps !== "object" || corps === null) return null;
  const features = (corps as { features?: unknown }).features;
  if (!Array.isArray(features) || features.length === 0) return null;

  const feature = features[0];
  if (typeof feature !== "object" || feature === null) return null;

  const geometry = (feature as { geometry?: unknown }).geometry;
  const properties = (feature as { properties?: unknown }).properties;
  if (typeof geometry !== "object" || geometry === null) return null;

  const coordinates = (geometry as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

  // GeoJSON range la longitude AVANT la latitude. L'inverser
  // placerait Cannes en Somalie, et la distance obtenue serait
  // parfaitement plausible pour qui ne regarde que le nombre.
  const longitude = coordinates[0];
  const latitude = coordinates[1];
  if (typeof longitude !== "number" || typeof latitude !== "number") return null;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const label = lireTexte(properties, "label");
  const postcode = lireTexte(properties, "postcode");

  return {
    coordonnees: { latitude, longitude },
    commune: label ?? "",
    codePostal: postcode,
  };
}

function lireTexte(source: unknown, champ: string): string | null {
  if (typeof source !== "object" || source === null) return null;
  const valeur = (source as Record<string, unknown>)[champ];
  return typeof valeur === "string" && valeur.trim() !== "" ? valeur.trim() : null;
}
