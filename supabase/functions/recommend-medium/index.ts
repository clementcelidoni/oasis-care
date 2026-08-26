// Oasis Care — Smart Media medium recommendation Edge Function
// (Phase 7 enhancement, "PHASE 7O — SMART MEDIA & PROTOCOL ENGINE").
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// ask it about a couple of real species before relying on it.
//
// Same structured-output shape as plant-info/analyze-biolab-inspection.
// CRITIQUE (enhancement §5, §7, §46): every proposal must carry its own
// honest evidenceType/confidence, and a ProtocolSource must never be
// fabricated — if the model has no source it actually knows, sources
// stays an empty array rather than an invented title/DOI.
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "recommend-medium" → paste this file's contents →
// Deploy. Requires an OPENAI_API_KEY secret (same one used by the other
// AI functions — Edge Functions → Manage secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 45_000;
const MAX_PROPOSALS = 3;

const CONFIDENCE_LEVELS = ["high", "medium", "low", "unknown"];
const EVIDENCE_TYPES = [
  "exactSpeciesEvidence",
  "cultivarEvidence",
  "sameSpeciesDifferentCultivar",
  "sameGenus",
  "relatedTaxon",
  "internalBioLabData",
  "publishedProtocol",
  "userProtocol",
  "aiExtrapolation",
  "unknown",
];
const DATA_PROVENANCE = ["published", "internalExperimental", "userDefined", "calculated", "aiSuggested", "unknown"];
const COMPONENT_TYPES = ["basalMedium", "sugar", "plantGrowthRegulator", "vitamin", "additive", "gellingAgent", "other"];
const PGR_CATEGORIES = ["cytokinin", "auxin", "gibberellin", "other"];
const CONCENTRATION_UNITS = [
  "milligramsPerLiter",
  "gramsPerLiter",
  "millilitersPerLiter",
  "micromolar",
  "microgramsPerLiter",
  "molar",
  "millimolar",
  "microlitersPerLiter",
];
const CULTURE_SYSTEMS = ["solid", "semiSolid", "liquid", "temporaryImmersion", "continuousImmersion", "custom"];

// JSON Schema helpers — same conventions as plant-info: obj() gives
// additionalProperties:false + required=all keys (OpenAI's strict mode
// demands this), optional fields are nullable rather than omitted.
function obj(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}
function nullableString() {
  return { type: ["string", "null"] };
}
function nullableInt() {
  return { type: ["integer", "null"] };
}
function nullableEnum(values: string[]) {
  return { type: ["string", "null"], enum: [...values, null] };
}

const sourceSchema = obj({
  title: nullableString(),
  authors: nullableString(),
  year: nullableInt(),
  journal: nullableString(),
  doi: nullableString(),
  url: nullableString(),
  notes: nullableString(),
  sourceType: { type: "string", enum: EVIDENCE_TYPES },
});

const ingredientSchema = obj({
  type: { type: "string", enum: COMPONENT_TYPES },
  name: { type: "string" },
  amount: { type: "number" },
  unit: { type: "string", enum: CONCENTRATION_UNITS },
  pgrCategory: nullableEnum(PGR_CATEGORIES),
  sourceType: { type: "string", enum: DATA_PROVENANCE },
});

const evidenceSchema = obj({
  evidenceType: { type: "string", enum: EVIDENCE_TYPES },
  confidence: { type: "string", enum: CONFIDENCE_LEVELS },
  explanation: { type: "string" },
  basedOnBatchCount: nullableInt(),
  sources: { type: "array", items: sourceSchema },
});

const proposalSchema = obj({
  label: { type: "string" },
  basalMediumName: { type: "string" },
  ingredients: { type: "array", items: ingredientSchema },
  targetPH: { type: ["number", "null"] },
  cultureSystem: nullableEnum(CULTURE_SYSTEMS),
  evidence: evidenceSchema,
});

const responseSchema = obj({
  recommendations: { type: "array", items: proposalSchema },
});

