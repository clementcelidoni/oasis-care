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
  presenceSourceLabel,
  presenceSourceTone,
  productLabel,
} from "@/lib/customers/labels";
import type { AdminUserRow } from "@/lib/customers/types";
import { formatDate, formatRelative } from "@/lib/format";

/**
 * ==================================================================
 * LE TABLEAU DES COMPTES — partagé par « Tous » et par « Pro »
 * ==================================================================
 *
 * Deux écrans montrent la même chose avec un filtre différent. Le
 * tableau est donc écrit une fois : sans cela, ajouter une colonne
 * demanderait de penser à deux fichiers, et le jour où l'on oublie, les
 * deux écrans divergent sans que rien ne le signale.
 *
 * ------------------------------------------------------------------
 * CE QUE CE TABLEAU NE MONTRE PAS, ET POURQUOI
 * ------------------------------------------------------------------
 * Spec p.9 : « Ne PAS afficher par défaut toutes ses plantes ou photos
 * dans l'administration. » Aucune colonne ici ne touche au contenu d'un
 * compte. On y lit une identité, des dates, des rattachements et des
 * nombres — de quoi reconnaître un client et juger de son état, jamais
 * de quoi lire son jardin.
 *
 * Il n'y a pas non plus de colonne « Statut » calculée ici. La
 * frontière entre actif et inactif — trente jours sans connexion — est
 * fixée dans `admin_list_users`, et la recopier en TypeScript créerait
 * une seconde vérité : le jour où le seuil change en SQL, la colonne
 * afficherait « actif » sur des lignes que le filtre « Inactif » vient
 * de rendre. On montre donc la DATE, qui ne peut pas mentir, et on
 * laisse le filtre à la base.
 */
