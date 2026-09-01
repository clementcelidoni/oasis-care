import Link from "next/link";
import type { ReactNode } from "react";

/**
 * §35 DESIGN SYSTEM — les briques.
 *
 * Un seul endroit décide d'un rayon, d'une ombre, d'une teinte de
 * statut. C'est ce qui empêche l'ERP gris de revenir par la fenêtre :
 * quand chaque écran redéfinit sa carte, aucun ne ressemble au voisin
 * et l'ensemble a l'air d'un prototype.
 *
 * Les signatures existantes ne changent pas — quatre-vingt-treize
 * écrans les importent déjà. On étend, on ne casse pas.
 */

export type Tone = "neutral" | "accent" | "positive" | "warning" | "critical" | "info";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-ink-soft",
  accent: "bg-accent-wash text-accent",
  positive: "bg-positive-wash text-positive",
  warning: "bg-warning-wash text-warning",
  critical: "bg-critical-wash text-critical",
  info: "bg-info-wash text-info",
};

const DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-ink-faint",
  accent: "bg-accent",
  positive: "bg-positive",
  warning: "bg-warning",
  critical: "bg-critical",
  info: "bg-info",
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
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * §35 StatusBadge — un statut, pas une étiquette quelconque.
 *
 * La pastille n'est pas décorative : §47 demande de tester le
 * contraste, et une information portée par la seule couleur disparaît
 * pour un daltonien. Ici la couleur double le mot, elle ne le remplace
 * jamais.
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
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-[12px] font-medium ${TONE_CLASS[tone]}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[tone]}`} aria-hidden />}
      {children}
    </span>
  );
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-3.5 py-2 text-[var(--text-secondary)] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANT = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-canvas",
  ghost: "text-ink-soft hover:bg-canvas hover:text-ink",
  danger: "border border-critical/30 bg-critical-wash text-critical hover:bg-critical/10",
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
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent";

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
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="text-[var(--text-secondary)] text-ink-faint">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------
// §35 CompanyAvatar / UserAvatar
// ---------------------------------------------------------------

/**
 * §3 « PAS DE LOGO ENTREPRISE → afficher initiales, avatar
 * d'entreprise, icône élégante. »
 *
 * Les initiales sont dérivées du nom, et leur teinte aussi : une somme
 * des codes de caractères choisit une des six couleurs. Deux
 * entreprises différentes n'ont donc pas la même pastille, et la même
 * entreprise garde la sienne d'un écran à l'autre — c'est ce qui la
 * rend reconnaissable au coup d'œil.
 */
const AVATAR_TINTS = [
  "bg-accent-wash text-accent",
  "bg-info-wash text-info",
  "bg-warning-wash text-warning",
  "bg-positive-wash text-positive",
  "bg-critical-wash text-critical",
  "bg-surface-sunken text-ink-soft",
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
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-[13px]",
  lg: "h-14 w-14 text-[18px]",
} as const;

export function CompanyAvatar({
  name,
  logoUrl,
  size = "md",
}: {
  name: string;
  logoUrl?: string | null;
  size?: keyof typeof AVATAR_SIZE;
}) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        className={`${AVATAR_SIZE[size]} shrink-0 rounded-[var(--radius-control)] border border-line object-cover`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${AVATAR_SIZE[size]} ${tintOf(name)} flex shrink-0 items-center justify-center rounded-[var(--radius-control)] font-semibold`}
    >
      {initialsOf(name)}
    </span>
  );
}

export function UserAvatar({
  name,
  size = "md",
}: {
  name: string;
  size?: keyof typeof AVATAR_SIZE;
}) {
  return (
    <span
      aria-hidden
      className={`${AVATAR_SIZE[size]} ${tintOf(name)} flex shrink-0 items-center justify-center rounded-full font-semibold`}
    >
      {initialsOf(name)}
    </span>
  );
}

/** §33 LOADING STATES — un squelette dit où le contenu va apparaître. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <span className={`skeleton block ${className}`} aria-hidden />;
}
