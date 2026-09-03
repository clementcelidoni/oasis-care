import { createClient } from "@/lib/supabase/server";
import {
  readCents,
  readConfidence,
  OPEN_DECISION_STATUSES,
  type ActionStatus,
  type DecisionCategory,
  type DecisionRow,
  type DecisionStatus,
  type RiskLevel,
} from "@/lib/ai/types";

/**
 * §11V — BRIQUE N° 2 : LE DECISION CENTER, côté lecture.
 *
 * Une décision est une ligne de `ai_decisions` (0072). Elle n'est pas
 * un message de l'IA : elle porte son agent, sa catégorie, son impact,
 * sa confiance, les données qui l'ont produite, et ce qui se passe si
 * on ne fait rien. C'est ce qui permet à l'écran d'afficher les cinq
 * blocs exigés par la spec p. 6 sans rien inventer pour combler.
 *
 * LA RLS FAIT LE CLOISONNEMENT. Ces requêtes demandent quand même
 * `organization_id` explicitement : une politique qui changerait de
 * forme un jour ne doit pas transformer une liste de décisions en
 * liste de toutes les décisions. C'est une ceinture par-dessus les
 * bretelles, et elle ne coûte rien.
 */

export type PendingApproval = {
  approvalId: string;
  actionId: string;
  actionType: string;
  actionLabel: string | null;
  risk: RiskLevel;
  expiresAt: string;
  requestedByAgent: string;
};

export type DecisionWithActions = {
  decision: DecisionRow;
  /** Les actions déjà engagées sur cette décision, la plus récente d'abord. */
  actions: {
    id: string;
    actionType: string;
    status: ActionStatus;
    risk: RiskLevel;
    result: unknown;
    executedAt: string | null;
    createdAt: string;
  }[];
  /** La demande d'approbation en attente, s'il y en a une. */
  pending: PendingApproval | null;
};

export type DecisionBoard = {
  items: DecisionWithActions[];
  /** Le compte par catégorie, sur les décisions ouvertes uniquement. */
  openByCategory: Record<DecisionCategory, number>;
  openTotal: number;
  /** Vrai quand la liste n'a PAS pu être lue. Distinct d'une liste vide. */
  failed: boolean;
  failureReason: string | null;
};

const EMPTY_COUNTS: Record<DecisionCategory, number> = {
  urgent: 0,
  important: 0,
  opportunite: 0,
  optimisation: 0,
  information: 0,
};

const DECISION_COLUMNS =
  "id, title, description, agent, category, priority, estimated_impact, " +
  "financial_impact_cents, confidence, data_sources, reasoning_summary, " +
  "recommended_action, available_actions, status, snoozed_until, created_at, updated_at";

/**
 * Le tableau des décisions.
 *
 * `scope` vaut « ouvertes » par défaut : le Decision Center est une
 * boîte de réception, pas des archives. Les décisions tranchées restent
 * accessibles par l'historique, où elles sont à leur place.
 */