const SYSTEM_PROMPT =
  "Tu es Oasis AI, l'assistant de formulation de milieu de culture in vitro du module BioLab de " +
  "l'application Oasis Care. On te donne une espèce (et éventuellement cultivar, type d'explant, stade " +
  "de culture, système de culture) ainsi qu'un résumé des protocoles/expériences/résultats de lots déjà " +
  "présents dans le laboratoire de cet utilisateur. Propose jusqu'à " + MAX_PROPOSALS + " formulations de " +
  "milieu distinctes (par exemple un milieu basal complet, une variante à demi-force, une formulation " +
  "plus expérimentale) — ne retourne qu'une seule proposition seulement si tu ne peux pas honnêtement en " +
  "justifier plusieurs. RÈGLES IMPÉRATIVES, sans exception : " +
  "1) NE JAMAIS présenter MS (Murashige & Skoog) comme le seul milieu basal possible — propose une " +
  "alternative (½MS, B5, WPM...) quand c'est pertinent pour l'espèce. " +
  "2) evidenceType et confidence doivent refléter honnêtement la qualité réelle de ta base : n'utilise " +
  "\"exactSpeciesEvidence\" ou confidence \"high\" que si tu as une vraie base solide pour cette espèce " +
  "précise ; utilise \"aiExtrapolation\"/\"unknown\" et confidence \"low\"/\"unknown\" dans le cas " +
  "contraire plutôt que de gonfler artificiellement ta certitude. " +
  "3) sources : n'invente JAMAIS un titre, un DOI, des auteurs ou une année d'une publication. Si tu ne " +
  "connais pas de source fiable et vérifiable pour une proposition, laisse le tableau sources VIDE — ne " +
  "le remplis jamais pour donner une impression de rigueur non justifiée. " +
  "4) explanation doit dire clairement, en français, sur quoi la proposition se base, ce qui est " +
  "similaire ou différent par rapport aux données fournies, et les incertitudes réelles. " +
  "5) basedOnBatchCount ne doit être renseigné (non-null) que si evidenceType est " +
  "\"internalBioLabData\" et que tu comptes réellement sur des résumés de lots fournis dans le contexte " +
  "— jamais un nombre inventé. " +
  "6) Chaque ingrédient a un sourceType (published/internalExperimental/userDefined/calculated/" +
  "aiSuggested/unknown) reflétant honnêtement d'où vient CETTE valeur précise, pas une valeur générique " +
  "pour toute la proposition.";

interface RecommendRequestBody {
  speciesName?: string;
  cultivar?: string | null;
  explantType?: string | null;
  cultureStage?: string;
  cultureSystem?: string | null;
  previousProtocolSummaries?: string[];
  previousExperimentSummaries?: string[];
  previousBatchResultSummaries?: string[];
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
  const quota = await checkAndIncrementUsage(admin, userData.user.id, "biolabRecommendation");
  if (!quota.allowed) {
    return jsonResponse({ error: "Quota de recommandations BioLab atteint pour ce mois. Passez à une offre supérieure pour continuer." }, 429);
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return jsonResponse({ error: "Fonction IA indisponible pour le moment (configuration manquante)." }, 500);
  }

  let body: RecommendRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  const speciesName = (body.speciesName ?? "").trim();
  if (speciesName.length === 0) {
    return jsonResponse({ error: "Espèce manquante." }, 400);
  }

  const prompt = formatRequest(body);

  try {
    const result = await callOpenAIStructured(
      openaiKey,
      [
        { role: "developer", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user", content: [{ type: "input_text", text: prompt }] },
      ],
      "medium_recommendations",
      responseSchema,
    );
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof OpenAIError) {
      return jsonResponse({ error: "L'IA n'a pas pu proposer de milieu. Réessayez plus tard." }, 502);
    }
    return jsonResponse({ error: "Erreur inattendue." }, 500);
  }
});

function formatRequest(body: RecommendRequestBody): string {
  const lines: string[] = [
    `Espèce : ${body.speciesName}`,
  ];
  if (body.cultivar) lines.push(`Cultivar : ${body.cultivar}`);
  if (body.explantType) lines.push(`Type d'explant : ${body.explantType}`);
  if (body.cultureStage) lines.push(`Stade de culture : ${body.cultureStage}`);
  if (body.cultureSystem) lines.push(`Système de culture : ${body.cultureSystem}`);

  if (body.previousProtocolSummaries?.length) {
    lines.push("Protocoles déjà utilisés dans ce laboratoire :");
    for (const summary of body.previousProtocolSummaries) lines.push(`- ${summary}`);
  }
  if (body.previousExperimentSummaries?.length) {
    lines.push("Expériences déjà menées :");
    for (const summary of body.previousExperimentSummaries) lines.push(`- ${summary}`);
  }
  if (body.previousBatchResultSummaries?.length) {
    lines.push("Résultats de lots déjà enregistrés :");
    for (const summary of body.previousBatchResultSummaries) lines.push(`- ${summary}`);
  }

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
        text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
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
