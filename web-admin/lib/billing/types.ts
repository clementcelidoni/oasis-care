/**
 * ==================================================================
 * LES LIGNES QUE LA BASE REND — types, et rien que des types
 * ==================================================================
 *
 * Chaque champ porte le nom EXACT de la colonne SQL, en `snake_case`.
 * Renommer en `camelCase` à la lecture ferait une deuxième
 * nomenclature : il faudrait alors traduire dans les deux sens à chaque
 * requête, et le premier oubli produirait un `undefined` silencieux là
 * où une colonne manque. Le français des libellés vit à l'écran, pas
 * dans les types de transport.
 *
 * LA CONVENTION D'ARGENT DU PROJET : tout est en CENTIMES ENTIERS,
 * partout, du SQL jusqu'au dernier `formatCents()`. Aucun euro
 * flottant ne traverse ce fichier.
 *
 * ET LA CONVENTION D'INCONNU : `null` veut dire « la base ne sait
 * pas », jamais « zéro ». Un prix `null` n'est pas un prix nul, un
 * `included_seats` nul n'est pas « aucun siège », un `vat_rate` nul
 * n'est pas « exonéré ». Aucun `?? 0` ne doit apparaître derrière l'un
 * de ces champs.
 */

// ------------------------------------------------------------------
// La grille
// ------------------------------------------------------------------

/** Les deux seuls badges que la contrainte `organization_plans_badge_valid` accepte. */
export type BadgeOffre = "bestSeller" | "new";

/** Ce que 0081 § 4.a appelle `seat_policy`. */
export type PolitiqueSieges = "hardCap" | "billedBeyondIncluded";

export type LigneOffre = {
  key: string;
  name: string;
  tagline: string | null;
  /** `jsonb` : un tableau de chaînes dans le semis, mais rien ne l'impose. */
  features: unknown;
  monthly_price_cents: number | null;
  yearly_price_cents: number | null;
  currency: string;
  is_quote_only: boolean;
  price_floor_cents: number | null;
  /** Indication d'affichage héritée de 0060 — PAS un plafond appliqué. */
  max_users: number | null;
  /** La référence de facturation. `null` = NON DÉCIDÉ, pas « illimité ». */
  included_seats: number | null;
  seat_policy: PolitiqueSieges;
  extra_seat_monthly_price_cents: number | null;
  ai_monthly_quota: number | null;
  storage_gb: number | null;
  badge: BadgeOffre | null;
  position: number;
  is_active: boolean;
  updated_at: string | null;
  updated_by: string | null;
};

/** Le modèle de tarification d'un module (0081 § 4.b). */
export type ModeleTarification = "flat" | "metered" | "commission";

export type LigneModule = {
  key: string;
  name: string;
  tagline: string | null;
  is_delivered: boolean;
  pricing_model: ModeleTarification;
  metered_unit: string | null;
  position: number;
  note: string | null;
};

/**
 * Les quatre états d'une case de la matrice.
 *
 * `undecided` N'EST PAS UNE CASE VIDE : c'est la réponse honnête quand
 * le dirigeant n'a rien dit, et elle BLOQUE la souscription.
 */
export type Disponibilite = "included" | "optional" | "unavailable" | "undecided";

export type LigneCase = {
  plan_key: string;
  module_key: string;
  availability: Disponibilite;
  monthly_price_cents: number | null;
  yearly_price_cents: number | null;
  metered_unit_price_cents: number | null;
  updated_at: string | null;
};

export type NatureRemise = "fixedMonthlyPrice" | "percentOff" | "amountOff";

export type LigneOffreDeRemise = {
  code: string;
  label: string;
  kind: NatureRemise;
  value_cents: number | null;
  percent: number | null;
  duration_months: number;
  is_active: boolean;
  available_until: string | null;
  note: string | null;
};

// ------------------------------------------------------------------
// Les abonnements
// ------------------------------------------------------------------

export type StatutAbonnement = "trialing" | "active" | "pastDue" | "cancelled";
export type CycleFacturation = "monthly" | "yearly";
export type FournisseurAbonnement = "none" | "web" | "apple" | "manual";

