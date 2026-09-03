import Link from "next/link";
import type { ReactNode } from "react";

/**
 * ==================================================================
 * LE SYSTÈME DE COMPOSANTS DU CONTROL CENTER — les briques
 * ==================================================================
 *
 * Duplication assumée depuis `web-pro/components/ui/`, et non paquet
 * partagé. Trois raisons, dans l'ordre d'importance :
 *
 *   1. La spec p.34 autorise — et ici demande — une interface
 *      « légèrement différente du Pro pour éviter toute confusion ». Un
 *      paquet partagé rendrait cette divergence coûteuse alors qu'elle
 *      est la consigne.
 *   2. Il n'y a pas de monorepo à ce dépôt : pas de `package.json` à la
 *      racine, pas de champ `workspaces`. En créer un changerait la
 *      façon dont Oasis Care Pro se construit aujourd'hui, pour un
 *      bénéfice que le point 1 annule.
 *   3. Le coût est mesuré : environ 1 500 lignes, sans une seule
 *      dépendance d'interface tierce.
 *
 * Ce qui a VRAIMENT changé par rapport au Pro, et pourquoi :
 *   • un composant `UnknownValue`, absent là-bas parce qu'aucun écran
 *     Pro n'a onze indicateurs incalculables à afficher honnêtement ;
 *   • des tailles resserrées (spec p.34, « informations condensées ») ;
 *   • les tons recalculés pour un fond sombre.
 */

export type Tone =
  | "neutral"
  | "accent"
  | "positive"
  | "warning"
  | "critical"
  | "info"
  | "unknown";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-surface-raised text-ink-soft",
  accent: "bg-accent-wash text-accent",
  positive: "bg-positive-wash text-positive",
  warning: "bg-warning-wash text-warning",
  critical: "bg-critical-wash text-critical",
  info: "bg-info-wash text-info",
  unknown: "bg-unknown-wash text-unknown",
};

const DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-ink-faint",
  accent: "bg-accent",
  positive: "bg-positive",
  warning: "bg-warning",
  critical: "bg-critical",
  info: "bg-info",
  unknown: "bg-unknown",
};

export function Card({
  children,
  className = "",
  raised = false,
}: {
  children: ReactNode;
  className?: string;
  raised?: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius-card)] border border-line bg-surface ${
        raised ? "shadow-[var(--shadow-raised)]" : "shadow-[var(--shadow-card)]"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Un statut. La pastille double le mot, elle ne le remplace jamais :
 * une information portée par la seule couleur disparaît pour un
 * daltonien, et il y en a dans toutes les équipes.
 */
export function StatusBadge({
  children,
  tone = "neutral",
  dot = true,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-0.5 text-[12px] font-medium ${TONE_CLASS[tone]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[tone]}`} aria-hidden />}
      {children}
    </span>
  );
}

/**
 * ==================================================================
 * UnknownValue — LE COMPOSANT LE PLUS IMPORTANT DE CE FICHIER
 * ==================================================================
 *
 * Spec p.4 : « Les KPI doivent être calculés depuis les vraies
 * données. Aucune valeur fictive en production. »
 *
 * L'audit a établi que onze des seize chiffres demandés n'existent pas
 * dans cette base : les quatre forfaits Pro ont `monthly_price_cents` à
 * NULL, `organization_subscriptions` est vide et aucune ligne de code
 * du dépôt ne l'écrit jamais, aucune table n'enregistre de jetons ni de
 * coût IA, aucune table d'erreurs n'existe, et rien ne dit par quelle
 * application un compte est entré.
 *
 * Ces chiffres ne s'affichent donc PAS en zéro. Un `0 €` de MRR se lit
 * « nous ne gagnons rien » ; la vérité est « nous ne suivons
 * l'abonnement d'aucune entreprise ». Les deux appellent des décisions
 * opposées.
 *
 * Le `reason` vient de `unknown_reasons`, que chaque fonction de 0075
 * rend à côté de ses chiffres. Il est affiché, pas seulement mis en
 * `title` : une explication qu'il faut survoler pour lire n'est pas
 * lue, et celle-ci est la moitié de l'information.
 */
export function UnknownValue({
  reason,
  label = "Inconnu",
  compact = false,
  inline = false,
}: {
  /** La phrase de `unknown_reasons`. Sans elle, l'inconnu est une excuse. */
  reason?: string | null;
  label?: string;
  /** Dans une cellule de tableau : le tiret seul, l'explication en survol. */
  compact?: boolean;
  /**
   * Dans une rangée de chiffres serrés : le mot « Inconnu », sans le
   * motif. Un tiret nu à la place d'un nombre se lit « zéro » du coin
   * de l'œil ; le mot, lui, ne se confond avec aucune valeur. Le motif
   * reste en survol — c'est la seule concession de densité, et elle ne
   * vaut que là où six chiffres doivent tenir sur une ligne.
   */
  inline?: boolean;
}) {
  const title = reason ?? "Donnée non disponible dans cette base.";

  if (compact) {
    return (
      <span
        className="text-unknown"
        title={title}
        aria-label={reason ? `${label} : ${reason}` : label}
      >
        —
      </span>
    );
  }

  if (inline) {
    return (
      <span
        className="unknown-rule inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-0.5 text-[12px] font-medium"
        title={title}
        aria-label={reason ? `${label} : ${reason}` : label}
      >
        <span aria-hidden>—</span>
        {label}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="unknown-rule inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-0.5 text-[12px] font-medium">
        <span aria-hidden>—</span>
        {label}
      </span>
      {reason && (
        <span className="max-w-prose text-[var(--text-secondary)] leading-snug text-ink-faint">
          {reason}
        </span>
      )}
    </span>
  );
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 py-1.5 text-[var(--text-secondary)] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANT = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface-raised text-ink hover:border-ink-faint",
  ghost: "text-ink-soft hover:bg-surface-raised hover:text-ink",
  danger: "border border-critical/40 bg-critical-wash text-critical hover:border-critical",
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANT;

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  return (
    <Link href={href} className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  className = "",
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  return (
    <button type="submit" className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${className}`}>
      {children}
    </button>
  );
}

