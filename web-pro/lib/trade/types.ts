import type { BadgeTone } from "@/lib/quotes/types";

/** §11M achats et §11N commandes clients. */

export const PURCHASE_STATUSES = [
  "draft", "sent", "partiallyReceived", "received", "cancelled",
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  draft: "Brouillon",
  sent: "Envoyée",
  partiallyReceived: "Partiellement reçue",
  received: "Reçue",
  cancelled: "Annulée",
};

export const PURCHASE_STATUS_TONE: Record<PurchaseStatus, BadgeTone> = {
  draft: "neutral",
  sent: "info",
  partiallyReceived: "warning",
  received: "positive",
  cancelled: "neutral",
};

/**
 * Les états qui se DÉDUISENT des réceptions.
 *
 * Les proposer à la saisie laisserait quelqu'un cocher « reçue » sur
 * une commande dont rien n'est arrivé, et le stock prévisionnel
 * mentirait sans que rien ne le signale.
 */
export const DERIVED_PURCHASE_STATUSES: PurchaseStatus[] = ["partiallyReceived", "received"];

export const SALES_STATUSES = [
  "draft", "confirmed", "partiallyDelivered", "delivered", "cancelled",
] as const;
export type SalesStatus = (typeof SALES_STATUSES)[number];

export const SALES_STATUS_LABELS: Record<SalesStatus, string> = {
  draft: "Brouillon",
  confirmed: "Confirmée",
  partiallyDelivered: "Partiellement livrée",
  delivered: "Livrée",
  cancelled: "Annulée",
};

export const SALES_STATUS_TONE: Record<SalesStatus, BadgeTone> = {
  draft: "neutral",
  confirmed: "info",
  partiallyDelivered: "warning",
  delivered: "positive",
  cancelled: "neutral",
};

export const DERIVED_SALES_STATUSES: SalesStatus[] = ["partiallyDelivered", "delivered"];

export type PurchaseOrder = {
  id: string;
  number: string;
  reference: string | null;
  status: PurchaseStatus;
  ordered_on: string;
  expected_on: string | null;
  notes: string | null;
};

export type PurchaseLine = {
  id: string;
  position: number;
  description: string;
  unit: string;
  quantity: number;
  unit_cost_cents: number;
  vat_rate: number;
  total_cents: number;
  is_plant: boolean;
  species_name: string | null;
  cultivar: string | null;
  container_size: string | null;
};

export type LineProgress = {
  line_id: string;
  ordered: number;
  received: number;
  remaining: number;
};

export type SalesOrder = {
  id: string;
  number: string;
  reference: string | null;
  status: SalesStatus;
  ordered_on: string;
  requested_on: string | null;
  notes: string | null;
};

export type SalesLine = {
  id: string;
  position: number;
  description: string;
  unit: string;
  quantity: number;
  unit_sale_price_cents: number;
  vat_rate: number;
  total_cents: number;
  lot_id: string | null;
};

/**
 * Ce qu'il reste à livrer sur une ligne.
 *
 * Calculé côté client à partir des lignes de livraison déjà chargées :
 * une vue de plus en base pour une soustraction serait du zèle.
 */
export function remainingToDeliver(
  line: SalesLine,
  deliveredByLine: Map<string, number>,
): number {
  return Math.max(0, line.quantity - (deliveredByLine.get(line.id) ?? 0));
}
