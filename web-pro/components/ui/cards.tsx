import Link from "next/link";
import type { ReactNode } from "react";
import { Card, Badge, type Tone } from "./primitives";

/**
 * §35 — les cartes.
 *
 * §1 demande « grandes cartes KPI » et « moins d'informations
 * simultanément ». Une carte porte donc UN chiffre, en grand, avec de
 * quoi le situer — et rien d'autre. Six petites cartes empilées sur
 * douze chiffres, c'est le tableau de bord qu'on remplace.
 */

/**
 * §10 DASHBOARD V2 — « CA DU MOIS / 24 580 € / +12 % vs mois précédent ».
 *
 * `delta` est un pourcentage signé. Sa couleur suit le SENS MÉTIER, pas
 * le signe : une baisse d'impayés est une bonne nouvelle. D'où
 * `deltaGood`, que l'appelant renseigne — le composant ne devine pas.
 *
 * `value` peut valoir null. Un indicateur incalculable affiche un tiret,
 * jamais zéro : « 0 € de marge » et « aucune donnée pour calculer la
 * marge » sont deux affirmations différentes, et l'une des deux est
 * fausse.
 */
export function MetricCard({
  label,
  value,
  hint,
  delta,
  deltaGood,
  tone = "neutral",
  href,
}: {
  label: string;
  value: string | null;
  hint?: string;
  delta?: number | null;
  /** true si un delta positif est une bonne nouvelle. */
  deltaGood?: boolean;
  tone?: Tone;
  href?: string;
}) {
  const showDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const positive = showDelta && delta > 0;
  const good = deltaGood === undefined ? positive : positive === deltaGood;

  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p
        className={`tabular mt-2 text-[2rem] font-semibold leading-none tracking-tight ${
          value === null ? "text-ink-faint" : ""
        }`}
      >
        {value ?? "—"}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {showDelta && (
          <span
            className={`tabular text-[var(--text-secondary)] font-medium ${
              delta === 0 ? "text-ink-faint" : good ? "text-positive" : "text-critical"
            }`}
          >
            {delta > 0 ? "+" : ""}
            {delta.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %
          </span>
        )}
        {hint && <span className="text-[var(--text-secondary)] text-ink-soft">{hint}</span>}
      </div>
    </>
  );

  const shell = `block rounded-[var(--radius-card)] border bg-surface p-5 shadow-[var(--shadow-card)] ${
    tone === "accent" ? "border-accent/25 bg-accent-wash/40" : "border-line"
  }`;

  if (href) {
    return (
      <Link href={href} className={`${shell} transition-colors hover:border-line-strong`}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}

/** Une information posée à plat : un libellé, une valeur, rien à cliquer. */
export function InfoCard({
  label,
  value,
  hint,
  badge,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  badge?: { label: string; tone: Tone };
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </div>
      <div className="mt-2 text-[length:var(--text-card)] font-medium">{value}</div>
      {hint && <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">{hint}</p>}
    </Card>
  );
}

/**
 * §44 PREMIÈRE PAGE — « [ Ajouter un client ] [ Créer un projet ] … »
 *
 * Une carte qui EST un bouton. Le titre dit l'action, la description
 * dit ce qu'elle ouvre — un intitulé seul (« Digital Twin ») laisse
 * deviner.
 */
export function ActionCard({
  title,
  description,
  href,
  icon,
}: {
  title: string;
  description: string;
  href: string;
  icon?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3.5 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)] transition-colors hover:border-accent/40 hover:bg-accent-wash/30"
    >
      {icon && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-wash text-accent">
          {icon}
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-[length:var(--text-card)] font-medium">{title}</span>
        <span className="mt-0.5 block text-[var(--text-secondary)] text-ink-soft">
          {description}
        </span>
      </span>
      <span
        aria-hidden
        className="ml-auto shrink-0 self-center text-ink-faint transition-transform group-hover:translate-x-0.5"
      >
        →
      </span>
    </Link>
  );
}

/**
 * §15 ABONNEMENT — la carte d'un forfait.
 *
 * §"Noms configurables. NE PAS figer définitivement ces noms." — d'où
 * un composant qui ne connaît aucun nom de plan et se contente
 * d'afficher ce qu'on lui donne.
 */
export function PlanCard({
  name,
  tagline,
  features,
  current = false,
  action,
  price,
}: {
  name: string;
  tagline?: string;
  features: string[];
  current?: boolean;
  action?: ReactNode;
  price?: string;
}) {
  return (
    <div
      className={`flex flex-col rounded-[var(--radius-card)] border p-5 ${
        current
          ? "border-accent bg-accent-wash/40 shadow-[var(--shadow-raised)]"
          : "border-line bg-surface shadow-[var(--shadow-card)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[length:var(--text-card)] font-semibold">{name}</h3>
        {current && <Badge tone="accent">Votre forfait</Badge>}
      </div>
      {tagline && <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">{tagline}</p>}
      {price && <p className="tabular mt-3 text-[1.5rem] font-semibold leading-none">{price}</p>}

      <ul className="mt-4 flex flex-1 flex-col gap-1.5">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-[var(--text-body)]">
            <span aria-hidden className="mt-0.5 shrink-0 text-accent">
              ✓
            </span>
            <span className="text-ink-soft">{feature}</span>
          </li>
        ))}
      </ul>

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