export async function getDecisionBoard(
  organizationId: string,
  options: { scope?: "open" | "all"; category?: DecisionCategory } = {},
): Promise<DecisionBoard> {
  const supabase = await createClient();

  let query = supabase
    .from("ai_decisions")
    .select(DECISION_COLUMNS)
    .eq("organization_id", organizationId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (options.scope !== "all") query = query.in("status", OPEN_DECISION_STATUSES);
  if (options.category) query = query.eq("category", options.category);

  const { data, error } = await query;

  if (error) {
    console.error("décisions Oasis :", error.message);
    return {
      items: [],
      openByCategory: { ...EMPTY_COUNTS },
      openTotal: 0,
      failed: true,
      failureReason: friendlyDecisionError(error.message),
    };
  }

  const decisions = (data ?? []).map((row) => normalizeDecision(row as unknown as Record<string, unknown>));

  // Les comptes portent sur TOUTES les décisions ouvertes, pas
  // seulement sur celles que le filtre laisse voir : les onglets de
  // catégorie doivent montrer ce qu'ils cachent.
  const { data: countRows } = await supabase
    .from("ai_decisions")
    .select("category")
    .eq("organization_id", organizationId)
    .in("status", OPEN_DECISION_STATUSES)
    .limit(1000);

  const openByCategory = { ...EMPTY_COUNTS };
  for (const row of countRows ?? []) {
    const category = (row as { category: string }).category as DecisionCategory;
    if (category in openByCategory) openByCategory[category] += 1;
  }

  const items = await attachActions(organizationId, decisions);

  return {
    items,
    openByCategory,
    openTotal: Object.values(openByCategory).reduce((a, b) => a + b, 0),
    failed: false,
    failureReason: null,
  };
}

/**
 * Combien de décisions attendent une réponse.
 *
 * Les cinq sections de l'espace Oasis AI affichent ce nombre sur leur
 * onglet. Appeler `getDecisionBoard` pour un entier ferait quatre
 * requêtes par écran — la liste, les comptes, les actions, les
 * approbations — pour n'en garder qu'un total. `head: true` n'en fait
 * aucune qui rapporte des lignes.
 */
export async function countOpenDecisions(organizationId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("ai_decisions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", OPEN_DECISION_STATUSES);

  // Un compte illisible rend zéro, et c'est le seul endroit du module
  // où c'est acceptable : il ne sert qu'à décorer un onglet, et une
  // pastille absente vaut mieux qu'un écran en erreur.
  if (error) return 0;
  return count ?? 0;
}

/** Une décision seule, pour la page qui la traite. */
export async function getDecision(
  organizationId: string,
  decisionId: string,
): Promise<DecisionWithActions | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_decisions")
    .select(DECISION_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("id", decisionId)
    .maybeSingle();

  if (error || !data) return null;
  const [item] = await attachActions(organizationId, [
    normalizeDecision(data as unknown as Record<string, unknown>),
  ]);
  return item ?? null;
}

/**
 * Rattache à chaque décision ses actions et la demande d'approbation
 * qui court, en DEUX requêtes pour toute la page.
 *
 * Une requête par décision serait plus simple à lire et ferait
 * quarante allers-retours sur un tableau chargé.
 */
async function attachActions(
  organizationId: string,
  decisions: DecisionRow[],
): Promise<DecisionWithActions[]> {
  if (decisions.length === 0) return [];

  const supabase = await createClient();
  const ids = decisions.map((d) => d.id);

  const { data: actionRows } = await supabase
    .from("ai_actions")
    .select("id, decision_id, action_type, status, risk_level, result, executed_at, created_at")
    .eq("organization_id", organizationId)
    .in("decision_id", ids)
    .order("created_at", { ascending: false })
    .limit(500);

  const actions = (actionRows ?? []) as {
    id: string;
    decision_id: string | null;
    action_type: string;
    status: ActionStatus;
    risk_level: RiskLevel;
    result: unknown;
    executed_at: string | null;
    created_at: string;
  }[];

  const { data: approvalRows } = await supabase
    .from("ai_action_approvals")
    .select("id, action_id, requested_by_agent, risk, expires_at, status")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .limit(500);

  const pendingByAction = new Map(
    ((approvalRows ?? []) as {
      id: string;
      action_id: string;
      requested_by_agent: string;
      risk: RiskLevel;
      expires_at: string;
    }[]).map((row) => [row.action_id, row]),
  );

  return decisions.map((decision) => {
    const mine = actions.filter((a) => a.decision_id === decision.id);
    let pending: PendingApproval | null = null;

    for (const action of mine) {
      const approval = pendingByAction.get(action.id);
      if (!approval) continue;
      pending = {
        approvalId: approval.id,
        actionId: action.id,
        actionType: action.action_type,
        actionLabel: null,
        risk: approval.risk,
        expiresAt: approval.expires_at,
        requestedByAgent: approval.requested_by_agent,
      };
      break;
    }

    return {
      decision,
      actions: mine.map((a) => ({
        id: a.id,
        actionType: a.action_type,
        status: a.status,
        risk: a.risk_level,
        result: a.result,
        executedAt: a.executed_at,
        createdAt: a.created_at,
      })),
      pending,
    };
  });
}

/**
 * LES DEMANDES NÉES DE LA CONVERSATION, QUI N'APPARTIENNENT À AUCUNE
 * DÉCISION.
 *
 * `prepareInvoiceDrafts` (fonction Edge) insère ses lignes `ai_actions`
 * sans `decision_id` : elles ne naissent pas d'un balayage, elles
 * naissent d'une phrase tapée dans l'assistant. `attachActions`
 * ci-dessus ne rattache que ce qui porte un `decision_id`, si bien que
 * ces demandes n'apparaissaient NULLE PART : ni ici, ni sur l'écran
 * d'où elles venaient. Elles expiraient au bout de vingt-quatre heures,
 * en laissant une ligne morte à chaque question posée.
 *
 * L'assistant sait désormais les afficher et les confirmer lui-même,
 * mais un onglet fermé entre la question et le clic les rendait de
 * nouveau invisibles. Elles ont donc leur place ici aussi : c'est
 * l'écran des approbations.
 */
export type OrphanApproval = PendingApproval & {
  createdAt: string;
  parameters: unknown;
};

export async function getConversationApprovals(
  organizationId: string,
): Promise<OrphanApproval[]> {
  const supabase = await createClient();

  const { data: approvalRows, error } = await supabase
    .from("ai_action_approvals")
    .select("id, action_id, requested_by_agent, risk, expires_at, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error || !approvalRows || approvalRows.length === 0) {
    if (error) console.error("approbations en attente :", error.message);
    return [];
  }

  const { data: actionRows } = await supabase
    .from("ai_actions")
    .select("id, action_type, decision_id, parameters, status")
    .eq("organization_id", organizationId)
    .in(
      "id",
      approvalRows.map((r) => r.action_id as string),
    );

  const parAction = new Map(
    ((actionRows ?? []) as Record<string, unknown>[]).map((a) => [String(a.id), a]),
  );

  const orphelines: OrphanApproval[] = [];
  for (const row of approvalRows as Record<string, unknown>[]) {
    const action = parAction.get(String(row.action_id));
    // Sans ligne d'action lisible, on n'affiche rien : un bouton dont
    // on ne sait pas dire ce qu'il fait est pire qu'un bouton absent.
    if (!action) continue;
    if (action.decision_id) continue;
    if (action.status !== "awaiting_approval") continue;

    orphelines.push({
      approvalId: String(row.id),
      actionId: String(row.action_id),
      actionType: String(action.action_type),
      actionLabel: null,
      risk: row.risk as RiskLevel,
      expiresAt: String(row.expires_at),
      requestedByAgent: String(row.requested_by_agent),
      createdAt: String(row.created_at),
      parameters: action.parameters,
    });
  }
  return orphelines;
}

function normalizeDecision(row: Record<string, unknown>): DecisionRow {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    description: typeof row.description === "string" ? row.description : null,
    agent: String(row.agent ?? "executive"),
    category: (row.category as DecisionCategory) ?? "information",
    priority: Number(row.priority ?? 50),
    estimated_impact: typeof row.estimated_impact === "string" ? row.estimated_impact : null,
    // `readCents` et non `?? 0` : « impact inconnu » n'est pas « impact
    // nul », et la colonne est nullable précisément pour cela.
    financial_impact_cents: readCents(row.financial_impact_cents),
    confidence: readConfidence(row.confidence),
    data_sources: row.data_sources,
    reasoning_summary: typeof row.reasoning_summary === "string" ? row.reasoning_summary : null,
    recommended_action: typeof row.recommended_action === "string" ? row.recommended_action : null,
    available_actions: row.available_actions,
    status: (row.status as DecisionStatus) ?? "new",
    snoozed_until: typeof row.snoozed_until === "string" ? row.snoozed_until : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at ?? row.created_at),
  };
}

