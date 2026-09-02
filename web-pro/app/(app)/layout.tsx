import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { getActiveOrganization, getUserOrganizations } from "@/lib/auth/organization";
import { switchOrganization } from "@/lib/auth/organizationActions";
import { signOut } from "@/lib/auth/session";
import { hasPortalAccess } from "@/lib/portal/access";
import { loadQuickLists } from "@/lib/search/actions";
import { visibleNavigation, type ModuleKey } from "@/lib/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { Header } from "@/components/shell/Header";
import { Toast } from "@/components/shell/Toast";
import { readFlash } from "@/lib/ui/flash";

/**
 * §2 STRUCTURE GÉNÉRALE — « Créer une vraie interface desktop » :
 *
 *     HEADER GLOBAL
 *     SIDEBAR | WORKSPACE
 *
 * §"Le WORKSPACE doit occuper la majorité de l'écran." D'où la
 * structure ci-dessous : le header sur toute la largeur, la barre
 * latérale à gauche, et tout le reste au contenu.
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

  const supabase = await createClient();
  const [{ data: profile }, organizations, quick, cookieStore, { data: unread }, pendingFlash] =
    await Promise.all([
      supabase
        .from("business_organizations")
        .select("logo_path, disabled_modules")
        .eq("id", organization.organizationId)
        .maybeSingle(),
      getUserOrganizations(),
      loadQuickLists(),
      cookies(),
      supabase.rpc("unread_notification_count", {
        p_organization_id: organization.organizationId,
      }),
      readFlash(),
    ]);

  const logoUrl = profile?.logo_path
    ? supabase.storage.from("organization-logos").getPublicUrl(profile.logo_path).data.publicUrl
    : null;

  const groups = visibleNavigation(
    organization.businessType,
    organization.permissions,
    (profile?.disabled_modules ?? []) as ModuleKey[],
  );

  // §5 SIDEBAR COLLAPSIBLE — l'état vient du cookie, donc le serveur
  // rend déjà la bonne largeur. Sans lui, la barre s'afficherait
  // dépliée puis se replierait à chaque navigation.
  const compact = cookieStore.get("oasis_sidebar")?.value === "compact";

  // IMPRESSION — la coquille se déplie.
  //
  // À l'écran, `h-screen` + `overflow-hidden` gardent le menu fixe
  // pendant qu'on fait défiler le contenu. À l'impression, ces deux
  // règles coupent le document à la hauteur d'un écran : un devis de
  // trois pages n'en sortirait qu'une, sans rien signaler. D'où les
  // variantes `print:` ci-dessous.
  return (
    <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
      {/* §47 ACCESSIBILITÉ — « clavier ». Sans ce lien, atteindre le
          contenu demande de traverser une quarantaine de liens. */}
      <a href="#contenu" className="skip-link">
        Aller au contenu
      </a>

      <Sidebar
        groups={groups}
        organizationName={organization.name}
        organizationLogoUrl={logoUrl}
        role={organization.role}
        initialCompact={compact}
        organizations={organizations.map((o) => ({ id: o.organizationId, name: o.name }))}
        activeOrganizationId={organization.organizationId}
        switchOrganization={switchOrganization}
        signOut={signOut}
      />

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <Header
          userEmail={user.email ?? ""}
          userName={
            (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "Mon compte"
          }
          unreadCount={typeof unread === "number" ? unread : 0}
          recents={quick.recents}
          favorites={quick.favorites}
          signOut={signOut}
        />

        <main
          id="contenu"
          className="flex-1 overflow-y-auto print:overflow-visible"
        >
          {children}
        </main>
      </div>

      {/* §34 — le retour d'une action, quelle que soit la page. Le
          message arrive par un cookie posé par la Server Action, ce qui
          le fait survivre à une redirection : « Devis créé » s'affiche
          sur la fiche du devis, pas sur la page qu'on vient de quitter. */}
      {/* `key` : chaque message est un composant neuf. Sans lui, un
          deuxième message n'en serait pas un — l'état « visible » du
          premier survivrait, et il faudrait le remettre à jour depuis un
          effet, ce qui déclenche un rendu en cascade. */}
      <Toast key={pendingFlash?.message ?? "aucun"} flash={pendingFlash} />
    </div>
  );
}
