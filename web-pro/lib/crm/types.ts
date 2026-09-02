export const LIFECYCLE_STAGES = ["lead", "customer", "lost"] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const PROSPECT_STATUSES = [
  "new",
  "contacted",
  "visitScheduled",
  "quoteInProgress",
  "quoteSent",
  "won",
  "lost",
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

/** §"PROSPECT — Workflow configurable", dans l'ordre du document. */
export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  new: "Nouveau",
  contacted: "Contacté",
  visitScheduled: "Visite planifiée",
  quoteInProgress: "Devis en cours",
  quoteSent: "Devis envoyé",
  won: "Gagné",
  lost: "Perdu",
};

export const OPPORTUNITY_STAGES = [
  "qualification",
  "visit",
  "design",
  "quoted",
  "negotiation",
  "won",
  "lost",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  qualification: "Qualification",
  visit: "Visite",
  design: "Conception",
  quoted: "Devis remis",
  negotiation: "Négociation",
  won: "Gagnée",
  lost: "Perdue",
};

export const ACTIVITY_TYPES = [
  "note",
  "call",
  "email",
  "meeting",
  "visit",
  "task",
  "custom",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  note: "Note",
  call: "Appel",
  email: "E-mail",
  meeting: "Rendez-vous",
  visit: "Visite",
  task: "Tâche",
  custom: "Autre",
};

export const SITE_TYPES = [
  "residence",
  "secondaryResidence",
  "business",
  "publicSpace",
  "other",
] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const SITE_TYPE_LABELS: Record<SiteType, string> = {
  residence: "Résidence principale",
  secondaryResidence: "Résidence secondaire",
  business: "Site professionnel",
  publicSpace: "Espace public",
  other: "Autre",
};

export type Customer = {
  id: string;
  lifecycle_stage: LifecycleStage;
  prospect_status: ProspectStatus;
  kind: "individual" | "company";
  display_name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  billing_city: string | null;
  billing_postal_code: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
  converted_at: string | null;
};

export type Contact = {
  id: string;
  first_name: string | null;
  last_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  is_primary: boolean;
};

export type CustomerSite = {
  id: string;
  name: string;
  site_type: SiteType;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
  surface_sqm: number | null;
  garden_id: string | null;
};

export type Opportunity = {
  id: string;
  title: string;
  stage: OpportunityStage;
  estimated_value_cents: number | null;
  probability_percent: number | null;
  expected_close_date: string | null;
  customer_id: string;
};

export type Activity = {
  id: string;
  activity_type: ActivityType;
  subject: string | null;
  body: string | null;
  occurred_at: string;
  due_at: string | null;
  completed_at: string | null;
};

/**
 * Montants stockés en centimes : un `double precision` pour de l'argent
 * finit toujours par produire un total à 0,01 € près qu'on ne sait pas
 * expliquer au client.
 */
export function formatAmount(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