export type LigneAbonnement = {
  organization_id: string;
  plan: string;
  provider: FournisseurAbonnement;
  status: StatutAbonnement;
  started_at: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  external_reference: string | null;
  updated_at: string | null;
  // Les colonnes de 0081 § 5.b.
  billing_cycle: CycleFacturation;
  negotiated_monthly_price_cents: number | null;
  negotiated_yearly_price_cents: number | null;
  billable_extra_seats: number;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean;
  currency: string;
  note: string | null;
  managed_by: string | null;
};

export type LigneModuleSouscrit = {
  organization_id: string;
  module_key: string;
  activated_at: string;
  cancelled_at: string | null;
  note: string | null;
};

export type LigneRemise = {
  id: string;
  organization_id: string;
  code: string | null;
  label: string;
  kind: NatureRemise;
  value_cents: number | null;
  percent: number | null;
  starts_on: string;
  /** NOT NULL en base : l'à-vie est littéralement inenregistrable. */
  ends_on: string;
  reason: string;
  cancelled_at: string | null;
  created_at: string;
};

export type LigneCredit = {
  id: string;
  organization_id: string;
  amount_cents: number;
  currency: string;
  reason: string;
  granted_at: string;
  consumed_at: string | null;
  consumed_invoice_id: string | null;
  cancelled_at: string | null;
};

export type LigneEvenementAbonnement = {
  id: string;
  organization_id: string;
  event: string;
  plan_before: string | null;
  plan_after: string | null;
  status_before: string | null;
  status_after: string | null;
  old_value: unknown;
  new_value: unknown;
  actor_user_id: string | null;
  reason: string | null;
  occurred_at: string;
};

/**
 * Ce que rend `saas_subscription_billing_lines()` — le calcul de ce
 * qu'un abonnement doit pour une période.
 *
 * `blocking_reason` est le champ qui compte : la fonction NE LÈVE
 * JAMAIS, elle rend une ligne portant son motif de blocage. C'est ce
 * qui permet à l'écran de montrer la facture ET ce qui l'empêche de
 * partir, au lieu d'une erreur opaque.
 */
export type LigneCalculee = {
  line_position: number;
  kind: string;
  module_key: string | null;
  description: string;
  quantity: number;
  /** NULL = prix inconnu. Jamais zéro : voir `LigneDeFacture`. */
  unit_price_cents: number | null;
  vat_rate: number | null;
  blocking_reason: string | null;
};

// ------------------------------------------------------------------
// Les factures SaaS
// ------------------------------------------------------------------

export type StatutStockeFacture = "draft" | "issued" | "paid" | "cancelled" | "credited";

/**
 * Ce que rend la vue `saas_invoice_state`.
 *
 * `overdue` et `partiallyPaidOverdue` ne sont PAS des statuts stockés :
 * ils se déduisent de l'échéance et de ce qui a été encaissé. Un statut
 * « en retard » écrit en base serait faux dès le lendemain.
 */
export type StatutEffectifFacture =
  | "draft"
  | "issued"
  | "paid"
  | "partiallyPaid"
  | "partiallyPaidOverdue"
  | "overdue"
  | "cancelled"
  | "credited";

export type RegimeTva = "france" | "euReverseCharge" | "outsideEu" | "unknown";

export type MoyenReglement = "transfer" | "provider";
export type MoyenEncaissement = "transfer" | "provider" | "other";

export type LigneFacture = {
  id: string;
  organization_id: string;
  number: string | null;
  status: StatutStockeFacture;
  period_start: string;
  period_end: string;
  billing_cycle: CycleFacturation;
  issued_on: string | null;
  due_on: string | null;
  issued_at: string | null;
  currency: string;
  vat_regime: RegimeTva;
  vat_rate: number | null;
  vat_note: string | null;
  payment_method: MoyenReglement;
  payment_reference: string | null;
  external_payment_reference: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  internal_notes: string | null;
  created_at: string;
};

