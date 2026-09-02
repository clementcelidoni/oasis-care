/**
 * Phase 11 §"RÔLES ET PERMISSIONS".
 *
 * "Ne pas coder les autorisations directement écran par écran."
 * Everything here is about SHOWING or HIDING. It is never the thing
 * that keeps data safe: the binding check is `has_permission()` in
 * Postgres, enforced by RLS on every table. A user who edits their
 * browser state gets a different-looking sidebar and exactly the same
 * database rights.
 */

export const ROLES = [
  "owner",
  "admin",
  "manager",
  "sales",
  "designer",
  "projectManager",
  "teamLeader",
  "fieldWorker",
  "nurseryManager",
  "nurseryWorker",
  "orderPicker",
  "accounting",
  "readOnly",
  "custom",
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "clients.read",
  "clients.write",
  "quotes.read",
  "quotes.create",
  "quotes.edit",
  "quotes.approve",
  "projects.read",
  "projects.manage",
  "digitalTwin.edit",
  "nursery.stock.manage",
  "invoice.create",
  "organization.manageUsers",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** French labels — the role is shown to users, so it needs a real name. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  manager: "Responsable",
  sales: "Commercial",
  designer: "Concepteur",
  projectManager: "Conducteur de travaux",
  teamLeader: "Chef d'équipe",
  fieldWorker: "Ouvrier",
  nurseryManager: "Responsable pépinière",
  nurseryWorker: "Ouvrier pépinière",
  orderPicker: "Préparateur de commandes",
  accounting: "Comptabilité",
  readOnly: "Lecture seule",
  custom: "Personnalisé",
};

export const BUSINESS_TYPES = [
  "landscaper",
  "nursery",
  "landscaperAndNursery",
  "horticulturalProducer",
  "gardenMaintenance",
  "other",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  landscaper: "Paysagiste",
  nursery: "Pépiniériste",
  landscaperAndNursery: "Paysagiste et pépiniériste",
  horticulturalProducer: "Producteur horticole",
  gardenMaintenance: "Entretien de jardins",
  other: "Autre",
};

/**
 * Mirrors `role_permissions` and the owner/admin shortcut in
 * `has_permission()`. Kept in sync by
 * `lib/auth/__tests__/permissions.test.ts`, which fails if the two ever
 * drift — a client-side list that silently disagrees with the database
 * shows people menus that lead to a permission error.
 */
const ROLE_PERMISSIONS: Record<Exclude<Role, "owner" | "admin" | "custom">, Permission[]> = {
  manager: [
    "clients.read", "clients.write",
    "quotes.read", "quotes.create", "quotes.edit", "quotes.approve",
    "projects.read", "projects.manage",
    "digitalTwin.edit", "nursery.stock.manage", "invoice.create",
  ],
  sales: [
    "clients.read", "clients.write",
    "quotes.read", "quotes.create", "quotes.edit",
    "projects.read",
  ],
  designer: ["clients.read", "projects.read", "digitalTwin.edit", "quotes.read", "quotes.create"],
  projectManager: [
    "clients.read", "projects.read", "projects.manage", "quotes.read", "digitalTwin.edit",
  ],
  teamLeader: ["projects.read", "projects.manage"],
  fieldWorker: ["projects.read"],
  nurseryManager: ["nursery.stock.manage", "projects.read", "clients.read"],
  nurseryWorker: ["nursery.stock.manage"],
  orderPicker: ["nursery.stock.manage"],
  accounting: ["clients.read", "quotes.read", "invoice.create", "projects.read"],
  readOnly: ["clients.read", "quotes.read", "projects.read"],
};

export function permissionsForRole(role: Role, customPermissions: string[] = []): Permission[] {
  if (role === "owner" || role === "admin") return [...PERMISSIONS];
  if (role === "custom") {
    return customPermissions.filter((p): p is Permission =>
      (PERMISSIONS as readonly string[]).includes(p),
    );
  }
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(
  permission: Permission,
  role: Role,
  customPermissions: string[] = [],
): boolean {
  return permissionsForRole(role, customPermissions).includes(permission);
}
