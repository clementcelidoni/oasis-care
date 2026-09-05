import "server-only";

import { can, requireAdmin, type AdminIdentity } from "@/lib/auth/guard";

import { type PermissionAssistance } from "./permissions.ts";

/**
 * ==================================================================
 * LA GARDE DES ÉCRANS D'ASSISTANCE — un alias, et rien de plus
 * ==================================================================
 *
 * `requireAdmin(permission)` FAIT DÉJÀ TOUT, dans le bon ordre :
 *
 *   1. l'identité, vérifiée auprès du serveur Auth — jamais le cookie
 *      seul ;
 *   2. la fiche `platform_admins`, lue en base ;
 *   3. le second facteur, si la politique l'exige ;
 *   4. un 404 pour qui n'est pas des nôtres — pas un 403, qui
 *      apprendrait qu'il y a quelque chose à voir ;
 *   5. une redirection vers `/role-insuffisant` pour l'administrateur
 *      légitime au rôle trop étroit, avec le nom de la permission.
 *
 * Ces deux fonctions n'ajoutent donc RIEN : elles resserrent le type.
 * `PermissionAssistance` est le sous-ensemble des quatre clés qui
 * commandent ces écrans, et le compilateur refuse ici une permission
 * qui n'en fait pas partie — un `platform.users.read` collé par erreur
 * dans la page des sessions d'accès ouvrirait l'écran le plus sensible
 * du produit à un rôle qui n'a rien à y faire, et rien ne le
 * signalerait.
 *
 * ------------------------------------------------------------------
 * ET LA BARRIÈRE QUI COMPTE VRAIMENT EST AILLEURS
 * ------------------------------------------------------------------
 * Chaque fonction d'écriture de 0081 recommence le contrôle en SQL —
 * `if not public.platform_admin_can('support.sessions.manage') then
 * raise` —, exige le second facteur, puis un motif non vide. Et pour
 * l'accès sous session, `support_session_record_access()` revérifie la
 * propriété, la révocation, L'EXPIRATION et le consentement à CHAQUE
 * usage. Cette garde-ci rend le refus LISIBLE ; celles de la base sont
 * celles qu'aucun remaniement de TypeScript ne peut déplacer.
 */
export async function requireAssistance(
  permission: PermissionAssistance,
): Promise<AdminIdentity> {
  return requireAdmin(permission);
}

/**
 * La même question en booléen, pour décider d'AFFICHER un bouton.
 *
 * UN BOUTON CACHÉ N'EST PAS UNE SÉCURITÉ : la Server Action qu'il
 * déclenche refait le contrôle, et la fonction SQL derrière elle aussi.
 * Ici, on ne fait que ne pas promettre ce qui sera refusé.
 */
export function peut(admin: AdminIdentity, permission: PermissionAssistance): boolean {
  return can(admin, permission);
}
