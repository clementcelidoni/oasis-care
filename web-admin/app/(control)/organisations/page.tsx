import type { Metadata } from "next";

import { GapList } from "@/components/customers/facts";
import { OrganizationsTable } from "@/components/customers/organizations-table";
import { ReadFailure } from "@/components/customers/read-failure";
import {
  ButtonLink,
  EmptyState,
  FilterBar,
  Pagination,
  PageHeader,
  Panel,
  SearchBar,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { listHref, ORGANIZATION_FILTERS, parseFilter } from "@/lib/customers/filters";
import { ORGANIZATION_GAPS } from "@/lib/customers/gaps";
import { isBeyondLastPage, parsePage, parseSearch, type Paged } from "@/lib/customers/pagination";
import { listOrganizations } from "@/lib/customers/source";
import type { AdminOrganizationRow } from "@/lib/customers/types";
import { formatCount } from "@/lib/format";

/**
 * ==================================================================
 * PRO ORGANIZATIONS — spec p.9-11. Point 6 du jalon.
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * LA RECHERCHE PAR SIRET COMPARE LES CHIFFRES, PAS LE TEXTE
 * ------------------------------------------------------------------
 * « 123 456 789 » et « 123456789 » désignent la même entreprise, et un
 * administrateur qui recopie un SIRET depuis un document le colle avec
 * ses espaces. La fonction SQL extrait donc les chiffres des deux côtés
 * avant de comparer — comme le faisait déjà la recherche de téléphones
 * de la migration 0061.
 *
 * Elle exige QUATRE chiffres au minimum, et ce seuil n'est pas de la
 * prudence décorative : en dessous, le moindre chiffre égaré dans un
 * nom ferait remonter toutes les entreprises immatriculées. Chercher
 * « owner2 » rendrait la plateforme entière.
 *
 * ------------------------------------------------------------------
 * « ARCHIVÉES » N'EST PAS UN CONFORT
 * ------------------------------------------------------------------
 * `archived_at` est un effacement doux (migrations 0056 et 0060). La
 * liste par défaut masque ces entreprises — sinon le compteur ne
 * baisserait jamais — mais sans le filtre elles deviendraient
 * introuvables : présentes en base, absentes de toute vue. Or c'est
 * précisément quand une entreprise vient d'être archivée qu'on a besoin
 * de la consulter.
 */

export const metadata: Metadata = {
  title: "Organisations — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function OrganisationsPage({ searchParams }: PageProps<"/organisations">) {
  await requireAdmin("platform.organizations.read");

  const params = await searchParams;
  const search = parseSearch(params.q);
  const filtre = parseFilter(params.filtre);
  const page = parsePage(params.page);

  const hrefFor = (target: { q?: string | null; filtre?: string | null; page?: number }) =>
    listHref("/organisations", { q: search, filtre, ...target });

  let paged: Paged<AdminOrganizationRow>;
  try {
    paged = await listOrganizations({ search, filter: filtre, page });
  } catch (error) {
    return (
      <>
        <PageHeader
          eyebrow="Clients"
          title="Organisations"
          subtitle="Les entreprises Oasis Care Pro, en nombres."
        />
        <ReadFailure error={error} retryHref={listHref("/organisations", { q: search })} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title="Organisations"
        subtitle={
          paged.total !== null
            ? `${formatCount(paged.total)} entreprise${paged.total > 1 ? "s" : ""} — une ligne par entreprise, et des nombres plutôt que du contenu.`
            : "Les entreprises Oasis Care Pro, en nombres. Une ligne = une entreprise."
        }
      />

      <SearchBar
        action="/organisations"
        defaultValue={search ?? ""}
        placeholder="Nom commercial, raison sociale, SIRET, ou identifiant exact…"
      >
        {filtre && <input type="hidden" name="filtre" value={filtre} />}
      </SearchBar>

      <FilterBar
        label="Filtrer les entreprises"
        current={hrefFor({ page: 1 })}
        filters={ORGANIZATION_FILTERS.map((option) => ({
          label: option.label,
          href: hrefFor({ filtre: option.value, page: 1 }),
        }))}
      />

      {isBeyondLastPage(paged) ? (
        <EmptyState
          title={`La page ${page} est au-delà de la fin de la liste`}
          description="Le nombre total est rendu par la base sur les lignes elles-mêmes : sans ligne, il n'est pas connu."
          action={<ButtonLink href={hrefFor({ page: 1 })}>Revenir à la première page</ButtonLink>}
        />
      ) : (
        <OrganizationsTable
          rows={paged.rows}
          empty={
            <EmptyState
              title="Aucune entreprise ne correspond"
              description={
                search
                  ? `La recherche « ${search} » ne rend aucune entreprise. Un SIRET se cherche avec au moins quatre chiffres ; un identifiant se cherche en entier. Les entreprises archivées sont masquées par défaut — le filtre « Archivées » les montre.`
                  : "Aucune entreprise ne correspond à ce filtre."
              }
              action={
                search || filtre ? (
                  <ButtonLink href="/organisations" variant="secondary">
                    Effacer la recherche et les filtres
                  </ButtonLink>
                ) : undefined
              }
            />
          }
          footer={
            paged.total !== null ? (
              <Pagination
                page={paged.page}
                pageSize={paged.pageSize}
                total={paged.total}
                hrefFor={(target) => hrefFor({ page: target })}
              />
            ) : undefined
          }
        />
      )}

      <div className="mt-5">
        <Panel
          title="Ce que cette liste ne montre pas"
          description="Des champs de la spec p.9-11 qu'aucune fonction d'administration ne rend aujourd'hui. Ils existent en base : ce sont des migrations à écrire, pas des données perdues."
        >
          <GapList gaps={ORGANIZATION_GAPS} />
        </Panel>
      </div>
    </>
  );
}
