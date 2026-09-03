import { createClient } from "@/lib/supabase/server";
import { readCents, readText } from "@/lib/ai/types";

/**
 * §11V — L'HISTORIQUE (spec p. 41, `AIAuditEvent`).
 *
 * « agent · user · organization · action · dataUsed · parameters ·
 * confirmation · result · timestamp. »
 *
 * IL N'Y A PAS DE TABLE `ai_audit_events`, ET C'EST VOULU. La migration
 * 0072 a choisi de passer par `audit_events` (0058), qui porte déjà
 * l'organisation, l'auteur, le verbe, l'entité et une colonne `source`
 * dont l'une des valeurs est justement `'ai'`. Une table parallèle
 * aurait sa propre RLS, sa propre rétention, et le jour d'un incident
 * on lirait la mauvaise. Les champs propres à l'IA — agent, données
 * lues, paramètres, mode de confirmation, résultat — sont empaquetés
 * dans `new_value` par `ai_record_agent_event`.
 *
 * Ce fichier déballe, et rien de plus.
 */

export type HistoryEntry = {
  id: string;
  occurredAt: string;
  /** Le verbe, en français. */
  action: string;
  rawAction: string;
  agent: string | null;
  actorUserId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string | null;
  confirmation: string | null;
  /** Ce qui en est sorti, en une phrase quand on sait le dire. */
  outcome: string | null;
  /** L'argent en jeu, ou `null`. Jamais zéro pour « on ne sait pas ». */
  impactCents: number | null;
  /** La décision à laquelle l'événement se rattache, si on la connaît. */
  decisionTitle: string | null;
  succeeded: boolean | null;
};

export type HistoryView = {
  entries: HistoryEntry[];
  failed: boolean;
  failureReason: string | null;
};

/** Les verbes du journal, en français. */
const ACTION_LABELS: Record<string, string> = {
  aiDecisionOpened: "Décision ouverte",
  aiDecisionAnswered: "Réponse à une décision",
  aiApprovalRequested: "Validation demandée",
  aiApprovalAnswered: "Réponse à une validation",
  aiActionExecuted: "Action exécutée",
  aiActionFailed: "Action échouée",
  aiAutonomyChanged: "Autonomie modifiée",
  aiAutopilotEnabled: "Automatisme activé",
  aiAutopilotDisabled: "Automatisme éteint",
  aiCustomerCreated: "Client créé",
  aiOpportunityCreated: "Opportunité créée",
  aiOpportunityStageChanged: "Étape d'opportunité modifiée",
  aiActivityLogged: "Échange consigné",
  aiQuoteLinesAdded: "Lignes ajoutées à un devis",
  aiCatalogItemCreated: "Article de catalogue créé",
  aiProjectCreated: "Chantier créé",
  aiProjectPhaseCreated: "Phase de chantier créée",
  aiProjectTaskCreated: "Tâche de chantier créée",
  aiPhaseProgressUpdated: "Avancement de phase mis à jour",
  aiInterventionScheduled: "Intervention planifiée",
  aiNurseryLotCreated: "Lot de pépinière créé",
  aiStockMovementRecorded: "Mouvement de stock enregistré",
  aiPurchaseOrderDraftCreated: "Commande fournisseur en brouillon",
};

const CONFIRMATION_LABELS: Record<string, string> = {
  none: "Sans confirmation",
  requested: "Validation demandée",
  approved: "Validée",
  rejected: "Refusée",
  autopilot: "Autopilote",
  human: "Geste humain",
};

export function confirmationLabel(value: string | null): string | null {
  if (!value) return null;
  return CONFIRMATION_LABELS[value] ?? value;
}

