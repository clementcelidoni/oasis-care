import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "./primitives";

/**
 * ==================================================================
 * LES TABLEAUX — spec p.34 : « tableaux puissants »
 * ==================================================================
 *
 * `DataTable` est délibérément un composant SERVEUR sans état. Le tri,
 * les filtres et la pagination passent par l'URL, pas par un
 * `useState` : une liste filtrée doit rester filtrée quand on ouvre une
 * fiche et qu'on revient, et un lien vers « les comptes inactifs » doit
 * pouvoir se coller dans un message d'équipe.
 *
 * Il y a une deuxième raison, propre à cette application : garder l'état
 * côté serveur garde aussi les DONNÉES côté serveur. Une table rendue
 * par un composant client expédierait toute la page de résultats dans
 * le bundle et dans l'onglet Réseau du navigateur — et ce sont des
 * comptes de clients.
 */

export type Column<Row> = {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** Aligné à droite : pour les nombres et les montants. */
  numeric?: boolean;
  /** Masquée sous 1280px : une console d'administration se consulte large. */
  secondary?: boolean;
  width?: string;
};

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  rowHref,
  empty,
  footer,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string;
  empty: ReactNode;
  footer?: ReactNode;
}) {
  if (rows.length === 0) {
    return <>{empty}</>;
  }

  return (
    <Card className="overflow-hidden">
      {/* Le conteneur défile, pas la page : le corps du document ne
          doit jamais partir en travers. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[var(--text-body)]">
          <thead>
            <tr className="border-b border-line bg-surface-sunken">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={`eyebrow px-3 py-2 text-left ${column.numeric ? "text-right" : ""} ${
                    column.secondary ? "hidden xl:table-cell" : ""
                  }`}
                >
                  {column.header}
                </th>
              ))}
              {rowHref && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  className="border-b border-line transition-colors last:border-0 hover:bg-surface-raised"
                >
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={`px-3 py-2 align-middle ${
                        column.numeric ? "tabular text-right" : ""
                      } ${column.secondary ? "hidden xl:table-cell" : ""}`}
                    >
                      {/* Le lien porte sur la PREMIÈRE cellule et couvre
                          la ligne par un pseudo-élément. Envelopper
                          chaque cellule produirait autant d'arrêts au
                          clavier qu'il y a de colonnes, pour une seule
                          destination. */}
                      {href && index === 0 ? (
                        <Link href={href} className="relative font-medium hover:text-accent">
                          <span className="absolute inset-y-0 -left-3 right-0 -z-0 w-screen" />
                          <span className="relative">{column.cell(row)}</span>
                        </Link>
                      ) : (
                        column.cell(row)
                      )}
                    </td>
                  ))}
                  {href && (
                    <td className="px-2 text-right text-ink-faint" aria-hidden>
                      →
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t border-line px-3 py-2">{footer}</div>}
    </Card>
  );
}

/**
 * La barre de recherche d'une liste. Un vrai formulaire GET : la
 * recherche atterrit dans l'URL, donc dans l'historique et dans le
 * presse-papiers, et elle fonctionne sans JavaScript.
 */
export function SearchBar({
  name = "q",
  defaultValue,
  placeholder = "Rechercher…",
  action,
  children,
}: {
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  /** L'URL de la liste. Vide = la page courante. */
  action?: string;
  /** Les filtres à emporter avec la recherche (champs cachés compris). */
  children?: ReactNode;
}) {
  return (
    <form action={action} className="mb-3 flex flex-wrap items-center gap-2" role="search">
      <div className="relative min-w-56 flex-1">
        <span
          aria-hidden
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
        >
          ⌕
        </span>
        <input
          type="search"
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken py-1.5 pl-7 pr-3 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </div>
      {children}
    </form>
  );
}

/**
 * Des filtres qui sont des LIENS, pas des cases à cocher : on peut les
 * envoyer à un collègue, et « précédent » défait le filtre au lieu de
 * quitter la page.
 *
 * `disabledReason` mérite un mot. La spec p.7 demande neuf filtres ;
 * trois n'ont aucune donnée derrière (Mobile, Trial, Cancelled) et
 * `admin_list_users` LÈVE plutôt que de les ignorer en silence. Un
 * filtre impossible se dessine donc éteint, avec la raison en survol,
 * plutôt que de disparaître : son absence pure ferait croire à un oubli
 * d'interface, alors que c'est une absence de donnée.
 */
