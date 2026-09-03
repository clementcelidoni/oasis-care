import { createClient } from "@/lib/supabase/server";
import type { Permission } from "@/lib/auth/permissions";
import {
  AGENTS,
  AGENT_REQUIRED_PERMISSIONS,
  isAgentKey,
  readAutonomy,
  readCents,
  OPEN_DECISION_STATUSES,
  type AgentKey,
  type AutonomyLevel,
  type AutopilotRuleRow,
} from "@/lib/ai/types";

/**
 * §11V — LA PAGE AGENTS (spec p. 40) : « Status · Last analysis ·
 * Decisions open · Autonomy · Permissions », pour chacun.
 *
 * TROIS DE CES CINQ COLONNES NE SONT PAS DES RÉGLAGES, CE SONT DES
 * MESURES. « Dernière analyse » se lit dans le journal, « décisions
 * ouvertes » dans le centre de décision, « permissions » dans le rôle
 * du compte connecté. Les afficher depuis une table de configuration
 * aurait été plus simple et aurait menti : un agent réglé sur
 * « recommander » qui n'a rien produit depuis trois semaines doit se
 * voir.
 *
 * LES PERMISSIONS AFFICHÉES SONT CELLES DE L'UTILISATEUR. Un agent n'a
 * pas de droits propres (spec p. 30) — c'est même le principe central
 * de cette phase. La colonne « Permissions » répond donc à « que
 * pourra-t-il faire EN MON NOM », pas à « qu'a-t-on accordé à la
 * machine ».
 */

export type AgentPanel = {
  agent: AgentKey;
  enabled: boolean;
  autonomy: AutonomyLevel;
  updatedAt: string | null;
  /** La dernière fois que cet agent a écrit quelque chose au journal. */
  lastAnalysis: string | null;
  openDecisions: number;
  /** Les droits que ses fonctions exigent, et si le compte les a. */
  permissions: { permission: Permission; granted: boolean }[];
  /** Vrai quand un droit exigé manque : l'agent ne pourra pas répondre. */
  blocked: boolean;
};

export type AgentsView = {
  panels: AgentPanel[];
  /** Vrai quand les réglages n'ont PAS pu être lus. */
  failed: boolean;
  failureReason: string | null;
  /** Le droit qui permet de CHANGER un réglage (0072, section 14). */
  canConfigure: boolean;
};

export async function getAgentsView(
  organizationId: string,
  permissions: Permission[],
): Promise<AgentsView> {
  const supabase = await createClient();
  const canConfigure = permissions.includes("organization.manageUsers");

  const { data: settingRows, error } = await supabase
    .from("ai_agent_settings")
    .select("agent, enabled, autonomy_level, updated_at")
    .eq("organization_id", organizationId);

  if (error) {
    console.error("réglages des agents :", error.message);
    return {
      panels: [],
      failed: true,
      failureReason:
        error.message.includes("does not exist") || error.message.includes("schema cache")
          ? "Les agents Oasis ne sont pas encore installés sur cette base."
          : "Les réglages des agents n'ont pas pu être lus.",
      canConfigure,
    };
  }

  const settings = new Map(
    (settingRows ?? []).map((row) => [
      String(row.agent),
      {
        enabled: Boolean(row.enabled),
        autonomy: readAutonomy(row.autonomy_level),
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
      },
    ]),
  );

  // Les décisions ouvertes, par agent. Une seule requête pour les
  // quatre : quatre `count` séparés feraient quatre allers-retours pour
  // quatre entiers.
  const { data: decisionRows } = await supabase
    .from("ai_decisions")
    .select("agent")
    .eq("organization_id", organizationId)
    .in("status", OPEN_DECISION_STATUSES)
    .limit(1000);

  const openByAgent = new Map<string, number>();
  for (const row of decisionRows ?? []) {
    const agent = String(row.agent);
    openByAgent.set(agent, (openByAgent.get(agent) ?? 0) + 1);
  }

  // La dernière trace laissée par chaque agent. `source = 'ai'` est ce
  // que `ai_record_agent_event` force ; le nom de l'agent est rangé
  // dans `new_value` (0072 a délibérément évité une table parallèle).
  const { data: auditRows } = await supabase
    .from("audit_events")
    .select("new_value, occurred_at")
    .eq("organization_id", organizationId)
    .eq("source", "ai")
    .order("occurred_at", { ascending: false })
    .limit(200);

  const lastByAgent = new Map<string, string>();
  for (const row of auditRows ?? []) {
    const value = row.new_value as Record<string, unknown> | null;
    const agent = typeof value?.agent === "string" ? value.agent : null;
    if (!agent || lastByAgent.has(agent)) continue;
    lastByAgent.set(agent, String(row.occurred_at));
  }

  const panels: AgentPanel[] = AGENTS.map((agent) => {
    const setting = settings.get(agent);
    const required = AGENT_REQUIRED_PERMISSIONS[agent];
    const rows = required.map((permission) => ({
      permission,
      granted: permissions.includes(permission),
    }));

    return {
      agent,
      // Un agent sans ligne de réglage n'est pas « éteint » : la ligne
      // n'a pas encore été semée par `ai_ensure_org_defaults`. On
      // affiche le défaut de 0072 — actif, niveau 1 — plutôt qu'un
      // « désactivé » qui serait faux.
      enabled: setting?.enabled ?? true,
      autonomy: setting?.autonomy ?? 1,
      updatedAt: setting?.updatedAt ?? null,
      lastAnalysis: lastByAgent.get(agent) ?? null,
      openDecisions: openByAgent.get(agent) ?? 0,
      permissions: rows,
      blocked: rows.some((row) => !row.granted),
    };
  });

  return { panels, failed: false, failureReason: null, canConfigure };
}

