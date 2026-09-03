import { Badge, DataTable, EmptyState, UnknownValue, type Column } from "@/components/ui";
import { platformLabel } from "@/lib/customers/labels";
import { distributionPercent } from "@/lib/dashboard/mobile";
import type { MobileOsRow, MobileVersionRow } from "@/lib/dashboard/types";
import { formatCount, formatPercent, formatRelative, formatDateTime } from "@/lib/format";

/**
 * ==================================================================
 * LA DISTRIBUTION DU PARC — « reste-t-il des téléphones en retard ? »
 * ==================================================================
 *
 * Deux tableaux, parce que ce sont deux décisions différentes : arrêter
 * de corriger une vieille version de l'application, et relever la cible
 * de déploiement iOS. Les empiler dans une seule grille aurait forcé
 * une colonne « dimension » et des cases vides une ligne sur deux.
 *
 * ------------------------------------------------------------------
 * DES INSTALLATIONS ET DES COMPTES, JAMAIS UN SEUL DES DEUX
 * ------------------------------------------------------------------
 * Les deux colonnes sont affichées côte à côte et ne disent pas la même
 * chose. « 12 installations » et « 9 comptes » sur la même ligne veut
 * dire que trois personnes ont deux téléphones — et c'est la seconde
 * colonne qui répond à « combien de clients dois-je prévenir avant de
 * couper cette version ». N'en montrer qu'une laisserait chacun
 * supposer que c'est l'autre.
 *
 * ------------------------------------------------------------------
 * ET POURQUOI LE POURCENTAGE NE SE CALCULE PAS SUR CE QU'ON VOIT
 * ------------------------------------------------------------------
 * Le dénominateur est `declared_installations_total`, que la base
 * répète sur chaque ligne. Additionner les lignes affichées donnerait
 * un total plus petit dès qu'une page serait tronquée, donc des
 * pourcentages gonflés — et personne ne le verrait, parce qu'ils
 * resteraient plausibles.
 */

/** Le pourcentage d'une ligne, ou l'inconnu si le rapport n'a pas de sens. */
function Share({ row }: { row: { installations: number; declared_installations_total: number } }) {
  const percent = distributionPercent(row);
  if (percent === null) {
    return (
      <UnknownValue
        compact
        reason="Le rapport n'est pas calculable : soit le total des installations déclarées est nul, soit cette ligne en compte plus que le total — deux chiffres qui ne portent alors pas sur la même population. Un pourcentage raboté à 100 % se lirait comme un parc parfaitement à jour."
      />
    );
  }
  return <span className="tabular">{formatPercent(percent)}</span>;
}

/**
 * Un décompte. Un nombre illisible s'affiche en INCONNU et non en case
 * vide : une cellule vide dans une colonne de nombres se lit zéro, et
 * « 0 installation » sur une ligne qui existe serait absurde sans être
 * remarqué.
 */
function Count({ value }: { value: number }) {
  const text = formatCount(value);
  if (text === null) {
    return (
      <UnknownValue compact reason="La base a rendu pour ce décompte une valeur qui n'est pas un nombre." />
    );
  }
  return <>{text}</>;
}

/**
 * La plateforme, affichée UNIQUEMENT si ce n'est pas iOS.
 *
 * La contrainte de 0077 n'accepte que « ios » : répéter le mot sur
 * chacune des lignes de deux tableaux qui n'en contiennent pas d'autre
 * serait du bruit. Mais le jour où un client Android existera, la
 * distribution mélangera deux parcs, et une ligne « 1.4.2 » sans
 * plateforme deviendrait ambiguë au moment précis où elle compte. Ce
 * badge apparaît donc tout seul, sans qu'on ait à y penser.
 */
function AutrePlateforme({ platform }: { platform: string }) {
  if (platform === "ios") return null;
  return <Badge tone="info">{platformLabel(platform)}</Badge>;
}

/** La dernière annonce d'une ligne : relative à l'œil, exacte en survol. */
function LastSeen({ iso }: { iso: string }) {
  const relative = formatRelative(iso);
  if (relative === null) {
    return <UnknownValue compact reason="La date rendue par la base est illisible." />;
  }
  return <span title={formatDateTime(iso) ?? undefined}>{relative}</span>;
}