export function FilterBar({
  filters,
  current,
  label = "Filtrer",
}: {
  filters: {
    label: string;
    href: string;
    count?: number;
    /** Si renseigné, le filtre est inerte et affiche cette raison. */
    disabledReason?: string;
  }[];
  current: string;
  label?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {filters.map((filter) => {
        if (filter.disabledReason) {
          return (
            <span
              key={filter.href}
              title={filter.disabledReason}
              aria-disabled="true"
              className="unknown-rule inline-flex cursor-not-allowed items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-[var(--text-secondary)]"
            >
              {filter.label}
            </span>
          );
        }

        const active = filter.href === current;
        return (
          <Link
            key={filter.href}
            href={filter.href}
            aria-current={active ? "true" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-[var(--text-secondary)] transition-colors ${
              active
                ? "bg-accent text-accent-ink"
                : "border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink"
            }`}
          >
            {filter.label}
            {filter.count !== undefined && (
              <span className={`tabular ${active ? "opacity-80" : "text-ink-faint"}`}>
                {filter.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * La pagination d'une liste. Elle affiche le TOTAL, pas seulement
 * « suivant » : sur un écran d'administration, « 1 à 50 sur 18 429 »
 * est souvent l'information qu'on venait chercher.
 */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="tabular text-[var(--text-secondary)] text-ink-soft">
        {from.toLocaleString("fr-FR")} à {to.toLocaleString("fr-FR")} sur{" "}
        {total.toLocaleString("fr-FR")}
      </p>
      <div className="flex items-center gap-1.5">
        {page > 1 ? (
          <Link
            href={hrefFor(page - 1)}
            className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-[var(--text-secondary)] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          >
            ← Précédent
          </Link>
        ) : (
          <span className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-[var(--text-secondary)] text-ink-faint">
            ← Précédent
          </span>
        )}
        <span className="tabular px-1 text-[var(--text-secondary)] text-ink-faint">
          {page} / {lastPage}
        </span>
        {page < lastPage ? (
          <Link
            href={hrefFor(page + 1)}
            className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-[var(--text-secondary)] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          >
            Suivant →
          </Link>
        ) : (
          <span className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-[var(--text-secondary)] text-ink-faint">
            Suivant →
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Une chronologie. L'heure est à gauche, alignée : c'est la colonne que
 * l'œil descend quand il cherche « et à 14 h, il s'est passé quoi ».
 */
export function ActivityTimeline({
  items,
}: {
  items: {
    id: string;
    time: string;
    title: string;
    detail?: string;
    href?: string;
    tone?: "neutral" | "accent" | "warning" | "critical";
  }[];
}) {
  if (items.length === 0) return null;

  const dotTone = {
    neutral: "bg-line-strong",
    accent: "bg-accent",
    warning: "bg-warning",
    critical: "bg-critical",
  } as const;

  return (
    <ol className="relative flex flex-col">
      {items.map((item, index) => (
        <li key={item.id} className="flex gap-3">
          <div className="flex w-12 shrink-0 justify-end pt-0.5">
            <span className="tabular text-[var(--text-secondary)] text-ink-faint">{item.time}</span>
          </div>

          {/* La ligne verticale s'arrête au dernier point : la
              prolonger suggérerait une suite qui n'existe pas. */}
          <div className="relative flex w-3 shrink-0 justify-center">
            <span
              aria-hidden
              className={`z-10 mt-1.5 h-2 w-2 rounded-full ${dotTone[item.tone ?? "neutral"]}`}
            />
            {index < items.length - 1 && (
              <span aria-hidden className="absolute top-3 h-full w-px bg-line" />
            )}
          </div>

          <div className="min-w-0 flex-1 pb-4">
            {item.href ? (
              <Link href={item.href} className="font-medium hover:text-accent">
                {item.title}
              </Link>
            ) : (
              <p className="font-medium">{item.title}</p>
            )}
            {item.detail && (
              <p className="text-[var(--text-secondary)] text-ink-soft">{item.detail}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
