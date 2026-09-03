import Link from "next/link";
import type { ReactNode } from "react";
import { Card, Badge, UnknownValue, type Tone } from "./primitives";

/**
 * ==================================================================
 * LES CARTES DE CHIFFRES — spec p.34 : « grands KPI »
 * ==================================================================
 *
 * Une carte porte UN chiffre, en très grand, avec juste de quoi le
 * situer. C'est la différence entre un tableau de bord qu'on lit d'un
 * coup d'œil depuis la porte du bureau et une grille de douze petits
 * nombres qu'il faut déchiffrer un par un.
 */

/**
 * Le KPI principal.
 *
 * `value` vaut `null` quand le chiffre est INCONNU — et c'est le cas
 * de onze des seize chiffres de la spec sur cette base. La carte
 * affiche alors le marqueur d'inconnu et le motif rendu par
 * `unknown_reasons`, jamais un zéro. Ce n'est pas une précaution
 * d'ingénieur : « 0 € de MRR » et « nous ne suivons l'abonnement
 * d'aucune entreprise » n'appellent pas la même décision, et l'une des
 * deux phrases est fausse.
 *
 * `delta` suit le SENS MÉTIER et pas le signe : une baisse du churn est
 * une bonne nouvelle. D'où `deltaGood`, que l'appelant renseigne — le
 * composant ne devine pas.
 */
export function MetricCard({
  label,
  value,
  unknownReason,
  hint,
  delta,
  deltaGood,
  tone = "neutral",
  href,
  size = "large",
}: {
  label: string;
  /** `null` = inconnu. JAMAIS remplacé par 0 en amont. */
  value: string | null;
  /** La phrase de `unknown_reasons` pour ce chiffre. */
  unknownReason?: string | null;
  hint?: string;
  delta?: number | null;
  /** `true` si un delta positif est une bonne nouvelle. */
  deltaGood?: boolean;
  tone?: Tone;
  href?: string;
  /** `small` pour une deuxième rangée de chiffres secondaires. */
  size?: "large" | "small";
}) {
  const showDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const positive = showDelta && delta > 0;
  const good = deltaGood === undefined ? positive : positive === deltaGood;

  const body = (
    <>
      <p className="eyebrow">{label}</p>

      {value === null ? (
        <div className="mt-2.5">
          <UnknownValue reason={unknownReason} />
        </div>
      ) : (
        <p
          className={`tabular mt-2 font-semibold leading-none tracking-tight text-ink ${
            size === "large"
              ? "text-[length:var(--text-kpi)]"
              : "text-[length:var(--text-kpi-small)]"
          }`}
        >
          {value}
        </p>
      )}

      {(showDelta || hint) && value !== null && (
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
      )}
    </>
  );

  const shell = `block rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)] ${
    tone === "accent" ? "border-accent/30 bg-accent-wash" : "border-line bg-surface"
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

/**
 * Une rangée de chiffres serrés — l'« activité temps réel » de la
 * spec p.4-5, où l'on veut sept nombres visibles ensemble plutôt que
 * sept grandes cartes qui ne tiennent pas sur un écran.
 */
export function StatStrip({
  items,
}: {
  items: {
    label: string;
    value: string | null;
    unknownReason?: string | null;
    /**
     * La RÉSERVE d'un chiffre connu — ce qu'il compte exactement quand
     * son libellé promet un peu plus. À ne pas confondre avec
     * `unknownReason`, qui explique une absence : celle-ci accompagne
     * un nombre bien réel, et disparaîtrait si le nombre devenait
     * exact. Un chiffre approché affiché sans sa réserve est pris pour
     * la réponse.
     */
    note?: string;
    tone?: Tone;
  }[];
}) {
  return (
    <div className="grid grid-cols-2 divide-line rounded-[var(--radius-card)] border border-line bg-surface sm:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="border-b border-r border-line p-4 last:border-r-0">
          <p className="eyebrow">{item.label}</p>
          {item.value === null ? (
            <div className="mt-1.5">
              <UnknownValue reason={item.unknownReason} inline />
            </div>
          ) : (
            <p
              className={`tabular mt-1.5 text-[length:var(--text-kpi-small)] font-semibold leading-none ${
                item.tone === "critical"
                  ? "text-critical"
                  : item.tone === "positive"
                    ? "text-positive"
                    : "text-ink"
              }`}
            >
              {item.value}
            </p>
          )}
          {item.note && item.value !== null && (
            <p className="mt-1.5 text-[var(--text-secondary)] leading-snug text-ink-faint">
              {item.note}
            </p>
          )}
        </div>
      ))}
    </div>
  );
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
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </div>
      <div className="mt-1.5 text-[length:var(--text-card)] font-medium">{value}</div>
      {hint && <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">{hint}</p>}
    </Card>
  );
}

/** Une carte qui EST un lien : le titre dit l'action, la description dit ce qu'elle ouvre. */
export function ActionCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-accent/40 hover:bg-accent-wash"
    >
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