function friendlyDecisionError(message: string): string {
  if (message.includes("does not exist") || message.includes("schema cache")) {
    return "Le centre de décision n'est pas encore installé sur cette base.";
  }
  return "Les décisions n'ont pas pu être lues.";
}

// ------------------------------------------------------------------
// Le récapitulatif qu'une confirmation doit montrer (spec p. 9)
// ------------------------------------------------------------------

export type BillingPreview = {
  total: number;
  prets: number;
  aVerifier: number;
  bloques: number;
  montantPretHtCents: number | null;
  montantAVerifierHtCents: number | null;
  dossiersSansMontant: number;
  /** Vrai quand le décompte n'a PAS pu être établi. */
  failed: boolean;
};

/**
 * « Oasis souhaite : créer 10 factures. Montant total estimé :
 * 38 450 € HT. 8 factures semblent prêtes. 2 nécessitent une
 * vérification. » (spec p. 9)
 *
 * Ce décompte est relu au MOMENT de la confirmation, jamais repris de
 * la décision : entre l'ouverture de la décision et le clic, un
 * chantier a pu être facturé à la main. Le chiffre affiché doit être
 * celui sur lequel on va agir.
 */
export async function getBillingPreview(organizationId: string): Promise<BillingPreview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_billing_candidates", {
    p_organization_id: organizationId,
  });

  if (error || !data) {
    if (error) console.error("candidats à la facturation :", error.message);
    return {
      total: 0,
      prets: 0,
      aVerifier: 0,
      bloques: 0,
      montantPretHtCents: null,
      montantAVerifierHtCents: null,
      dossiersSansMontant: 0,
      failed: true,
    };
  }

  const resume = ((data as Record<string, unknown>).resume ?? {}) as Record<string, unknown>;
  return {
    total: Number(resume.total ?? 0),
    prets: Number(resume.prets ?? 0),
    aVerifier: Number(resume.aVerifier ?? 0),
    bloques: Number(resume.bloques ?? 0),
    montantPretHtCents: readCents(resume.montantPretHtCents),
    montantAVerifierHtCents: readCents(resume.montantAVerifierHtCents),
    dossiersSansMontant: Number(resume.dossiersSansMontant ?? 0),
    failed: false,
  };
}
