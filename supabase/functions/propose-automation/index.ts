// Oasis Care — automation-rule proposal Edge Function (spec §71).
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// try a few real goals before relying on it.
//
// Spec §71: "L'IA peut PROPOSER une règle... mais l'utilisateur doit
// valider explicitement avant activation." This function only ever
// returns a structured suggestion — it never touches automation_rules,
// never calls DeviceCommandService (it can't; Edge Functions have no
// access to HomeKit), and every enum value it can possibly return maps
// to a real AutomationConditionType/AutomationActionType case already
// built in Phase 5D, so nothing the client receives can reference a
// capability the app doesn't actually support. The Swift side is what
// turns a proposal into a real AutomationRule, and only does so — always
// disabled, mode "manual" — when the user explicitly taps "Créer".
//
// Scoped to threshold-style conditions (soil/air moisture, temperature,
// rain forecast) plus the two online-status checks — deliberately
// excludes timeBetween/dayOfWeek/lastWateringOlderThan, which need a
// richer shape (a time range, a list of days, an hours field instead of
// numericThreshold) than this single flat schema comfortably covers.
// Someone wanting one of those can still build it by hand in the
// existing full builder; this covers the spec's own example and
// everything structurally like it.
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "propose-automation" → paste this file's contents →
// Deploy. Requires an OPENAI_API_KEY secret (same one used by the other
// AI functions — Edge Functions → Manage secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 30_000;
const MAX_GOAL_LENGTH = 500;

// Mirrors AutomationConditionType/AutomationActionType's real raw
// values exactly (OasisCare/Models/AutomationCondition.swift and
// AutomationAction.swift) — never edit one list without the other.
const CONDITION_TYPES = [
  "soilMoistureBelow", "soilMoistureAbove",
  "temperatureBelow", "temperatureAbove",
  "humidityBelow", "humidityAbove",
  "rainForecastBelow", "rainForecastAbove",
  "sensorOnline", "deviceOnline",
];
const CONDITION_TYPES_OR_NONE = [...CONDITION_TYPES, "none"];
const ACTION_TYPES = [
  "openValve", "closeValve", "startPump", "stopPump",
  "turnFanOn", "turnFanOff", "turnHeaterOn", "turnHeaterOff",
  "turnMisterOn", "turnMisterOff", "turnLightOn", "turnLightOff",
  "sendNotification", "createCareEvent",
];

function obj(properties: Record<string, unknown>) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const proposalSchema = obj({
  canPropose: { type: "boolean" },
  explanation: { type: "string" },
  ruleName: { type: "string" },
  conditionType: { type: "string", enum: CONDITION_TYPES },
  conditionThreshold: { type: ["number", "null"] },
  secondConditionType: { type: "string", enum: CONDITION_TYPES_OR_NONE },
  secondConditionThreshold: { type: ["number", "null"] },
  actionType: { type: "string", enum: ACTION_TYPES },
  actionDurationMinutes: { type: ["number", "null"] },
  summary: { type: "string" },
});

const SYSTEM_PROMPT =
  "Tu es Oasis AI, l'assistant d'automatisation d'Oasis Care. L'utilisateur décrit en français ce " +
  "qu'il veut automatiser dans son jardin ; le contexte ci-dessous liste ce qui est réellement " +
  "disponible dans la portée choisie (capteurs présents, équipements pilotables). Règles impératives : " +
  "1) Ne propose JAMAIS une condition qui a besoin d'un type de capteur absent de la liste fournie, " +
  "ni une action qui a besoin d'un équipement dont la capacité n'est pas dans la liste fournie. " +
  "2) Si la demande ne peut pas être satisfaite avec ce qui est disponible, ou si elle est ambiguë, " +
  "mets canPropose à false et explique clairement pourquoi dans explanation, sans forcer une " +
  "proposition qui ne correspond pas vraiment à la demande ou au matériel réel. " +
  "3) secondConditionType et secondConditionThreshold sont optionnels — mets secondConditionType à " +
  "\"none\" et secondConditionThreshold à null si une seule condition suffit ; n'invente pas une " +
  "deuxième condition qui n'apporte rien. " +
  "4) actionDurationMinutes n'a de sens que pour actionType \"openValve\" — laisse-le à null pour " +
  "toute autre action, et choisis une durée raisonnable et bornée (jamais plus de 30 minutes, la " +
  "limite absolue de l'application) si l'utilisateur n'en précise pas. " +
  "5) summary doit être une phrase unique en français, au format \"SI <condition> [ET <condition>] " +
  "ALORS <action>\", reprenant les valeurs concrètes choisies — c'est ce que l'utilisateur va lire " +
  "pour décider de créer ou non cette règle, donc elle doit être complète et compréhensible seule. " +
  "6) Tu ne fais que PROPOSER : cette règle ne sera jamais créée ni activée automatiquement par toi, " +
  "seul l'utilisateur peut la créer (toujours désactivée par défaut) puis l'activer plus tard.";

