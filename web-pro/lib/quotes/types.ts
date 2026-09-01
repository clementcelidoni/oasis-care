/**
 * §11D et §11E — catalogue, bibliothèque de prix, devis.
 *
 * L'ARGENT NE QUITTE JAMAIS LES CENTIMES ENTIERS. Toutes les valeurs
 * traversent la base, le serveur et le navigateur en `bigint` de
 * centimes ; la conversion en euros n'a lieu qu'au dernier moment, pour
 * l'affichage ou la saisie. Un `number` flottant qui traverse trois
 * couches finit par produire un total à un centime près, et un centime
 * d'écart sur une facture est un litige.
 */

export const QUOTE_STATUSES = [
  "draft", "internalReview", "sent", "viewed",
  "accepted", "rejected", "expired", "cancelled",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Brouillon",
  internalReview: "Relecture interne",
  sent: "Envoyé",
  viewed: "Consulté",
  accepted: "Accepté",
  rejected: "Refusé",
  expired: "Expiré",
  cancelled: "Annulé",
};

/** Repris tel quel de `components/ui.tsx` : un vocabulaire parallèle
 *  ne se verrait qu'au moment de passer la valeur au composant. */
export type BadgeTone = "neutral" | "accent" | "positive" | "warning" | "critical" | "info";

export const QUOTE_STATUS_TONE: Record<QuoteStatus, BadgeTone> = {
  draft: "neutral",
  internalReview: "info",
  sent: "info",
  viewed: "info",
  accepted: "positive",
  rejected: "critical",
  expired: "warning",
  cancelled: "neutral",
};

/**
 * Les états depuis lesquels le devis se modifie encore.
 *
 * Une fois remis au client, un devis n'est plus un brouillon : le
 * modifier en place ferait diverger ce qu'on affiche de ce qu'il a reçu.
 * Le geste correct est d'enregistrer une révision puis de repasser en
 * brouillon, ce que l'écran propose explicitement.
 */
export const EDITABLE_STATUSES: QuoteStatus[] = ["draft", "internalReview"];

