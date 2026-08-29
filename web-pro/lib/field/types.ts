import type { BadgeTone } from "@/lib/quotes/types";

/** §11G planning et §11H équipes. */

export const INTERVENTION_KINDS = [
  "visit", "work", "maintenance", "delivery", "repair", "other",
] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

export const INTERVENTION_KIND_LABELS: Record<InterventionKind, string> = {
  visit: "Visite",
  work: "Chantier",
  maintenance: "Entretien",
  delivery: "Livraison",
  repair: "Dépannage",
  other: "Autre",
};

export const INTERVENTION_STATUSES = ["scheduled", "inProgress", "done", "cancelled"] as const;
export type InterventionStatus = (typeof INTERVENTION_STATUSES)[number];

export const INTERVENTION_STATUS_LABELS: Record<InterventionStatus, string> = {
  scheduled: "Planifiée",
  inProgress: "En cours",
  done: "Terminée",
  cancelled: "Annulée",
};

export const INTERVENTION_STATUS_TONE: Record<InterventionStatus, BadgeTone> = {
  scheduled: "neutral",
  inProgress: "info",
  done: "positive",
  cancelled: "warning",
};

export const TIME_KINDS = ["work", "travel", "break", "other"] as const;
export type TimeKind = (typeof TIME_KINDS)[number];

export const TIME_KIND_LABELS: Record<TimeKind, string> = {
  work: "Travail",
  travel: "Trajet",
  break: "Pause",
  other: "Autre",
};

/** Les niveaux de compétence — trois, parce qu'au-delà « 7/10 » ne veut rien dire. */
export const SKILL_LEVELS = [1, 2, 3] as const;
export const SKILL_LEVEL_LABELS: Record<number, string> = {
  1: "Notions",
  2: "Autonome",
  3: "Référent",
};

/** Couleurs proposées aux équipes. Assez distinctes pour se lire sur une semaine chargée. */
export const TEAM_COLORS = [
  "#15654a", "#2f6fb5", "#a8532f", "#6f4d8a", "#8a7233", "#3f8d82", "#a03b31",
];

export type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  hourly_cost_cents: number;
};

export function employeeName(e: { first_name: string; last_name: string }): string {
  return `${e.first_name} ${e.last_name}`.trim();
}

export type Team = {
  id: string;
  name: string;
  color: string;
  lead_employee_id: string | null;
};

export type Intervention = {
  id: string;
  kind: InterventionKind;
  title: string;
  status: InterventionStatus;
  instructions: string | null;
  notes: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  team_id: string | null;
  project_id: string | null;
  customer_id: string | null;
  signed_by_name: string | null;
  signed_at: string | null;
};

export type TimeEntry = {
  id: string;
  employee_id: string;
  worked_on: string;
  hours: number;
  hourly_cost_cents: number;
  total_cents: number;
  kind: TimeKind;
  validated: boolean;
  notes: string | null;
};

// ---------------------------------------------------------------
// Semaines
// ---------------------------------------------------------------

/**
 * Le lundi de la semaine contenant `date`.
 *
 * La semaine française commence le lundi, pas le dimanche comme le
 * suppose `getDay()`. Se tromper décale tout le planning d'un jour, ce
 * qui se voit tard et coûte un déplacement.
 */
export function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // getUTCDay : 0 = dimanche. On veut 0 = lundi.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** `AAAA-MM-JJ`, sans passer par le fuseau local. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const WEEKDAY_LABELS = [
  "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche",
];

const DAY_FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

export function formatDayShort(date: Date): string {
  return DAY_FORMAT.format(date);
}

const TIME_FORMAT = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  return TIME_FORMAT.format(new Date(iso));
}

/**
 * `<input type="datetime-local">` ne connaît AUCUN fuseau.
 *
 * Il rend « 2026-08-29T08:00 », que Postgres — dont le fuseau est UTC —
 * lit comme 08:00 UTC, soit 10 h à Paris. Envoyer la valeur telle
 * quelle décalait donc chaque intervention de deux heures, et de deux
 * heures DE PLUS à chaque réenregistrement, puisque le champ était
 * rempli à partir de l'heure locale de la valeur déjà décalée. Rien ne
 * le signalait : les cartes du planning se déplaçaient toutes seules.
 *
 * Ces deux fonctions font la traduction, et doivent encadrer tout champ
 * `datetime-local` de l'application.
 */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * L'inverse : une saisie locale vers l'instant qu'elle désigne.
 *
 * `new Date("2026-08-29T08:00")` — sans `Z` ni décalage — est interprété
 * en heure LOCALE par la norme, ce qui est exactement ce qu'on veut.
 */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** L'instant d'une heure donnée, un jour donné, en heure locale. */
export function dayAtHour(dayIso: string, hour: number): string {
  const [y, m, d] = dayIso.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0).toISOString();
}

/**
 * Les heures d'une durée planifiée, arrondies au quart d'heure.
 *
 * Sert à pré-remplir le pointage : le chef d'équipe corrige, mais part
 * de ce qui était prévu plutôt que d'un champ vide.
 */
export function scheduledHours(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round((ms / 3_600_000) * 4) / 4;
}

/**
 * Empêche une fin antérieure au début.
 *
 * Reculer l'heure de début après la fin est un geste normal — on
 * décale une intervention de la matinée à l'après-midi — mais la
 * contrainte de la base le refuse, et l'utilisateur reçoit alors le nom
 * d'une contrainte SQL en pleine figure.
 *
 * La DURÉE est conservée : déplacer le début de 8 h à 14 h sur une
 * intervention de huit heures la fait finir à 22 h, pas planter. C'est
 * ce que fait n'importe quel agenda, et c'est presque toujours
 * l'intention. Une fin explicitement placée après le début n'est jamais
 * touchée.
 */
export function keepScheduleOrdered(
  patch: Record<string, unknown>,
  previous: { scheduled_start: string | null; scheduled_end: string | null },
) {
  const start = "scheduled_start" in patch
    ? (patch.scheduled_start as string | null) : previous.scheduled_start;
  const end = "scheduled_end" in patch
    ? (patch.scheduled_end as string | null) : previous.scheduled_end;
  if (!start || !end) return;

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs >= startMs) return;

  const previousDuration =
    previous.scheduled_start && previous.scheduled_end
      ? new Date(previous.scheduled_end).getTime() - new Date(previous.scheduled_start).getTime()
      : 0;
  // Une durée héritée valable, sinon une heure : mieux vaut une durée
  // arbitraire mais visible qu'une intervention de durée nulle.
  const duration = previousDuration > 0 ? previousDuration : 3_600_000;
  patch.scheduled_end = new Date(startMs + duration).toISOString();
}

