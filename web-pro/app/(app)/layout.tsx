import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import { hasPortalAccess } from "@/lib/portal/access";
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
  // show here — send them onward rather than render an empty shell with
  // a broken sidebar.
  //
  // Le portail passe AVANT la création d'entreprise. Un particulier
  // invité par son paysagiste n'a pas d'organisation et n'en veut
  // pas : l'envoyer sur « Créons votre entreprise » lui demanderait de
  // fonder une société pour lire sa facture.
  if (!organization) redirect((await hasPortalAccess()) ? "/portail" : "/bienvenue");

  const items = visibleNavigation(organization.businessType, organization.permissions);

  // IMPRESSION — la coquille se déplie.
  //
  // À l'écran, `h-screen` + `overflow-hidden` gardent le menu fixe
  // pendant qu'on fait défiler le contenu. À l'impression, ces deux
  // règles coupent le document à la hauteur d'un écran : un devis de
  // trois pages n'en sortirait qu'une, sans rien signaler. D'où les
  // variantes `print:` ci-dessous, et le `print:hidden` sur le menu.
  return (
    <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
      <Sidebar
        items={items}
        organizationName={organization.name}
        role={organization.role}
        userEmail={user.email ?? ""}
      />
      <main className="flex-1 overflow-y-auto print:overflow-visible">{children}</main>
    </div>
  );
}
