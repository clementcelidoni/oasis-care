import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "./primitives";

/**
 * Les pièces qui tiennent une page du Control Center.
 *
 * L'ordre imposé : ce qu'on vient voir en haut, puis de quoi filtrer,
 * puis le détail. Un administrateur ouvre cette application avec une
 * question précise en tête — « combien », « qui », « depuis quand » —
 * et la réponse doit être au-dessus de la ligne de flottaison.
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
  breadcrumb?: { label: string; href: string };
  eyebrow?: string;
}) {
  return (
    <header className="mb-6">
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
            <p className="mt-1.5 max-w-3xl text-[var(--text-body)] leading-relaxed text-ink-soft">
              {subtitle}
            </p>
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
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
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
 * Un état vide, qui DIT POURQUOI.
 *
 * Dans cette application, « rien à afficher » a presque toujours une
 * cause précise et intéressante : la table est vide, la donnée n'existe
 * pas, ou le filtre ne peut pas être honoré. Un « Aucun résultat » nu
 * ferait perdre l'information la plus utile de l'écran.
 */
export function EmptyState({
  title,
  description,
  action,
  tone = "neutral",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  /** `unknown` quand le vide vient d'une donnée absente, pas d'un filtre. */
  tone?: "neutral" | "unknown";
}) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-dashed px-6 py-12 text-center ${
        tone === "unknown" ? "unknown-rule" : "border-line-strong bg-surface"
      }`}
    >
      <p className="text-[length:var(--text-card)] font-medium text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-xl text-[var(--text-body)] leading-relaxed text-ink-soft">
        {description}
      </p>
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * Le panneau : l'unité de base d'une page de détail. L'en-tête est
 * séparé du corps par une ligne, et le corps décide de son propre
 * rembourrage — une liste `divide-y` doit toucher les bords, un
 * formulaire non.
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
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
      {footer && <div className="border-t border-line px-4 py-2.5">{footer}</div>}
    </Card>
  );
}

/**
 * Des onglets qui NAVIGUENT : chaque onglet est une URL, donc
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
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
      {items.map((item) => {
        const active = current === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-[var(--text-body)] transition-colors ${
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

/**
 * Un bandeau d'avertissement pleine largeur.
 *
 * Sert notamment à la bannière MFA (spec p.32) et aux avertissements
 * de données manquantes. Il est en haut du contenu, jamais en bas :
 * un avertissement qu'il faut faire défiler pour voir n'avertit
 * personne.
 */
export function Notice({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warning" | "critical" | "unknown";
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const skin = {
    info: "border-info/35 bg-info-wash text-info",
    warning: "border-warning/35 bg-warning-wash text-warning",
    critical: "border-critical/40 bg-critical-wash text-critical",
    unknown: "border-unknown-line bg-unknown-wash text-unknown",
  }[tone];

  return (
    <div
      role="status"
      className={`mb-5 flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-card)] border px-4 py-2.5 ${skin}`}
    >
      <div className="min-w-0 text-[var(--text-secondary)] leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "mt-0.5 text-ink-soft" : "text-ink-soft"}>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
