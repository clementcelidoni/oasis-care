import type { ReactNode } from "react";

import {
  Badge,
  DataTable,
  EntityAvatar,
  StatusBadge,
  UnknownValue,
  type Column,
} from "@/components/ui";
import {
  businessTypeLabel,
  planLabel,
  subscriptionStatusLabel,
  subscriptionStatusTone,
} from "@/lib/customers/labels";
import type { AdminOrganizationRow } from "@/lib/customers/types";
import { formatCount, formatDate, formatRelative } from "@/lib/format";

/**
 * ==================================================================
 * LE TABLEAU DES ENTREPRISES — spec p.9-10
 * ==================================================================
 *
 * « Une ligne = une entreprise Oasis Care Pro. »
 *
 * ------------------------------------------------------------------
 * LA RÈGLE DE CET ÉCRAN, ÉCRITE NOIR SUR BLANC (spec p.11)
 * ------------------------------------------------------------------
 * « Afficher principalement des nombres et statistiques. Ne pas exposer
 * automatiquement le contenu métier. »
 *
 * La fonction SQL s'y tient déjà : chaque colonne d'usage est un
 * `count`. On apprend qu'une entreprise a 42 devis, on n'apprend rien
 * de ces devis — ni le nom d'un de ses clients, ni le montant d'une
 * facture. Ce tableau ne doit pas défaire ce travail en allant chercher
 * le détail « pour illustrer » : le nom d'un client de l'entreprise
 * n'est pas une donnée d'exploitation de la plateforme, c'est la
 * matière première de son métier.
 *
 * ------------------------------------------------------------------
 * IL N'Y A PAS DE COLONNE « STOCKAGE »
 * ------------------------------------------------------------------
 * La spec la demande (p.10) et la fonction ne la rend pas. Une colonne
 * entière de tirets n'informe personne et ferait croire, ligne après
 * ligne, à des entreprises sans fichiers. Le manque est déclaré une
 * fois, en toutes lettres, dans le panneau qui suit la liste — et sur
 * la fiche.
 */
export function OrganizationsTable({
  rows,
  empty,
  footer,
}: {
  rows: AdminOrganizationRow[];
  empty: ReactNode;
  footer?: ReactNode;
}) {
  const columns: Column<AdminOrganizationRow>[] = [
    {
      key: "entreprise",
      header: "Entreprise",
      cell: (row) => {
        // Le logo est en base (`logo_path`) mais la fonction ne le rend
        // pas : les initiales tiennent le rôle en attendant. Une pastille
        // colorée aide déjà l'œil à retrouver une ligne dans une liste.
        const showLegal = row.legal_name !== null && row.legal_name !== row.name;
        return (
          <span className="flex items-center gap-2.5">
            <EntityAvatar name={row.name} />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="truncate">{row.name}</span>
                {row.archived_at !== null && <Badge tone="warning">archivée</Badge>}
              </span>
              {showLegal && (
                <span className="block truncate text-[var(--text-secondary)] font-normal text-ink-faint">
                  {row.legal_name}
                </span>
              )}
            </span>
          </span>
        );
      },
    },
    {
      key: "activite",
      header: "Activité",
      secondary: true,
      cell: (row) =>
        row.business_type === null ? (
          <UnknownValue compact reason="Aucune activité n'est renseignée pour cette entreprise." />
        ) : (
          businessTypeLabel(row.business_type)
        ),
    },
    {
      key: "plan",
      header: "Forfait",
      cell: (row) => {
        // `plan` et `subscription_status` sont nuls tant qu'aucun
        // abonnement n'est enregistré — et aucune ligne du dépôt n'en
        // écrit. Ce n'est pas « forfait gratuit », c'est « nous ne
        // suivons pas l'abonnement de cette entreprise ».
        if (row.plan === null) {
          return (
            <UnknownValue
              compact
              reason="Aucun abonnement n'est enregistré pour cette entreprise. La table organization_subscriptions est vide, et aucune ligne du dépôt ne l'écrit jamais."
            />
          );
        }
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <span>{planLabel(row.plan)}</span>
            {row.subscription_status !== null && (
              <StatusBadge tone={subscriptionStatusTone(row.subscription_status)} dot={false}>
                {subscriptionStatusLabel(row.subscription_status)}
              </StatusBadge>
            )}
          </span>
        );
      },
    },
    {
      key: "membres",
      header: "Membres",
      numeric: true,
      cell: (row) => (
        <span title={`${row.active_member_count} connecté(s) depuis moins de 30 jours`}>
          {formatCount(row.active_member_count)}
          <span className="text-ink-faint"> / {formatCount(row.member_count)}</span>
        </span>
      ),
    },
    {
      key: "sieges",
      header: "Sièges",
      numeric: true,
      secondary: true,
      cell: (row) =>
        // Le plafond vient du forfait. Sans abonnement, il n'y a pas de
        // plafond connu — pas « illimité », qui serait une promesse.
        row.seat_limit === null ? (
          <UnknownValue
            compact
            reason="Le plafond de sièges vient du forfait souscrit. Sans abonnement enregistré, il n'est pas connu."
          />
        ) : (
          <span>
            {formatCount(row.member_count)}
            <span className="text-ink-faint"> / {formatCount(row.seat_limit)}</span>
          </span>
        ),
    },
    {
      key: "modules",
      header: "Modules",
      numeric: true,
      secondary: true,
      cell: (row) =>
        row.disabled_module_count === 0 ? (
          <span className="text-ink-faint">tous actifs</span>
        ) : (
          <span>{row.disabled_module_count} désactivé{row.disabled_module_count > 1 ? "s" : ""}</span>
        ),
    },
    {
      key: "ia",
      header: "IA ce mois",
      numeric: true,
      cell: (row) =>
        row.ai_requests_this_month === null ? (
          <UnknownValue
            compact
            reason="Aucun compteur pour le mois courant : cette entreprise n'a pas encore appelé l'IA, ou son compteur n'a jamais été créé. Ce sont des REQUÊTES, pas un coût — aucune table n'enregistre de jetons ni d'euros."
          />
        ) : (
          <span title="Requêtes, pas euros : le coût de l'IA n'est enregistré nulle part.">
            {formatCount(row.ai_requests_this_month)}
          </span>
        ),
    },
    {
      key: "inscription",
      header: "Inscription",
      secondary: true,
      cell: (row) => <span className="tabular">{formatDate(row.created_at)}</span>,
    },
    {
      key: "activite_derniere",
      header: "Dernière activité",
      cell: (row) => {
        const relative = formatRelative(row.last_audited_action_at);
        if (relative === null) {
          return (
            <UnknownValue
              compact
              reason="C'est la dernière action métier JOURNALISÉE (audit_events). Une entreprise qui travaille sans déclencher d'écriture auditée n'y apparaît pas : l'absence ne prouve pas l'inactivité."
            />
          );
        }
        return (
          <span title={formatDate(row.last_audited_action_at) ?? undefined}>{relative}</span>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.organization_id}
      rowHref={(row) => `/organisations/${row.organization_id}`}
      empty={empty}
      footer={footer}
    />
  );
}