interface AutomationProposalContextDTO {
  scopeName?: string | null;
  availableSensorTypes?: string[];
  availableActionCapabilities?: string[];
}
interface ProposeRequestBody {
  goal?: string;
  context?: AutomationProposalContextDTO;
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Authentification requise." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const callerClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Session invalide." }, 401);
  }

  // Phase 12 §12H "QUOTAS IA — CRITIQUE POUR LA RENTABILITÉ."
  // Same pattern as identify-plant, duplicated rather than shared:
  // this project has no supabase/functions/_shared/ folder, every
  // function stays individually copy-paste deployable.
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const quota = await checkAndIncrementUsage(admin, userData.user.id, "assistantMessage");
  if (!quota.allowed) {
    return jsonResponse({ error: "Quota de questions à l'assistant IA atteint pour ce mois. Passez à une offre supérieure pour continuer." }, 429);
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return jsonResponse({ error: "Fonction IA indisponible pour le moment (configuration manquante)." }, 500);
  }

  let body: ProposeRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  const goal = (body.goal ?? "").trim();
  if (goal.length === 0) {
    return jsonResponse({ error: "Décrivez ce que vous voulez automatiser." }, 400);
  }
  if (goal.length > MAX_GOAL_LENGTH) {
    return jsonResponse({ error: "Description trop longue." }, 400);
  }

  const prompt = `${formatContext(body.context)}\n\nObjectif de l'utilisateur : ${goal}`;

  try {
    const proposal = await callOpenAIStructured(
      openaiKey,
      [
        { role: "developer", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user", content: [{ type: "input_text", text: prompt }] },
      ],
      "automation_proposal",
      proposalSchema,
    );
    return jsonResponse(proposal);
  } catch (error) {
    if (error instanceof OpenAIError) {
      return jsonResponse({ error: "L'assistant IA n'a pas pu proposer d'automatisation. Réessayez plus tard." }, 502);
    }
    return jsonResponse({ error: "Erreur inattendue." }, 500);
  }
});

function formatContext(context: AutomationProposalContextDTO | undefined): string {
  if (!context) return "Aucune portée sélectionnée.";
  const lines: string[] = [];
  if (context.scopeName) lines.push(`Portée : ${context.scopeName}`);
  lines.push(
    context.availableSensorTypes?.length
      ? `Types de capteurs disponibles dans cette portée : ${context.availableSensorTypes.join(", ")}`
      : "Aucun capteur disponible dans cette portée.",
  );
  lines.push(
    context.availableActionCapabilities?.length
      ? `Équipements pilotables disponibles dans cette portée : ${context.availableActionCapabilities.join(", ")}`
      : "Aucun équipement pilotable disponible dans cette portée.",
  );
  return lines.join("\n");
}

class OpenAIError extends Error {}

async function callOpenAIStructured(
  apiKey: string,
  input: unknown[],
  schemaName: string,
  schema: unknown,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input,
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema,
          },
        },
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
  } catch (error) {
    throw new OpenAIError(`OpenAI unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OpenAIError(`OpenAI HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }

  // deno-lint-ignore no-explicit-any
  const payload: any = await response.json();
  if (payload.status && payload.status !== "completed") {
    throw new OpenAIError(`OpenAI response not completed: ${payload.status}`);
  }

  // deno-lint-ignore no-explicit-any
  const message = (payload.output ?? []).find((item: any) => item.type === "message");
  // deno-lint-ignore no-explicit-any
  const textContent = message?.content?.find((c: any) => c.type === "output_text");
  if (!textContent?.text) {
    // deno-lint-ignore no-explicit-any
    const refusal = message?.content?.find((c: any) => c.type === "refusal");
    throw new OpenAIError(refusal?.refusal ?? "Réponse IA vide.");
  }

  try {
    return JSON.parse(textContent.text);
  } catch {
    throw new OpenAIError("Réponse IA non structurée.");
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Phase 12 §12H. Per-AI-category monthly quota (spec: "À 100 % :
// bloquer uniquement la fonctionnalité IA concernée ... pas le reste de
// l'app"), so running out of one category never disables the others.
// Keep these numbers in sync with PlanConfigurationStore.swift.
const AI_REQUESTS_PER_MONTH: Record<string, number> = { free: 10, premium: 200, biolab: 400 };

/// Atomically checks and increments this user's usage_counters row for
/// one AI feature this month, via the increment_usage_counter Postgres
/// function (0041_phase12_commercialisation.sql) — a plain
/// read-then-upsert here would race under concurrent requests from the
/// same user.
// deno-lint-ignore no-explicit-any
async function checkAndIncrementUsage(admin: any, userId: string, feature: string): Promise<{ allowed: boolean; used: number }> {
  const { data: entitlementRow } = await admin.from("subscription_entitlements").select("plan, workspace_id").eq("user_id", userId).limit(1).maybeSingle();
  const plan = entitlementRow?.plan ?? "free";
  const limit = AI_REQUESTS_PER_MONTH[plan] ?? AI_REQUESTS_PER_MONTH.free;

  let workspaceId = entitlementRow?.workspace_id;
  if (!workspaceId) {
    const { data: memberRow } = await admin.from("workspace_members").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
    workspaceId = memberRow?.workspace_id;
  }
  if (!workspaceId) return { allowed: false, used: 0 };

  const period = currentPeriod();
  const { data, error } = await admin.rpc("increment_usage_counter", {
    p_user_id: userId, p_workspace_id: workspaceId, p_feature: feature, p_period: period, p_limit: limit,
  });
  if (error || !data || data.length === 0) {
    console.error("increment_usage_counter failed", error);
    // Fail open rather than blocking a real user over a transient
    // database error — the monthly limit is a profitability guard, not
    // a hard security boundary, so an occasional missed count is a far
    // smaller problem than refusing a paying customer's legitimate use.
    return { allowed: true, used: 0 };
  }
  return { allowed: data[0].allowed, used: data[0].used };
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
