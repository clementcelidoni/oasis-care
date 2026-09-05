import type { Metadata } from "next";
import Link from "next/link";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  DataTable,
  EmptyState,
  FilterBar,
  Notice,
  PageHeader,
  Pagination,
  SearchBar,
  StatusBadge,
  UnknownValue,
  type Column,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { formatDateTime, formatRelative, shortId } from "@/lib/format";
import { EcranAssistanceFerme } from "@/lib/support/ecran-ferme";
import {
  champsCaches,
  FILTRES_STATUT,
  lienFiltre,
  lireFiltres,
  LIBELLES_FILTRE_STATUT,
  PRIORITES_TICKET,
  statutsRetenus,
  TAILLE_PAGE,
} from "@/lib/support/filtres";
import {
  libelle,
  LIBELLES_PRIORITE,
  LIBELLES_PRODUIT,
  LIBELLES_STATUT,
  tonDe,
  TONS_PRIORITE,
  TONS_STATUT,
} from "@/lib/support/libelles";
import { diagnostiquerSocleAssistance } from "@/lib/support/socle";
import {
  chargerNomsEntreprises,
  compterDemandes,
  listerDemandes,
  type PageDemandes,
} from "@/lib/support/source";
import type { Ticket } from "@/lib/support/types";

/**
 * ==================================================================
 * LE CENTRE D'ASSISTANCE — spec p.18
 * ==================================================================
 *
 * Sept colonnes demandées : tickets ouverts, priorité, utilisateur,
 * organisation, produit, date, statut. Les sept sont ici, et elles
 * viennent toutes de `support_tickets` (0081 § 8.a).
 *
 * ------------------------------------------------------------------
 * POURQUOI CET ÉCRAN EXISTE ALORS QUE LA TABLE EST VIDE
 * ------------------------------------------------------------------
 * Le constat qui a précédé ce chantier disait de NE PAS le livrer, et
 * il avait raison à ce moment-là : ce qui manquait n'était pas la
 * table, c'était le CANAL D'ENTRÉE. Une table sans porte reste vide à
 * vie, et aucun geste d'administrateur ne peut la remplir —
 * contrairement aux abonnements, dont l'administrateur EST la source.
 *
 * 0081 a posé la porte : `open_support_ticket()` est appelable par
 * n'importe quel compte connecté, impose l'auteur (`auth.uid()`),
 * vérifie l'appartenance à l'entreprise déclarée et fixe le statut
 * initial. Ce qui manque encore est le FORMULAIRE qui l'appelle, et il
 * vit dans `OasisCare/` et `web-pro/` — hors du périmètre de ce lot.
 *
 * L'écran le DIT, en haut, tant que la liste est vide. Ce n'est pas une
 * excuse : c'est la seule information utile qu'une liste vide puisse
 * porter, et elle évite qu'on cherche pendant une heure pourquoi
 * « personne n'écrit jamais au support ».
 */

export const metadata: Metadata = {
  title: "Demandes d'assistance — Oasis Care Control Center",
};

/** Une file d'attente servie depuis un cache n'est pas une file d'attente. */
export const dynamic = "force-dynamic";

