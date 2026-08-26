// Oasis Care — BioLab inspection photo analysis Edge Function (spec
// Phase 7I "ANALYSE PHOTO").
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// test it against a few real culture/vessel photos before relying on it.
//
// Spec's own CRITIQUE (Phase 7H, reiterated here): "ne jamais demander à
// l'IA de déclarer automatiquement une contamination comme certitude."
// Mirrors analyze-tree-inspection's structure closely — same
// self-contained shape, same hedged-language requirement, different
// domain (in vitro culture signs instead of arboricultural signs).
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "analyze-biolab-inspection" → paste this file's
// contents → Deploy. Requires an OPENAI_API_KEY secret (same one used by
// the other AI functions — Edge Functions → Manage secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 30_000;
const MAX_IMAGES = 4;
const PROVIDER = "openai";
const CONFIDENCE_LEVELS = ["high", "medium", "low", "unknown"];

function obj(properties: Record<string, unknown>) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const analysisSchema = obj({
  growthObservation: { type: "string" },
  colorationObservation: { type: "string" },
  browningObservation: { type: "string" },
  necrosisObservation: { type: "string" },
  hyperhydricityObservation: { type: "string" },
  contaminationObservation: { type: "string" },
  confidence: { type: "string", enum: CONFIDENCE_LEVELS },
});

const SYSTEM_PROMPT =
  "Tu es un assistant qui aide un utilisateur non-expert à repérer, sur des photos d'une culture in " +
  "vitro (bocal, tissus, milieu), des éléments visuellement compatibles avec : la croissance, la " +
  "coloration, un brunissement, une nécrose, une hyperhydricité potentielle, et une contamination " +
  "visible potentielle. Règles impératives, sans exception : " +
  "1) Ceci n'est PAS un diagnostic certain et tu ne dois JAMAIS le présenter comme tel — en particulier " +
  "pour la contamination : n'affirme JAMAIS avec certitude qu'une culture est contaminée, même si des " +
  "signes visuels y sont compatibles. Utilise systématiquement des formulations comme « semble », " +
  "« compatible avec », « à vérifier physiquement ». Une contamination réelle ne peut être confirmée " +
  "que par un examen direct de la culture. " +
  "2) Chaque champ (growthObservation, colorationObservation, browningObservation, " +
  "necrosisObservation, hyperhydricityObservation, contaminationObservation) décrit ce qui est " +
  "visuellement observable sur les photos pour cet aspect précis. Si un aspect n'est pas observable ou " +
  "ne montre rien de notable, dis-le simplement (par exemple « rien de particulier visible ») plutôt " +
  "que d'inventer une observation. " +
  "3) confidence reflète honnêtement ta certitude réelle — utilise \"low\" ou \"unknown\" si les " +
  "photos sont peu claires, mal cadrées, ou ne semblent pas montrer une culture in vitro.";

interface BioLabInspectionAIContextDTO {
  speciesName?: string | null;
  cultureStage?: string | null;
  recipeVersion?: number | null;
  existingContaminationStatus?: string | null;
  existingHyperhydricityStatus?: string | null;
}
interface AnalyzeRequestBody {
  images?: string[];
  context?: BioLabInspectionAIContextDTO;
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

  let body: AnalyzeRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  const images = Array.isArray(body.images) ? body.images : [];
  if (images.length === 0) {
    return jsonResponse({ error: "Aucune photo fournie." }, 400);
  }
  if (images.length > MAX_IMAGES) {
    return jsonResponse({ error: `Maximum ${MAX_IMAGES} photos par analyse.` }, 400);
  }

  const content: Record<string, unknown>[] = [
    { type: "input_text", text: formatContext(body.context) },
  ];
  for (const image of images) {
    content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${image}` });
  }

  try {
    const analysis = await callOpenAIStructured(
      openaiKey,
      [
        { role: "developer", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user", content },
      ],
      "biolab_inspection_analysis",
      analysisSchema,
    );
    return jsonResponse({ ...analysis, provider: PROVIDER, model: OPENAI_MODEL });
  } catch (error) {
    if (error instanceof OpenAIError) {
      return jsonResponse({ error: "Le service IA n'a pas pu analyser ces photos. Réessayez plus tard." }, 502);
    }
    return jsonResponse({ error: "Erreur inattendue." }, 500);
  }
});

function formatContext(context: BioLabInspectionAIContextDTO | undefined): string {
  if (!context) return "Aucun contexte supplémentaire fourni.";
  const lines: string[] = [];
  if (context.speciesName) lines.push(`Espèce/cultivar : ${context.speciesName}`);
  if (context.cultureStage) lines.push(`Stade de culture : ${context.cultureStage}`);
  if (context.recipeVersion != null) lines.push(`Recette utilisée : V${context.recipeVersion}`);
  if (context.existingContaminationStatus) lines.push(`Statut contamination déjà saisi : ${context.existingContaminationStatus}`);
  if (context.existingHyperhydricityStatus) lines.push(`Statut hyperhydricité déjà saisi : ${context.existingHyperhydricityStatus}`);
  return lines.length > 0 ? lines.join("\n") : "Aucun contexte supplémentaire fourni.";
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
