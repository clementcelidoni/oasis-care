import type { PlatformPermission } from "@/lib/auth/roles";

/**
 * ==================================================================
 * LES PERMISSIONS QUI COMMANDENT LE CENTRE DE SÉCURITÉ
 * ==================================================================
 *
 * Comme ailleurs, ce fichier ne DÉCLARE rien : le catalogue vit en base
 * et son miroir TypeScript dans `lib/auth/roles.ts`. On ne fait ici que
 * resserrer le type et nommer une décision.
 *
 * ------------------------------------------------------------------
 * LA DÉCISION : LE CENTRE DE SÉCURITÉ S'OUVRE SUR `platform.audit.read`
 * ------------------------------------------------------------------
 * Elle mérite d'être écrite, parce qu'un autre choix se défendait.
 *
 * Trois des six indicateurs de la spec p.29 se lisent dans
 * `admin_audit_events`, dont la politique de lecture (0075) exige
 * `platform.audit.read` — portée par le super-administrateur et le
 * responsable sécurité, et par eux seuls. Un écran ouvert plus
 * largement se serait donc vidé de sa moitié pour tous les autres
 * rôles, sans le dire.
 *
 * Le quatrième — les sessions d'assistance — demande
 * `support.sessions.read`, que le SUPPORT porte aussi. Il n'est pas
 * exclu pour autant : il a son propre écran, `/support/sessions`, où il
 * les ouvre et les ferme. Le centre de sécurité les SURVEILLE ; ce
 * n'est pas le même usage, et ce n'est pas le même rôle.
 *
 * Conséquence assumée, et visible à l'écran : un responsable sécurité
 * qui n'aurait pas `support.sessions.read` verrait le bloc « sessions
 * d'assistance » fermé plutôt qu'absent. Au semis de 0081 § 1.c il la
 * porte ; si la matrice change un jour, l'écran le dira au lieu de
 * faire disparaître la ligne.
 */

export const PERMISSION_CENTRE_SECURITE = "platform.audit.read" as const satisfies PlatformPermission;

/** Les sessions d'assistance, vues du côté surveillance. */
export const PERMISSION_SURVEILLANCE_SESSIONS =
  "support.sessions.read" as const satisfies PlatformPermission;

/** La liste des administrateurs, d'où vient la couverture du second facteur. */
export const PERMISSION_LISTE_ADMINS = "platform.admins.read" as const satisfies PlatformPermission;

/**
 * Quel rôle porte quoi, d'après le SEMIS de 0075 et 0081 § 1.c.
 *
 * La base fait foi ; cette carte sert à dire à quelqu'un COMMENT
 * obtenir ce qui lui manque, plutôt que de le laisser chercher.
 */
export const ROLES_PORTEURS: Record<string, readonly string[]> = {
  "platform.audit.read": ["super_admin", "security_admin"],
  "platform.admins.read": ["super_admin", "security_admin"],
  "support.sessions.read": ["super_admin", "support", "security_admin"],
};

export function phraseDeRefus(role: string, permission: string, ouvre: string): string {
  const porteurs = ROLES_PORTEURS[permission] ?? [];
  return (
    `Le rôle « ${role} » ne porte pas ${permission} : ${ouvre} reste fermé.` +
    (porteurs.length > 0 ? ` Cette permission appartient à : ${porteurs.join(", ")}.` : "")
  );
}
