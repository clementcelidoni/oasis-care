import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { installationARappeler } from "@/app/inscription/aiguillage";
import { getActiveOrganization, getUserOrganizations } from "@/lib/auth/organization";
import { switchOrganization } from "@/lib/auth/organizationActions";
import { signOut } from "@/lib/auth/session";
import { hasPortalAccess } from "@/lib/portal/access";
import { loadQuickLists } from "@/lib/search/actions";
import { visibleNavigation, type ModuleKey } from "@/lib/navigation";
import { lireSituationPeage } from "@/lib/peage/situation";
import { BandeauPeage } from "@/components/shell/BandeauPeage";
import { Sidebar } from "@/components/shell/Sidebar";
import { Header } from "@/components/shell/Header";
import { Toast } from "@/components/shell/Toast";
import { readFlash } from "@/lib/ui/flash";
import { PresenceReporter } from "@/lib/telemetry/PresenceReporter";
import { traduireRefus } from "@/lib/peage/messages";

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
/**
 * « Je n'en ai pas besoin » — la sortie du rappel d'installation.
 *
 * Elle écrit `onboarding_completed_at`, exactement ce qu'écrit le
 * bouton « Entrer dans Oasis Care Pro » de la dernière étape de
 * `/bienvenue`. Ce n'est pas un mensonge : cette colonne dit que le
 * PARCOURS est clos, pas que tous les champs sont remplis — la dernière
 * étape l'écrit déjà sans rien exiger de personne. Ce que la personne
 * refuse ici, c'est qu'on le lui redemande, et c'est son droit.
 *
 * Le logo, les mentions et les modules restent accessibles dans
 * Entreprise › Ma société : rien n'est perdu, seul le rappel s'arrête.
 */
