import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import { visibleNavigation } from "@/lib/navigation";
import { Sidebar } from "@/components/Sidebar";

/**
 * The signed-in shell.
 *
 * `getUser()` runs here rather than relying on proxy.ts alone: the proxy
 * is an optimistic check, and Next's own guidance is not to treat it as
 * the authorization layer. This is the check that actually gates the
 * page.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const organization = await getActiveOrganization();
  // A signed-in user with no professional organization has nothing to
  // show here — send them to create one rather than render an empty
  // shell with a broken sidebar.
  if (!organization) redirect("/bienvenue");

  const items = visibleNavigation(organization.businessType, organization.permissions);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        items={items}
        organizationName={organization.name}
        role={organization.role}
        userEmail={user.email ?? ""}
      />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