export function UsersTable({
  rows,
  empty,
  footer,
}: {
  rows: AdminUserRow[];
  empty: ReactNode;
  footer?: ReactNode;
}) {
  const columns: Column<AdminUserRow>[] = [
    {
      key: "compte",
      header: "Compte",
      cell: (row) => {
        // `display_name` peut valoir l'adresse e-mail : le trigger de
        // `profiles` la recopie faute de mieux. On évite alors de
        // l'écrire deux fois l'une sous l'autre.
        const name = row.display_name?.trim() || row.email || row.user_id;
        const showEmail = row.email !== null && row.email !== name;

        return (
          <span className="flex items-center gap-2.5">
            <EntityAvatar name={name} shape="round" />
            <span className="min-w-0">
              <span className="block truncate">{name}</span>
              {showEmail && (
                <span className="block truncate text-[var(--text-secondary)] font-normal text-ink-faint">
                  {row.email}
                </span>
              )}
            </span>
          </span>
        );
      },
    },
    {
      key: "produit",
      header: "Produit",
      cell: (row) => {
        const label = productLabel(row.product);
        // `null` n'est pas « aucun produit » : c'est « on ne sait pas ».
        // Ce compte n'est membre d'aucune entreprise ET n'a laissé
        // aucune trace mobile — ce qui n'est pas la même chose que
        // « n'utilise rien ». Le mode invité en est la cause la plus
        // fréquente, et un compte qui n'a pas rouvert l'application
        // depuis la mise en service de la collecte reste invisible.
        if (label === null) {
          return (
            <UnknownValue
              compact
              reason="Ce compte n'est membre d'aucune entreprise et aucune trace d'usage de l'application iPhone n'existe à son nom. Ce n'est pas « il n'utilise rien » : le mode invité n'écrit jamais, et un compte qui n'a pas rouvert l'application depuis la mise en service de la collecte reste invisible."
            />
          );
        }
        return <Badge tone="accent">{label}</Badge>;
      },
    },
    {
      key: "mobile",
      header: "Mobile",
      // Masquée sous 1280px, comme la date d'inscription : sur un écran
      // étroit, l'identité et l'abonnement passent avant.
      secondary: true,
      cell: (row) => {
        // Les cinq colonnes de présence valent `null` ensemble. Une
        // seule suffit donc à savoir s'il y a quelque chose à montrer,
        // et c'est la provenance qu'on interroge : elle est renseignée
        // dès qu'une ligne existe, y compris pour une déduction, qui
        // n'a ni version ni date.
        if (row.mobile_presence_source === null) {
          return (
            <UnknownValue
              compact
              reason="Aucune trace d'usage mobile pour ce compte : ni installation annoncée, ni activité passée que seule l'application iPhone sache écrire."
            />
          );
        }

        // UNE DÉDUCTION NE SE PEINT PAS COMME UNE MESURE. Sans ce
        // badge, un compte rattrapé rétroactivement occuperait la même
        // ligne qu'un téléphone qui s'est annoncé hier, et la colonne
        // « version » vide passerait pour une lacune de collecte.
        if (row.mobile_presence_source !== "declared") {
          return (
            <Badge tone={presenceSourceTone(row.mobile_presence_source)}>
              {presenceSourceLabel(row.mobile_presence_source)}
            </Badge>
          );
        }

        const appareils = row.mobile_install_count;
        return (
          <span className="flex flex-wrap items-baseline gap-x-2">
            {row.mobile_app_version === null ? (
              // Ne devrait pas arriver : la contrainte de cohérence de
              // 0077 exige qu'une ligne déclarée porte sa version. Si
              // ça arrive quand même, on le dit plutôt que d'écrire une
              // version par défaut — une « 0.1.0 » inventée deviendrait
              // une ligne de la distribution.
              <UnknownValue
                compact
                reason="Cette présence est déclarée mais ne porte aucune version, ce que la contrainte de cohérence de la table devrait interdire."
              />
            ) : (
              <span className="tabular">{row.mobile_app_version}</span>
            )}
            {appareils !== null && appareils > 1 && (
              <span
                className="tabular text-[var(--text-secondary)] text-ink-faint"
                title="Des installations, pas des appareils : une réinstallation en crée une nouvelle."
              >
                {appareils} installations
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "organisations",
      header: "Organisations",
      cell: (row) => {
        if (row.organization_count === 0) {
          return <span className="text-ink-faint">Aucune</span>;
        }

        // Les noms sont une aide à la reconnaissance, pas le sujet : au
        // delà de deux, on compte plutôt que d'étirer la colonne.
        const names = row.organizations ?? [];
        const shown = names.slice(0, 2).join(", ");
        const rest = names.length - 2;

        return (
          <span className="block truncate" title={names.join(", ")}>
            {shown}
            {rest > 0 && <span className="text-ink-faint"> +{rest}</span>}
          </span>
        );
      },
    },
    {
      key: "abonnement",
      header: "Abonnement",
      cell: (row) => {
        // LE PIÈGE DE L'AUDIT, rendu visible. Les 25 droits du compte
        // propriétaire viennent de la migration 0042 avec
        // `source='complimentary'` : un accès OFFERT, zéro euro. Sans
        // ce badge, cette ligne se compterait comme un abonné payant.
        if (row.complimentary) {
          return (
            <span className="flex flex-wrap items-center gap-1.5">
              {row.mobile_plan && <span>{row.mobile_plan}</span>}
              <Badge tone="info">accès offert</Badge>
            </span>
          );
        }
        if (row.mobile_plan) return <span>{row.mobile_plan}</span>;
        return <span className="text-ink-faint">Gratuit</span>;
      },
    },
    {
      key: "inscription",
      header: "Inscription",
      secondary: true,
      cell: (row) => <span className="tabular">{formatDate(row.created_at)}</span>,
    },
    {
      key: "connexion",
      header: "Dernière connexion",
      cell: (row) => {
        const relative = formatRelative(row.last_sign_in_at);
        // Une date absente ne se dit pas « jamais » : c'est une
        // affirmation qu'on ne peut pas tirer d'une valeur manquante.
        if (relative === null) {
          return <UnknownValue compact reason="Aucune connexion n'est datée pour ce compte." />;
        }
        return (
          <span title={formatDate(row.last_sign_in_at) ?? undefined}>{relative}</span>
        );
      },
    },
    {
      key: "restriction",
      header: "Restriction",
      cell: (row) => {
        if (row.banned_until === null) return <span className="text-ink-faint">—</span>;
        return (
          <StatusBadge tone="critical">
            Banni jusqu&apos;au {formatDate(row.banned_until)}
          </StatusBadge>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.user_id}
      rowHref={(row) => `/utilisateurs/${row.user_id}`}
      empty={empty}
      footer={footer}
    />
  );
}