export default async function CentreAssistancePage({
  searchParams,
}: PageProps<"/support">) {
  // La garde SANS permission d'abord : `requireAdmin("support.tickets.read")`
  // redirigerait vers `/role-insuffisant` avant qu'on ait pu distinguer
  // « la migration 0081 n'est pas appliquée » de « votre rôle est trop
  // étroit ». Les deux ferment l'écran et se corrigent à deux endroits
  // opposés.
  const admin = await requireAdmin();
  const socle = await diagnostiquerSocleAssistance(admin.permissions, "support.tickets.read");

  if (socle.etat !== "ok") {
    return (
      <EcranAssistanceFerme
        etat={socle.etat}
        requise="support.tickets.read"
        titre="Demandes d'assistance"
        sousTitre="Ce que les clients nous écrivent, et où chaque demande en est."
      />
    );
  }

  const filtres = lireFiltres(await searchParams);

  let page: PageDemandes;
  let noms: Map<string, string>;
  let tronquee = false;
  let comptes: (number | null)[];
  try {
    [page, comptes] = await Promise.all([
      listerDemandes(filtres),
      compterDemandes(FILTRES_STATUT.map((filtre) => statutsRetenus(filtre))),
    ]);
    const entreprises = await chargerNomsEntreprises();
    noms = entreprises.noms;
    tronquee = entreprises.tronquee;
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Assistance" title="Demandes d'assistance" />
        <ReadFailure error={error} />
      </>
    );
  }

  const total = page.total;
  const aucuneDemandeDuTout =
    page.lignes.length === 0 && filtres.recherche === null && comptes.every((c) => c === 0);

  const colonnes: Column<Ticket>[] = [
    {
      key: "subject",
      header: "Objet",
      cell: (ticket) => <span className="font-medium text-ink">{ticket.subject}</span>,
    },
    {
      key: "priority",
      header: "Priorité",
      cell: (ticket) => (
        <Badge tone={tonDe(TONS_PRIORITE, ticket.priority)}>
          {libelle(LIBELLES_PRIORITE, ticket.priority)}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Statut",
      cell: (ticket) => (
        <StatusBadge tone={tonDe(TONS_STATUT, ticket.status)}>
          {libelle(LIBELLES_STATUT, ticket.status)}
        </StatusBadge>
      ),
    },
    {
      key: "user",
      header: "Utilisateur",
      // L'IDENTIFIANT, PAS L'ADRESSE, ET CE N'EST PAS UN RENONCEMENT.
      // `admin_list_users` résout un compte par requête (0075 accepte
      // l'identifiant comme critère de recherche) : afficher l'adresse
      // ici coûterait vingt-cinq allers-retours pour une colonne. La
      // FICHE, elle, affiche l'adresse — elle n'en résout qu'une.
      cell: (ticket) =>
        ticket.user_id === null ? (
          <UnknownValue
            compact
            reason="Cette demande n'a pas d'auteur : soit elle a été saisie par l'équipe pour le compte d'une entreprise, soit le compte a été supprimé depuis."
          />
        ) : (
          <Link
            href={`/utilisateurs/${ticket.user_id}`}
            className="font-mono text-[11px] text-ink-soft hover:text-accent"
          >
            {shortId(ticket.user_id)}
          </Link>
        ),
    },
    {
      key: "organization",
      header: "Organisation",
      cell: (ticket) => {
        if (ticket.organization_id === null) {
          return <span className="text-ink-faint">Particulier</span>;
        }
        const nom = noms.get(ticket.organization_id);
        return (
          <Link
            href={`/organisations/${ticket.organization_id}`}
            className={nom ? "text-ink-soft hover:text-accent" : "font-mono text-[11px] text-ink-faint hover:text-accent"}
          >
            {nom ?? shortId(ticket.organization_id)}
          </Link>
        );
      },
    },
    {
      key: "product",
      header: "Produit",
      secondary: true,
      cell: (ticket) => (
        <span className="text-ink-soft">{libelle(LIBELLES_PRODUIT, ticket.product)}</span>
      ),
    },
    {
      key: "created",
      header: "Ouverte",
      secondary: true,
      cell: (ticket) => (
        <span className="text-ink-soft" title={formatDateTime(ticket.created_at) ?? undefined}>
          {formatRelative(ticket.created_at)}
        </span>
      ),
    },
    {
      key: "updated",
      header: "Dernier mouvement",
      cell: (ticket) => (
        <span className="text-ink-soft" title={formatDateTime(ticket.updated_at) ?? undefined}>
          {formatRelative(ticket.updated_at)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Assistance"
        title="Demandes d'assistance"
        subtitle="Ce que les clients nous écrivent, et où chaque demande en est."
      />


      {aucuneDemandeDuTout && (
        <Notice tone="unknown" title="Aucune demande, et la raison n'est pas « personne n'écrit »">
          La base sait recevoir une demande depuis 0081 :{" "}
          <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px]">
            open_support_ticket()
          </code>{" "}
          est appelable par n&apos;importe quel compte connecté. Ce qui manque est le FORMULAIRE
          qui l&apos;appelle, côté application iPhone et côté Oasis Care Pro — les deux hors du
          périmètre de ce lot. Tant qu&apos;il n&apos;existe pas, cette liste reste vide quoi
          qu&apos;il arrive, et ce n&apos;est pas un signe de calme.
        </Notice>
      )}

      {tronquee && (
        <Notice tone="warning" title="Tous les noms d'entreprise ne sont pas résolus">
          Au-delà de mille entreprises, cet écran cesse de chercher les noms et affiche
          l&apos;identifiant. La demande, elle, est complète : c&apos;est la colonne
          « Organisation » qui est incomplète, pas la liste.
        </Notice>
      )}

      <FilterBar
        label="Filtrer par statut"
        current={lienFiltre("/support", filtres, { statut: filtres.statut })}
        filters={FILTRES_STATUT.map((statut, index) => ({
          label: LIBELLES_FILTRE_STATUT[statut],
          href: lienFiltre("/support", filtres, { statut }),
          // `?? undefined` et non `?? 0` : un compte qui a échoué ne
          // s'affiche pas, il ne s'affiche pas en zéro.
          count: comptes[index] ?? undefined,
        }))}
      />

      <FilterBar
        label="Filtrer par priorité"
        current={lienFiltre("/support", filtres, { priorite: filtres.priorite })}
        filters={[
          { label: "Toutes priorités", href: lienFiltre("/support", filtres, { priorite: null }) },
          ...PRIORITES_TICKET.map((priorite) => ({
            label: LIBELLES_PRIORITE[priorite],
            href: lienFiltre("/support", filtres, { priorite }),
          })),
        ]}
      />

      <SearchBar
        action="/support"
        defaultValue={filtres.recherche ?? undefined}
        placeholder="Chercher dans l'objet des demandes…"
      >
        {champsCaches(filtres).map((champ) => (
          <input key={champ.nom} type="hidden" name={champ.nom} value={champ.valeur} />
        ))}
      </SearchBar>

      <DataTable
        columns={colonnes}
        rows={page.lignes}
        rowKey={(ticket) => ticket.id}
        rowHref={(ticket) => `/support/${ticket.id}`}
        empty={
          aucuneDemandeDuTout ? (
            <EmptyState
              tone="unknown"
              title="Rien à traiter, et rien ne peut encore arriver"
              description="Voir l'avertissement ci-dessus : la porte d'entrée existe en base, le formulaire qui l'ouvre n'est pas encore livré."
            />
          ) : (
            <EmptyState
              title="Aucune demande ne correspond"
              description="Ce filtre-là ne rend rien. Les autres filtres, eux, portent leur compte : si tous sont à zéro, c'est qu'aucune demande n'est arrivée."
            />
          )
        }
        footer={
          total !== null && total > TAILLE_PAGE ? (
            <Pagination
              page={filtres.page}
              pageSize={TAILLE_PAGE}
              total={total}
              hrefFor={(page) => lienFiltre("/support", filtres, { page })}
            />
          ) : undefined
        }
      />

      <p className="mt-4 max-w-4xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
        Cet écran ne montre AUCUNE donnée métier d&apos;un client : un objet, un statut, un
        rattachement, des dates. Ouvrir le dossier d&apos;une entreprise demande une session
        d&apos;assistance — motivée, bornée dans le temps, journalisée, et visible du client —
        depuis{" "}
        <Link href="/support/sessions" className="font-medium text-accent hover:underline">
          Sessions d&apos;assistance
        </Link>
        .
      </p>
    </>
  );
}
