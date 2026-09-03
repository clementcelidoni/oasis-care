import type { Tone } from "@/components/ui";
import type { Permission } from "@/lib/auth/permissions";

/**
 * §11V OASIS EXECUTIVE AI — le vocabulaire, côté écran.
 *
 * Les valeurs de ce fichier RECOPIENT celles de la migration 0072
 * (`ai_is_supported_agent`, les `check (… in (…))` de `ai_decisions`,
 * `ai_actions`, `ai_action_approvals`). Elles ne les remplacent pas :
 * la base refuse déjà tout ce qui n'y figure pas. Ce qui est écrit ici,
 * c'est comment on les DIT en français, et de quelle couleur.
 *
 * UNE RÈGLE TRAVERSE TOUT LE FICHIER : « insufficientData » n'est pas
 * une confiance faible. « Je n'ai pas assez de données » et « j'ai des
 * données qui disent peu » sont deux messages différents, et faire
 * passer le premier pour le second serait un mensonge. Ils ont donc
 * deux libellés, deux teintes, et `isInsufficient()` existe pour que
 * les écrans puissent les traiter différemment sans se tromper de
 * comparaison.
 */

// ------------------------------------------------------------------
// Les agents de la première itération. Pas un de plus.
// ------------------------------------------------------------------
// La spec p. 49 impose de ne construire que ceux-là, et
// `ai_is_supported_agent` (0072) refuse les autres noms en base. Cette
// liste est donc un miroir, pas une décision.

export const AGENTS = ["executive", "finance", "billing", "quote_pricing"] as const;
export type AgentKey = (typeof AGENTS)[number];

export function isAgentKey(value: unknown): value is AgentKey {
  return typeof value === "string" && (AGENTS as readonly string[]).includes(value);
}

export const AGENT_LABELS: Record<AgentKey, string> = {
  executive: "Direction",
  finance: "Finance",
  billing: "Facturation",
  quote_pricing: "Devis & prix",
};

/** Ce que l'agent surveille, en une phrase. Affiché sur son panneau. */
export const AGENT_MISSIONS: Record<AgentKey, string> = {
  executive:
    "Coordonne les autres agents et classe ce qui compte : il n'a aucune donnée à lui, il agrège les leurs.",
  finance:
    "Chiffre d'affaires signé, facturé et encaissé, marges réalisées, créances et trésorerie observée.",
  billing:
    "Chantiers terminés, interventions clôturées, devis signés sans facture, factures en retard.",
  quote_pricing:
    "Prix, coût, marge et cible d'un devis, comparé aux chantiers internes de périmètre équivalent.",
};

/**
 * Les droits que l'agent doit trouver chez l'utilisateur pour dire
 * quelque chose. Ce ne sont PAS les droits de l'agent : il n'en a
 * aucun (spec p. 30). C'est ce que ses fonctions exigent de l'appelant,
 * lu dans les `ai_guard` de la migration 0073.
 */
export const AGENT_REQUIRED_PERMISSIONS: Record<AgentKey, Permission[]> = {
  executive: ["projects.read"],
  finance: ["projects.read", "quotes.read", "invoice.create"],
  billing: ["projects.read", "quotes.read", "invoice.create"],
  quote_pricing: ["quotes.read", "projects.read"],
};

// ------------------------------------------------------------------
// Les catégories de décision (spec p. 5)
// ------------------------------------------------------------------

