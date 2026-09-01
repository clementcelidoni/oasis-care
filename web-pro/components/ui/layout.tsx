import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "./primitives";

/**
 * §35 — les pièces qui tiennent une page.
 *
 * §1 : « information importante ↓ action principale ↓ détails si
 * besoin ». Ces composants imposent cet ordre plutôt que de le
 * recommander : le titre est grand, l'action est à droite du titre, et
 * les détails vivent dans des sections en dessous.
 */

export function PageHeader({
  title,
  subtitle,
  action,
  breadcrumb,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Le chemin de retour, quand la page est un détail. */
  breadcrumb?: { label: string; href: string };
  eyebrow?: string;
}) {
  return (
    <header className="mb-8">
      {breadcrumb && (
        <Link
          href={breadcrumb.href}
          className="mb-2 inline-block text-[var(--text-secondary)] text-ink-soft transition-colors hover:text-ink"
        >
          ← {breadcrumb.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
          <h1 className="text-[length:var(--text-page)] font-semibold leading-tight tracking-tight text-balance">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 max-w-2xl text-[var(--text-body)] text-ink-soft">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
    </header>
  );
}

export function SectionHeader({
  title,
  description,
  action,
  count,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  count?: number;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2.5 text-[length:var(--text-section)] font-semibold leading-tight tracking-tight">
          {title}
          {count !== undefined && (
            <span className="tabular text-[var(--text-secondary)] font-normal text-ink-faint">
              {count}
            </span>
          )}
        </h2>
        {description && (
          <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">{description}</p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * §32 EMPTY STATES — « Créer de vrais empty states », pas « No data ».
 *
 * Trois choses, dans cet ordre : ce qu'il n'y a pas, à quoi ça servira,
 * et le bouton pour commencer. Un écran vide sans porte de sortie
 * ressemble à une panne.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
      {icon && (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-card)] bg-accent-wash text-accent">
          {icon}
        </div>
      )}
      <p className="text-[length:var(--text-card)] font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[var(--text-body)] text-ink-soft">{description}</p>
      {action && <div className="mt-6 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * Un panneau de contenu : l'unité de base d'une page de détail.
 *
 * Sépare l'entête du corps par une ligne, et laisse le corps décider de
 * son propre rembourrage — une liste `divide-y` doit toucher les bords,
 * un formulaire non.
 */
export function Panel({
  title,
  description,
  action,
  count,
  children,
  footer,
  className = "",
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  count?: number;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[length:var(--text-card)] font-semibold leading-tight">{title}</h2>
            {description && (
              <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">{description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {count !== undefined && (
              <span className="tabular text-[var(--text-secondary)] text-ink-faint">{count}</span>
            )}
            {action}
          </div>
        </div>
      )}
      {children}
      {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
    </Card>
  );
}

/**
 * §35 Tabs — la version qui NAVIGUE.
 *
 * Des liens, pas des boutons : chaque onglet est une URL, donc
 * partageable, rechargeable et gardée dans l'historique. Un état React
 * perdrait l'onglet à chaque rafraîchissement.
 */
export function Tabs({
  items,
  current,
}: {
  items: { label: string; href: string; count?: number }[];
  current: string;
}) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
      {items.map((item) => {
        const active = current === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3.5 py-2.5 text-[var(--text-body)] transition-colors ${
              active
                ? "border-accent font-medium text-accent"
                : "border-transparent text-ink-soft hover:border-line-strong hover:text-ink"
            }`}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="tabular ml-2 text-[var(--text-secondary)] text-ink-faint">
                {item.count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
