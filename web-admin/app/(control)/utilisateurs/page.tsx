import type { Metadata } from "next";

import { ReadFailure } from "@/components/customers/read-failure";
import { UsersTable } from "@/components/customers/users-table";
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
import { listHref, parseFilter, USER_FILTERS } from "@/lib/customers/filters";
import { isBeyondLastPage, parsePage, parseSearch, type Paged } from "@/lib/customers/pagination";
import { listUsers } from "@/lib/customers/source";
import type { AdminUserRow } from "@/lib/customers/types";
import { formatCount } from "@/lib/format";

/**
 * ==================================================================
 * USERS — spec p.7. Point 5 du jalon.
 * ==================================================================
 *
 * « Recherche universelle : nom, email, userId, organisation, plan,
 * date inscription. » La fonction `admin_list_users` couvre le nom,
 * l'e-mail et l'identifiant exact ; l'organisation et le plan se
 * cherchent par les filtres, et la date d'inscription est la colonne de
 * tri (la plus récente en premier).
 *
 * ------------------------------------------------------------------
 * TOUT L'ÉTAT EST DANS L'URL
 * ------------------------------------------------------------------
 * La recherche, le filtre et la page sont des paramètres d'URL, jamais
 * un `useState`. Trois raisons, dans l'ordre d'importance :
 *
 *   1. Cette page reste un composant SERVEUR. Un tableau rendu côté
 *      client expédierait la page de résultats — des comptes de
 *      clients — dans le bundle et dans l'onglet Réseau du navigateur.
 *   2. Une liste filtrée doit rester filtrée quand on ouvre une fiche
 *      puis qu'on revient.
 *   3. « Les comptes bannis » est une URL qui se colle dans un message
 *      d'équipe.
 *
 * ------------------------------------------------------------------
 * LA PAGINATION EST RÉELLE
 * ------------------------------------------------------------------
 * `offset`/`limit` en SQL, cinquante lignes par page, total rendu par
 * la base. Rien n'est chargé puis découpé en mémoire : une table qui
 * charge tout finit par ne plus charger, et ce serait sur la base la
 * plus grosse — donc chez le client le plus important.
 */

export const metadata: Metadata = {
  title: "Utilisateurs — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function UtilisateursPage({ searchParams }: PageProps<"/utilisateurs">) {
  await requireAdmin("platform.users.read");

  // `searchParams` est asynchrone dans cette version de Next.
  const params = await searchParams;
  const search = parseSearch(params.q);
  const filtre = parseFilter(params.filtre);
  const page = parsePage(params.page);

  const hrefFor = (target: { q?: string | null; filtre?: string | null; page?: number }) =>
    listHref("/utilisateurs", { q: search, filtre, ...target });

  let paged: Paged<AdminUserRow>;
  try {
    paged = await listUsers({ search, filter: filtre, page });
  } catch (error) {
    return (
      <>
        <Header search={search} />
        <ReadFailure error={error} retryHref={listHref("/utilisateurs", { q: search })} />
      </>
    );
  }

  const beyondEnd = isBeyondLastPage(paged);

  return (
    <>
      <Header search={search} total={paged.total} />

      <SearchBar
        action="/utilisateurs"
        defaultValue={search ?? ""}
        placeholder="Nom, adresse e-mail, ou identifiant exact…"
      >
        {/* Le filtre voyage avec la recherche : chercher « dupont » en
            regardant les comptes bannis ne doit pas rendre les autres.
            La page, elle, n'est PAS reportée — une nouvelle recherche
            recommence à la première page, sinon elle s'ouvrirait
            au-delà de la fin. */}
        {filtre && <input type="hidden" name="filtre" value={filtre} />}
      </SearchBar>

      <FilterBar
        label="Filtrer les comptes"
        current={hrefFor({ page: 1 })}
        filters={USER_FILTERS.map((option) => ({
          label: option.label,
          href: hrefFor({ filtre: option.value, page: 1 }),
          disabledReason: option.unsupportedReason,
        }))}
      />

      {beyondEnd ? (
        // Une page vide au-delà de la fin n'est PAS « aucun résultat ».
        // Le total voyageait sur les lignes : il a disparu avec elles,
        // et on ne peut donc pas dire combien il y en avait. On le dit.
        <EmptyState
          title={`La page ${page} est au-delà de la fin de la liste`}
          description="Il y a peut-être beaucoup de résultats, mais pas jusqu'ici. Le nombre total est rendu par la base sur les lignes elles-mêmes : sans ligne, il n'est pas connu."
          action={<ButtonLink href={hrefFor({ page: 1 })}>Revenir à la première page</ButtonLink>}
        />
      ) : (
        <UsersTable
          rows={paged.rows}
          empty={
            <EmptyState
              title="Aucun compte ne correspond"
              description={
                search
                  ? `La recherche « ${search} » ne rend aucun compte. L'identifiant se cherche en entier : une portion d'uuid ne correspond à rien.`
                  : "Aucun compte ne correspond à ce filtre."
              }
              action={
                search || filtre ? (
                  <ButtonLink href="/utilisateurs" variant="secondary">
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
        <UnfilterablePanel />
      </div>
    </>
  );
}

function Header({ search, total }: { search: string | null; total?: number | null }) {
  return (
    <PageHeader
      eyebrow="Clients"
      title="Tous les utilisateurs"
      subtitle={
        total !== null && total !== undefined
          ? `${formatCount(total)} compte${total > 1 ? "s" : ""} — leurs métadonnées et leurs rattachements, jamais leur contenu.`
          : "Les comptes Oasis Care, leurs métadonnées et leurs rattachements. Pas leur contenu."
      }
      breadcrumb={search ? { label: "Tous les utilisateurs", href: "/utilisateurs" } : undefined}
    />
  );
}

/**
 * Les trois filtres que la spec demande et que la base refuse.
 *
 * Ils sont déjà dessinés éteints dans la barre de filtres, avec leur
 * raison en attribut `title`. Ce panneau existe parce qu'un `title` ne
 * se lit qu'à la souris : il n'existe ni au doigt, ni au clavier, ni
 * pour un lecteur d'écran. Or la raison est ici plus intéressante que
 * le filtre lui-même — elle dit ce qu'il faudrait enregistrer pour que
 * la question devienne posable.
 */
function UnfilterablePanel() {
  const unsupported = USER_FILTERS.filter((option) => option.unsupportedReason !== undefined);

  return (
    <Panel
      title="Ce que cette liste ne sait pas filtrer"
      description="Trois filtres de la spec p.7 n'ont aucune donnée derrière. La base lève plutôt que de rendre la liste entière sous un titre qui affirmerait le contraire."
    >
      <ul className="divide-y divide-line">
        {unsupported.map((option) => (
          <li key={option.label} className="px-4 py-2.5">
            <p className="text-[var(--text-body)] font-medium text-ink-soft">{option.label}</p>
            <p className="mt-1 max-w-prose text-[var(--text-secondary)] leading-relaxed text-ink-faint">
              {option.unsupportedReason}
            </p>
          </li>
        ))}
        <li className="px-4 py-2.5">
          <p className="text-[var(--text-body)] font-medium text-ink-soft">
            « Actif » et « Inactif »
          </p>
          <p className="mt-1 max-w-prose text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Ces deux-là fonctionnent, mais mesurent la CONNEXION, pas l&apos;usage : le seuil est
            de trente jours sans connexion, fixé dans la base. Rien dans ce projet ne date un
            geste métier par utilisateur.
          </p>
        </li>
      </ul>
    </Panel>
  );
}