export const DECISION_CATEGORIES = [
  "urgent",
  "important",
  "opportunite",
  "optimisation",
  "information",
] as const;
export type DecisionCategory = (typeof DECISION_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<DecisionCategory, string> = {
  urgent: "Urgent",
  important: "Important",
  opportunite: "Opportunité",
  optimisation: "Optimisation",
  information: "Information",
};

/** Ce que la catégorie veut dire, pour qu'elle ne soit pas qu'une couleur. */
export const CATEGORY_MEANINGS: Record<DecisionCategory, string> = {
  urgent: "Ça coûte de l'argent maintenant.",
  important: "Ça en coûtera bientôt.",
  opportunite: "De l'argent à prendre.",
  optimisation: "De l'argent à ne plus perdre.",
  information: "Rien à faire, mais bon à savoir.",
};

export const CATEGORY_TONES: Record<DecisionCategory, Tone> = {
  urgent: "critical",
  important: "warning",
  opportunite: "positive",
  optimisation: "accent",
  information: "neutral",
};

export function isDecisionCategory(value: unknown): value is DecisionCategory {
  return typeof value === "string" && (DECISION_CATEGORIES as readonly string[]).includes(value);
}

// ------------------------------------------------------------------
// La confiance — et la distinction qui compte
// ------------------------------------------------------------------

export const CONFIDENCES = ["high", "medium", "low", "insufficient_data"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/**
 * Le libellé de `insufficient_data` ne contient pas le mot « faible »,
 * et c'est délibéré. Un utilisateur qui lit « confiance faible » croit
 * qu'Oasis a regardé et hésite ; la vérité est qu'il n'a pas eu de quoi
 * regarder. La deuxième phrase appelle une action (saisir les coûts,
 * accorder un droit), la première non.
 */
export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "Confiance élevée",
  medium: "Confiance moyenne",
  low: "Confiance faible",
  insufficient_data: "Données insuffisantes",
};

export const CONFIDENCE_TONES: Record<Confidence, Tone> = {
  high: "positive",
  medium: "info",
  low: "warning",
  // Ni « warning » ni « critical » : ce n'est pas une alerte, c'est une
  // absence. La teinte neutre dit « je ne me prononce pas ».
  insufficient_data: "neutral",
};

export const CONFIDENCE_EXPLANATIONS: Record<Confidence, string> = {
  high: "Les données nécessaires sont présentes et cohérentes.",
  medium: "Les données sont présentes, mais partielles ou approchées.",
  low: "Les données sont trop peu nombreuses pour trancher.",
  insufficient_data:
    "Oasis n'a pas les données nécessaires — ce n'est pas un avis prudent, c'est une absence de réponse.",
};

export function readConfidence(value: unknown): Confidence {
  // Un niveau inconnu ne vaut PAS « élevée ». Le doute descend, il ne
  // monte pas.
  return typeof value === "string" && (CONFIDENCES as readonly string[]).includes(value)
    ? (value as Confidence)
    : "insufficient_data";
}

export function isInsufficient(confidence: Confidence): boolean {
  return confidence === "insufficient_data";
}

// ------------------------------------------------------------------
// Le risque d'une action (spec p. 9)
// ------------------------------------------------------------------

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Risque faible",
  medium: "Risque modéré",
  high: "Risque élevé",
  critical: "Risque critique",
};

export const RISK_TONES: Record<RiskLevel, Tone> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "critical",
};

export function readRisk(value: unknown): RiskLevel {
  return typeof value === "string" && (RISK_LEVELS as readonly string[]).includes(value)
    ? (value as RiskLevel)
    : "critical"; // l'inconnu est traité comme le plus grave
}

// ------------------------------------------------------------------
// Les niveaux d'autonomie (spec p. 7)
// ------------------------------------------------------------------

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export const AUTONOMY_LEVELS: {
  level: AutonomyLevel;
  code: string;
  label: string;
  description: string;
}[] = [
  {
    level: 0,
    code: "OBSERVE",
    label: "Observer",
    description: "L'agent analyse et se tait. Rien n'apparaît dans le centre de décision.",
  },
  {
    level: 1,
    code: "ADVISE",
    label: "Recommander",
    description: "L'agent ouvre des décisions et explique. C'est vous qui décidez de tout.",
  },
  {
    level: 2,
    code: "PREPARE",
    label: "Préparer",
    description:
      "L'agent prépare le brouillon de l'action et le met en attente. Rien n'est exécuté sans votre réponse.",
  },
  {
    level: 3,
    code: "CONFIRM_TO_EXECUTE",
    label: "Exécuter après confirmation",
    description:
      "L'agent prépare, demande, et exécute dès que vous avez dit oui. Une action par confirmation.",
  },
  {
    level: 4,
    code: "AUTHORIZED_AUTOPILOT",
    label: "Autopilote autorisé",
    description:
      "L'agent exécute SEUL, sans personne, les actions explicitement autorisées dans les automatisations et sous leur plafond.",
  },
];

export function autonomyLabel(level: number): string {
  return AUTONOMY_LEVELS.find((l) => l.level === level)?.label ?? `Niveau ${level}`;
}

export function readAutonomy(value: unknown): AutonomyLevel {
  const n = typeof value === "number" ? value : Number(value);
  // Un niveau illisible retombe sur « recommander », le défaut de 0072.
  // Jamais sur 4 : le doute ne donne pas les clés à la machine.
  return n === 0 || n === 1 || n === 2 || n === 3 || n === 4 ? (n as AutonomyLevel) : 1;
}

