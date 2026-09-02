import type { BadgeTone, CostKind } from "@/lib/quotes/types";

/** §11F — projets et chantiers. */

export const PROJECT_STATUSES = [
  "planned", "inProgress", "onHold", "completed", "handedOver", "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: "Planifié",
  inProgress: "En cours",
  onHold: "En attente",
  completed: "Terminé",
  handedOver: "Réceptionné",
  cancelled: "Annulé",
};

export const PROJECT_STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  planned: "neutral",
  inProgress: "info",
  onHold: "warning",
  completed: "positive",
  handedOver: "positive",
  cancelled: "neutral",
};

export const PHASE_STATUSES = ["notStarted", "inProgress", "blocked", "done"] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];

export const PHASE_STATUS_LABELS: Record<PhaseStatus, string> = {
  notStarted: "À faire",
  inProgress: "En cours",
  blocked: "Bloquée",
  done: "Terminée",
};

export const PHASE_STATUS_TONE: Record<PhaseStatus, BadgeTone> = {
  notStarted: "neutral",
  inProgress: "info",
  blocked: "critical",
  done: "positive",
};

export const TASK_STATUSES = ["todo", "doing", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "À faire",
  doing: "En cours",
  blocked: "Bloquée",
  done: "Faite",
};

/**
 * §PHASES — « Préparation, Terrassement, Irrigation, Plantation,
 * Éclairage, Finitions, Réception. Configurables. »
 *
 * Proposées à la création d'un chantier parti de rien. Un chantier issu
 * d'un devis reprend les postes du devis : son découpage est déjà celui
 * du chantier, le refaire à la main serait une double saisie.
 */
export const DEFAULT_PHASES = [
  "Préparation", "Terrassement", "Irrigation",
  "Plantation", "Éclairage", "Finitions", "Réception",
];

export const PHOTO_MOMENTS = ["before", "during", "after"] as const;
export type PhotoMoment = (typeof PHOTO_MOMENTS)[number];

export const PHOTO_MOMENT_LABELS: Record<PhotoMoment, string> = {
  before: "Avant",
  during: "Pendant",
  after: "Après",
};

export type Project = {
  id: string;
  number: string;
  name: string;
  status: ProjectStatus;
  customer_id: string;
  quote_id: string | null;
  garden_id: string | null;
  planned_start_on: string | null;
  planned_end_on: string | null;
  actual_start_on: string | null;
  actual_end_on: string | null;
  notes: string | null;
  created_at: string;
};

export type ProjectPhase = {
  id: string;
  title: string;
  position: number;
  status: PhaseStatus;
  progress_percent: number;
  planned_start_on: string | null;
  planned_end_on: string | null;
  notes: string | null;
};

export type ProjectTask = {
  id: string;
  phase_id: string | null;
  title: string;
  position: number;
  status: TaskStatus;
  planned_hours: number | null;
  due_on: string | null;
};

export type ProjectResource = {
  id: string;
  phase_id: string | null;
  kind: CostKind;
  description: string;
  unit: string;
  planned_quantity: number;
  planned_unit_cost_cents: number;
  planned_total_cents: number;
};

export type ProjectCost = {
  id: string;
  phase_id: string | null;
  kind: CostKind;
  description: string;
  unit: string;
  quantity: number;
  unit_cost_cents: number;
  total_cents: number;
  incurred_on: string;
  invoice_reference: string | null;
};

export type CostSummaryRow = {
  kind: CostKind;
  planned_cents: number;
  actual_cents: number;
  variance_cents: number;
};

/**
 * L'avancement d'ensemble : la moyenne des phases, pondérée par leur
 * budget prévu.
 *
 * Une moyenne simple donnerait le même poids à « Réception » qu'à
 * « Terrassement », et un chantier paraîtrait à moitié fait en ayant
 * coché trois broutilles. Sans budget, on retombe sur la moyenne
 * simple, qui reste une réponse défendable — plutôt que de ne rien
 * afficher.
 */
export function overallProgress(
  phases: { id: string; progress_percent: number }[],
  plannedByPhase: Map<string | null, number>,
): number {
  if (phases.length === 0) return 0;
  const weights = phases.map((p) => plannedByPhase.get(p.id) ?? 0);
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  if (totalWeight === 0) {
    return Math.round(
      phases.reduce((s, p) => s + p.progress_percent, 0) / phases.length,
    );
  }

  const weighted = phases.reduce(
    (s, p, i) => s + p.progress_percent * weights[i], 0,
  );
  return Math.round(weighted / totalWeight);
}

/**
 * Le ton d'un écart budgétaire.
 *
 * Dépenser MOINS que prévu n'est pas signalé en vert triomphant : c'est
 * souvent qu'une partie du chantier n'est pas encore faite, pas qu'on a
 * gagné de l'argent. Seul le dépassement est mis en avant, parce que
 * lui appelle une décision.
 */
export function varianceTone(varianceCents: number, plannedCents: number): BadgeTone {
  if (varianceCents <= 0) return "neutral";
  // Un dépassement de moins de 5 % du prévu est du bruit de chantier.
  if (plannedCents > 0 && varianceCents / plannedCents < 0.05) return "warning";
  return "critical";
}