const INPUT_CLASS =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent";

export function Field({
  label,
  name,
  type = "text",
  required = false,
  defaultValue,
  placeholder,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
        {label}
        {required && <span className="text-critical"> *</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={INPUT_CLASS}
      />
      {hint && <span className="text-[var(--text-secondary)] text-ink-faint">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  name,
  options,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[var(--text-secondary)] font-medium text-ink-soft">{label}</span>
      <select name={name} defaultValue={defaultValue} className={INPUT_CLASS}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <span className="text-[var(--text-secondary)] text-ink-faint">{hint}</span>}
    </label>
  );
}

/**
 * Une pastille d'initiales. Sa teinte est dérivée du nom, donc stable
 * d'un écran à l'autre : c'est ce qui rend une entreprise
 * reconnaissable au coup d'œil dans une liste de deux cents lignes.
 *
 * Aucune photo, aucun logo distant n'est chargé par défaut dans le
 * Control Center : afficher l'avatar d'un client, c'est déjà ouvrir un
 * contenu qui lui appartient. Les initiales suffisent à identifier.
 */
const AVATAR_TINTS = [
  "bg-accent-wash text-accent",
  "bg-info-wash text-info",
  "bg-warning-wash text-warning",
  "bg-positive-wash text-positive",
  "bg-critical-wash text-critical",
  "bg-surface-raised text-ink-soft",
];

export function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/[\s'-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function tintOf(name: string): string {
  let sum = 0;
  for (const character of name) sum += character.codePointAt(0) ?? 0;
  return AVATAR_TINTS[sum % AVATAR_TINTS.length];
}

const AVATAR_SIZE = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-[12px]",
  lg: "h-12 w-12 text-[16px]",
} as const;

export function EntityAvatar({
  name,
  size = "md",
  shape = "square",
}: {
  name: string;
  size?: keyof typeof AVATAR_SIZE;
  /** `round` pour une personne, `square` pour une entreprise. */
  shape?: "round" | "square";
}) {
  return (
    <span
      aria-hidden
      className={`${AVATAR_SIZE[size]} ${tintOf(name)} flex shrink-0 items-center justify-center font-semibold ${
        shape === "round" ? "rounded-full" : "rounded-[var(--radius-control)]"
      }`}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Un squelette dit où le contenu va apparaître. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <span className={`skeleton block ${className}`} aria-hidden />;
}

/**
 * Un identifiant technique.
 *
 * Spec p.35 : « Les IDs techniques ne doivent apparaître que dans
 * Technical details. » Ce composant est donc volontairement discret et
 * monospace — il se lit quand on le cherche, il ne s'impose pas.
 */
export function TechnicalId({ id }: { id: string }) {
  return (
    <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
      {id}
    </code>
  );
}
