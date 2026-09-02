import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import {
  PageHeader, Panel, SearchBar, FilterBar, EmptyState, ButtonLink, SubmitButton, Badge,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { toggleFavorite } from "@/lib/search/actions";
import {
  parseQuery, SEARCH_GROUPS, SEARCH_FILTERS, ENTITY_LABELS,
  type EntityType, type SearchResult,
} from "@/lib/search/types";

/**
 * §22 « Voir tous les résultats » — la page complète de la recherche.
 *
 * La palette (⌘K) montre six résultats par famille et s'arrête là :
 * c'est un outil pour ATTEINDRE quelque chose qu'on a déjà en tête.
 * Cette page-ci est l'autre moitié — celle qu'on ouvre quand on ne sait
 * pas encore ce qu'on cherche, et qu'on veut voir tout ce que l'espace
 * de travail contient sur « Martin ».
 *
 * Elle est un composant SERVEUR, et tout son état tient dans l'URL
 * (`?q=` et `?type=`). Pas de `useState` : une page de résultats doit
 * pouvoir se recharger, se coller dans un message et revenir intacte
 * par le bouton « précédent » du navigateur. C'est la même raison qui
 * fait de `FilterBar` des liens plutôt que des boutons.
 */

/**
 * §22 « Limiter résultats initiaux » — mais généreusement ici.
 *
 * `global_search` coupe à `p_limit` PAR TYPE, pas au total : cinquante
 * clients ET cinquante devis peuvent revenir ensemble. Au-delà, ce
 * n'est plus une liste qu'on lit, c'est une recherche à reformuler — et
 * la page le dit alors franchement au lieu de laisser croire qu'elle a
 * tout montré.
 */
const PER_TYPE_LIMIT = 50;

/** L'URL d'un filtre. « Tout » n'écrit pas de paramètre : c'est le défaut. */
function searchHref(query: string, filterKey: string): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filterKey !== "tout") params.set("type", filterKey);
  const suffix = params.toString();
  return suffix ? `/recherche?${suffix}` : "/recherche";
}

