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
  // §7 BIOLAB SUR LE WEB. Les trois clés sont semées dans
  // `role_permissions` par la migration 0087, et le découpage suit les
  // COMMANDES SQL, pas une liste de tables : les vingt et une politiques
  // BioLab sont en `for all`, donc quiconque peut écrire pourrait aussi
  // supprimer — et effacer un lot efface la généalogie qui pend à son
  // `parent_batch_id`. D'où la troisième.
  //
  //   biolab.read   — consulter le laboratoire.
  //   biolab.write  — saisir le quotidien à la paillasse.
  //   biolab.manage — supprimer, et commander la reprise du §3 de 0087.
  "biolab.read",
  "biolab.write",
  "biolab.manage",
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
 * `has_permission()`.
 *
 * TENU EN PHASE PAR `lib/auth/permissions.test.ts`, QUI EXISTE
 * DÉSORMAIS. Le commentaire d'origine annonçait un
 * `lib/auth/__tests__/permissions.test.ts` — ce fichier n'a jamais été
 * écrit, et la promesse était donc fausse pendant tout ce temps. Le
 * test relit les `insert into public.role_permissions` de
 * `supabase/migrations/` et échoue si une seule case diffère, dans un
 * sens ou dans l'autre.
 *
 * POURQUOI CE TEST COMPTE AUTANT. `lib/auth/organization.ts` construit
 * `permissions` avec `permissionsForRole()`, c'est-à-dire à partir de
 * la table ci-dessous, JAMAIS depuis `role_permissions` en base. Les
 * deux peuvent donc diverger en silence, et les deux dérives sont
 * muettes : une permission semée en base mais absente d'ici donne un
 * droit que rien n'affiche ; une permission listée ici mais non semée
 * ouvre un écran sur des données que la base refuse.
 */
const ROLE_PERMISSIONS: Record<Exclude<Role, "owner" | "admin" | "custom">, Permission[]> = {
  manager: [
    "clients.read", "clients.write",
    "quotes.read", "quotes.create", "quotes.edit", "quotes.approve",
    "projects.read", "projects.manage",
    "digitalTwin.edit", "nursery.stock.manage", "invoice.create",
    // Le responsable répond de la production végétale : les trois.
    "biolab.read", "biolab.write", "biolab.manage",
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
  nurseryManager: [
    "nursery.stock.manage", "projects.read", "clients.read",
    "biolab.read", "biolab.write", "biolab.manage",
  ],
  // La personne à la paillasse saisit une inspection, une photo, un
  // comptage. Elle ne SUPPRIME pas : effacer un lot efface la
  // généalogie de ses sous-lots avec lui.
  nurseryWorker: ["nursery.stock.manage", "biolab.read", "biolab.write"],
  orderPicker: ["nursery.stock.manage"],
  accounting: ["clients.read", "quotes.read", "invoice.create", "projects.read"],
  readOnly: ["clients.read", "quotes.read", "projects.read", "biolab.read"],
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
