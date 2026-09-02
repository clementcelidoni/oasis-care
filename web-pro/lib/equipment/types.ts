import type { BadgeTone } from "@/lib/quotes/types";

/**
 * §5 GESTION → MATÉRIEL, §21 « véhicules ; machines ; immatriculations ;
 * numéros internes ; catégories ».
 *
 * Le vocabulaire du module, en un seul endroit. Les libellés français
 * vivent ici plutôt que dans les écrans : la même catégorie s'affiche
 * dans la liste, dans la fiche, dans le formulaire de création et dans
 * un filtre, et quatre traductions du même mot finissent par diverger.
 *
 * Les CLÉS sont celles des contraintes `check` de la migration 0067.
 * En ajouter une ici sans l'ajouter là-bas produit un formulaire qui
 * propose un choix que la base refuse — d'où les listes `as const`,
 * qui rendent l'oubli visible à la compilation dès qu'un `Record` les
 * indexe.
 */

// ---------------------------------------------------------------
// Le matériel
// ---------------------------------------------------------------

export const EQUIPMENT_CATEGORIES = [
  "vehicle", "trailer", "earthmoving", "mower",
  "cutting", "lifting", "soil", "irrigation", "workshop", "other",
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  vehicle: "Véhicule",
  trailer: "Remorque",
  earthmoving: "Terrassement",
  mower: "Tonte",
  cutting: "Coupe",
  lifting: "Levage",
  soil: "Travail du sol",
  irrigation: "Arrosage",
  workshop: "Atelier",
  other: "Autre",
};

export const OWNERSHIPS = ["owned", "rented", "leased"] as const;
export type Ownership = (typeof OWNERSHIPS)[number];

export const OWNERSHIP_LABELS: Record<Ownership, string> = {
  owned: "En propriété",
  rented: "En location",
  leased: "En crédit-bail",
};

export const EQUIPMENT_STATUSES = ["active", "maintenance", "outOfService", "retired"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  active: "En service",
  maintenance: "À l'atelier",
  outOfService: "Immobilisé",
  retired: "Sorti du parc",
};

export const EQUIPMENT_STATUS_TONE: Record<EquipmentStatus, BadgeTone> = {
  active: "positive",
  maintenance: "warning",
  outOfService: "critical",
  retired: "neutral",
};

export const METER_KINDS = ["none", "hours", "kilometers"] as const;
export type MeterKind = (typeof METER_KINDS)[number];

export const METER_KIND_LABELS: Record<MeterKind, string> = {
  none: "Aucun compteur",
  hours: "Heures",
  kilometers: "Kilomètres",
};

/** L'unité écrite à côté du nombre. Vide pour un engin sans compteur. */
export const METER_UNITS: Record<MeterKind, string> = {
  none: "",
  hours: "h",
  kilometers: "km",
};

// ---------------------------------------------------------------
// Les échéances
// ---------------------------------------------------------------

export const DEADLINE_KINDS = [
  "technicalInspection", "insurance", "service",
  "regulatoryCheck", "leaseEnd", "warranty", "other",
] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

export const DEADLINE_KIND_LABELS: Record<DeadlineKind, string> = {
  technicalInspection: "Contrôle technique",
  insurance: "Assurance",
  service: "Révision",
  regulatoryCheck: "Contrôle réglementaire",
  leaseEnd: "Fin de contrat",
  warranty: "Fin de garantie",
  other: "Autre échéance",
};

/**
 * Le préavis par défaut, PAR NATURE d'échéance.
 *
 * Trente jours pour un contrôle technique — le temps de prendre
 * rendez-vous. Quatre-vingt-dix pour une fin de crédit-bail, qui se
 * renégocie et se préavise. Un délai unique obligerait à choisir entre
 * alerter trop tôt sur tout et trop tard sur l'essentiel.
 *
 * Ce n'est qu'une valeur PROPOSÉE au formulaire : la colonne
 * `reminder_days` reste saisie par l'utilisateur, zéro compris.
 */
export const DEADLINE_REMINDER_DEFAULT: Record<DeadlineKind, number> = {
  technicalInspection: 30,
  insurance: 30,
  service: 15,
  regulatoryCheck: 30,
  leaseEnd: 90,
  warranty: 30,
  other: 30,
};

/** La périodicité usuelle, en mois. `null` = ponctuelle. */
export const DEADLINE_RECURRENCE_DEFAULT: Record<DeadlineKind, number | null> = {
  // Poids lourd et véhicule utilitaire : un an ; voiture : deux ans.
  // On propose douze mois, la valeur la plus courte — proposer la plus
  // longue ferait manquer l'échéance de ceux qui ne la corrigent pas.
  technicalInspection: 12,
  insurance: 12,
  service: 12,
  // VGP d'un appareil de levage : semestrielle ou annuelle selon
  // l'usage. Six mois par prudence.
  regulatoryCheck: 6,
  leaseEnd: null,
  warranty: null,
  other: null,
};

/** L'état calculé par la vue `equipment_due_dates` (migration 0067, §5). */
export const DEADLINE_STATES = ["overdue", "dueSoon", "planned", "done"] as const;
export type DeadlineState = (typeof DEADLINE_STATES)[number];

export const DEADLINE_STATE_LABELS: Record<DeadlineState, string> = {
  overdue: "En retard",
  dueSoon: "Bientôt",
  planned: "Planifiée",
  done: "Faite",
};

