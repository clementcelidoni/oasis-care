import {
  isPlatformPermission,
  permissionLabel,
  type PlatformPermission,
} from "@/lib/auth/roles";

/**
 * ==================================================================
 * LES PERMISSIONS QUI COMMANDENT LES ÉCRANS D'ASSISTANCE
 * ==================================================================
 *
 * CE FICHIER NE DÉCLARE AUCUNE PERMISSION. Le catalogue vit en base
 * (`platform_admin_permissions`), son miroir TypeScript vit dans
 * `lib/auth/roles.ts`, et il n'en existe pas de troisième. Un second
 * vocabulaire — même recopié mot pour mot le jour où on l'écrit —
 * diverge au premier correctif, et un administrateur qui lit deux
 * libellés différents pour la même clé croit à deux droits.
 *
 * On trouve ici un SOUS-ENSEMBLE typé et une seule information que le
 * catalogue ne porte pas : qui porte quoi, pour pouvoir le dire quand
 * un geste est refusé.
 */

/**
 * Les quatre clés de l'assistance, toutes introduites par 0081.
 *
 * ELLES SE SÉPARENT EN DEUX PAIRES, ET LA SÉPARATION EST LE SUJET :
 * lire une demande n'est pas y répondre au nom d'Oasis Care, et VOIR
 * les sessions d'accès n'est pas EN OUVRIR. La seconde distinction est
 * celle que la migration 0081 § 1.c applique en donnant
 * `support.sessions.read` au responsable sécurité SANS
 * `support.sessions.manage` : il surveille, il ne fait pas.
 */
export const PERMISSIONS_ASSISTANCE = [
  "support.tickets.read",
  "support.tickets.write",
  "support.sessions.read",
  "support.sessions.manage",
] as const satisfies readonly PlatformPermission[];

export type PermissionAssistance = (typeof PERMISSIONS_ASSISTANCE)[number];

/**
 * Les quatre clés arrivent TOUTES avec 0081 : leur absence du catalogue
 * date la base sans ambiguïté. C'est ce qui permet à `socle.ts` de dire
 * « la migration manque » plutôt que « votre rôle est trop étroit ».
 */
export const PERMISSIONS_NEUVES_0081 = PERMISSIONS_ASSISTANCE;

/**
 * Quel rôle porte quoi, d'après le SEMIS de 0081 § 1.c.
 *
 * LA SOURCE DE VÉRITÉ RESTE LA BASE : cette carte est datée du semis et
 * ne suit pas les modifications ultérieures de la matrice. Elle sert à
 * une seule chose, et elle vaut son approximation — dire « il vous
 * manque support.sessions.manage » sans dire QUI la porte oblige à
 * chercher la réponse ailleurs, c'est-à-dire à ouvrir un ticket.
 */
export const ROLES_PORTEURS: Record<PermissionAssistance, readonly string[]> = {
  "support.tickets.read": ["super_admin", "support"],
  "support.tickets.write": ["super_admin", "support"],
  // Le responsable sécurité SURVEILLE les sessions sans pouvoir en
  // ouvrir. C'est la ligne de partage de tout ce module.
  "support.sessions.read": ["super_admin", "support", "security_admin"],
  "support.sessions.manage": ["super_admin", "support"],
};

export function estPermissionAssistance(valeur: unknown): valeur is PermissionAssistance {
  return (
    typeof valeur === "string" &&
    (PERMISSIONS_ASSISTANCE as readonly string[]).includes(valeur)
  );
}

/**
 * La phrase qu'on affiche à la place d'un bouton refusé.
 *
 * Elle nomme la permission, ce qu'elle ouvre — le libellé vient du
 * catalogue, pas d'ici — et les rôles qui la portent. Un refus qui ne
 * dit pas comment l'obtenir se transforme en ticket.
 */
export function phraseDeRefus(role: string, permission: PermissionAssistance): string {
  const libelle = isPlatformPermission(permission) ? permissionLabel(permission) : permission;
  return (
    `Le rôle « ${role} » ne porte pas la permission ${permission} — ` +
    `${libelle.charAt(0).toLowerCase()}${libelle.slice(1)}. ` +
    `Au semis de 0081, elle appartient à : ${ROLES_PORTEURS[permission].join(", ")}.`
  );
}
