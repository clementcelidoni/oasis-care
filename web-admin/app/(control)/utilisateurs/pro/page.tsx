import type { Metadata } from "next";

import { ReadFailure } from "@/components/customers/read-failure";
import { UsersTable } from "@/components/customers/users-table";
import { ButtonLink, EmptyState, Pagination, PageHeader, SearchBar } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { listHref } from "@/lib/customers/filters";
import { isBeyondLastPage, parsePage, parseSearch, type Paged } from "@/lib/customers/pagination";
import { listUsers } from "@/lib/customers/source";
import type { AdminUserRow } from "@/lib/customers/types";
import { formatCount } from "@/lib/format";

/**
 * ==================================================================
 * OASIS CARE PRO — les comptes rattachés à une entreprise (spec p.5)
 * ==================================================================
 *
 * Contrairement à son voisin « Oasis Care Mobile », cette question-ci a
 * une réponse exacte : est membre de Pro qui est membre d'au moins une
 * entreprise non archivée. Ce n'est pas un proxy, c'est la définition.
 *
 * Le filtre est VERROUILLÉ à `pro` : pas de barre de filtres ici. Une
 * page dont le titre affirme « les comptes Pro » ne doit pas pouvoir
 * afficher autre chose, et un filtre dans l'URL qui contredirait le
 * titre serait précisément le genre d'écran qui fait perdre confiance à
 * l'équipe.
 *
 * Deux précisions que la fonction SQL porte déjà et qu'il ne faut
 * surtout pas refaire à la main :
 *
 *   • un même compte peut être membre de PLUSIEURS entreprises — la
 *     contrainte d'unicité porte sur le couple (organisation,
 *     utilisateur). Le décompte se fait donc par compte distinct, ce
 *     que `admin_list_users` fait en ne rendant qu'une ligne par
 *     compte ;
 *   • `archived_at` écarte les adhésions supprimées en douceur. Sans
 *     lui, le compteur ne baisserait jamais : un salarié parti resterait
 *     un utilisateur Pro pour l'éternité.
 */

export const metadata: Metadata = {
  title: "Utilisateurs Pro — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function UtilisateursProPage({
  searchParams,
}: PageProps<"/utilisateurs/pro">) {
  await requireAdmin("platform.users.read");

  const params = await searchParams;
  const search = parseSearch(params.q);
  const page = parsePage(params.page);

  const hrefFor = (target: { page?: number }) =>
    listHref("/utilisateurs/pro", { q: search, ...target });

  let paged: Paged<AdminUserRow>;
  try {
    // Le filtre n'est pas lu depuis l'URL : il est écrit ici.
    paged = await listUsers({ search, filter: "pro", page });
  } catch (error) {
    return (
      <>
        <PageHeader
          eyebrow="Clients"
          title="Oasis Care Pro"
          subtitle="Les comptes membres d'au moins une entreprise Pro."
        />
        <ReadFailure error={error} retryHref="/utilisateurs/pro" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title="Oasis Care Pro"
        subtitle={
          paged.total !== null
            ? `${formatCount(paged.total)} compte${paged.total > 1 ? "s" : ""} membre${paged.total > 1 ? "s" : ""} d'au moins une entreprise non archivée.`
            : "Les comptes membres d'au moins une entreprise Pro."
        }
      />

      <SearchBar
        action="/utilisateurs/pro"
        defaultValue={search ?? ""}
        placeholder="Nom, adresse e-mail, ou identifiant exact…"
      />

      {isBeyondLastPage(paged) ? (
        <EmptyState
          title={`La page ${page} est au-delà de la fin de la liste`}
          description="Le nombre total est rendu par la base sur les lignes elles-mêmes : sans ligne, il n'est pas connu."
          action={<ButtonLink href={hrefFor({ page: 1 })}>Revenir à la première page</ButtonLink>}
        />
      ) : (
        <UsersTable
          rows={paged.rows}
          empty={
            <EmptyState
              title={search ? "Aucun compte Pro ne correspond" : "Aucun compte n'est rattaché à une entreprise"}
              description={
                search
                  ? `La recherche « ${search} » ne rend aucun compte membre d'une entreprise. Le compte existe peut-être sans être rattaché : la liste complète le dirait.`
                  : "Aucun compte n'est aujourd'hui membre d'une entreprise Pro non archivée."
              }
              action={
                search ? (
                  <ButtonLink href="/utilisateurs" variant="secondary">
                    Chercher dans tous les comptes
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
    </>
  );
}
