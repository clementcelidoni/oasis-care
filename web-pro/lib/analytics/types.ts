/**
 * §11T ANALYTICS — `ProAnalyticsService`, côté lecture.
 *
 * Les chiffres viennent des fonctions `pro_analytics_landscaper` et
 * `pro_analytics_nursery` (migration 0058). Rien n'est recalculé ici :
 * un KPI qui existe à deux endroits finit par donner deux réponses, et
 * c'est celui de l'écran qu'on croit.
 *
 * Ce module fait deux choses, et deux seulement : nommer les périodes,
 * et distinguer « zéro » de « je ne sais pas ».
 */

export type LandscaperKpis = {
  revenue_cents: number;
  quotes_sent: number;
  quotes_accepted: number;
  quote_conversion_percent: number | null;
  backlog_cents: number;
  project_margin_cents: number;
  project_margin_percent: number | null;
  projects_measured: number;
  labor_planned_hours: number;
  labor_actual_hours: number;
  labor_efficiency_percent: number | null;
  average_project_value_cents: number | null;
  overdue_invoices_count: number;
  overdue_invoices_cents: number;
};

export type NurseryKpis = {
  stock_value_cents: number;
  valued_lots: number;
  unpriced_lots: number;
  available_stock: number;
  production_value_cents: number;
  loss_rate_percent: number | null;
  turnover_percent: number | null;
  dormant_lots: number;
  dormant_quantity: number;
  space_utilization_percent: number | null;
  production_yield_percent: number | null;
};

// ---------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------

export const PERIODS = ["month", "quarter", "year", "twelveMonths"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  month: "Ce mois",
  quarter: "Ce trimestre",
  year: "Cette année",
  twelveMonths: "12 derniers mois",
};

export function isPeriod(value: string | undefined): value is Period {
  return value !== undefined && (PERIODS as readonly string[]).includes(value);
}

/**
 * Les bornes d'une période, en dates locales.
 *
 * `toISOString()` passerait par UTC : le 1er janvier à Paris y devient
 * le 31 décembre, et le premier jour du mois sortirait du mois. On
 * formate donc à la main, comme partout ailleurs dans ce projet depuis
 * le décalage de deux heures trouvé au Milestone 7.
 */
export function periodRange(period: Period, today = new Date()): { from: string; to: string } {
  const year = today.getFullYear();
  const month = today.getMonth();

  const start = (() => {
    switch (period) {
      case "month":
        return new Date(year, month, 1);
      case "quarter":
        return new Date(year, Math.floor(month / 3) * 3, 1);
      case "year":
        return new Date(year, 0, 1);
      case "twelveMonths":
        return new Date(year - 1, month, today.getDate());
    }
  })();

  return { from: isoDate(start), to: isoDate(today) };
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// ---------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------

/**
 * Un pourcentage, ou un tiret.
 *
 * LA DISTINCTION EST TOUT L'INTÉRÊT. Une conversion nulle et une
 * conversion inconnue s'affichent différemment : « 0 % » se lit comme
 * un mois catastrophique, alors qu'aucun devis n'a peut-être été
 * envoyé. Les fonctions SQL rendent NULL dans ce cas ; à l'écran, c'est
 * un tiret.
 */
export function formatPercentOrDash(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value)} %`;
}

export function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value)} h`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("fr-FR").format(value);
}

export type Tone = "neutral" | "positive" | "warning" | "critical";

/**
 * Le ton d'un indicateur.
 *
 * Un seuil affiché en couleur est une opinion. Ceux-ci sont assumés et
 * écrits ici plutôt que dispersés dans le JSX : une marge sous 20 %
 * inquiète un paysagiste, une conversion sous 20 % aussi, et une perte
 * de pépinière au-dessus de 10 % est un problème à regarder.
 */
export function thresholdTone(
  value: number | null,
  { good, warn, inverted = false }: { good: number; warn: number; inverted?: boolean },
): Tone {
  if (value === null) return "neutral";
  if (inverted) {
    if (value <= good) return "positive";
    if (value <= warn) return "warning";
    return "critical";
  }
  if (value >= good) return "positive";
  if (value >= warn) return "warning";
  return "critical";
}