export async function getAiHistory(
  organizationId: string,
  limit = 80,
): Promise<HistoryView> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("audit_events")
    .select("id, actor_user_id, action, entity_type, entity_id, new_value, occurred_at")
    .eq("organization_id", organizationId)
    .eq("source", "ai")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("historique Oasis :", error.message);
    return {
      entries: [],
      failed: true,
      failureReason: "Le journal d'Oasis n'a pas pu être lu.",
    };
  }

  const rows = data ?? [];

  // Les noms. `organization_members` ne connaît qu'un identifiant de
  // compte ; le nom d'une personne vit dans `employees`. Sans cette
  // jointure, la colonne « Utilisateur » afficherait des UUID — c'est
  // le défaut qui avait été corrigé sur l'écran des paramètres.
  const actorIds = [
    ...new Set(
      rows
        .map((row) => row.actor_user_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];

  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: employees } = await supabase
      .from("employees")
      .select("user_id, first_name, last_name")
      .eq("organization_id", organizationId)
      .in("user_id", actorIds);

    for (const employee of employees ?? []) {
      const userId = employee.user_id;
      if (typeof userId !== "string") continue;
      const full = [employee.first_name, employee.last_name].filter(Boolean).join(" ").trim();
      if (full) names.set(userId, full);
    }
  }

  // Les titres des décisions citées, pour que la colonne « Décision »
  // ne soit pas un identifiant.
  const decisionIds = [
    ...new Set(
      rows
        .filter((row) => row.entity_type === "ai_decision" && typeof row.entity_id === "string")
        .map((row) => row.entity_id as string),
    ),
  ];

  const decisionTitles = new Map<string, string>();
  if (decisionIds.length > 0) {
    const { data: decisions } = await supabase
      .from("ai_decisions")
      .select("id, title")
      .eq("organization_id", organizationId)
      .in("id", decisionIds);
    for (const decision of decisions ?? []) {
      decisionTitles.set(String(decision.id), String(decision.title));
    }
  }

  const entries: HistoryEntry[] = rows.map((row) => {
    const value = (row.new_value ?? {}) as Record<string, unknown>;
    const result = (value.result ?? null) as Record<string, unknown> | null;
    const parameters = (value.parameters ?? null) as Record<string, unknown> | null;
    const rawAction = String(row.action);

    return {
      id: String(row.id),
      occurredAt: String(row.occurred_at),
      action: ACTION_LABELS[rawAction] ?? rawAction,
      rawAction,
      agent: readText(value.agent),
      actorUserId: typeof row.actor_user_id === "string" ? row.actor_user_id : null,
      actorName:
        typeof row.actor_user_id === "string"
          ? (names.get(row.actor_user_id) ?? null)
          : null,
      entityType: String(row.entity_type),
      entityId: typeof row.entity_id === "string" ? row.entity_id : null,
      confirmation: readText(value.confirmation),
      outcome: describeResult(rawAction, result),
      // L'impact peut venir du résultat (ce qui a été fait) ou des
      // paramètres (ce qui avait été annoncé). On préfère le résultat :
      // c'est le seul des deux qui soit constaté.
      impactCents:
        readCents(result?.totalHtCents) ??
        readCents(parameters?.impactCents) ??
        readCents(parameters?.plafondCents),
      decisionTitle:
        typeof row.entity_id === "string"
          ? (decisionTitles.get(row.entity_id) ?? null)
          : null,
      succeeded:
        rawAction === "aiActionExecuted" ? true : rawAction === "aiActionFailed" ? false : null,
    };
  });

  return { entries, failed: false, failureReason: null };
}

/**
 * Le résultat, en une phrase.
 *
 * Une erreur est rendue TELLE QUELLE : les refus de 0069 et 0072 sont
 * écrits en français pour ça, et les paraphraser ferait perdre le
 * détail qui permet de comprendre.
 */
function describeResult(action: string, result: Record<string, unknown> | null): string | null {
  if (!result) return null;

  const erreur = readText(result.erreur);
  if (erreur) return erreur;

  if (action === "aiActionExecuted") {
    const created = result.brouillonsCrees;
    if (typeof created === "number") {
      const skipped = Array.isArray(result.dossiersEcartes) ? result.dossiersEcartes.length : 0;
      return skipped > 0
        ? `${created} brouillon(s) créé(s), ${skipped} dossier(s) écarté(s)`
        : `${created} brouillon(s) créé(s)`;
    }
  }

  return null;
}
