// Oasis Care — natural-language plant search Edge Function.
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// test it against a few real queries before relying on it.
//
// Spec §70: turn a sentence like "Montre-moi tous les palmiers qui
// n'ont pas reçu d'engrais depuis plus de 60 jours" into structured
// filters — never arbitrary SQL. This function's ONLY job is picking
// values from the vocabulary it's given (plant types, care event
// types, health statuses, zone names already present in this
// workspace); NaturalLanguageSearchService.apply on the Swift side
// does the actual filtering against local data.
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "natural-language-search" → paste this file's
// contents → Deploy. Requires an OPENAI_API_KEY secret (same one used
// by the other AI functions — Edge Functions → Manage secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 30_000;
const PROVIDER = "openai";
const MAX_QUERY_LENGTH = 500;

function obj(properties: Record<string, unknown>) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
function nullableString() {
  return { type: ["string", "null"] };
}
function nullableBool() {
  return { type: ["boolean", "null"] };
}
function nullableInt() {
  return { type: ["integer", "null"] };
}

const filterSchema = obj({
  plantType: nullableString(),
  isIndoor: nullableBool(),
  healthStatus: nullableString(),
  zoneName: nullableString(),
  careEventType: nullableString(),
  careEventDaysThreshold: nullableInt(),
  careEventComparison: nullableString(),
  summary: { type: "string" },
});

interface SearchContextDTO {
  availablePlantTypes?: string[];
  availableCareEventTypes?: string[];
  availableHealthStatuses?: string[];
  availableZoneNames?: string[];
}
interface SearchRequestBody {
  query?: string;
  context?: SearchContextDTO;
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

  let body: SearchRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  const query = (body.query ?? "").trim();
  if (query.length === 0) {
    return jsonResponse({ error: "Recherche vide." }, 400);
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return jsonResponse({ error: "Recherche trop longue." }, 400);
  }

  const systemPrompt =
    "Tu transformes une phrase en français décrivant des végétaux recherchés en un filtre structuré. " +
    "Règles impératives : " +
    "1) Tu ne dois JAMAIS produire de SQL ni de code — uniquement remplir les champs du schéma fourni. " +
    "2) Chaque champ ne peut prendre QUE l'une des valeurs listées ci-dessous (respecte l'orthographe " +
    "exacte, en anglais pour plantType/careEventType/healthStatus), ou null si la phrase ne mentionne " +
    "pas ce critère. " +
    `Types de végétaux valides : ${(body.context?.availablePlantTypes ?? []).join(", ")}. ` +
    `Types d'intervention valides : ${(body.context?.availableCareEventTypes ?? []).join(", ")}. ` +
    `États de santé valides : ${(body.context?.availableHealthStatuses ?? []).join(", ")}. ` +
    `Zones existantes : ${(body.context?.availableZoneNames ?? []).join(", ") || "aucune"}. ` +
    "3) careEventComparison vaut \"moreThan\" pour « depuis plus de X jours » / « pas reçu depuis X jours », " +
    "\"lessThan\" pour « dans les X derniers jours » / « récemment ». " +
    "4) summary doit reformuler en une phrase simple, en français, le filtre que tu as compris — " +
    "l'utilisateur le verra pour vérifier que la recherche a bien compris sa demande. " +
    "5) Si la phrase ne correspond à aucun critère reconnaissable, laisse tous les champs à null et dis-le dans summary.";

  const content = [{ type: "input_text", text: `Recherche de l'utilisateur : ${query}` }];

  try {
    const filter = await callOpenAIStructured(
      openaiKey,
      [
        { role: "developer", content: [{ type: "input_text", text: systemPrompt }] },
        { role: "user", content },
      ],
      "natural_language_filter",
      filterSchema,
    );
    return jsonResponse({ ...filter, provider: PROVIDER, model: OPENAI_MODEL });
  } catch (error) {
    if (error instanceof OpenAIError) {
      return jsonResponse({ error: "La recherche IA n'a pas pu comprendre cette demande. Réessayez plus tard." }, 502);
    }
    return jsonResponse({ error: "Erreur inattendue." }, 500);
  }
});

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