// ------------------------------------------------------------------
// Statuts
// ------------------------------------------------------------------

export type DecisionStatus =
  | "new"
  | "reviewed"
  | "accepted"
  | "rejected"
  | "snoozed"
  | "executed"
  | "completed";

export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  new: "À traiter",
  reviewed: "Vue",
  accepted: "Acceptée",
  rejected: "Ignorée",
  snoozed: "Reportée",
  executed: "Exécutée",
  completed: "Close",
};

export const DECISION_STATUS_TONES: Record<DecisionStatus, Tone> = {
  new: "accent",
  reviewed: "neutral",
  accepted: "info",
  rejected: "neutral",
  snoozed: "warning",
  executed: "positive",
  completed: "positive",
};

/** Les statuts qui réclament encore quelque chose de quelqu'un. */
export const OPEN_DECISION_STATUSES: DecisionStatus[] = ["new", "reviewed", "snoozed"];

export type ActionStatus =
  | "proposed"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "executing"
  | "executed"
  | "failed"
  | "cancelled"
  | "expired";

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  proposed: "Proposée",
  awaiting_approval: "En attente de validation",
  approved: "Validée",
  rejected: "Refusée",
  executing: "En cours",
  executed: "Exécutée",
  failed: "Échouée",
  cancelled: "Annulée",
  expired: "Expirée",
};

export const ACTION_STATUS_TONES: Record<ActionStatus, Tone> = {
  proposed: "neutral",
  awaiting_approval: "warning",
  approved: "info",
  rejected: "neutral",
  executing: "info",
  executed: "positive",
  failed: "critical",
  cancelled: "neutral",
  expired: "warning",
};

// ------------------------------------------------------------------
// Les formes rendues par les fonctions de 0073
// ------------------------------------------------------------------

/**
 * Une ligne du brief exécutif, et donc d'Oasis Daily : les deux
 * fonctions rendent la même forme, `ai_oasis_daily` se contentant de
 * regrouper les lignes d'`ai_executive_brief` en rubriques.
 *
 * `impactCents` est `number | null`, et le `null` est porteur : « on ne
 * sait pas chiffrer » n'est pas « ça ne vaut rien ». L'écran affiche un
 * tiret, jamais « 0 € ».
 */
export type BriefItem = {
  agent: string;
  categorie: DecisionCategory;
  titre: string;
  impactCents: number | null;
  impactTexte: string | null;
  confiance: Confidence;
  pourquoi: string | null;
  siRienNestFait: string | null;
  donneesUtilisees: string[];
  actionRecommandee: string | null;
  actionsDisponibles: string[];
};

export type DailyRubrique = {
  code: string;
  titre: string;
  elements: BriefItem[];
};

export type OasisDaily = {
  date: string | null;
  salutation: string;
  droitsManquants: string[];
  rubriques: DailyRubrique[];
  confiance: Confidence;
  note: string | null;
  /**
   * Vrai quand le briefing n'a PAS pu être établi — migration non
   * lancée, droit manquant, panne. Distinct d'un briefing vide, comme
   * `DailyPriorities.failed` : « rien à signaler » est un mensonge
   * rassurant quand la vérité est « je n'ai pas pu regarder ».
   */
  failed: boolean;
  /** Ce qui a empêché de répondre, en français, quand `failed`. */
  failureReason: string | null;
};

/** Une décision, telle qu'elle sort de la table `ai_decisions`. */
export type DecisionRow = {
  id: string;
  title: string;
  description: string | null;
  agent: string;
  category: DecisionCategory;
  priority: number;
  estimated_impact: string | null;
  financial_impact_cents: number | null;
  confidence: Confidence;
  data_sources: unknown;
  reasoning_summary: string | null;
  recommended_action: string | null;
  available_actions: unknown;
  status: DecisionStatus;
  snoozed_until: string | null;
  created_at: string;
  updated_at: string;
};

/** Un bouton proposé par une décision : `available_actions`. */
export type DecisionAction = {
  actionType: string;
  label: string | null;
  parameters: Record<string, unknown>;
};

export type CatalogEntry = {
  action_type: string;
  agent: string;
  label: string;
  description: string | null;
  default_risk_level: RiskLevel;
  required_permission: string;
  is_write: boolean;
  carries_amount: boolean;
  autopilot_eligible: boolean;
  autopilot_default_on: boolean;
};

export type AgentSettingRow = {
  agent: string;
  enabled: boolean;
  autonomy_level: number;
  updated_at: string;
};