async function clorreLInstallation(): Promise<void> {
  "use server";

  const organization = await requireOrganization();
  const supabase = await createClient();
  const { error } = await supabase
    .from("business_organizations")
    .update({
      onboarding_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", organization.organizationId);
  // ON NE SE TAIT PAS SUR UN REFUS. La politique de la table exige
  // `organization.manageUsers` ; le bandeau n'est déjà montré qu'à ceux
  // qui l'ont, mais si la règle changeait, un bouton qui ne fait rien
  // et ne dit rien est la panne la plus difficile à signaler.
  if (error) throw new Error(traduireRefus(error));

  // Le bandeau vit dans la mise en page : sans cette invalidation, il
  // resterait affiché jusqu'au prochain rechargement complet, et l'on
  // croirait que le bouton n'a rien fait.
  revalidatePath("/", "layout");
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const organization = await getActiveOrganization();
  /**
   * LA SEULE BIFURCATION DU PRODUIT, ET CE QU'ELLE ENVOYAIT OÙ.
   *
   * Un compte connecté sans organisation professionnelle n'a rien à
   * voir ici : on l'envoie plus loin plutôt que de rendre une coquille
   * vide avec une barre latérale cassée.
   *
   * ══════════════════════════════════════════════════════════════════
   * CE QUI CHANGE : LA DESTINATION, ET C'EST TOUT LE CHANTIER
   * ══════════════════════════════════════════════════════════════════
   *
   * Cette ligne envoyait sur `/bienvenue` — l'installation du LOGICIEL.
   * Un client neuf traversait ses huit étapes, arrivait dans
   * l'application, et personne ne lui avait jamais parlé d'argent : les
   * deux seuls liens vers le parcours de souscription étaient DANS
   * l'application, c'est-à-dire derrière cette garde-ci. Il fallait
   * être entré pour trouver la porte du péage.
   *
   * Elle envoie maintenant sur `/inscription`, qui mène à l'offre. Ce
   * n'est pas une question de goût : la règle du dirigeant — « essai
   * gratuit un mois AVEC CARTE OBLIGATOIREMENT » — impose que LE
   * CONTRAT PRÉCÈDE L'ACCÈS, et c'est cet ordre-là qui fixe le parcours.
   *
   * `/bienvenue` n'a pas disparu : elle est ce qui vient APRÈS, et
   * l'étape de confirmation du tunnel y renvoie. Le bandeau plus bas
   * dans ce fichier fait qu'on ne l'oublie pas, sans jamais bloquer
   * personne.
   *
   * ══════════════════════════════════════════════════════════════════
   * LE PORTAIL PASSE AVANT, ET IL DOIT RESTER PREMIER
   * ══════════════════════════════════════════════════════════════════
   *
   * Un particulier invité par son paysagiste n'a pas d'organisation et
   * n'en veut pas. L'envoyer sur « créez votre société » lui demanderait
   * de fonder une entreprise pour lire sa facture. Le test du portail
   * est donc AVANT toute idée de souscription, et il le reste.
   */
  if (!organization) redirect((await hasPortalAccess()) ? "/portail" : "/inscription");

  const supabase = await createClient();
  const [
    { data: profile },
    organizations,
    quick,
    cookieStore,
    { data: unread },
    pendingFlash,
    /**
     * L'ÉTAT DU CONTRAT, LU ICI ET UNE SEULE FOIS.
     *
     * Il voyage avec les six autres lectures de la coquille : le
     * bandeau ne coûte donc pas un aller-retour de plus par page. Et il
     * est lu ICI plutôt que dans chaque écran, parce qu'un péage dont
     * on n'entend parler qu'au moment du refus est indiscernable d'une
     * panne — c'est exactement ce que ce bandeau existe pour éviter.
     *
     * IL N'EST JAMAIS UNE CONDITION D'ACCÈS. La barrière est en base
     * (migration 0092) et nulle part ailleurs ; poser ici un second
     * juge garantirait la divergence, et le pire des deux mondes serait
     * un écran qui ferme quand la base laisse passer.
     */
    situationPeage,
  ] = await Promise.all([
      supabase
        .from("business_organizations")
        // Les deux colonnes d'avancement voyagent avec les deux autres :
        // la requête existait déjà, et le bandeau d'installation ne
        // coûte donc pas un aller-retour de plus à chaque page.
        .select("logo_path, disabled_modules, onboarding_step, onboarding_completed_at")
        .eq("id", organization.organizationId)
        .maybeSingle(),
      getUserOrganizations(),
      loadQuickLists(),
      cookies(),
      supabase.rpc("unread_notification_count", {
        p_organization_id: organization.organizationId,
      }),
      readFlash(),
      lireSituationPeage(supabase, organization.organizationId),
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

  /**
   * LE RAPPEL D'INSTALLATION — parce que `/bienvenue` n'est plus la
   * porte, et qu'une page qu'on ne croise plus est une page qui
   * n'existe plus.
   *
   * L'installation du logiciel (logo, mentions légales, effectif,
   * modules du menu, équipe) était traversée d'office par tout compte
   * neuf, puisqu'elle tenait lieu d'entrée. Elle vient désormais APRÈS
   * le contrat, et l'étape de confirmation y renvoie — mais celui qui
   * clique « plus tard » ne doit pas la perdre pour toujours.
   *
   * D'où ce bandeau. Une ligne, pas un mur : il n'empêche rien, ne
   * masque rien, et disparaît dès que le parcours est clos — soit qu'on
   * l'ait terminé, soit qu'on ait dit ne pas en vouloir. La règle qui
   * décide de l'afficher est partagée avec l'écran de confirmation
   * (`installationARappeler`) : écrite deux fois, elle aurait fini par
   * proposer l'installation à quelqu'un qui l'a finie.
   */
  const rappelerInstallation =
    /**
     * ET SEULEMENT À QUI PEUT LE FAIRE.
     *
     * Installer l'espace, c'est écrire dans `business_organizations` —
     * ce que la base réserve à `organization.manageUsers`. Montrer ce
     * bandeau à un ouvrier lui proposerait un travail qui n'est pas le
     * sien, et le bouton « Je n'en ai pas besoin » serait refusé par
     * RLS sans rien lui dire. Un rappel qui s'adresse à la mauvaise
     * personne est un rappel qui n'aboutit jamais.
     */
    organization.permissions.includes("organization.manageUsers")
    && installationARappeler({
      onboardingStep:
        typeof profile?.onboarding_step === "number" ? profile.onboarding_step : null,
      onboardingCompletedAt:
        typeof profile?.onboarding_completed_at === "string"
          ? profile.onboarding_completed_at
          : null,
    });

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
          {/* LE PÉAGE PARLE EN PREMIER, ET AVANT LE CLIC.
              Il passe devant le rappel d'installation : choisir un logo
              importe peu à qui ne peut plus créer de devis. */}
          {situationPeage !== null && <BandeauPeage situation={situationPeage} />}

          {/* `print:hidden` : un devis imprimé n'a pas à porter un
              rappel d'installation destiné au dirigeant. */}
          {rappelerInstallation && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-accent-wash px-8 py-2.5 print:hidden">
              <p className="min-w-56 flex-1 text-[var(--text-secondary)] text-ink-soft">
                <span className="font-medium text-ink">
                  Votre espace n&apos;est pas tout à fait installé.
                </span>{" "}
                Logo, mentions légales, modules du menu, équipe — cinq réglages facultatifs,
                cinq minutes.
              </p>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Link
                  href="/bienvenue"
                  className="inline-flex items-center rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-[var(--text-secondary)] font-medium text-accent-ink hover:bg-accent-hover"
                >
                  Reprendre l&apos;installation
                </Link>
                <form action={clorreLInstallation}>
                  <button
                    type="submit"
                    className="rounded-[var(--radius-control)] px-3 py-1.5 text-[var(--text-secondary)] text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
                  >
                    Je n&apos;en ai pas besoin
                  </button>
                </form>
              </div>
            </div>
          )}

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

      {/* PRÉSENCE APPLICATIVE — n'affiche rien, ne rend rien, ne peut
          rien casser. Il annonce au Control Center qu'un compte utilise
          bien le web, ce que rien n'enregistrait : sans ce pendant,
          « Oasis Care Mobile : N utilisateurs » n'a pas de contraire et
          ne veut rien dire. Voir lib/telemetry/presence.ts. */}
      <PresenceReporter />
    </div>
  );
}
