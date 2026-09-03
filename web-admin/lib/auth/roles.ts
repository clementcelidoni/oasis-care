/**
 * ==================================================================
 * LES RÔLES DE PLATEFORME — le miroir TypeScript de la migration 0075
 * ==================================================================
 *
 * LE PIÈGE NOMINATIF DE CE PROJET, dit une fois pour toutes. Le mot
 * « admin » est DÉJÀ PRIS, et il désigne un rôle CLIENT :
 * `organization_members.role` accepte 'owner' et 'admin' (0043), et
 * `has_permission()` accorde tout à ces deux-là. Un « admin » dans
 * Oasis Care Pro est l'administrateur d'UNE entreprise cliente — un
 * client, donc, pas un membre de l'équipe Oasis Care.
 *
 * La spec p.32 : « Ne pas considérer simplement organization owner
 * comme admin Oasis Care. » Rien de ce fichier ne touche à
 * `organization_members`, à `role_permissions` ni à `has_permission()`.
 * Il n'y a aucun chemin de l'un vers l'autre, ici comme en base.
 *
 * ------------------------------------------------------------------
 * CE FICHIER NE DÉCIDE RIEN
 * ------------------------------------------------------------------
 * La matrice qui fait autorité est en base :
 * `platform_admin_role_permissions`, protégée par le déclencheur
 * `platform_admin_matrix_guard()` qui refuse littéralement d'y insérer
 * une ligne interdite par la spec p.30. Les permissions affichées dans
 * l'application viennent de `admin_me()`, donc de cette table — jamais
 * de la constante ci-dessous.
 *
 * Ce qui suit sert à DEUX choses, et à rien d'autre :
 *   • typer ce que `admin_me()` rend, pour que le compilateur attrape
 *     une permission mal orthographiée dans un appel de garde ;
 *   • donner des libellés français lisibles à l'écran.
 *
 * Si les deux divergent un jour, c'est la base qui a raison, et
 * `assertKnownPermission()` le signalera au lieu de laisser une
 * permission inconnue passer pour un refus silencieux.
 */

/** Les six rôles de la spec p.30, en snake_case comme la contrainte SQL. */
export const PLATFORM_ROLES = [
  "super_admin",
  "support",
  "billing_admin",
  "product_admin",
  "security_admin",
  "read_only_analyst",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Les libellés visibles. En français, et SANS le mot « admin » seul :
 * « Administrateur » tout court se confondrait avec l'administrateur
 * d'une entreprise cliente, qui porte déjà ce nom dans Oasis Care Pro.
 */
export const ROLE_LABELS: Record<PlatformRole, string> = {
  super_admin: "Super-administrateur",
  support: "Support",
  billing_admin: "Facturation",
  product_admin: "Produit",
  security_admin: "Sécurité",
  read_only_analyst: "Analyste (lecture seule)",
};

/** Ce que chaque rôle est censé faire, en une phrase — affiché en survol. */
export const ROLE_DESCRIPTIONS: Record<PlatformRole, string> = {
  super_admin: "Tout le catalogue de permissions.",
  support:
    "Aide les clients : voit les comptes et les nombres, lit les abonnements, n'en modifie aucun (spec p.30).",
  billing_admin:
    "L'argent, et rien que l'argent : n'ouvre pas les données métier d'un client (spec p.30).",
  product_admin: "Les usages du produit ; ne touche pas aux paiements (spec p.30).",
  security_admin: "Le journal des actions administratives et la liste des administrateurs.",
  read_only_analyst: "Les chiffres, point. N'écrit rien, pas même dans le journal.",
};

/**
 * Le catalogue `platform_admin_permissions` de 0075, à l'identique.
 *
 * Toute chaîne passée à `requireAdmin()` doit venir d'ici : une
 * permission inventée ne serait jamais portée par aucun rôle, et
 * refuserait donc tout le monde en silence — le pire mode de
 * défaillance possible pour un contrôle d'accès, parce qu'il ressemble
 * à un fonctionnement normal.
 */
export const PLATFORM_PERMISSIONS = [
  "platform.dashboard.read",
  "platform.users.read",
  "platform.organizations.read",
  "platform.search",
  "platform.audit.read",
  "platform.admins.read",
  "platform.admins.manage",
  "customer.data.read",
  "billing.subscriptions.read",
  "billing.subscriptions.write",
  "billing.payments.write",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<PlatformPermission, string> = {
  "platform.dashboard.read": "Voir le tableau de bord et l'activité",
  "platform.users.read": "Lister les utilisateurs (métadonnées)",
  "platform.organizations.read": "Lister les entreprises Pro (nombres)",
  "platform.search": "Recherche administrative globale",
  "platform.audit.read": "Lire le journal des actions admin",
  "platform.admins.read": "Voir la liste des administrateurs",
  "platform.admins.manage": "Créer, modifier, révoquer un admin",
  // AUCUN RÔLE DE TRAVAIL NE LA PORTE dans ce jalon, et aucun écran ne
  // la consulte : par défaut, aucun accès aux données métier d'un
  // client. Elle figure au catalogue parce que « Billing : ne peut pas
  // ouvrir les données client » (spec p.30) n'a de sens que si la
  // permission existe, et un déclencheur en base refuse de l'accorder à
  // quatre des six rôles. Elle se rajoutera avec le mécanisme qui
  // l'encadre — consentement, session d'assistance bornée, journal
  // (milestone Admin 4).
  "customer.data.read": "Ouvrir les données métier d'un client",
  "billing.subscriptions.read": "Voir les abonnements",
  "billing.subscriptions.write": "Modifier un abonnement",
  "billing.payments.write": "Agir sur les paiements",
};

export function isPlatformRole(value: unknown): value is PlatformRole {
  return typeof value === "string" && (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function isPlatformPermission(value: unknown): value is PlatformPermission {
  return (
    typeof value === "string" && (PLATFORM_PERMISSIONS as readonly string[]).includes(value)
  );
}

/**
 * Le libellé d'un rôle qu'on ne connaît pas encore.
 *
 * Ce cas est réel : la base peut gagner un septième rôle avant que ce
 * fichier ne soit mis à jour. On affiche alors la valeur brute plutôt
 * que « inconnu » — un administrateur doit pouvoir lire sa propre
 * casquette même quand l'interface a un train de retard.
 */
export function roleLabel(role: string): string {
  return isPlatformRole(role) ? ROLE_LABELS[role] : role;
}

export function permissionLabel(permission: string): string {
  return isPlatformPermission(permission) ? PERMISSION_LABELS[permission] : permission;
}
