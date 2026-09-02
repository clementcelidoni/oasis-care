import type { BadgeTone } from "@/lib/quotes/types";

/** §11I à §11L — pépinière. */

export const LOT_STATUSES = [
  "inProduction", "available", "reserved", "quarantine",
  "hold", "damaged", "lost", "sold", "completed",
] as const;
export type LotStatus = (typeof LOT_STATUSES)[number];

export const LOT_STATUS_LABELS: Record<LotStatus, string> = {
  inProduction: "En production",
  available: "Disponible",
  reserved: "Réservé",
  quarantine: "Quarantaine",
  hold: "Bloqué",
  damaged: "Abîmé",
  lost: "Perdu",
  sold: "Vendu",
  completed: "Terminé",
};

export const LOT_STATUS_TONE: Record<LotStatus, BadgeTone> = {
  inProduction: "info",
  available: "positive",
  reserved: "accent",
  quarantine: "critical",
  hold: "warning",
  damaged: "warning",
  lost: "neutral",
  sold: "neutral",
  completed: "neutral",
};

export const LOCATION_KINDS = [
  "site", "greenhouse", "tunnel", "outdoorBlock", "row",
  "bench", "quarantine", "shipping", "potting", "storage",
] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const LOCATION_KIND_LABELS: Record<LocationKind, string> = {
  site: "Site",
  greenhouse: "Serre",
  tunnel: "Tunnel",
  outdoorBlock: "Planche extérieure",
  row: "Rang",
  bench: "Tablette",
  quarantine: "Quarantaine",
  shipping: "Expédition",
  potting: "Rempotage",
  storage: "Stockage",
};

export const MOVEMENT_KINDS = [
  "receive", "move", "split", "merge", "repot", "reserve",
  "unreserve", "sell", "loss", "quarantine", "release", "adjustment",
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_KIND_LABELS: Record<MovementKind, string> = {
  receive: "Réception",
  move: "Déplacement",
  split: "Scission",
  merge: "Fusion",
  repot: "Rempotage",
  reserve: "Réservation",
  unreserve: "Libération",
  sell: "Vente",
  loss: "Perte",
  quarantine: "Mise en quarantaine",
  release: "Levée de quarantaine",
  adjustment: "Inventaire",
};

/**
 * Les mouvements dont la quantité a un sens.
 *
 * Mettre en quarantaine ou lever une quarantaine change l'état du lot,
 * pas son nombre : demander une quantité inviterait à en saisir une, et
 * elle serait ignorée — pire qu'un champ absent.
 */
export const MOVEMENTS_WITHOUT_QUANTITY: MovementKind[] = ["quarantine", "release", "move"];

/** §11J — les étapes proposées par défaut, configurables ensuite. */
export const DEFAULT_STAGES = [
  { code: "seed", label: "Semis", saleable: false },
  { code: "cutting", label: "Bouture", saleable: false },
  { code: "division", label: "Division", saleable: false },
  { code: "biolab", label: "BioLab", saleable: false },
  { code: "plug", label: "Godet", saleable: false },
  { code: "C1", label: "C1", saleable: false },
  { code: "C3", label: "C3", saleable: false },
  { code: "C5", label: "C5", saleable: true },
  { code: "C10", label: "C10", saleable: true },
  { code: "saleable", label: "Vendable", saleable: true },
];

export const INSPECTION_RESULTS = ["healthy", "watch", "problem", "critical"] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

export const INSPECTION_RESULT_LABELS: Record<InspectionResult, string> = {
  healthy: "Sain",
  watch: "À surveiller",
  problem: "Problème",
  critical: "Critique",
};

export const INSPECTION_RESULT_TONE: Record<InspectionResult, BadgeTone> = {
  healthy: "positive",
  watch: "warning",
  problem: "warning",
  critical: "critical",
};

export type NurseryLocation = {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
  kind: LocationKind;
  surface_m2: number | null;
  capacity: number | null;
};

export type NurseryLot = {
  id: string;
  lot_code: string;
  species_name: string;
  cultivar: string | null;
  origin: string | null;
  supplier_lot_reference: string | null;
  parent_lot_id: string | null;
  container_size: string | null;
  plant_size: string | null;
  initial_quantity: number;
  current_quantity: number;
  reserved_quantity: number;
  status: LotStatus;
  location_id: string | null;
  public_token: string | null;
  notes: string | null;
  created_at: string;
};

export type StockRow = {
  species_name: string;
  physical: number;
  available: number;
  reserved: number;
  quarantine: number;
  in_production: number;
  /**
   * Commandé au fournisseur et pas encore reçu — la sixième mesure de
   * §STOCK VIVANT. La vue `nursery_stock` la rend depuis la migration
   * 0053 ; l'écran continuait d'annoncer qu'elle « arriverait ».
   */
  expected: number;
};

export type Movement = {
  id: string;
  kind: MovementKind;
  quantity: number;
  reason: string | null;
  occurred_at: string;
  to_location_id: string | null;
};

/**
 * Le disponible réel d'un lot.
 *
 * §"Ne pas confondre stock physique et disponible à vendre." Un lot en
 * quarantaine compte encore dans le physique — les plantes existent —
 * mais rien n'en est vendable.
 */
export function availableOf(lot: NurseryLot): number {
  if (lot.status !== "available") return 0;
  return Math.max(0, lot.current_quantity - lot.reserved_quantity);
}

const NUMBER = new Intl.NumberFormat("fr-FR");

export function formatCount(n: number): string {
  return NUMBER.format(n);
}