export function isEditable(status: QuoteStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

export const CATALOG_ITEM_TYPES = [
  "plant", "material", "labor", "equipment", "rental",
  "transport", "waste", "subcontracting", "service", "custom",
] as const;
export type CatalogItemType = (typeof CATALOG_ITEM_TYPES)[number];

export const CATALOG_ITEM_TYPE_LABELS: Record<CatalogItemType, string> = {
  plant: "Végétal",
  material: "Fourniture",
  labor: "Main-d'œuvre",
  equipment: "Matériel",
  rental: "Location",
  transport: "Transport",
  waste: "Évacuation",
  subcontracting: "Sous-traitance",
  service: "Prestation",
  custom: "Divers",
};

/**
 * Natures de coût du suivi de chantier — §JOB COSTING.
 *
 * Portée par la ligne de devis dès qu'on la connaît, pour que le
 * chantier qui en naîtra sache classer sa dépense. Sans elle, tout
 * atterrit dans « Divers » et le comparatif prévu/réel se réduit à une
 * seule ligne.
 */
export const COST_KINDS = [
  "labor", "material", "plant", "equipment",
  "subcontracting", "transport", "waste", "other",
] as const;
export type CostKind = (typeof COST_KINDS)[number];

export const COST_KIND_LABELS: Record<CostKind, string> = {
  labor: "Main-d'œuvre",
  material: "Fournitures",
  plant: "Végétaux",
  equipment: "Matériel et location",
  subcontracting: "Sous-traitance",
  transport: "Transport",
  waste: "Évacuation",
  other: "Divers",
};

/** Ce que devient un type d'article du catalogue. Miroir de `cost_kind_from_catalog_type`. */
export const COST_KIND_FROM_ITEM_TYPE: Record<CatalogItemType, CostKind> = {
  plant: "plant",
  labor: "labor",
  material: "material",
  equipment: "equipment",
  rental: "equipment",
  transport: "transport",
  waste: "waste",
  subcontracting: "subcontracting",
  service: "other",
  custom: "other",
};

/** Unités courantes du métier. Le champ reste libre — voir migration 0048. */
export const COMMON_UNITS = ["u", "m", "m²", "m³", "h", "j", "kg", "L", "forfait"];

/**
 * Taux de TVA français applicables aux travaux de jardin.
 *
 * Proposés, jamais imposés : le champ accepte n'importe quelle valeur.
 * Choisir le bon taux relève de la situation du chantier et du client,
 * pas d'une règle qu'Oasis pourrait deviner — et la liste des interdits
 * du document est claire : « NE PAS inventer des obligations
 * réglementaires ».
 */
export const VAT_RATES = [20, 10, 5.5, 0];

// ---------------------------------------------------------------
// Argent
// ---------------------------------------------------------------

const EUROS = new Intl.NumberFormat("fr-FR", {
  style: "currency", currency: "EUR",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return EUROS.format(cents / 100);
}

/** Sans le symbole : pour les champs de saisie et les colonnes serrées. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

/**
 * Une saisie en euros vers des centimes entiers.
 *
 * Accepte la virgule comme séparateur décimal, parce que c'est ce que
 * tape un utilisateur français, et parce qu'un champ qui refuse « 12,50 »
 * sans le dire renvoie silencieusement zéro.
 */
export function inputToCents(value: string): number {
  const normalised = value.replace(/\s/g, "").replace(",", ".");
  const euros = Number.parseFloat(normalised);
  if (!Number.isFinite(euros)) return 0;
  return Math.round(euros * 100);
}

/**
 * Un nombre saisi à la française, ou `null` si ce n'en est pas un.
 *
 * La distinction entre « zéro » et « illisible » est tout l'objet de
 * cette fonction, et elle a coûté cher : les Server Actions écrivaient
 * `parseQuantity(saisie) || 20` pour se prémunir d'une saisie
 * incompréhensible. Mais `0 || 20` vaut 20. Un artisan en franchise en
 * base de TVA qui choisissait « 0 % » dans la liste — la liste la
 * PROPOSE — voyait sa facture émise à 20 %, sans le moindre message.
 *
 * Six endroits faisaient ça, sur les devis, les factures, le catalogue
 * et les commandes. Le repli doit s'appliquer à ce qui n'est PAS un
 * nombre, jamais à un nombre qui vaut zéro.
 */
export function parseNumber(value: string): number | null {
  const normalised = value.replace(/\s/g, "").replace(",", ".");
  const n = Number.parseFloat(normalised);
  return Number.isFinite(n) ? n : null;
}

export function parseQuantity(value: string): number {
  return parseNumber(value) ?? 0;
}

/**
 * Une quantité, avec un repli si la saisie est illisible.
 *
 * Les nombres NÉGATIFS passent : une ligne de facture à quantité
 * négative est une remise ou une reprise, et c'est légitime. Seule une
 * saisie qui n'est pas un nombre retombe sur le repli.
 */
export function parseQuantityOr(value: string, fallback: number): number {
  return parseNumber(value) ?? fallback;
}

/**
 * Un taux de TVA.
 *
 * Zéro est un taux valable — franchise en base, autoliquidation,
 * exportation. Un taux NÉGATIF n'existe pas : il retombe sur le repli,
 * comme une saisie illisible.
 */
export function parseVatRate(value: string, fallback = 20): number {
  const rate = parseNumber(value);
  if (rate === null || rate < 0) return fallback;
  return rate;
}

const PERCENT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${PERCENT.format(value)} %`;
}

const QUANTITY = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

export function formatQuantity(value: number): string {
  return QUANTITY.format(value);
}

// ---------------------------------------------------------------
// Formes lues en base
// ---------------------------------------------------------------

export type QuoteTotals = {
  total_excluding_vat_cents: number;
  total_cost_cents: number;
  total_vat_cents: number;
  total_including_vat_cents: number;
  margin_cents: number;
  margin_percent: number | null;
};

export const EMPTY_TOTALS: QuoteTotals = {
  total_excluding_vat_cents: 0,
  total_cost_cents: 0,
  total_vat_cents: 0,
  total_including_vat_cents: 0,
  margin_cents: 0,
  margin_percent: null,
};

export type QuoteLine = {
  id: string;
  section_id: string | null;
  catalog_item_id: string | null;
  position: number;
  description: string;
  unit: string;
  quantity: number;
  unit_cost_cents: number;
  unit_sale_price_cents: number;
  vat_rate: number;
  discount_percent: number;
  sale_total_cents: number;
  cost_total_cents: number;
};

export type QuoteSection = {
  id: string;
  title: string;
  description: string | null;
  position: number;
};

export type Quote = {
  id: string;
  number: string;
  title: string;
  status: QuoteStatus;
  customer_id: string;
  garden_id: string | null;
  global_discount_percent: number;
  issued_on: string;
  valid_until: string | null;
  sent_at: string | null;
  decided_at: string | null;
  introduction: string | null;
  terms: string | null;
  internal_notes: string | null;
  created_at: string;
};

export type CatalogItem = {
  id: string;
  item_type: CatalogItemType;
  name: string;
  reference: string | null;
  unit: string;
  description: string | null;
  /** Tarif en cours dans la grille par défaut, joint à la lecture. */
  purchase_price_cents: number | null;
  sale_price_cents: number | null;
  vat_rate: number | null;
};

/**
 * §RENTABILITÉ — « Coût estimé / Prix HT / Marge € / Marge % ».
 *
 * Le signe compte : une marge négative doit sauter aux yeux, c'est un
 * chantier vendu à perte.
 */
export function marginTone(marginCents: number): BadgeTone {
  if (marginCents < 0) return "critical";
  if (marginCents === 0) return "warning";
  return "positive";
}