export default async function SearchPage({ searchParams }: PageProps<"/recherche">) {
  const organization = await requireOrganization();
  const params = await searchParams;

  const rawQuery = typeof params.q === "string" ? params.q : "";

  // §26 — la syntaxe `type:devis` est analysée par `parseQuery`, pas
  // ici : la palette et cette page doivent comprendre exactement la
  // même chose, sinon « Voir tous les résultats » changerait les
  // résultats en changeant d'écran.
  const parsed = parseQuery(rawQuery);

  // Un `type` inconnu dans l'URL retombe sur « Tout » plutôt que de
  // vider l'écran : un lien tronqué ou un vieux favori doit encore
  // marcher.
  const requestedFilter = typeof params.type === "string" ? params.type : "tout";
  const activeFilter =
    SEARCH_FILTERS.find((filter) => filter.key === requestedFilter) ?? SEARCH_FILTERS[0];

  // Le même plancher que la fonction SQL. Le rappeler ici évite un
  // aller-retour qui, par construction, ne rendrait rien.
  const searchable = parsed.text.trim().length >= 2;

  const supabase = await createClient();

  let results: SearchResult[] = [];
  let failed = false;

  if (searchable) {
    // Les types passés au SQL viennent de la SYNTAXE, pas du filtre par
    // famille : la requête ramène tout, et le filtre ne fait que
    // masquer. C'est ce qui permet à la barre de filtres d'afficher des
    // décomptes justes — un décompte calculé sur un ensemble déjà
    // filtré vaudrait toujours zéro pour les autres familles.
    const { data, error } = await supabase.rpc("global_search", {
      p_organization_id: organization.organizationId,
      p_query: parsed.text,
      p_types: parsed.types,
      p_limit: PER_TYPE_LIMIT,
    });

    if (error) {
      console.error("page de recherche :", error.message);
      failed = true;
    } else {
      results = (data ?? []) as SearchResult[];
    }
  }

  // §28 FAVORIS — quelles lignes sont déjà épinglées. La RLS restreint
  // la table à l'utilisateur courant, d'où le seul filtre sur
  // l'organisation.
  const favorites = new Set<string>();
  if (results.length > 0) {
    const { data: rows } = await supabase
      .from("user_favorites")
      .select("entity_type, entity_id")
      .eq("organization_id", organization.organizationId);

    for (const row of rows ?? []) favorites.add(`${row.entity_type}:${row.entity_id}`);
  }

  // Combien par type — pour savoir si la coupure à cinquante a mordu.
  const perType = new Map<string, number>();
  for (const result of results) {
    perType.set(result.entity_type, (perType.get(result.entity_type) ?? 0) + 1);
  }
  const saturated = (types: EntityType[]) =>
    types.some((type) => (perType.get(type) ?? 0) >= PER_TYPE_LIMIT);

  const activeTypes = activeFilter.types;
  const shown =
    activeTypes === null
      ? results
      : results.filter((result) => activeTypes.includes(result.entity_type));

  // §22 — regroupés par famille, dans l'ordre de `SEARCH_GROUPS` : le
  // plus fréquemment cherché en premier, pas le mieux scoré.
  const groups = SEARCH_GROUPS.map((group) => ({
    ...group,
    rows: shown.filter((result) => group.types.includes(result.entity_type)),
  })).filter((group) => group.rows.length > 0);

  // Une famille sans résultat n'a pas de filtre : proposer « Factures 0 »
  // n'est qu'une impasse de plus à cliquer. Le filtre ACTIF reste
  // affiché même vide, sans quoi il disparaîtrait sous les pieds de
  // celui qui vient de le choisir.
  const filters = SEARCH_FILTERS.flatMap((filter) => {
    const types = filter.types;
    const count =
      types === null
        ? results.length
        : results.filter((result) => types.includes(result.entity_type)).length;

    if (types !== null && count === 0 && filter.key !== activeFilter.key) return [];
    return [{ label: filter.label, href: searchHref(rawQuery, filter.key), count }];
  });

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Recherche"
        subtitle={
          searchable
            ? `${results.length} résultat${results.length > 1 ? "s" : ""} pour « ${parsed.text} »`
            : "Clients, chantiers, devis, factures, plans, lots, salariés — tout ce que contient votre espace de travail."
        }
      />

      {/* Un formulaire GET vers cette même page : la recherche atterrit
          dans l'URL, donc dans l'historique. Le filtre par famille n'est
          volontairement PAS reporté sur la nouvelle requête — chercher
          autre chose repart de « Tout », plutôt que de se heurter à un
          écran vide dont la cause serait invisible. */}
      <SearchBar
        action="/recherche"
        defaultValue={rawQuery}
        placeholder="Client, devis, facture, lot, objet du plan…"
      >
        <SubmitButton variant="secondary">Rechercher</SubmitButton>
      </SearchBar>

      {/* §26 — dire ce que la syntaxe a fait. Une recherche restreinte
          sans qu'on sache pourquoi passe pour une recherche cassée. */}
      {parsed.keywords.length > 0 && (
        <p className="mb-4 text-[var(--text-secondary)] text-ink-soft">
          Restreint par <span className="font-mono text-ink">{parsed.keywords.join(" ")}</span>.
          Retirez ce mot-clé du champ pour chercher partout.
        </p>
      )}

      {/* §25 FILTRES RECHERCHE — des liens, un par famille. */}
      {results.length > 0 && (
        <FilterBar
          filters={filters}
          current={searchHref(rawQuery, activeFilter.key)}
          label="Filtrer par famille"
        />
      )}

      {!searchable ? (
        <EmptyState
          icon={<Icon name="search" className="h-5 w-5" />}
          title="Que cherchez-vous ?"
          description="Deux caractères suffisent : un nom de client, un numéro de devis, un téléphone, une référence de lot — ou même le nom d'un arbre posé sur un plan."
        />
      ) : failed ? (
        // §9 — on ne fait pas passer une panne pour une absence de
        // résultat : « rien ne correspond » enverrait chercher ailleurs
        // quelque chose qui existe bel et bien.
        <EmptyState
          title="La recherche n'a pas abouti"
          description="Le service de recherche n'a pas répondu. Vos données sont intactes ; il n'y a qu'à réessayer."
          action={
            <ButtonLink href={searchHref(rawQuery, activeFilter.key)} variant="secondary">
              Réessayer
            </ButtonLink>
          }
        />
      ) : results.length === 0 ? (
        <EmptyState
          title={`Rien ne correspond à « ${parsed.text} »`}
          description="Essayez un nom, un numéro, un téléphone — les accents et une orthographe approximative sont tolérés. Vous pouvez aussi écrire « type:devis » devant votre recherche pour ne chercher que là, mais ce n'est jamais obligatoire."
          action={
            <ButtonLink href="/" variant="secondary">
              Retour au tableau de bord
            </ButtonLink>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title={`Aucun résultat dans « ${activeFilter.label} »`}
          description="D'autres familles en contiennent. Revenez à la vue complète pour les voir."
          action={
            <ButtonLink href={searchHref(rawQuery, "tout")} variant="secondary">
              Voir tous les résultats
            </ButtonLink>
          }
        />
      ) : (
        groups.map((group) => (
          <Panel
            key={group.key}
            title={group.label}
            count={group.rows.length}
            className="mb-4"
            footer={
              saturated(group.types) ? (
                <p className="text-[var(--text-secondary)] text-ink-faint">
                  Les {PER_TYPE_LIMIT} résultats les plus pertinents sont affichés. Précisez
                  votre recherche pour atteindre les autres.
                </p>
              ) : undefined
            }
          >
            <ul className="divide-y divide-line">
              {group.rows.map((result) => (
                <ResultRow
                  key={`${result.entity_type}-${result.entity_id}`}
                  result={result}
                  favorite={favorites.has(`${result.entity_type}:${result.entity_id}`)}
                />
              ))}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}

/**
 * §23 OUVERTURE DIRECTE — « Cliquer résultat : Client → fiche client. »
 *
 * L'URL est portée par le résultat lui-même (`global_search` la rend) :
 * vingt-deux familles d'objets, et aucune branche dans l'interface.
 *
 * L'étoile est un FORMULAIRE posé À CÔTÉ du lien, jamais dedans : un
 * `<form>` imbriqué dans un `<a>` est invalide, et surtout épingler ne
 * doit pas naviguer. Ce sont deux gestes différents sur la même ligne.
 */
function ResultRow({ result, favorite }: { result: SearchResult; favorite: boolean }) {
  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <Link href={result.url} className="group flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-surface-sunken text-ink-faint">
          <Icon name={result.icon} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[var(--text-body)] font-medium transition-colors group-hover:text-accent">
            {result.title}
          </span>
          {result.subtitle && (
            <span className="block truncate text-[var(--text-secondary)] text-ink-faint">
              {result.subtitle}
            </span>
          )}
        </span>
      </Link>

      {/* Le type, écrit. Deux « Villa Martin » dans la même liste — la
          propriété et le chantier — ne se distinguent que par là. */}
      <span className="hidden shrink-0 sm:block">
        <Badge>{ENTITY_LABELS[result.entity_type]}</Badge>
      </span>

      <form action={toggleFavorite} className="shrink-0">
        <input type="hidden" name="entity_type" value={result.entity_type} />
        <input type="hidden" name="entity_id" value={result.entity_id} />
        <input type="hidden" name="title" value={result.title} />
        <input type="hidden" name="url" value={result.url} />
        {/* Une étoile dessinée en caractère plutôt qu'une icône du jeu
            maison : celui-ci n'en contient pas, et §28 demande un
            symbole reconnaissable sans légende. Le caractère hérite de
            la couleur du texte, donc des mêmes jetons. */}
        <button
          type="submit"
          aria-pressed={favorite}
          aria-label={
            favorite
              ? `Retirer ${result.title} des favoris`
              : `Ajouter ${result.title} aux favoris`
          }
          title={favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
          className={`rounded-[var(--radius-control)] px-2 py-1 text-[16px] leading-none transition-colors ${
            favorite ? "text-warning" : "text-ink-faint hover:bg-canvas hover:text-ink"
          }`}
        >
          {favorite ? "★" : "☆"}
        </button>
      </form>
    </li>
  );
}
