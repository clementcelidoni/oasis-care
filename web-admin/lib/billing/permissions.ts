import {
  isPlatformPermission,
  permissionLabel,
  type PlatformPermission,
} from "@/lib/auth/roles";

/**
 * ==================================================================
 * LES PERMISSIONS QUI COMMANDENT LES ÉCRANS COMMERCIAUX
 * ==================================================================
 *
 * CE FICHIER NE DÉCLARE AUCUNE PERMISSION, ET C'EST DÉLIBÉRÉ. Le
 * catalogue vit en base (`platform_admin_permissions`), son miroir
 * TypeScript vit dans `lib/auth/roles.ts`, et il n'en existe pas de
 * troisième. Un second vocabulaire — même bien intentionné, même
 * recopié mot pour mot le jour où on l'écrit — diverge au premier
 * correctif, et un administrateur qui lit « Fixer les prix » sur un
 * écran et « Gérer la tarification » sur un autre croit à deux droits.
 *
 * Ce qu'on trouve ici est donc un SOUS-ENSEMBLE typé — les sept clés
 * dont ces écrans ont besoin — et une seule information que le
 * catalogue ne porte pas : QUI porte quoi, pour pouvoir le dire quand
 * un geste est refusé.
 */

/**
 * Les sept clés de ce lot.
 *
 * Deux d'entre elles — `billing.subscriptions.read` et
 * `billing.subscriptions.write` — existaient déjà au catalogue de 0075.
 * Les cinq autres arrivent avec 0081, et cette distinction sert au
 * diagnostic : voir `socle.ts`, qui s'en sert pour dire « la migration
 * 0081 manque » plutôt que « votre rôle est trop étroit ».
 *
 * Le type est celui de `roles.ts` : une clé mal orthographiée ne
 * compile pas, et une clé retirée du catalogue casse la compilation au
 * lieu de refuser tout le monde en silence — le pire mode de
 * défaillance d'un contrôle d'accès, parce qu'il ressemble à un
 * fonctionnement normal.
 */
export const PERMISSIONS_COMMERCIALES = [
  "billing.plans.read",
  "billing.plans.write",
  "billing.subscriptions.read",
  "billing.subscriptions.write",
  "billing.invoices.read",
  "billing.invoices.write",
  "billing.issuer.write",
] as const satisfies readonly PlatformPermission[];

export type PermissionCommerciale = (typeof PERMISSIONS_COMMERCIALES)[number];

/** Les cinq clés que 0081 AJOUTE au catalogue. Leur absence en base la date. */
export const PERMISSIONS_NEUVES_0081 = [
  "billing.plans.read",
  "billing.plans.write",
  "billing.invoices.read",
  "billing.invoices.write",
  "billing.issuer.write",
] as const satisfies readonly PlatformPermission[];

/**
 * Quel rôle porte quoi, d'après le SEMIS de 0081 § 1.c.
 *
 * LA SOURCE DE VÉRITÉ RESTE LA BASE : cette carte est datée du semis et
 * ne suit pas les modifications ultérieures de la matrice. Elle sert à
 * une seule chose, et elle vaut son approximation — dire à quelqu'un
 * « il vous manque billing.plans.write » sans lui dire QUI la porte
 * l'oblige à aller chercher la réponse ailleurs, c'est-à-dire à ouvrir
 * un ticket.
 */
export const ROLES_PORTEURS: Record<PermissionCommerciale, readonly string[]> = {
  "billing.plans.read": ["super_admin", "billing_admin", "support", "product_admin"],
  "billing.plans.write": ["super_admin", "billing_admin"],
  "billing.subscriptions.read": ["super_admin", "billing_admin", "support"],
  "billing.subscriptions.write": ["super_admin", "billing_admin"],
  "billing.invoices.read": ["super_admin", "billing_admin", "support"],
  "billing.invoices.write": ["super_admin", "billing_admin"],
  // Le garde-fou de la matrice la refuse à tout autre rôle : un SIRET
  // ou un IBAN changé par erreur ne se rattrape pas sur une facture
  // déjà partie.
  "billing.issuer.write": ["super_admin"],
};

export function estPermissionCommerciale(valeur: unknown): valeur is PermissionCommerciale {
  return (
    typeof valeur === "string" &&
    (PERMISSIONS_COMMERCIALES as readonly string[]).includes(valeur)
  );
}

/**
 * La phrase qu'on affiche à la place d'un bouton refusé.
 *
 * Elle nomme la permission, ce qu'elle ouvre — le libellé vient du
 * catalogue, pas d'ici — et les rôles qui la portent. Un refus qui ne
 * dit pas comment l'obtenir se transforme en ticket.
 */
export function phraseDeRefus(role: string, permission: PermissionCommerciale): string {
  const libelle = isPlatformPermission(permission) ? permissionLabel(permission) : permission;
  return (
    `Le rôle « ${role} » ne porte pas la permission ${permission} — ` +
    `${libelle.charAt(0).toLowerCase()}${libelle.slice(1)}. ` +
    `Au semis de 0081, elle appartient à : ${ROLES_PORTEURS[permission].join(", ")}.`
  );
}
