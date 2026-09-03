import { isDeclarable, type WebPresence } from "./presence.ts";

/**
 * LE SILENCE, CÔTÉ SERVEUR.
 *
 * L'écriture réelle est passée en paramètre plutôt qu'importée : ce
 * fichier ne connaît ni Supabase, ni `next/headers`, ni cookies. C'est
 * ce qui permet de vérifier LA SEULE PROPRIÉTÉ QUI COMPTE ICI — qu'un
 * échec ne remonte jamais — par un test qui n'a besoin d'aucun serveur.
 *
 * Pourquoi cette propriété est la seule qui compte : cette déclaration
 * part d'une Server Action appelée par la coquille de l'application. Si
 * elle rejetait, l'erreur remonterait dans le rendu client de CHAQUE
 * page — une bannière rouge, ou pire, une limite d'erreur qui avale
 * l'écran — pour une information dont personne n'attend rien. Une
 * télémétrie qui casse le produit qu'elle mesure est pire que pas de
 * télémétrie.
 */

/** Ce que fait vraiment l'écriture. Doit lever en cas d'échec. */
export type PresenceWriter = (presence: WebPresence) => Promise<void>;

/**
 * Déclare, et n'échoue jamais.
 *
 * Ne rend rien, exprès : il n'y a rien à attendre d'elle, et rendre un
 * booléen inviterait un appelant à en faire quelque chose — un message,
 * une nouvelle tentative, une branche de code qui n'a aucune raison
 * d'exister. `declare_mobile_presence` rend `void` pour la même raison.
 *
 * Le contrôle de complétude passe AVANT l'envoi : une déclaration
 * incomplète serait refusée par la base, et dépenser une requête pour
 * se faire dire non n'apprend rien à personne.
 */
export async function declareQuietly(
  write: PresenceWriter,
  presence: WebPresence,
): Promise<void> {
  if (!isDeclarable(presence)) return;

  try {
    await write(presence);
  } catch {
    // Rien. Pas de `console.error` non plus : tant que la fonction
    // `declare_web_presence` n'existe pas en base (0077 ne connaît que
    // 'ios' — voir `presence.ts`), CHAQUE appel échoue. Journaliser
    // remplirait les traces du serveur d'une erreur attendue, et la
    // vraie panne du jour se perdrait dedans.
  }
}