// ------------------------------------------------------------------
// AUTOMATIONS — les règles d'autopilote (spec p. 35-36)
// ------------------------------------------------------------------

export type AutopilotRuleView = {
  rule: AutopilotRuleRow | null;
  actionType: string;
  agent: string;
  label: string;
  description: string | null;
  requiredPermission: string;
  carriesAmount: boolean;
  /**
   * Le catalogue autorise-t-il un jour cette action sans humain ?
   * Faux = verrou de migration, pas réglage : envoyer une facture,
   * passer une commande et changer un tarif sont trois des interdits
   * de la page 2, et l'autopilote est l'absence de validation.
   */
  eligible: boolean;
  enabled: boolean;
  maximumAmountCents: number | null;
};

export type AutomationsView = {
  rules: AutopilotRuleView[];
  failed: boolean;
  failureReason: string | null;
  canConfigure: boolean;
  /** Combien d'automatismes tournent réellement sans personne. */
  activeCount: number;
};

export async function getAutomationsView(
  organizationId: string,
  permissions: Permission[],
): Promise<AutomationsView> {
  const supabase = await createClient();
  const canConfigure = permissions.includes("organization.manageUsers");

  const [{ data: catalogRows, error: catalogError }, { data: ruleRows, error: ruleError }] =
    await Promise.all([
      supabase
        .from("ai_action_catalog")
        .select(
          "action_type, agent, label, description, required_permission, carries_amount, autopilot_eligible",
        )
        .order("agent")
        .order("action_type"),
      supabase
        .from("ai_autopilot_rules")
        .select(
          "id, action_type, enabled, maximum_amount_cents, allowed_action_types, allowed_suppliers, allowed_clients, allowed_hours, updated_at",
        )
        .eq("organization_id", organizationId),
    ]);

  if (catalogError || ruleError) {
    const message = catalogError?.message ?? ruleError?.message ?? "";
    console.error("automatisations Oasis :", message);
    return {
      rules: [],
      failed: true,
      failureReason:
        message.includes("does not exist") || message.includes("schema cache")
          ? "Les automatisations d'Oasis ne sont pas encore installées sur cette base."
          : "Les règles d'autopilote n'ont pas pu être lues.",
      canConfigure,
      activeCount: 0,
    };
  }

  const rulesByType = new Map(
    ((ruleRows ?? []) as AutopilotRuleRow[]).map((row) => [row.action_type, row]),
  );

  const rules: AutopilotRuleView[] = (catalogRows ?? []).map((row) => {
    const actionType = String(row.action_type);
    const rule = rulesByType.get(actionType) ?? null;
    return {
      rule,
      actionType,
      agent: String(row.agent),
      label: String(row.label),
      description: typeof row.description === "string" ? row.description : null,
      requiredPermission: String(row.required_permission),
      carriesAmount: Boolean(row.carries_amount),
      eligible: Boolean(row.autopilot_eligible),
      // Sans ligne de règle, l'automatisme est ÉTEINT. C'est le seul
      // défaut acceptable : « je ne sais pas » ne donne pas les clés.
      enabled: rule?.enabled ?? false,
      maximumAmountCents: rule ? readCents(rule.maximum_amount_cents) : null,
    };
  });

  return {
    rules,
    failed: false,
    failureReason: null,
    canConfigure,
    activeCount: rules.filter((r) => r.enabled).length,
  };
}

/** Le nom d'agent d'une ligne de catalogue, quand il sort du périmètre. */
export function agentOf(value: string): AgentKey | null {
  return isAgentKey(value) ? value : null;
}