export const DEADLINE_STATE_TONE: Record<DeadlineState, BadgeTone> = {
  overdue: "critical",
  dueSoon: "warning",
  planned: "neutral",
  done: "positive",
};

// ---------------------------------------------------------------
// L'entretien
// ---------------------------------------------------------------

export const MAINTENANCE_KINDS = [
  "service", "repair", "inspection", "tyres", "consumable", "reading", "other",
] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export const MAINTENANCE_KIND_LABELS: Record<MaintenanceKind, string> = {
  service: "Révision",
  repair: "Réparation",
  inspection: "Contrôle",
  tyres: "Pneumatiques",
  consumable: "Consommables",
  reading: "Relevé de compteur",
  other: "Autre",
};

// ---------------------------------------------------------------
// Les formes lues depuis la base
// ---------------------------------------------------------------

export type Equipment = {
  id: string;
  organization_id: string;
  name: string;
  category: EquipmentCategory;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  internal_number: string | null;
  registration: string | null;
  ownership: Ownership;
  acquired_on: string | null;
  acquisition_cost_cents: number | null;
  supplier_id: string | null;
  meter_kind: MeterKind;
  status: EquipmentStatus;
  notes: string | null;
  archived_at: string | null;
};

/**
 * Une ligne de la vue `equipment_overview`.
 *
 * Elle reprend l'identité du matériel EN PLUS de la synthèse, ce qui
 * permet à la liste de chercher, filtrer, trier par urgence et paginer
 * en une seule requête. `id` n'y figure pas : la vue l'expose sous le
 * nom `equipment_id`, sans ambiguïté sur ce que la ligne désigne.
 */
export type EquipmentOverview = Omit<Equipment, "id"> & {
  equipment_id: string;
  /** NULL tant qu'aucune relève n'existe. Ce n'est PAS zéro. */
  current_meter: number | null;
  meter_read_on: string | null;
  last_maintenance_on: string | null;
  /** NULL tant qu'aucune intervention n'est notée. Ce n'est PAS zéro. */
  maintenance_cost_cents: number | null;
  maintenance_count: number;
  next_due_on: string | null;
  next_due_kind: DeadlineKind | null;
  next_due_state: DeadlineState | null;
  next_due_days_left: number | null;
  overdue_count: number;
  assignment_id: string | null;
  assigned_project_id: string | null;
  assigned_team_id: string | null;
  assigned_employee_id: string | null;
  assigned_since: string | null;
};

/** Une ligne de la vue `equipment_due_dates`. */
export type EquipmentDueDate = {
  deadline_id: string;
  equipment_id: string;
  equipment_name: string;
  category: EquipmentCategory;
  registration: string | null;
  internal_number: string | null;
  equipment_status: EquipmentStatus;
  kind: DeadlineKind;
  label: string | null;
  due_on: string;
  reminder_days: number;
  recurrence_months: number | null;
  completed_on: string | null;
  days_left: number;
  state: DeadlineState;
};

export type EquipmentMaintenance = {
  id: string;
  equipment_id: string;
  performed_on: string;
  kind: MaintenanceKind;
  description: string | null;
  cost_cents: number;
  meter_reading: number | null;
  supplier_id: string | null;
  deadline_id: string | null;
};

export type EquipmentAssignment = {
  id: string;
  equipment_id: string;
  project_id: string | null;
  team_id: string | null;
  employee_id: string | null;
  started_on: string;
  ended_on: string | null;
  notes: string | null;
};

// ---------------------------------------------------------------
// Mise en forme
// ---------------------------------------------------------------

const NOMBRE = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/**
 * Un compteur, avec son unité.
 *
 * `null` rend un tiret, jamais « 0 h ». Le quatrième défaut connu du
 * projet énoncé à l'envers : « on n'a jamais relevé le compteur » et
 * « la machine n'a jamais tourné » sont deux affirmations différentes,
 * et l'une des deux est fausse.
 */
export function formatMeter(value: number | null | undefined, kind: MeterKind): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const unit = METER_UNITS[kind];
  return unit ? `${NOMBRE.format(value)} ${unit}` : NOMBRE.format(value);
}

/**
 * Le délai d'une échéance, en français lisible.
 *
 * « dans 12 jours » fait agir ; « 2026-09-14 » demande un calcul mental
 * que personne ne fait en parcourant une liste. La date exacte reste
 * affichée à côté — l'un ne remplace pas l'autre.
 *
 * Zéro n'est ni positif ni négatif : c'est « aujourd'hui », et c'est le
 * jour où l'on peut encore agir.
 */
export function formatDelay(daysLeft: number | null | undefined): string {
  if (daysLeft === null || daysLeft === undefined || !Number.isFinite(daysLeft)) return "—";
  if (daysLeft === 0) return "aujourd'hui";
  if (daysLeft === 1) return "demain";
  if (daysLeft === -1) return "1 jour de retard";
  if (daysLeft < 0) return `${-daysLeft} jours de retard`;
  return `dans ${daysLeft} jours`;
}

/** L'intitulé d'une échéance : sa précision libre, ou sa nature. */
export function deadlineTitle(kind: DeadlineKind, label: string | null): string {
  return label?.trim() || DEADLINE_KIND_LABELS[kind];
}
