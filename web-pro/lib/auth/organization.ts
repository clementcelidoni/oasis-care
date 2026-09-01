import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import type { BusinessType, Role } from "@/lib/auth/permissions";
import { permissionsForRole, type Permission } from "@/lib/auth/permissions";

export type OrganizationContext = {
  organizationId: string;
  workspaceId: string;
  name: string;
  businessType: BusinessType;
  role: Role;
  permissions: Permission[];
};

/**
 * Every organization the signed-in user belongs to.
 *
 * §"MULTI-ENTREPRISES : un même utilisateur peut appartenir à plusieurs
 * organisations." RLS does the filtering — this query asks for all rows
 * and the database returns only the caller's, so a bug here cannot leak
 * another company's organization.
 */
export async function getUserOrganizations(): Promise<OrganizationContext[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("organization_members")
    .select(
      `role, custom_permissions,
       business_organizations!inner ( id, workspace_id, name, business_type, archived_at )`,
    )
    .is("archived_at", null);

  if (error || !data) return [];

  return data
    .map((row) => {
      // The embedded row comes back as an object for a to-one relation,
      // but PostgREST types it loosely enough that a defensive read is
      // cheaper than a cast that lies.
      const org = row.business_organizations as unknown as {
        id: string;
        workspace_id: string;
        name: string;
        business_type: BusinessType;
        archived_at: string | null;
      } | null;
      if (!org || org.archived_at) return null;

      const role = row.role as Role;
      return {
        organizationId: org.id,
        workspaceId: org.workspace_id,
        name: org.name,
        businessType: org.business_type,
        role,
        permissions: permissionsForRole(role, row.custom_permissions ?? []),
      } satisfies OrganizationContext;
    })
    .filter((o): o is OrganizationContext => o !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

/** §13 COMPANY SWITCHER — où l'on retient l'entreprise choisie. */
export const ACTIVE_ORGANIZATION_COOKIE = "oasis_org";

/**
 * The organization to show. `preferredId` comes from a cookie or a URL;
 * it is validated against the user's real memberships rather than
 * trusted, so asking for someone else's organization id simply falls
 * back to your own first one.
 *
 * §13 : sans argument, on lit le cookie posé par le sélecteur
 * d'entreprise. C'est délibérément ICI et non dans l'appelant — tous
 * les écrans et toutes les Server Actions passent par cette fonction,
 * et une bascule qui ne changerait que la barre latérale sans changer
 * les données serait pire que pas de bascule du tout.
 */
export async function getActiveOrganization(
  preferredId?: string,
): Promise<OrganizationContext | null> {
  const organizations = await getUserOrganizations();
  if (organizations.length === 0) return null;

  let wanted = preferredId;
  if (!wanted) {
    const store = await cookies();
    wanted = store.get(ACTIVE_ORGANIZATION_COOKIE)?.value;
  }

  if (wanted) {
    // Validé contre les appartenances réelles : demander l'entreprise
    // d'un autre ne fait que retomber sur la sienne.
    const match = organizations.find((o) => o.organizationId === wanted);
    if (match) return match;
  }
  return organizations[0];
}

/**
 * L'organisation active, ou une redirection.
 *
 * À utiliser dans les Server Actions, où l'alternative — `if
 * (!organization) return;` — ne fait rien de visible : l'utilisateur
 * clique, rien ne se passe, et il recommence.
 *
 * La distinction compte. Pas de session, c'est la page de connexion ;
 * une session sans organisation, c'est la page de création. Renvoyer
 * vers la connexion quelqu'un qui est déjà connecté le laisserait
 * tourner en rond.
 *
 * `redirect()` depuis une Server Action produit une réponse que le
 * routeur client sait suivre — contrairement à une redirection émise
 * par `proxy.ts`, qui lui renvoie une page HTML là où il attend une
 * réponse d'action.
 */
export async function requireOrganization(): Promise<OrganizationContext> {
  const organization = await getActiveOrganization();
  if (organization) return organization;

  const user = await getCurrentUser();
  redirect(user ? "/bienvenue" : "/login");
}
