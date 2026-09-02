import type { BadgeTone } from "@/lib/quotes/types";

/** §11O facturation et §DÉPENSES / TRÉSORERIE. */

export const INVOICE_STATUSES = [
  "draft", "issued", "partiallyPaid", "paid", "overdue", "cancelled", "credited",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Brouillon",
  issued: "Émise",
  partiallyPaid: "Partiellement payée",
  paid: "Payée",
  overdue: "En retard",
  cancelled: "Annulée",
  credited: "Créditée",
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, BadgeTone> = {
  draft: "neutral",
  issued: "info",
  partiallyPaid: "warning",
  paid: "positive",
  overdue: "critical",
  cancelled: "neutral",
  credited: "neutral",
};

/**
 * Une facture émise ne redevient jamais un brouillon.
 *
 * La base le refuse — voir le déclencheur `protect_issued_invoice` —
 * mais l'écran doit le dire avant qu'on essaie, plutôt que de laisser
 * quelqu'un buter dessus.
 */
export function isLocked(invoice: { issued_at: string | null }): boolean {
  return invoice.issued_at !== null;
}

export const PAYMENT_METHODS = [
  "transfer", "card", "cheque", "cash", "direct_debit", "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer: "Virement",
  card: "Carte",
  cheque: "Chèque",
  cash: "Espèces",
  direct_debit: "Prélèvement",
  other: "Autre",
};

export type Invoice = {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  issued_on: string | null;
  due_on: string | null;
  issued_at: string | null;
  introduction: string | null;
  terms: string | null;
  internal_notes: string | null;
  customer_id: string;
  quote_id: string | null;
  project_id: string | null;
};

export type InvoiceLine = {
  id: string;
  position: number;
  description: string;
  unit: string;
  quantity: number;
  unit_price_cents: number;
  vat_rate: number;
  discount_percent: number;
  total_cents: number;
};

export type InvoiceBalance = {
  total_including_vat_cents: number;
  paid_cents: number;
  credited_cents: number;
  outstanding_cents: number;
};

export const EMPTY_BALANCE: InvoiceBalance = {
  total_including_vat_cents: 0,
  paid_cents: 0,
  credited_cents: 0,
  outstanding_cents: 0,
};

/**
 * Un solde négatif veut dire qu'on doit de l'argent au client — un
 * avoir plus grand que ce qui restait dû. Le dire ainsi plutôt que
 * d'afficher un moins devant un chiffre, que personne ne lit comme ça.
 */
export function balanceTone(outstanding: number): BadgeTone {
  if (outstanding < 0) return "info";
  if (outstanding === 0) return "positive";
  return "warning";
}

export type CashFlowEntry = {
  occurred_on: string;
  direction: "in" | "out";
  amount_cents: number;
  label: string;
  source: string;
};

/**
 * Le solde cumulé, mois par mois.
 *
 * Ce n'est PAS une trésorerie prévisionnelle : rien ici n'anticipe une
 * échéance à venir ou un découvert. Ce sont les mouvements constatés,
 * additionnés dans l'ordre. Présenter cela comme une prévision serait
 * la sorte de fausse assurance que la spec interdit.
 */
export function monthlyCashFlow(entries: CashFlowEntry[]): {
  month: string;
  inCents: number;
  outCents: number;
  netCents: number;
  runningCents: number;
}[] {
  const byMonth = new Map<string, { inCents: number; outCents: number }>();
  for (const e of entries) {
    const month = e.occurred_on.slice(0, 7);
    const bucket = byMonth.get(month) ?? { inCents: 0, outCents: 0 };
    if (e.amount_cents >= 0) bucket.inCents += e.amount_cents;
    else bucket.outCents += e.amount_cents;
    byMonth.set(month, bucket);
  }

  let running = 0;
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, b]) => {
      const netCents = b.inCents + b.outCents;
      running += netCents;
      return { month, inCents: b.inCents, outCents: b.outCents, netCents, runningCents: running };
    });
}

const MONTH_FORMAT = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return MONTH_FORMAT.format(new Date(y, m - 1, 1));
}
