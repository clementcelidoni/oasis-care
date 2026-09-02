import type { BadgeTone } from "@/lib/quotes/types";

/**
 * §11S PORTAIL CLIENT — ce que le client voit.
 *
 * Ces types décrivent les VUES `client_*` de la migration 0055, pas les
 * tables. La différence est le sujet même du milestone : une vue
 * n'expose que les colonnes qu'on y a écrites, et aucune d'elles ne
 * porte de coût, de marge ni de note interne.
 *
 * Chaque type ci-dessous est donc plus PAUVRE que son équivalent
 * professionnel, et volontairement. Si un écran du portail réclame un
 * champ absent d'ici, la bonne réponse n'est pas de l'ajouter au type :
 * c'est de vérifier que le client a le droit de le connaître.
 */

/**
 * L'entête de l'entreprise, telle qu'elle figure déjà sur le devis
 * papier. Migration 0056 — ni `workspace_id`, ni réglages.
 */
export type PortalCompany = {
  id: string;
  name: string;
  business_type: string;
  legal_name: string | null;
  legal_form: string | null;
  siret: string | null;
  vat_number: string | null;
  rcs_city: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  insurance_details: string | null;
};

export type ClientQuote = {
  id: string;
  customer_id: string;
  number: string;
  title: string;
  status: string;
  issued_on: string;
  valid_until: string | null;
  introduction: string | null;
  terms: string | null;
  global_discount_percent: number;
  created_at: string;
};

export type ClientQuoteSection = {
  id: string;
  quote_id: string;
  title: string;
  description: string | null;
  position: number;
};

export type ClientQuoteLine = {
  id: string;
  quote_id: string;
  section_id: string | null;
  position: number;
  description: string;
  unit: string;
  quantity: number;
  unit_sale_price_cents: number;
  vat_rate: number;
  discount_percent: number;
  sale_total_cents: number;
};

export type ClientInvoice = {
  id: string;
  customer_id: string;
  number: string | null;
  status: string;
  issued_on: string;
  due_on: string | null;
  introduction: string | null;
  terms: string | null;
  /** Reprise du devis accepté. Migration 0065. */
  global_discount_percent: number;
};

export type ClientInvoiceLine = {
  id: string;
  invoice_id: string;
  position: number;
  description: string;
  unit: string;
  quantity: number;
  unit_price_cents: number;
  vat_rate: number;
  discount_percent: number;
  total_cents: number;
};

export type ClientInvoiceBalance = {
  invoice_id: string;
  total_including_vat_cents: number;
  paid_cents: number;
  credited_cents: number;
  outstanding_cents: number;
};

export type ClientProject = {
  id: string;
  customer_id: string;
  number: string;
  name: string;
  status: string;
  planned_start_on: string | null;
  planned_end_on: string | null;
  actual_start_on: string | null;
  actual_end_on: string | null;
  garden_id: string | null;
};

export type ClientProjectPhase = {
  id: string;
  project_id: string;
  title: string;
  position: number;
  status: string;
  progress_percent: number;
  planned_start_on: string | null;
  planned_end_on: string | null;
};

export type ClientProjectPhoto = {
  id: string;
  project_id: string;
  storage_path: string;
  caption: string | null;
  moment: string;
  taken_on: string | null;
};

// ---------------------------------------------------------------
// Les totaux, recalculés
// ---------------------------------------------------------------

/**
 * Le client ne lit pas `quote_totals`.
 *
 * Cette vue-là porte `total_cost_cents` et `margin_percent` dans les
 * mêmes lignes que le total à payer : lui en ouvrir la lecture
 * reviendrait à lui montrer notre marge pour lui épargner une addition.
 *
 * Le portail refait donc le calcul à partir des seules lignes qu'il a
 * le droit de voir. La formule suit celle de la vue au détail près,
 * migration 0049 :
 *
 *   1. regrouper par taux de TVA ;
 *   2. appliquer la remise globale sur CHAQUE tranche, au prorata ;
 *   3. calculer la TVA tranche par tranche, puis additionner.
 *
 * L'ordre n'est pas décoratif. Une TVA appliquée au total, à un taux
 * moyen, donne un centime d'écart dès qu'un devis mélange 20 % et
 * 10 % — et un client qui voit un montant différent de celui du PDF
 * appelle son artisan.
 */
export type PortalTotals = {
  totalExcludingVatCents: number;
  totalVatCents: number;
  totalIncludingVatCents: number;
  /** La ventilation par taux, telle qu'elle s'imprime en pied de devis. */
  byRate: { rate: number; baseCents: number; vatCents: number }[];
};

