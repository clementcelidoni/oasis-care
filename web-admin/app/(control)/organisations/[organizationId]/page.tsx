import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FactList, GapList, type Fact } from "@/components/customers/facts";
import { ReadFailure } from "@/components/customers/read-failure";
import { TechnicalDetails } from "@/components/customers/technical-details";
import {
  Badge,
  EntityAvatar,
  Notice,
  PageHeader,
  Panel,
  SectionHeader,
  StatStrip,
  StatusBadge,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { ORGANIZATION_GAPS } from "@/lib/customers/gaps";
import {
  businessTypeLabel,
  countryLabel,
  planLabel,
  subscriptionStatusLabel,
  subscriptionStatusTone,
} from "@/lib/customers/labels";
import { findOrganization } from "@/lib/customers/source";
import type { AdminOrganizationRow } from "@/lib/customers/types";
import { formatCount, formatDate, formatDateTime, formatRelative } from "@/lib/format";

/**
 * ==================================================================
 * FICHE ENTREPRISE PRO — spec p.10-11
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * LA MÊME LIGNE ROUGE QUE LA LISTE, ET ELLE COMPTE DOUBLE ICI
 * ------------------------------------------------------------------
 * Spec p.11 : « Afficher principalement des nombres et statistiques.
 * Ne pas exposer automatiquement le contenu métier. »
 *
 * Une fiche donne envie de « montrer un peu plus » : le nom d'un client
 * du CRM pour illustrer, le montant d'une facture pour situer la
 * taille. Rien de tout cela n'a sa place ici. Les clients de cette
 * entreprise ne sont pas nos clients, leurs devis ne nous regardent
 * pas, et un administrateur de plateforme n'a besoin que d'un ordre de
 * grandeur pour faire son travail : combien, depuis quand, et à quel
 * rythme.
 *
 * L'écran s'y tient par construction — la fonction SQL ne rend que des
 * `count`. Il ne s'agit donc pas de résister à la tentation, mais de ne
 * jamais ouvrir la porte : aucune lecture supplémentaire n'est faite
 * ici, et il ne faut pas en ajouter.
 *
 * ------------------------------------------------------------------
 * UNE ENTREPRISE ARCHIVÉE RESTE CONSULTABLE
 * ------------------------------------------------------------------
 * `findOrganization()` interroge avec le filtre « toutes ». Sans cela,
 * la fiche d'une entreprise archivée rendrait un 404 — introuvable
 * alors qu'elle est bien là. C'est justement au moment de l'archivage
 * qu'on vient la regarder.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
}: PageProps<"/organisations/[organizationId]">): Promise<Metadata> {
  const { organizationId } = await params;
  return {
    title: `Entreprise ${organizationId.slice(0, 8)}… — Oasis Care Control Center`,
  };
}

export default async function FicheOrganisationPage({
  params,
}: PageProps<"/organisations/[organizationId]">) {
  await requireAdmin("platform.organizations.read");

  const { organizationId } = await params;
  if (!UUID.test(organizationId)) notFound();

  let organization: AdminOrganizationRow | null;
  try {
    organization = await findOrganization(organizationId);
  } catch (error) {
    return (
      <>
        <PageHeader
          eyebrow="Entreprise"
          title="Fiche entreprise"
          breadcrumb={{ label: "Organisations", href: "/organisations" }}
        />
        <ReadFailure error={error} />
      </>
    );
  }

  if (organization === null) notFound();

  const archived = organization.archived_at !== null;

  const identity: Fact[] = [
    { label: "Nom commercial", value: organization.name },
    {
      label: "Raison sociale",
      value: organization.legal_name,
      unknownReason: "Aucune raison sociale n'est renseignée.",
    },
    {
      label: "SIRET",
      value: organization.siret,
      unknownReason:
        "Aucun SIRET n'est renseigné. Le champ est facultatif dans Oasis Care Pro : une entreprise peut s'inscrire sans l'avoir sous la main.",
    },
    {
      label: "Pays",
      value: organization.country === null ? null : countryLabel(organization.country),
      unknownReason: "Aucun pays n'est renseigné.",
    },
    {
      label: "Activité",
      value:
        organization.business_type === null ? null : businessTypeLabel(organization.business_type),
      unknownReason: "Aucune activité n'est renseignée.",
    },
    {
      label: "Date de création",
      value: formatDateTime(organization.created_at),
      hint: formatRelative(organization.created_at) ?? undefined,
    },
    {
      label: "Dernière activité",
      value: formatDateTime(organization.last_audited_action_at),
      unknownReason:
        "C'est la dernière action métier JOURNALISÉE (audit_events). Une entreprise qui travaille sans déclencher d'écriture auditée n'y apparaît pas : l'absence ne prouve pas l'inactivité.",
      hint:
        organization.last_audited_action_at !== null
          ? "Dernière action métier journalisée, pas dernière connexion."
          : undefined,
    },
    {
      label: "Archivage",
      value: archived ? (
        <StatusBadge tone="warning">Archivée le {formatDate(organization.archived_at)}</StatusBadge>
      ) : (
        "Active"
      ),
    },
  ];

  const subscription: Fact[] = [
    {
      label: "Forfait",
      value: organization.plan === null ? null : planLabel(organization.plan),
      unknownReason:
        "Aucun abonnement n'est enregistré. La table organization_subscriptions est vide, et la seule mention de cette table dans tout le dépôt est une LECTURE : rien ne l'écrit jamais.",
    },
    {
      label: "Statut",
      value:
        organization.subscription_status === null ? null : (
          <StatusBadge tone={subscriptionStatusTone(organization.subscription_status)}>
            {subscriptionStatusLabel(organization.subscription_status)}
          </StatusBadge>
        ),
      unknownReason: "Sans abonnement enregistré, il n'y a pas de statut à afficher.",
    },
    {
      label: "Membres",
      value: `${formatCount(organization.member_count)} — dont ${formatCount(organization.active_member_count)} connecté${organization.active_member_count > 1 ? "s" : ""} récemment`,
      hint: "« Récemment » veut dire moins de trente jours, seuil fixé dans la base. C'est une mesure de CONNEXION, pas d'usage.",
    },
    {
      label: "Sièges utilisés",
      value:
        organization.seat_limit === null
          ? null
          : `${formatCount(organization.member_count)} / ${formatCount(organization.seat_limit)}`,
      unknownReason:
        "Le plafond de sièges vient du forfait souscrit. Sans abonnement enregistré, il n'y a pas de plafond connu — ce qui n'est pas la même chose qu'un accès illimité.",
    },
    {
      label: "Modules",
      value:
        organization.disabled_module_count === 0
          ? "Tous actifs"
          : `${organization.disabled_module_count} désactivé${organization.disabled_module_count > 1 ? "s" : ""}`,
      hint:
        organization.disabled_module_count > 0
          ? "Le nombre est rendu par la base, pas la liste des modules concernés."
          : undefined,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Entreprise"
        title={organization.name}
        subtitle={
          organization.legal_name && organization.legal_name !== organization.name
            ? organization.legal_name
            : undefined
        }
        breadcrumb={{ label: "Organisations", href: "/organisations" }}
        action={
          <span className="flex items-center gap-2">
            {archived && <Badge tone="warning">archivée</Badge>}
            <EntityAvatar name={organization.name} size="lg" />
          </span>
        }
      />

      {archived && (
        <Notice tone="warning" title="Cette entreprise est archivée">
          L&apos;archivage est un effacement doux : les données restent en base et cette fiche
          continue de les lire. Elle n&apos;apparaît plus dans la liste par défaut.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Identité">
          <FactList facts={identity} />
        </Panel>

        <Panel title="Abonnement et capacité">
          <FactList facts={subscription} />
        </Panel>
      </div>

      <div className="mt-6">
        <SectionHeader
          title="Usage"
          description="Des nombres, et rien d'autre. Le contenu métier de cette entreprise — ses clients, ses devis, ses factures — ne s'affiche nulle part dans le Control Center."
        />
        <StatStrip
          items={[
            { label: "Clients CRM", value: formatCount(organization.crm_customer_count) },
            { label: "Projets", value: formatCount(organization.project_count) },
            { label: "Devis", value: formatCount(organization.quote_count) },
            { label: "Factures", value: formatCount(organization.invoice_count) },
            { label: "Lots de pépinière", value: formatCount(organization.nursery_lot_count) },
            { label: "Documents", value: formatCount(organization.document_count) },
            { label: "Jardins", value: formatCount(organization.garden_count) },
            { label: "Plantes", value: formatCount(organization.plant_count) },
            {
              label: "Requêtes IA (mois)",
              value: formatCount(organization.ai_requests_this_month),
              unknownReason:
                "Aucun compteur pour le mois courant. Et ce sont des REQUÊTES, jamais un coût : aucune table du projet n'enregistre de jetons, de modèle ni d'euros.",
            },
            {
              label: "Digital twins",
              value: null,
              unknownReason:
                "Aucune fonction d'administration ne compte les jumeaux numériques par entreprise. La table digital_twin_revisions existe : c'est une migration à écrire, pas une donnée perdue.",
            },
            {
              label: "Stockage",
              value: null,
              unknownReason:
                "Les tailles sont dans storage.objects ; rien ne les agrège par entreprise. Migration à écrire.",
            },
          ]}
        />
        <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Jardins et plantes passent par l&apos;espace de travail de l&apos;entreprise : ces deux
          tables sont partagées avec l&apos;application iPhone et ne portent pas
          d&apos;identifiant d&apos;organisation.
        </p>
      </div>

      <div className="mt-6">
        <Panel
          title="Ce que cette fiche ne montre pas"
          description="Les champs de la spec p.10-11 qu'aucune fonction d'administration ne rend aujourd'hui — à commencer par la liste des membres, qui est la seule chose de cette page qui ne soit pas un nombre."
        >
          <GapList gaps={ORGANIZATION_GAPS} />
        </Panel>
      </div>

      <div className="mt-4">
        <TechnicalDetails
          entries={[{ label: "Organization ID", value: organization.organization_id }]}
        >
          Spec p.35 : les identifiants techniques ne s&apos;affichent que derrière ce dépliant.
          Celui-ci est le seul que cette lecture rende — l&apos;espace de travail, qui relie
          l&apos;entreprise aux jardins et aux plantes, n&apos;est pas exposé.
        </TechnicalDetails>
      </div>
    </>
  );
}
