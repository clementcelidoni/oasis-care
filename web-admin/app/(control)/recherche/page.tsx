import Link from "next/link";
import type { Metadata } from "next";

import { ReadFailure } from "@/components/customers/read-failure";
import { TechnicalDetails } from "@/components/customers/technical-details";
import {
  Badge,
  ButtonLink,
  EmptyState,
  EntityAvatar,
  PageHeader,
  Panel,
  SearchBar,
  SectionHeader,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { matchedOnLabel } from "@/lib/customers/labels";
import { parseSearch } from "@/lib/customers/pagination";
import { searchPlatform } from "@/lib/customers/source";
import type { AdminSearchRow } from "@/lib/customers/types";

/**
 * ==================================================================
 * GLOBAL ADMIN SEARCH — spec p.33. Point 7 du jalon.
 * ==================================================================
 *
 * Une seule barre pour un compte, une adresse, une entreprise, un
 * SIRET, un identifiant. La barre de l'en-tête pointe ici en GET, avec
 * le paramètre `q` : la recherche est donc une URL, qui se colle dans
 * un message et se retrouve dans l'historique.
 *
 * ------------------------------------------------------------------
 * POURQUOI PAS `global_search()` DE LA MIGRATION 0061
 * ------------------------------------------------------------------
 * Cette fonction-là est bornée à UNE organisation : elle prend un
 * `p_organization_id` et vérifie `is_organization_member`. C'est
 * l'inverse exact du besoin, et lui passer les organisations une par
 * une reviendrait à lui faire dire ce qu'elle a été écrite pour
 * refuser.
 *
 * Ce qu'on cherche ici est d'une autre nature : des IDENTITÉS. Aucune
 * branche de `admin_global_search` ne touche un devis, une facture ou
 * une plante, et cet écran n'en ajoute aucune.
 *
 * ------------------------------------------------------------------
 * LE MOINDRE PRIVILÈGE EST DANS LA FONCTION, PAS DANS CETTE PAGE
 * ------------------------------------------------------------------
 * `admin_global_search` ne rend les comptes que si l'appelant porte
 * `platform.users.read`, et les entreprises que s'il porte
 * `platform.organizations.read`. Une recherche qui rendrait ce qu'une
 * liste refuse serait une porte dérobée dans le moindre privilège — et
 * c'est le SQL qui la ferme, pas un `if` de cette page, parce qu'un
 * `if` de cette page ne protégerait pas le prochain appelant de la
 * fonction.
 *
 * D'où une conséquence à ne pas prendre pour un bug : un rôle qui ne
 * peut pas lister les entreprises ne verra jamais d'entreprise ici,
 * même en cherchant son nom exact.
 */

export const metadata: Metadata = {
  title: "Recherche — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

/** Le minimum imposé par la fonction SQL. En dessous, elle ne rend rien. */
const MIN_LENGTH = 2;

/**
 * Le plafond demandé à la base, PAR TYPE de résultat — la fonction
 * applique son `limit` à chaque branche séparément.
 *
 * Une recherche n'est pas une liste : on vient y reconnaître quelque
 * chose qu'on cherche, pas parcourir un annuaire. Vingt suffisent, et
 * au-delà c'est la liste filtrée qu'il faut ouvrir.
 *
 * Mais un plafond atteint doit se DIRE. Vingt résultats affichés sans
 * un mot laisseraient croire qu'il n'y en a que vingt, et un
 * administrateur conclurait que le compte qu'il cherche n'existe pas
 * alors qu'il est le vingt-et-unième.
 */
const LIMIT_PER_TYPE = 20;

export default async function RecherchePage({ searchParams }: PageProps<"/recherche">) {
  const admin = await requireAdmin("platform.search");

  const params = await searchParams;
  const query = parseSearch(params.q);

  const form = (
    <SearchBar
      action="/recherche"
      name="q"
      defaultValue={query ?? ""}
      placeholder="Un nom, une adresse e-mail, une entreprise, un SIRET, un identifiant…"
    />
  );

  if (query === null) {
    return (
      <>
        <Header />
        {form}
        <EmptyState
          title="Que cherchez-vous ?"
          description="Un compte par son nom ou son adresse, une entreprise par son nom commercial, sa raison sociale ou son SIRET, l'un comme l'autre par son identifiant exact. Deux caractères au minimum."
        />
        <div className="mt-5">
          <Coverage />
        </div>
      </>
    );
  }

  if (query.length < MIN_LENGTH) {
    return (
      <>
        <Header query={query} />
        {form}
        <EmptyState
          title="Recherche trop courte"
          description={`Il faut au moins ${MIN_LENGTH} caractères. En dessous, la requête balaierait la plateforme entière pour rendre des résultats qui ne veulent rien dire.`}
        />
      </>
    );
  }

  let results: AdminSearchRow[];
  try {
    results = await searchPlatform(query, LIMIT_PER_TYPE);
  } catch (error) {
    return (
      <>
        <Header query={query} />
        {form}
        <ReadFailure error={error} retryHref="/recherche" />
      </>
    );
  }

  const users = results.filter((row) => row.result_type === "user");
  const organizations = results.filter((row) => row.result_type === "organization");
  // Une branche que 0075 n'a pas écrite aujourd'hui mais pourrait
  // écrire demain : on ne la fait pas disparaître en silence.
  const others = results.filter(
    (row) => row.result_type !== "user" && row.result_type !== "organization",
  );

  return (
    <>
      <Header query={query} count={results.length} />
      {form}

      {results.length === 0 ? (
        <EmptyState
          title={`Rien ne correspond à « ${query} »`}
          description="Un identifiant se cherche en entier — une portion d'uuid ne correspond à rien. Un SIRET demande au moins quatre chiffres, faute de quoi il ferait remonter presque toutes les entreprises. Et cette recherche ne couvre que des identités : ni devis, ni facture, ni plante."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {users.length > 0 && (
            <section>
              <SectionHeader
                title="Comptes"
                count={users.length}
                description={saturated(users.length)}
                action={moreLink(users.length, "/utilisateurs", query, "Voir tous les comptes")}
              />
              <ResultList rows={users} hrefFor={(row) => `/utilisateurs/${row.result_id}`} round />
            </section>
          )}

          {organizations.length > 0 && (
            <section>
              <SectionHeader
                title="Entreprises"
                count={organizations.length}
                description={saturated(organizations.length)}
                action={moreLink(
                  organizations.length,
                  "/organisations",
                  query,
                  "Voir toutes les entreprises",
                )}
              />
              <ResultList
                rows={organizations}
                hrefFor={(row) => `/organisations/${row.result_id}`}
              />
            </section>
          )}

          {others.length > 0 && (
            <section>
              <SectionHeader
                title="Autres résultats"
                description="Un type de résultat que cette interface ne sait pas encore ouvrir. Il est affiché plutôt que masqué : un résultat invisible se confondrait avec une absence."
                count={others.length}
              />
              <ResultList rows={others} hrefFor={() => null} />
            </section>
          )}

          <TechnicalDetails
            entries={results.map((row) => ({
              label: `${row.result_type} · ${row.title ?? "sans titre"}`,
              value: row.result_id,
            }))}
          >
            Spec p.35 : les identifiants techniques ne s&apos;affichent que derrière ce dépliant.
          </TechnicalDetails>
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-6">
          <Coverage />
        </div>
      )}

      {/* Le rôle décide de ce que la recherche peut rendre. Le dire
          évite de chercher un bug là où le moindre privilège fonctionne
          exactement comme prévu. */}
      {!admin.permissions.includes("platform.organizations.read") && (
        <p className="mt-4 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Votre rôle ne porte pas <code className="font-mono text-[12px]">platform.organizations.read</code> :
          aucune entreprise ne peut apparaître dans ces résultats, même en cherchant son nom exact.
        </p>
      )}
      {!admin.permissions.includes("platform.users.read") && (
        <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Votre rôle ne porte pas <code className="font-mono text-[12px]">platform.users.read</code> :
          aucun compte ne peut apparaître dans ces résultats.
        </p>
      )}
    </>
  );
}

/**
 * Le plafond est-il atteint pour ce type de résultat ?
 *
 * On ne peut pas savoir combien il y en a « en vrai » : la fonction
 * rend au plus `LIMIT_PER_TYPE` lignes et ne compte pas le reste. Alors
 * on ne l'invente pas — on dit qu'il peut y en avoir d'autres, et on
 * indique l'écran qui, lui, sait paginer.
 */
function saturated(count: number): string | undefined {
  if (count < LIMIT_PER_TYPE) return undefined;
  return `Affichage limité à ${LIMIT_PER_TYPE} résultats — il y en a peut-être davantage, et la base ne compte pas le reste. La liste, elle, pagine.`;
}

/** Le bouton qui emmène vers la liste paginée, quand la recherche sature. */
function moreLink(count: number, listPath: string, query: string, label: string) {
  if (count < LIMIT_PER_TYPE) return undefined;
  return (
    <ButtonLink href={`${listPath}?q=${encodeURIComponent(query)}`} variant="secondary">
      {label}
    </ButtonLink>
  );
}

function Header({ query, count }: { query?: string; count?: number } = {}) {
  return (
    <PageHeader
      eyebrow="Recherche"
      title={query ? `Recherche : ${query}` : "Recherche administrative"}
      subtitle={
        count !== undefined
          ? `${count} résultat${count > 1 ? "s" : ""} — des identités uniquement : un compte, une adresse, une entreprise, un SIRET, un identifiant. Pas de contenu métier.`
          : "Un compte, une adresse, une entreprise, un SIRET, un identifiant. Pas de contenu métier."
      }
    />
  );
}

/**
 * Une ligne de résultat SAIT OÙ ELLE MÈNE.
 *
 * `matched_on` est affiché, et ce n'est pas décoratif : quand on cherche
 * « 4521 » et qu'une entreprise remonte, savoir que c'est son SIRET — et
 * non son nom — évite de croire à un résultat aberrant et de
 * recommencer la recherche autrement.
 */
function ResultList({
  rows,
  hrefFor,
  round = false,
}: {
  rows: AdminSearchRow[];
  hrefFor: (row: AdminSearchRow) => string | null;
  round?: boolean;
}) {
  return (
    <Panel>
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const title = row.title ?? row.result_id;
          const href = hrefFor(row);

          const body = (
            <>
              <EntityAvatar name={title} shape={round ? "round" : "square"} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--text-body)] font-medium">{title}</span>
                {row.subtitle && (
                  <span className="block truncate text-[var(--text-secondary)] text-ink-faint">
                    {row.subtitle}
                  </span>
                )}
              </span>
              {row.matched_on && (
                <Badge tone="neutral">trouvé par {matchedOnLabel(row.matched_on)}</Badge>
              )}
            </>
          );

          return (
            <li key={`${row.result_type}:${row.result_id}`}>
              {href ? (
                <Link
                  href={href}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-raised"
                >
                  {body}
                  <span aria-hidden className="shrink-0 text-ink-faint">
                    →
                  </span>
                </Link>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/**
 * Ce que la recherche NE couvre pas.
 *
 * La spec p.33 énumère neuf cibles ; trois d'entre elles n'existent pas
 * dans cette plateforme. Les taire ferait chercher longtemps un
 * abonnement par son numéro.
 */
function Coverage() {
  return (
    <Panel
      title="Ce que cette recherche ne couvre pas"
      description="La spec p.33 énumère neuf cibles. Trois n'ont aucune donnée derrière, et deux autres n'appartiennent pas à ce jalon."
    >
      <ul className="divide-y divide-line">
        <li className="px-4 py-2.5">
          <p className="text-[var(--text-body)] font-medium text-ink-soft">Abonnement</p>
          <p className="mt-1 max-w-prose text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Aucun abonnement d&apos;entreprise n&apos;est enregistré : la table est vide et aucune
            ligne du dépôt ne l&apos;écrit. Il n&apos;y a donc rien à chercher.
          </p>
        </li>
        <li className="px-4 py-2.5">
          <p className="text-[var(--text-body)] font-medium text-ink-soft">Facture SaaS</p>
          <p className="mt-1 max-w-prose text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Oasis Care ne facture personne aujourd&apos;hui — aucun encaissement n&apos;est
            branché. Les factures présentes en base sont celles que les entreprises clientes
            émettent vers LEURS clients : elles ne nous concernent pas, et le Control Center ne
            les ouvre pas.
          </p>
        </li>
        <li className="px-4 py-2.5">
          <p className="text-[var(--text-body)] font-medium text-ink-soft">Ticket de support</p>
          <p className="mt-1 max-w-prose text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Le support ne fait pas partie de ce jalon, et aucune table de tickets n&apos;existe.
          </p>
        </li>
      </ul>
    </Panel>
  );
}
