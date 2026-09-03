import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FactList, GapList, type Fact } from "@/components/customers/facts";
import { ReadFailure } from "@/components/customers/read-failure";
import { TechnicalDetails } from "@/components/customers/technical-details";
import { Badge, EntityAvatar, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { MOBILE_GAPS, USER_GAPS } from "@/lib/customers/gaps";
import {
  platformLabel,
  presenceSourceHint,
  presenceSourceLabel,
  presenceSourceTone,
  productLabel,
} from "@/lib/customers/labels";
import { findUser } from "@/lib/customers/source";
import type { AdminUserRow } from "@/lib/customers/types";
import { formatCount, formatDate, formatDateTime, formatRelative } from "@/lib/format";

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

/**
 * Ce que « Produit utilisé » veut dire pour ce compte-là.
 *
 * `'both'` est la valeur qu'on oublie, et c'est celle du compte le plus
 * important de la production : le propriétaire est membre de
 * l'organisation ET utilisateur de l'iPhone. La spec p.8 l'a toujours
 * prévue (« ou les deux ») ; la base ne savait pas la produire avant
 * 0077.
 *
 * Un produit hors catalogue ne reçoit AUCUNE phrase : la valeur brute
 * s'affichera, et c'est le bon signal — mieux vaut un mot anglais
 * pendant une journée qu'une explication inventée pour toujours.
 */
function produitHint(product: string | null): string | undefined {
  switch (product) {
    case "pro":
      return "Membre d'au moins une entreprise non archivée. Aucune trace d'usage de l'application iPhone à ce nom — ce qui ne prouve pas l'absence d'usage, seulement l'absence de trace.";
    case "mobile":
      return "Un usage de l'application iPhone est attesté, et ce compte n'est membre d'aucune entreprise non archivée.";
    case "both":
      return "Membre d'une entreprise ET usage de l'iPhone attesté. C'est la troisième branche de la spec p.8 (« ou les deux »), et elle décrit un vrai cas : un professionnel qui soigne aussi ses propres plantes.";
    default:
      return undefined;
  }
}

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
      // `null` ne veut pas dire « aucun produit » : ce compte n'est
      // membre d'aucune entreprise ET n'a laissé aucune trace mobile.
      // Le mode invité en est la cause la plus fréquente — l'application
      // entière s'utilise sans compte, et rien ne remonte alors.
      unknownReason:
        "Ce compte n'est membre d'aucune entreprise, et aucune trace d'usage de l'application iPhone n'existe à son nom — ni déclaration, ni activité passée. Cela ne prouve pas qu'il n'utilise rien : un compte qui n'a pas rouvert l'application depuis la mise en service de la collecte reste invisible.",
      hint: produitHint(user.product),
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

  /**
   * ================================================================
   * LA PRÉSENCE MOBILE — spec p.8 : plateforme, version, appareils
   * ================================================================
   *
   * Les cinq champs valent `null` ENSEMBLE pour un compte sans trace,
   * et ce `null` se lit « on ne sait pas », jamais « aucun appareil ».
   * La différence n'est pas rhétorique : la collecte a une date de
   * début, et ce qui s'est passé avant elle sans laisser de trace
   * rétroactive est définitivement invisible.
   *
   * POUR UN COMPTE DÉDUIT, DEUX CHAMPS SUR CINQ SONT RENSEIGNÉS, et
   * c'est exactement ce que 0077 rend : la provenance et la plateforme.
   * La version, le nombre d'installations et la DATE D'ANNONCE valent
   * `null`, parce qu'une déduction ne les connaît pas. Ce dernier point
   * a dû être corrigé : la date affichée était en réalité celle du
   * dernier ARROSAGE du compte — un geste métier présenté sous une
   * étiquette de télémétrie, sur le seul état que la production
   * connaîtra le jour du déploiement.
   *
   * LA PROVENANCE EST LE PREMIER CHAMP, avant la version et avant le
   * nombre d'installations, parce qu'elle dit ce que les autres valent.
   * Sur une ligne DÉDUITE, il n'y a ni version ni date : le compte est
   * réputé mobile parce qu'il a laissé dans la base une trace que seule
   * l'application iPhone écrit, et c'est tout ce qu'on sait. Afficher
   * les trois autres champs en inconnu sans expliquer d'où vient
   * l'inconnu laisserait croire à une collecte défaillante.
   *
   * L'IDENTIFIANT D'INSTALLATION N'EST NULLE PART SUR CETTE FICHE, pas
   * même derrière « Afficher détails techniques ». Ce n'est pas une
   * décision d'écran : aucune fonction d'administration de 0077 ne le
   * rend, il ne franchit donc jamais la frontière de la base. C'est
   * plus strict que la spec p.35, et c'est le bon niveau pour un
   * identifiant qui suit une installation.
   */
  const mobile: Fact[] = [
    {
      label: "Comment on le sait",
      value: user.mobile_presence_source ? (
        <Badge tone={presenceSourceTone(user.mobile_presence_source)}>
          {presenceSourceLabel(user.mobile_presence_source)}
        </Badge>
      ) : null,
      unknownReason:
        "Aucune ligne de présence mobile pour ce compte : ni installation annoncée, ni activité passée que seule l'application iPhone sache écrire. Ce n'est pas « il n'utilise pas l'iPhone » — c'est « rien ne l'atteste ».",
      hint: user.mobile_presence_source
        ? (presenceSourceHint(user.mobile_presence_source) ?? undefined)
        : undefined,
    },
    {
      label: "Plateforme",
      value: user.mobile_platform ? platformLabel(user.mobile_platform) : null,
      // La plateforme est le SEUL des quatre champs suivants qu'une
      // DÉDUCTION sache renseigner, et 0077 la rend exprès dans ce
      // cas-là : les cinq tables et les compteurs sur lesquels repose la
      // déduction ne sont écrits que par l'application iPhone. Le motif
      // d'inconnu ne doit donc pas dire « seule une déclaration la
      // connaît » — ce serait faux, et l'écran afficherait « iOS » juste
      // au-dessus d'une phrase qui le réfute.
      unknownReason:
        "Aucune ligne de présence mobile pour ce compte : ni déclaration, ni déduction. Il n'y a donc aucune plateforme à afficher — pas « aucune plateforme ».",
      hint:
        user.mobile_presence_source === "inferred"
          ? "Déduite, pas déclarée : les tables qui portent la trace de ce compte ne sont écrites que par l'application iPhone."
          : undefined,
    },
    {
      label: "Version de l'application",
      value: user.mobile_app_version,
      unknownReason:
        "Une présence DÉDUITE ne porte aucune version : on sait que ce compte est passé par l'iPhone, pas avec quelle build. Inventer « 0.1.0 » en aurait fait une ligne de la distribution des versions.",
      hint: user.mobile_app_version
        ? "Celle de l'installation vue le plus récemment — sur deux téléphones, c'est le dernier utilisé qui décrit l'utilisateur, pas la version la plus haute."
        : undefined,
    },
    {
      label: "Nombre d'appareils",
      // `mobile_install_count` compte des INSTALLATIONS. Le libellé de
      // la spec p.8 dit « appareils » et on le garde — c'est le mot que
      // l'équipe emploie — mais la précision est écrite juste en
      // dessous : `identifierForVendor` est remis à zéro à la
      // désinstallation, donc quelqu'un qui réinstalle deux fois en
      // vaut trois. Promettre des appareils serait plus court et faux.
      value: formatCount(user.mobile_install_count),
      unknownReason:
        "Aucune installation identifiée. « 0 appareil » affirmerait qu'on a regardé et qu'il n'y en a pas ; la vérité est qu'on ne sait pas combien.",
      hint:
        user.mobile_install_count === null
          ? undefined
          : user.mobile_install_count >= 10
            ? "Dix est le PLAFOND : au-delà, la base recycle la plus ancienne installation. « 10 » se lit donc « au moins dix » — une saturation, pas une mesure."
            : "Des INSTALLATIONS, pas des appareils : l'identifiant est remis à zéro à la désinstallation, donc une réinstallation en crée une nouvelle.",
    },
    {
      label: "Dernière annonce de l'application",
      value: formatDateTime(user.mobile_last_seen_at),
      unknownReason:
        "Aucune installation ne s'est annoncée. Une présence déduite d'une activité passée n'a pas de date de dernière ouverture.",
      hint:
        user.mobile_last_seen_at === null
          ? undefined
          : `${formatRelative(user.mobile_last_seen_at) ?? "date relative indisponible"} — c'est l'ouverture de l'application, ni la dernière connexion, ni le dernier geste métier.`,
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
          title="Présence mobile"
          description="Spec p.8. Plateforme, version, appareils et dernière annonce — minimisés à la source : ni adresse IP, ni position, ni modèle, ni nom d'appareil."
          className="lg:col-span-2"
        >
          <FactList facts={mobile} />
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
          title="Usage mobile — ce qui reste hors de portée (spec p.9)"
          description="Ces champs-là décrivent le CONTENU d'un compte — combien de jardins, combien de photos. La donnée existe ; aucune fonction d'administration ne la compte, et la spec p.9 interdit de la lister."
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
          <p className="mt-2">
            L&apos;identifiant d&apos;INSTALLATION de l&apos;application n&apos;y figure pas, et ce
            n&apos;est pas un oubli : aucune fonction d&apos;administration de la migration 0077 ne
            le rend. Il ne franchit jamais la frontière de la base — plus strict que la règle
            ci-dessus, et le bon niveau pour un identifiant qui suit une installation sur le
            téléphone de quelqu&apos;un. Ce que cette fiche montre du mobile, ce sont des NOMBRES
            et des VERSIONS.
          </p>
        </TechnicalDetails>
      </div>
    </>
  );
}
