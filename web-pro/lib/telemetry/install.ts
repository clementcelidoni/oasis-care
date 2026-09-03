import { isValidInstallId } from "./presence.ts";

/**
 * L'IDENTIFIANT D'INSTALLATION, ET LA LIMITATION DE FRÉQUENCE.
 *
 * Deux responsabilités, un seul fichier, parce qu'elles partagent la
 * même matière : le stockage du navigateur, qui peut refuser de
 * répondre à tout moment.
 *
 * Rien ici ne touche `window` : tout passe par les deux stockages reçus
 * en paramètre. C'est ce qui rend ces fonctions vérifiables par
 * `node:test` sans navigateur — et, accessoirement, ce qui garantit
 * qu'aucune de ces lignes ne peut lire autre chose que ce qu'on lui a
 * donné.
 */

/**
 * La part de `Storage` qu'on utilise, et elle seule.
 *
 * Pas le type `Storage` du DOM : on ne veut ni `clear()`, ni `key()`,
 * ni `length`. Une interface étroite est ici une garantie de portée —
 * ce module ne peut pas énumérer ce que le site a stocké par ailleurs.
 */
export interface WebStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Rangé dans `localStorage` : il doit survivre à la fermeture. */
export const INSTALL_ID_KEY = "oasis.presence.install";

/** Rangé dans `sessionStorage` : une déclaration par session d'onglet. */
export const SESSION_FLAG_KEY = "oasis.presence.declared";

/** Rangé dans `localStorage` : l'heure de la dernière déclaration. */
export const LAST_DECLARED_KEY = "oasis.presence.last";

/**
 * Une heure, comme le `do update` de 0077.
 *
 * Le garde-fou du client et celui de la base ne font pas double
 * emploi : celui de la base protège la TABLE (pas de réécriture, pas de
 * WAL, pas d'index à rafraîchir), celui-ci protège le RÉSEAU (pas de
 * requête inutile). Aligner les deux durées évite le cas absurde où le
 * client envoie fidèlement une requête que la base jette à chaque fois.
 */
export const MIN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Lit l'identifiant d'installation, ou en tire un nouveau.
 *
 * Rend `null` — et c'est un CHOIX, pas un oubli — dans deux cas :
 *
 *   • le stockage est indisponible (navigation privée verrouillée,
 *     cookies et stockage refusés, `localStorage` qui lève sur un quota
 *     plein) ;
 *   • aucun générateur d'aléa sûr n'est disponible.
 *
 * Dans ces cas-là, ON NE DÉCLARE RIEN. La tentation serait de fabriquer
 * un identifiant volatile pour « ne pas perdre l'utilisateur » : ce
 * serait fabriquer une NOUVELLE installation à chaque chargement de
 * page, et le nombre d'installations web deviendrait un compteur de
 * visites déguisé. Un chiffre absent se corrige ; un chiffre gonflé se
 * croit.
 *
 * Conséquence assumée, à écrire dans l'écran comme 0077 l'a fait pour
 * l'iPhone : LE NOMBRE D'UTILISATEURS WEB EST UNE BORNE INFÉRIEURE.
 */
export function readInstallId(
  local: WebStorage | null,
  newId: () => string | null,
): string | null {
  if (!local) return null;

  // Une valeur abîmée (modifiée à la main, ou héritée d'un format
  // antérieur) est remplacée, pas réutilisée : elle n'identifie plus
  // rien et la base la refuserait de toute façon.
  const stored = safeGet(local, INSTALL_ID_KEY);
  if (isValidInstallId(stored)) return stored;

  const fresh = newId();
  if (!isValidInstallId(fresh)) return null;

  // Si l'écriture échoue, on ne rend pas l'identifiant : le garder
  // reviendrait à en tirer un autre au prochain chargement, donc à
  // compter une installation de plus à chaque page.
  return safeSet(local, INSTALL_ID_KEY, fresh) ? fresh : null;
}

/**
 * Faut-il déclarer maintenant ?
 *
 * DEUX VERROUS, qui répondent à deux questions différentes.
 *
 *   1. LA SESSION D'ONGLET (`sessionStorage`). « Une fois par session,
 *      pas à chaque navigation » : dans l'App Router, la coquille n'est
 *      pas remontée d'une page à l'autre, mais un rechargement complet,
 *      un lien externe ou un retour arrière la remontent. Sans ce
 *      drapeau, une matinée de travail vaudrait quelques dizaines
 *      d'appels pour une seule information, toujours la même. Il rattrape
 *      aussi le double montage des effets en développement (StrictMode).
 *
 *   2. LE DÉLAI (`localStorage`). Le drapeau de session ne survit pas à
 *      l'ouverture d'un nouvel onglet, et une personne qui travaille
 *      avec six onglets déclarerait six fois. Le délai, lui, est partagé
 *      par tous les onglets du même navigateur.
 *
 * Aucun des deux ne suffit seul : le premier ne voit pas les autres
 * onglets, le second ne verrouille rien si l'horloge du poste recule.
 */
export function shouldDeclare(
  session: WebStorage | null,
  local: WebStorage | null,
  now: number,
): boolean {
  if (session && safeGet(session, SESSION_FLAG_KEY) === "1") return false;

  const last = Number(safeGet(local, LAST_DECLARED_KEY));
  // `Number(null)` vaut 0 et `Number("bavardage")` vaut NaN : les deux
  // doivent laisser passer. Seule une date lisible et récente arrête.
  if (Number.isFinite(last) && last > 0 && now - last < MIN_INTERVAL_MS) {
    // Une horloge qui recule (changement d'heure, remise à l'heure du
    // poste) rendrait `now - last` négatif et bloquerait la déclaration
    // pendant des heures. On ne bloque que vers l'avenir.
    if (now >= last) return false;
  }

  return true;
}

/**
 * Note qu'on vient de déclarer.
 *
 * APPELÉE AVANT L'ENVOI, PAS APRÈS, et c'est le point important. Si la
 * base ne répond pas — fonction absente tant que la migration n'est pas
 * posée, réseau coupé, jeton expiré — marquer après coup ferait
 * repartir une tentative à chaque navigation, indéfiniment. Marquer
 * avant coûte au pire une déclaration perdue par heure ; marquer après
 * coûterait une requête par page pendant toute la panne.
 *
 * C'est le même arbitrage que côté iPhone : la télémétrie n'a pas le
 * droit de peser sur le produit, même quand elle échoue.
 */
export function markDeclared(
  session: WebStorage | null,
  local: WebStorage | null,
  now: number,
): void {
  if (session) safeSet(session, SESSION_FLAG_KEY, "1");
  if (local) safeSet(local, LAST_DECLARED_KEY, String(now));
}

/**
 * `localStorage` LÈVE. Ce n'est pas une hypothèse défensive : Safari en
 * navigation privée lève sur `setItem` (quota nul), Firefox lève sur
 * `getItem` quand le stockage du site est bloqué, et un quota plein
 * lève partout. Un `catch` vide serait suspect ailleurs ; ici, il est
 * la règle — aucune de ces pannes ne concerne l'utilisateur.
 */
function safeGet(store: WebStorage | null, key: string): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(store: WebStorage, key: string, value: string): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