/**
 * L'état vide, partagé par les deux tableaux.
 *
 * Il ne dit JAMAIS « aucune version en circulation » — ce serait un
 * fait, et il serait faux. Il dit « aucune installation ne s'est encore
 * annoncée », qui est la vérité et qui se transforme en attente plutôt
 * qu'en inquiétude.
 */
function AucuneDeclaration({ quoi }: { quoi: string }) {
  return (
    <EmptyState
      tone="unknown"
      title={`Aucune ${quoi} n'est encore connue`}
      description="Ce tableau ne compte que les installations qui se sont ANNONCÉES : une présence déduite d'une activité passée ne porte ni version ni système. Tant qu'aucun iPhone ne porte la version qui déclare sa présence, il reste vide — ce n'est pas une panne, et ce n'est surtout pas « personne n'utilise l'application »."
    />
  );
}

/** Les versions de l'application en circulation (0077 §5.c). */
export function MobileVersionTable({ rows }: { rows: MobileVersionRow[] }) {
  const columns: Column<MobileVersionRow>[] = [
    {
      key: "version",
      header: "Version",
      cell: (row) => (
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="tabular font-medium">{row.app_version}</span>
          {/*
            LE BUILD EST AFFICHÉ À CÔTÉ DE LA VERSION, ET CE N'EST PAS
            DE LA DÉCORATION. `project.yml` fige MARKETING_VERSION à
            « 0.1.0 » et seul CURRENT_PROJECT_VERSION est réécrit par la
            CI : les 31 builds TestFlight envoyés à ce jour portent tous
            la même version. Sans le build, cette colonne afficherait
            une ligne unique et n'apprendrait rien.
          */}
          <span className="tabular text-[var(--text-secondary)] text-ink-faint">
            build {row.app_build}
          </span>
          <AutrePlateforme platform={row.platform} />
        </span>
      ),
    },
    {
      key: "installations",
      header: "Installations",
      numeric: true,
      cell: (row) => <Count value={row.installations} />,
    },
    {
      key: "comptes",
      header: "Comptes",
      numeric: true,
      cell: (row) => <Count value={row.users} />,
    },
    {
      key: "part",
      header: "Part du parc",
      numeric: true,
      cell: (row) => <Share row={row} />,
    },
    {
      key: "vue",
      header: "Dernière annonce",
      cell: (row) => <LastSeen iso={row.last_seen_at} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      // Une installation peut porter la même version qu'une autre sur
      // une plateforme différente : la clé prend les trois dimensions du
      // regroupement, pas la seule version.
      rowKey={(row) => `${row.platform}-${row.app_version}-${row.app_build}`}
      empty={<AucuneDeclaration quoi="version de l'application" />}
    />
  );
}

/** Les versions majeures d'iOS en circulation (0077 §5.c). */
export function MobileOsTable({ rows }: { rows: MobileOsRow[] }) {
  const columns: Column<MobileOsRow>[] = [
    {
      key: "os",
      header: "Système",
      cell: (row) => (
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="tabular font-medium">
            {row.platform === "ios" ? "iOS" : platformLabel(row.platform)} {row.os_major}
          </span>
          {/*
            Seule la MAJEURE est collectée : la mineure ne change aucune
            décision de cible de déploiement, et la collecter rendrait
            l'empreinte plus fine pour rien. Le badge le dit là où on
            pourrait croire à une troncature d'affichage.
          */}
          <Badge>version majeure</Badge>
        </span>
      ),
    },
    {
      key: "installations",
      header: "Installations",
      numeric: true,
      cell: (row) => <Count value={row.installations} />,
    },
    {
      key: "comptes",
      header: "Comptes",
      numeric: true,
      cell: (row) => <Count value={row.users} />,
    },
    {
      key: "part",
      header: "Part du parc",
      numeric: true,
      cell: (row) => <Share row={row} />,
    },
    {
      key: "vue",
      header: "Dernière annonce",
      cell: (row) => <LastSeen iso={row.last_seen_at} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => `${row.platform}-${row.os_major}`}
      empty={<AucuneDeclaration quoi="version d'iOS" />}
    />
  );
}