export type AutopilotRuleRow = {
  id: string;
  action_type: string;
  enabled: boolean;
  maximum_amount_cents: number;
  allowed_action_types: string[] | null;
  allowed_suppliers: string[] | null;
  allowed_clients: string[] | null;
  allowed_hours: string | null;
  updated_at: string;
};

export type ApprovalRow = {
  id: string;
  action_id: string;
  requested_by_agent: string;
  risk: RiskLevel;
  expires_at: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  responded_at: string | null;
};

// ------------------------------------------------------------------
// Lectures défensives
// ------------------------------------------------------------------
//
// Tout ce qui vient de `jsonb` arrive en `unknown`. Ces fonctions
// existent pour qu'aucun écran n'ait à écrire `as any`, et surtout pour
// qu'aucune ne remplace une absence par un zéro.

/**
 * Un montant en centimes, ou `null`.
 *
 * PAS de `?? 0`, jamais : c'est la faute que ce projet a corrigée trois
 * fois (0059 sur l'efficacité, 0067 sur les compteurs, 0073 sur la
 * marge). Un montant absent s'affiche « — », et l'écran ne le trie pas
 * à côté des zéros.
 */
export function readCents(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function readBriefItem(value: unknown): BriefItem | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const titre = readText(row.titre);
  if (!titre) return null; // une ligne sans titre ne s'affiche nulle part

  return {
    agent: readText(row.agent) ?? "executive",
    categorie: isDecisionCategory(row.categorie) ? row.categorie : "information",
    titre,
    impactCents: readCents(row.impactCents),
    impactTexte: readText(row.impactTexte),
    confiance: readConfidence(row.confiance),
    pourquoi: readText(row.pourquoi),
    siRienNestFait: readText(row.siRienNestFait),
    donneesUtilisees: readStringArray(row.donneesUtilisees),
    actionRecommandee: readText(row.actionRecommandee),
    actionsDisponibles: readStringArray(row.actionsDisponibles),
  };
}

/**
 * Les boutons d'une décision.
 *
 * Un `actionType` absent ou non textuel fait tomber l'entrée : mieux
 * vaut un bouton manquant qu'un bouton qui échoue au clic.
 */
export function readDecisionActions(value: unknown): DecisionAction[] {
  if (!Array.isArray(value)) return [];
  const actions: DecisionAction[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const actionType = readText(row.actionType);
    if (!actionType) continue;
    actions.push({
      actionType,
      label: readText(row.label),
      parameters:
        typeof row.parameters === "object" && row.parameters !== null && !Array.isArray(row.parameters)
          ? (row.parameters as Record<string, unknown>)
          : {},
    });
  }
  return actions;
}

/**
 * Les tables lues pour conclure (spec p. 6, « Données utilisées »).
 *
 * `data_sources` accepte deux formes en base : un tableau de chaînes
 * (ce qu'écrit notre balayage) ou un tableau d'objets `{table, ids…}`
 * (ce que la migration décrit). On rend des libellés dans les deux cas
 * plutôt que d'en privilégier un et d'afficher « [object Object] ».
 */
export function readDataSources(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      labels.push(entry);
      continue;
    }
    if (typeof entry === "object" && entry !== null) {
      const row = entry as Record<string, unknown>;
      const table = readText(row.table) ?? readText(row.source);
      if (table) labels.push(table);
    }
  }
  return [...new Set(labels)];
}

/**
 * Le nom français d'une table lue. Sans lui, « Données utilisées :
 * quote_totals, time_entries » ne dit rien à un paysagiste.
 */
const TABLE_LABELS: Record<string, string> = {
  projects: "chantiers",
  quotes: "devis",
  quote_lines: "lignes de devis",
  quote_totals: "totaux de devis",
  invoices: "factures",
  invoice_lines: "lignes de facture",
  credit_notes: "avoirs",
  payments: "règlements",
  payment_allocations: "affectations de règlement",
  project_costs: "achats de chantier",
  time_entries: "heures pointées",
  field_interventions: "interventions",
  crm_customers: "clients",
  suppliers: "fournisseurs",
  purchase_orders: "commandes fournisseurs",
  nursery_lots: "lots de pépinière",
  organization_kpi_targets: "objectifs de l'entreprise",
  business_goals: "objectifs de l'entreprise",
  expenses: "dépenses",
  ai_decisions: "décisions Oasis",
};

export function tableLabel(table: string): string {
  return TABLE_LABELS[table] ?? table;
}
