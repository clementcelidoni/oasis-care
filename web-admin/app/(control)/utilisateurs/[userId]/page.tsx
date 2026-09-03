import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FactList, GapList, type Fact } from "@/components/customers/facts";
import { ReadFailure } from "@/components/customers/read-failure";
import { TechnicalDetails } from "@/components/customers/technical-details";
import { Badge, EntityAvatar, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { MOBILE_GAPS, USER_GAPS } from "@/lib/customers/gaps";
import { productLabel } from "@/lib/customers/labels";
import { findUser } from "@/lib/customers/source";
import type { AdminUserRow } from "@/lib/customers/types";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";

/**
 * ==================================================================
 * FICHE UTILISATEUR — spec p.8-9
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * LA LIGNE À NE PAS FRANCHIR, ET ELLE EST ÉCRITE
 * ------------------------------------------------------------------
 * Spec p.9 : « Ne PAS afficher par défaut toutes ses plantes ou photos
 * dans l'administration. »
 *
 * Cette page ne lit donc AUCUN contenu. Elle montre une identité, des
 * dates, des rattachements et des nombres. Le jour où quelqu'un devra
 * voir le contenu d'un compte, ce sera par une session d'assistance
 * tracée et consentie — qui n'existe pas dans ce jalon, et qu'on se
 * garde bien d'esquisser ici : un premier bouton « voir ses jardins »,
 * même désactivé, est le début du chemin qui mène à la porte dérobée.
 *
 * ------------------------------------------------------------------
 * IL N'Y A PAS DE `admin_user_detail()` DANS 0075
 * ------------------------------------------------------------------
 * La fiche se lit par la fonction de LISTE, à qui l'on passe
 * l'identifiant en guise de recherche. C'est volontaire et non un
 * détour honteux : cela garantit que la fiche ne peut pas montrer un
 * champ que la liste ne montre pas — le même SQL, la même clause de
 * garde, la même discipline de nombres.
 *
 * Le prix est visible en bas de page : tout ce que la spec demande et
 * que cette fonction ne rend pas est NOMMÉ, avec sa cause. C'est plus
 * honnête qu'une fiche qui aurait l'air complète en taisant ses trous.
 *
 * ------------------------------------------------------------------
 * SPEC p.35 : les fiches sont annoncées en « MILESTONE ADMIN 2 »
 * ------------------------------------------------------------------
 * Elles sont construites ici parce qu'une ligne de tableau qui ne mène
 * nulle part est une impasse, et parce que la consigne de ce chantier
 * décrit explicitement leur contenu. Ce qui reste au jalon 2 est ce que
 * la spec y range vraiment : les abonnements, les entitlements et les
 * plans — c'est-à-dire ce qu'on POURRAIT MODIFIER. Cette page ne
 * modifie rien.
 */

export const dynamic = "force-dynamic";

/**
 * Les identifiants de cette base sont des uuid. Écarter tout de suite
 * ce qui n'en est pas un évite d'envoyer une chaîne quelconque dans les
 * `ilike` de la fonction de recherche, où elle pourrait faire remonter
 * une ligne — celle de quelqu'un d'autre — sous une adresse qui
 * prétendait désigner un compte précis.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: PageProps<"/utilisateurs/[userId]">): Promise<Metadata> {
  const { userId } = await params;
  // Le titre d'onglet ne va PAS chercher le nom du compte : ce serait
  // une seconde lecture pour un texte que personne ne lit, et le nom
  // d'un client finirait dans l'historique du navigateur.
  return { title: `Compte ${userId.slice(0, 8)}… — Oasis Care Control Center` };
}

export default async function FicheUtilisateurPage({
  params,
}: PageProps<"/utilisateurs/[userId]">) {
  await requireAdmin("platform.users.read");

  const { userId } = await params;
  if (!UUID.test(userId)) notFound();

  let user: AdminUserRow | null;
  try {
    user = await findUser(userId);
  } catch (error) {
    return (
      <>
        <PageHeader
          eyebrow="Compte"
          title="Fiche utilisateur"
          breadcrumb={{ label: "Tous les utilisateurs", href: "/utilisateurs" }}
        />
        <ReadFailure error={error} />
      </>
    );
  }

  // Un compte introuvable — effacé, ou jamais existé — reçoit le même
  // 404 qu'une adresse mal tapée. On n'apprend pas à un visiteur qu'un
  // identifiant a existé.
  if (user === null) notFound();

  const name = user.display_name?.trim() || user.email || user.user_id;
  const banned = user.banned_until !== null;

  const identity: Fact[] = [
    { label: "Nom", value: user.display_name?.trim() || null, unknownReason: "Aucun nom d'affichage n'est renseigné sur ce profil." },
    { label: "Adresse e-mail", value: user.email, unknownReason: "Aucune adresse n'est attachée à ce compte." },
    {
      label: "Date de création",
      value: formatDateTime(user.created_at),
      hint: formatRelative(user.created_at) ?? undefined,
    },
    {
      label: "Dernière connexion",
      value: formatDateTime(user.last_sign_in_at),
      unknownReason: "Aucune connexion n'est datée pour ce compte.",
      // La spec p.8 dit « Dernière activité ». La base ne sait dater
      // qu'une connexion, et les deux ne sont pas la même chose : on
      // affiche donc le nom exact de ce qu'on mesure.
      hint: "C'est la dernière CONNEXION. Rien dans cette base ne date un geste métier par utilisateur.",
    },
    {
      label: "Produit utilisé",
      value: productLabel(user.product),
      unknownReason:
        "L'appartenance à une entreprise prouverait « Pro ». Ce compte n'en a aucune, et rien n'enregistre l'usage de l'application iPhone.",
      hint:
        user.product === "pro"
          ? "Membre d'au moins une entreprise. Cela ne dit rien de l'usage de l'iPhone, qui n'est mesuré nulle part."
          : undefined,
    },
    {
      label: "Restriction",
      value: banned ? (
        <StatusBadge tone="critical">Banni jusqu&apos;au {formatDate(user.banned_until)}</StatusBadge>
      ) : (
        "Aucune"
      ),
    },
  ];

  const subscription: Fact[] = [
    {
      label: "Forfait mobile",
      value: user.mobile_plan,
      unknownReason:
        "Aucun droit actif dans subscription_entitlements. Ce compte est en accès gratuit — ou son achat n'a jamais été enregistré.",
    },
    {
      label: "Accès offert",
      value: user.complimentary ? (
        <Badge tone="info">Oui — droits offerts, zéro euro</Badge>
      ) : (
        "Non"
      ),
      hint: user.complimentary
        ? "Ces droits viennent de la migration 0042 (source = complimentary). Ils donnent accès aux fonctionnalités du produit et ne correspondent à AUCUN paiement : compter ce compte comme un abonné surestimerait le revenu."
        : undefined,
    },
    {
      label: "Forfaits Pro",
      value: user.pro_plans?.length ? user.pro_plans.join(", ") : null,
      unknownReason:
        "Aucune des entreprises de ce compte n'a d'abonnement enregistré. La table organization_subscriptions est vide, et aucune ligne du dépôt ne l'écrit jamais.",
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Compte"
        title={name}
        subtitle={user.email && user.email !== name ? user.email : undefined}
        breadcrumb={{ label: "Tous les utilisateurs", href: "/utilisateurs" }}
        action={
          <span className="flex items-center gap-2">
            {user.complimentary && <Badge tone="info">accès offert</Badge>}
            {banned && <StatusBadge tone="critical">banni</StatusBadge>}
            <EntityAvatar name={name} size="lg" shape="round" />
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Identité">
          <FactList facts={identity} />
        </Panel>

        <Panel title="Abonnement et droits">
          <FactList facts={subscription} />
        </Panel>

        <Panel
          title="Organisations"
          count={user.organization_count}
          description="Les entreprises dont ce compte est membre. Le rôle qu'il y tient n'est pas rendu par cette lecture."
        >
          {user.organization_count === 0 ? (
            <p className="px-4 py-3 text-[var(--text-body)] text-ink-faint">
              Ce compte n&apos;est membre d&apos;aucune entreprise non archivée.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {(user.organizations ?? []).map((organization) => (
                <li key={organization} className="flex items-center gap-2.5 px-4 py-2.5">
                  <EntityAvatar name={organization} size="sm" />
                  <span className="min-w-0 truncate text-[var(--text-body)]">{organization}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Ce que la plateforme ne mesure pas"
          description="Les champs de la spec p.8 que cette base ne sait pas remplir, et pourquoi."
        >
          <GapList gaps={USER_GAPS} />
        </Panel>

        <Panel
          title="Usage mobile — spec p.9"
          description="Ces champs sont listés pour tout compte : rien ne permet de savoir lequel utilise l'iPhone."
          className="lg:col-span-2"
        >
          <GapList gaps={MOBILE_GAPS} />
        </Panel>
      </div>

      <div className="mt-4">
        <TechnicalDetails entries={[{ label: "User ID", value: user.user_id }]}>
          Spec p.35 : les identifiants techniques ne s&apos;affichent que derrière ce dépliant. Un
          écran couvert d&apos;uuid est illisible, et l&apos;œil n&apos;y retrouve plus le nom du
          compte.
        </TechnicalDetails>
      </div>
    </>
  );
}
