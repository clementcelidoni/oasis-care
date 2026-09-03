import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "./primitives";

/**
 * §37 TABLES — « recherche, filtres, tri, pagination. Cliquer ligne :
 * ouvre détail. »
 *
 * `DataTable` est délibérément un composant SERVEUR sans état. Le tri
 * et les filtres passent par l'URL (`?tri=…&statut=…`), pas par un
 * `useState` : une liste triée doit rester triée quand on ouvre une
 * fiche et qu'on revient, et un lien vers « les factures en retard »
 * doit pouvoir se coller dans un message.
 */

export type Column<Row> = {
  key: string;
  header: string;
  /** Rendu de la cellule. */
  cell: (row: Row) => ReactNode;
  /** Aligné à droite : pour les montants et les quantités. */
  numeric?: boolean;
  /** Masquée sous 1024px — §46 « supporter laptop, tablette ». */
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
  /** Cliquer une ligne ouvre le détail. */
  rowHref?: (row: Row) => string;
  empty: ReactNode;
  footer?: ReactNode;
}) {
  if (rows.length === 0) {
    return <>{empty}</>;
  }

  return (
    <Card className="overflow-hidden">
      {/* Le conteneur défile, pas la page : §46 impose que le corps du
          document ne parte jamais en travers. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[var(--text-body)]">
          <thead>
            <tr className="border-b border-line bg-surface-sunken/60">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={`eyebrow px-4 py-2.5 text-left ${
                    column.numeric ? "text-right" : ""
                  } ${column.secondary ? "hidden lg:table-cell" : ""}`}
                >
                  {column.header}
                </th>
              ))}
              {rowHref && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  className="border-b border-line last:border-0 transition-colors hover:bg-canvas"
                >
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={`px-4 py-3 ${column.numeric ? "tabular text-right" : ""} ${
                        column.secondary ? "hidden lg:table-cell" : ""
                      }`}
                    >
                      {/* Le lien porte sur la PREMIÈRE cellule et couvre
                          la ligne par un pseudo-élément. Envelopper
                          chaque cellule produirait autant d'arrêts au
                          clavier qu'il y a de colonnes, pour une seule
                          destination. */}
                      {href && index === 0 ? (
                        <Link href={href} className="relative font-medium hover:text-accent">
                          <span className="absolute inset-y-0 -left-4 right-0 -z-0 w-screen" />
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
      {footer && <div className="border-t border-line px-4 py-2.5">{footer}</div>}
    </Card>
  );
}

/**
 * §37 — la barre de recherche d'une liste.
 *
 * Un vrai formulaire GET : la recherche atterrit dans l'URL, donc dans
 * l'historique et dans le presse-papiers. Elle marche aussi sans
 * JavaScript, ce qui n'est pas une coquetterie — c'est ce qui la rend
 * indépendante de l'état d'hydratation de la page.
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
    <form
      action={action}
      className="mb-4 flex flex-wrap items-center gap-2"
      role="search"
    >
      <div className="relative min-w-56 flex-1">
        <span
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
        >
          ⌕
        </span>
        <input
          type="search"
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface py-2 pl-8 pr-3 text-[var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent"
        />
      </div>
      {children}
    </form>
  );
}

/**
 * §25 FILTRES — des liens, pas des cases à cocher.
 *
 * Chaque filtre est une URL. On peut donc l'envoyer à un collègue, et
 * le bouton « précédent » du navigateur défait le filtre au lieu de
 * quitter la page.
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
    /**
     * Une pastille de couleur AVANT le libellé, quand la chose filtrée
     * en porte une dans les données — une équipe, par exemple. Elle
     * double le libellé, elle ne le remplace jamais : une couleur
     * choisie par l'utilisateur n'est ni forcément lisible ni
     * forcément distinguable d'une autre. Facultative ; sans elle,
     * rien ne change pour les écrans qui utilisent déjà ce composant.
     */
    dot?: string;
  }[];
  current: string;
  label?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {filters.map((filter) => {
        const active = filter.href === current;
        return (
          <Link
            key={filter.href}
            href={filter.href}
            aria-current={active ? "true" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1.5 text-[var(--text-secondary)] transition-colors ${
              active
                ? "bg-accent text-accent-ink"
                : "border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink"
            }`}
          >
            {filter.dot && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: filter.dot }}
              />
            )}
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
 * §35 ActivityTimeline — « AUJOURD'HUI » du tableau de bord, et
 * l'historique d'une fiche client.
 *
 * L'heure est à gauche, alignée : c'est la colonne que l'œil descend
 * quand il cherche « et à 14 h, il se passe quoi ».
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
        <li key={item.id} className="flex gap-4">
          <div className="flex w-14 shrink-0 justify-end pt-0.5">
            <span className="tabular text-[var(--text-secondary)] text-ink-faint">{item.time}</span>
          </div>

          {/* La ligne verticale s'arrête au dernier point : la
              prolonger sous le dernier élément suggère une suite qui
              n'existe pas. */}
          <div className="relative flex w-3 shrink-0 justify-center">
            <span
              aria-hidden
              className={`z-10 mt-1.5 h-2 w-2 rounded-full ${dotTone[item.tone ?? "neutral"]}`}
            />
            {index < items.length - 1 && (
              <span aria-hidden className="absolute top-3 h-full w-px bg-line" />
            )}
          </div>

          <div className="min-w-0 flex-1 pb-5">
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
