import "server-only";

import { redirect } from "next/navigation";

import { requireAdmin, type AdminIdentity } from "@/lib/auth/guard";

import { type PermissionCourrier } from "./permissions.ts";

/**
 * ==================================================================
 * LA GARDE DES ÉCRANS DE COURRIER
 * ==================================================================
 *
 * Elle fait exactement ce que `requireAdmin(permission)` fait, et pour
 * une seule raison elle le refait à la main : `requireAdmin` n'accepte
 * qu'une `PlatformPermission`, et `lib/auth/roles.ts` — qui appartient à
 * un autre périmètre — ne connaît pas encore les six clés `emails.*`
 * posées par 0084. Voir l'en-tête de `permissions.ts`.
 *
 * L'ORDRE EST LE MÊME, ET IL COMPTE :
 *   1. `requireAdmin()` sans argument fait l'essentiel — identité
 *      vérifiée auprès du serveur Auth (jamais le cookie seul), fiche
 *      `platform_admins` lue en base, second facteur si la politique
 *      l'exige, et un 404 pour qui n'est pas des nôtres. Un 404, pas un
 *      403 : un « accès refusé » apprendrait à un curieux qu'il y a
 *      quelque chose à voir.
 *   2. La permission ensuite, contre `admin.permissions` — qui vient de
 *      `admin_me()`, donc de la base, jamais d'une liste écrite dans ce
 *      dépôt.
 *   3. Et pour un administrateur légitime au rôle trop étroit, la même
 *      redirection que `requireAdmin` : `/role-insuffisant`, avec le nom
 *      de la permission. Il sait déjà que le Control Center existe — il
 *      y est — lui répondre 404 le ferait douter de l'application au
 *      lieu de sa permission.
 *
 * CE QUI PROTÈGE VRAIMENT EST AILLEURS, et il ne faut pas s'y tromper :
 * chaque fonction de 0084 recommence le contrôle en SQL
 * (`if not public.platform_admin_can('emails.…') then raise`), puis
 * exige le second facteur, puis un motif non vide. Cette garde-ci rend
 * le refus LISIBLE ; celle de la base est celle qu'aucun remaniement de
 * TypeScript ne peut déplacer.
 *
 * ATTENTION À CE QU'ELLE NE COUVRE PAS : `/role-insuffisant` affichera
 * la clé brute (`emails.campaigns.send`) au lieu d'un libellé, parce
 * que `permissionLabel()` retombe sur la chaîne pour une clé hors
 * catalogue. C'est laid et honnête ; ce sera réparé le jour où les six
 * clés entreront dans `lib/auth/roles.ts`.
 */
export async function requireCourrier(permission: PermissionCourrier): Promise<AdminIdentity> {
  const admin = await requireAdmin();

  if (!admin.permissions.includes(permission)) {
    redirect(`/role-insuffisant?permission=${encodeURIComponent(permission)}`);
  }

  return admin;
}

/**
 * La même question en booléen, pour décider d'AFFICHER un bouton.
 *
 * UN BOUTON CACHÉ N'EST PAS UNE SÉCURITÉ : la Server Action qu'il
 * déclenche refait le contrôle, et la fonction SQL derrière elle aussi.
 * Ici, on ne fait que ne pas promettre ce qui sera refusé.
 */
export function peut(admin: AdminIdentity, permission: PermissionCourrier): boolean {
  return admin.permissions.includes(permission);
}