/**
 * `round()` de Postgres arrondit à l'unité supérieure EN VALEUR
 * ABSOLUE : -0,5 donne -1. `Math.round` de JavaScript, lui, arrondit
 * vers +∞ et rend 0. Une ligne d'avoir suffit à faire diverger les
 * deux.
 */
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function clientQuoteTotals(
  lines: Pick<ClientQuoteLine, "vat_rate" | "sale_total_cents">[],
  globalDiscountPercent: number,
): PortalTotals {
  const byRate = new Map<number, number>();
  for (const line of lines) {
    byRate.set(line.vat_rate, (byRate.get(line.vat_rate) ?? 0) + line.sale_total_cents);
  }

  const rates = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, saleCents]) => {
      // `sale * (100 - g) / 100` plutôt que `sale * (1 - g / 100)` :
      // le second passe par 0,05 et consorts, que le binaire ne
      // représente pas exactement.
      const baseCents = roundHalfAwayFromZero(
        (saleCents * (100 - globalDiscountPercent)) / 100,
      );
      return { rate, baseCents, vatCents: roundHalfAwayFromZero((baseCents * rate) / 100) };
    });

  const totalExcludingVatCents = rates.reduce((sum, r) => sum + r.baseCents, 0);
  const totalVatCents = rates.reduce((sum, r) => sum + r.vatCents, 0);

  return {
    totalExcludingVatCents,
    totalVatCents,
    totalIncludingVatCents: totalExcludingVatCents + totalVatCents,
    byRate: rates,
  };
}

/**
 * Les factures ont leur SOLDE en base — `client_invoice_balance` — mais
 * pas leur ventilation par taux : c'est le portail qui la recompose.
 *
 * La remise globale doit donc entrer dans le calcul. Sans elle, le
 * détail par taux affiché au client ne ferait pas le total affiché
 * juste en dessous, et c'est lui qui verrait la contradiction en
 * premier.
 */
export function clientInvoiceTotals(
  lines: Pick<ClientInvoiceLine, "vat_rate" | "total_cents">[],
  globalDiscountPercent = 0,
): PortalTotals {
  return clientQuoteTotals(
    lines.map((l) => ({ vat_rate: l.vat_rate, sale_total_cents: l.total_cents })),
    globalDiscountPercent,
  );
}

// ---------------------------------------------------------------
// Libellés
// ---------------------------------------------------------------

/**
 * Les statuts, dits au client.
 *
 * Les clés sont celles des contraintes `check` de la base — vérifiées
 * dans le catalogue, pas devinées. Une clé à côté ne casse rien : elle
 * fait retomber l'écran sur la valeur brute, et le client lit
 * « rejected » en anglais sur son devis.
 *
 * Ce ne sont pas les libellés internes. « Relancé » se dit à
 * l'entreprise ; au client on dit « À régler », parce qu'il sait déjà
 * qu'on l'a relancé.
 */
export const CLIENT_QUOTE_STATUS_LABELS: Record<string, string> = {
  sent: "À examiner",
  viewed: "À examiner",
  accepted: "Accepté",
  rejected: "Refusé",
  expired: "Expiré",
  cancelled: "Annulé",
};

export const CLIENT_QUOTE_STATUS_TONE: Record<string, BadgeTone> = {
  sent: "info",
  viewed: "info",
  accepted: "positive",
  rejected: "critical",
  expired: "neutral",
  cancelled: "neutral",
};

export const CLIENT_INVOICE_STATUS_LABELS: Record<string, string> = {
  issued: "À régler",
  partiallyPaid: "Partiellement réglée",
  paid: "Réglée",
  overdue: "En retard",
  credited: "Avoir émis",
  cancelled: "Annulée",
};

export const CLIENT_INVOICE_STATUS_TONE: Record<string, BadgeTone> = {
  issued: "info",
  partiallyPaid: "warning",
  paid: "positive",
  overdue: "critical",
  credited: "neutral",
  cancelled: "neutral",
};

export const CLIENT_PROJECT_STATUS_LABELS: Record<string, string> = {
  planned: "Planifié",
  inProgress: "En cours",
  onHold: "En pause",
  completed: "Terminé",
  handedOver: "Livré",
  cancelled: "Annulé",
};

export const CLIENT_PROJECT_STATUS_TONE: Record<string, BadgeTone> = {
  planned: "neutral",
  inProgress: "info",
  onHold: "warning",
  completed: "positive",
  handedOver: "positive",
  cancelled: "neutral",
};

export const GARDEN_ROLE_LABELS: Record<string, string> = {
  owner: "Propriétaire",
  householdMember: "Foyer",
  professional: "Professionnel",
  readOnly: "Lecture seule",
};

/**
 * L'avancement d'un chantier, vu du client.
 *
 * Moyenne des phases, pas moyenne pondérée par le budget : le client ne
 * connaît pas les budgets, et une phase courte mais chère fausserait un
 * chiffre qu'il lit comme « où en est-on ».
 */
export function projectProgress(phases: Pick<ClientProjectPhase, "progress_percent">[]): number {
  if (phases.length === 0) return 0;
  const sum = phases.reduce((total, phase) => total + phase.progress_percent, 0);
  return Math.round(sum / phases.length);
}
