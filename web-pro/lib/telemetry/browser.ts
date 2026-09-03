import {
  markDeclared,
  readInstallId,
  shouldDeclare,
  type WebStorage,
} from "./install.ts";
import { WEB_PRESENCE_ENABLED } from "./presence.ts";

/**
 * L'ANNONCE, CÔTÉ NAVIGATEUR.
 *
 * Six lignes utiles et beaucoup de retenue : décider s'il faut parler,
 * trouver l'identifiant, marquer, envoyer, se taire. Tout ce qui touche
 * `window` est concentré dans `browserEnv()` pour que la décision
 * elle-même soit vérifiable hors navigateur.
 */

/** Ce dont l'annonce a besoin du monde extérieur. Rien de plus. */
export interface PresenceEnv {
  session: WebStorage | null;
  local: WebStorage | null;
  now: () => number;
  /** Rend `null` si aucun aléa sûr n'est disponible. */
  newId: () => string | null;
}

/**
 * L'environnement réel, ou `null` hors navigateur.
 *
 * Chaque accès est protégé : lire `window.localStorage` LÈVE quand le
 * site n'a pas le droit de stocker (Firefox, cookies bloqués), avant
 * même qu'on ait appelé `getItem`. Un `try` autour du seul `getItem`
 * ne suffirait donc pas.
 */
export function browserEnv(): PresenceEnv | null {
  if (typeof window === "undefined") return null;

  return {
    session: storageOrNull(() => window.sessionStorage),
    local: storageOrNull(() => window.localStorage),
    now: () => Date.now(),
    newId: randomInstallId,
  };
}

/**
 * Annonce la présence de cette installation, au plus une fois par
 * session d'onglet et par heure.
 *
 * NE LÈVE JAMAIS, quoi qu'il arrive en aval. C'est un effet de bord
 * déclenché depuis la coquille de l'application : une promesse rejetée
 * ici deviendrait une erreur non capturée sur toutes les pages du
 * produit, pour une information dont personne n'attend rien.
 *
 * `declare` est passée en paramètre — c'est la Server Action en
 * production, une fonction d'essai dans les tests. Ce module ne connaît
 * donc ni Supabase, ni le nom de la fonction en base.
 */
export async function announceWebPresence(
  declare: (installId: string) => Promise<void>,
  env: PresenceEnv | null = browserEnv(),
  // Le drapeau est un PARAMÈTRE avec une valeur par défaut, et pas une
  // lecture directe de la constante, pour une seule raison : les tests
  // doivent pouvoir éprouver la mécanique complète (identifiant,
  // limitation de fréquence, silence en cas d'échec) le jour où on
  // l'allumera, sans quoi elle serait allumée sans avoir jamais été
  // vérifiée. Le code de production, lui, ne passe jamais ce paramètre.
  enabled: boolean = WEB_PRESENCE_ENABLED,
): Promise<void> {
  // LE DRAPEAU EST TESTÉ AVANT TOUT LE RESTE, ET AVANT `env`. Il n'y a
  // pas encore de `declare_web_presence` en base ; tant qu'il n'y en a
  // pas, cette fonction ne doit RIEN faire — et surtout pas la première
  // chose qu'elle ferait, qui est de ranger un identifiant
  // d'installation dans le `localStorage` de chaque utilisateur.
  // Stocker une donnée personnelle qui ne répond à aucune question,
  // c'est ce que la minimisation interdit. Voir `presence.ts`.
  if (!enabled) return;
  if (!env) return;

  try {
    const now = env.now();
    if (!shouldDeclare(env.session, env.local, now)) return;

    const installId = readInstallId(env.local, env.newId);
    // Pas d'identifiant stable : on se tait. `install.ts` explique
    // pourquoi une installation inventée serait pire qu'un trou.
    if (!installId) return;

    // AVANT l'envoi. Si la base ne répond pas — et elle ne répondra pas
    // tant que `declare_web_presence` n'existe pas —, marquer après
    // coup relancerait une tentative à chaque navigation.
    markDeclared(env.session, env.local, now);

    await declare(installId);
  } catch {
    // Y compris ce que `declare` rejette : voir plus haut.
  }
}

/**
 * Un UUID, et rien d'autre.
 *
 * `crypto.randomUUID` n'existe qu'en contexte sécurisé (HTTPS, ou
 * `localhost`) ; `getRandomValues` y est disponible plus largement. Si
 * ni l'un ni l'autre n'est là, on rend `null` : `Math.random()` ferait
 * l'affaire techniquement, mais un identifiant tiré d'un générateur
 * prévisible est un identifiant qu'un tiers peut deviner, donc
 * réattribuer.
 *
 * Aucune de ces deux fonctions ne lit quoi que ce soit de la machine :
 * l'identifiant est un tirage, pas une mesure. C'est toute la
 * différence avec une empreinte.
 */
function randomInstallId(): string | null {
  try {
    if (typeof crypto === "undefined") return null;
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // Un navigateur qui refuse l'aléa refuse la télémétrie. Soit.
  }
  return null;
}

function storageOrNull(read: () => Storage): WebStorage | null {
  try {
    const store = read();
    // Un test d'écriture réel : Safari en navigation privée expose bien
    // un objet `Storage`, et ne lève qu'au moment du `setItem`. Sans
    // cette sonde, on croirait le stockage disponible.
    const probe = "oasis.presence.probe";
    store.setItem(probe, "1");
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}