/** Les mentions figées sur le document au moment de l'émission. */
export type MentionsFacture = {
  issuer_legal_name: string | null;
  issuer_legal_form: string | null;
  issuer_siret: string | null;
  issuer_vat_number: string | null;
  issuer_rcs_city: string | null;
  issuer_share_capital_cents: number | null;
  issuer_address: string | null;
  issuer_email: string | null;
  issuer_iban: string | null;
  issuer_bic: string | null;
  issuer_late_penalty_terms: string | null;
  issuer_recovery_indemnity_cents: number | null;
  issuer_footer: string | null;
  customer_name: string | null;
  customer_legal_name: string | null;
  customer_legal_form: string | null;
  customer_siret: string | null;
  customer_vat_number: string | null;
  customer_address: string | null;
  customer_country: string | null;
  customer_email: string | null;
};

export type EtatFacture = {
  invoice_id: string;
  organization_id: string;
  number: string | null;
  stored_status: StatutStockeFacture;
  effective_status: StatutEffectifFacture;
  due_on: string | null;
  days_late: number | null;
  /** `null` quand un seul taux de TVA manque : le total est INCONNU. */
  total_including_vat_cents: number | null;
  paid_cents: number;
  credited_cents: number;
  outstanding_cents: number | null;
};

export type LigneDeFacture = {
  id: string;
  invoice_id: string;
  position: number;
  kind: "plan" | "seats" | "module" | "discount" | "credit" | "other";
  module_key: string | null;
  description: string;
  quantity: number;
  /**
   * NULLABLE, ET C'EST LE POINT. Un prix absent n'est pas un prix de
   * zéro : la base laisse la colonne vide, le total de la facture
   * devient inconnu, et l'émission est refusée. Avant 0081 elle valait
   * 0 et une facture opposable à 0,00 € pouvait partir.
   */
  unit_price_cents: number | null;
  vat_rate: number | null;
  /**
   * Ce qui empêche d'émettre, écrit sur la ligne fautive et STOCKÉ.
   * Le motif était calculé à la génération puis perdu ; rouvrir le
   * brouillon le lendemain ne disait plus rien.
   */
  blocking_reason: string | null;
  /** Colonne GÉNÉRÉE par la base. On ne la recalcule jamais ici. */
  total_cents: number | null;
};

export type LigneEncaissement = {
  id: string;
  invoice_id: string;
  amount_cents: number;
  received_on: string;
  method: MoyenEncaissement;
  external_reference: string | null;
  note: string | null;
  created_at: string;
};

export type LigneAvoir = {
  id: string;
  invoice_id: string;
  organization_id: string;
  number: string | null;
  reason: string;
  issued_on: string | null;
  created_at: string;
};

export type LigneEmetteur = {
  legal_name: string | null;
  legal_form: string | null;
  siret: string | null;
  siren: string | null;
  vat_number: string | null;
  rcs_city: string | null;
  share_capital_cents: number | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  iban: string | null;
  bic: string | null;
  bank_name: string | null;
  payment_terms_days: number;
  late_penalty_terms: string | null;
  recovery_indemnity_cents: number;
  invoice_footer: string | null;
  updated_at: string | null;
};

/** Ce que rend `saas_vat_regime()`. */
export type RegimeTvaClient = {
  regime: RegimeTva;
  rate: number | null;
  /** Le motif quand le régime est `unknown`. C'est lui qui bloque l'émission. */
  reason: string | null;
};

/** Une entreprise, réduite à ce que ces écrans ont besoin d'en savoir. */
export type Entreprise = {
  id: string;
  nom: string;
  plan: string | null;
  statutAbonnement: string | null;
  pays: string | null;
  siret: string | null;
  numeroTva: string | null;
  archiveeLe: string | null;
};

/** Une ligne de `saas_generate_invoices()`. */
export type ResultatGeneration = {
  organization_id: string;
  organization_name: string;
  invoice_id: string;
  invoice_number: string | null;
  /**
   * « refreshed » : un brouillon EXISTAIT et vient d'être refait sur
   * l'abonnement d'aujourd'hui. À ne pas confondre avec
   * « alreadyBilled », qui ne concerne plus qu'une facture ÉMISE — donc
   * intouchable.
   */
  outcome: "draft" | "refreshed" | "issued" | "blocked" | "alreadyBilled";
  total_including_vat_cents: number | null;
  blocking_reason: string | null;
};
