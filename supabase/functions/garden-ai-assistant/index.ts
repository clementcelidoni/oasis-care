// Oasis Care — global garden AI assistant Edge Function ("✨ Demander à
// Oasis" on the dashboard / in a garden — spec §12, §68-69).
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// ask it a couple of real questions before relying on it.
//
// Same shape as plant-ai-assistant, but the context summarizes a whole
// garden (plant counts by health, today's tasks, top alerts, recent
// events, weather once Phase 4B lands) instead of one plant. Free-form
// Q&A — no structured JSON output, the answer is just plain text.
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "garden-ai-assistant" → paste this file's contents →
// Deploy. Requires an OPENAI_API_KEY secret (same one used by
// plant-info, diagnose-plant-problem, and plant-ai-assistant — Edge
// Functions → Manage secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 30_000;
const MAX_QUESTION_LENGTH = 2000;

const SYSTEM_PROMPT =
  "Tu es Oasis AI, l'assistant intégré à l'application de jardinage Oasis Care. L'utilisateur te pose " +
  "une question sur l'ensemble d'un jardin (pas une seule plante) ; un résumé de ce jardin (nombre de " +
  "végétaux par état de santé, tâches du jour, alertes principales, historique récent, météo, " +
  "consommation d'eau et arbres/palmiers à inspecter si connus) t'est fourni ci-dessous. Tu dois " +
  "notamment pouvoir répondre à des questions comme « Que dois-je faire cette semaine ? », « Quels " +
  "arbres sont à inspecter ? », « Quelles plantes sont en retard ? », « Quels végétaux semblent " +
  "malades ? » et « Combien d'eau ai-je consommé ? » à partir de ce contexte. Réponds en français, de " +
  "façon concise et actionnable — dis quoi faire, pas seulement ce qui existe. Appuie-toi sur le " +
  "contexte fourni. Si une réponse certaine n'est pas possible avec les informations disponibles, " +
  "dis-le plutôt que d'inventer — par exemple si aucune donnée d'irrigation n'est fournie, dis que tu " +
  "n'as pas cette information plutôt que de deviner une consommation d'eau.";

interface GardenAIContextDTO {
  gardenName?: string | null;
  totalPlants?: number;
  healthyCount?: number;
  monitorCount?: number;
  attentionCount?: number;
  urgentCount?: number;
  todayTaskCounts?: Record<string, number>;
  overdueCount?: number;
  topInsights?: string[];
  recentEvents?: string[];
  weather?: { temperatureCelsius?: number | null; condition?: string | null } | null;
  waterTodayLiters?: number | null;
  waterWeekLiters?: number | null;
  waterMonthLiters?: number | null;
  treesNeedingInspection?: string[] | null;
}
interface AssistantRequestBody {
  question?: string;
  context?: GardenAIContextDTO;
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

  let body: AssistantRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  const question = (body.question ?? "").trim();
  if (question.length === 0) {
    return jsonResponse({ error: "Question manquante." }, 400);
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return jsonResponse({ error: "Question trop longue." }, 400);
  }

  const prompt = `${formatContext(body.context)}\n\nQuestion de l'utilisateur : ${question}`;

  try {
    const answer = await callOpenAIText(openaiKey, [
      { role: "developer", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
      { role: "user", content: [{ type: "input_text", text: prompt }] },
    ]);
    return jsonResponse({ answer, provider: "openai", model: OPENAI_MODEL });
  } catch (error) {
    if (error instanceof OpenAIError) {
      return jsonResponse({ error: "L'assistant IA n'a pas pu répondre. Réessayez plus tard." }, 502);
    }
    return jsonResponse({ error: "Erreur inattendue." }, 500);
  }
});

function formatContext(context: GardenAIContextDTO | undefined): string {
  if (!context) return "Aucun contexte de jardin fourni.";
  const lines: string[] = [`Jardin : ${context.gardenName ?? "tous les jardins"}`];
  if (context.totalPlants != null) lines.push(`Total végétaux : ${context.totalPlants}`);
  lines.push(
    `État : ${context.healthyCount ?? 0} bon état, ${context.monitorCount ?? 0} à surveiller, ` +
      `${context.attentionCount ?? 0} attention, ${context.urgentCount ?? 0} urgent`
  );
  if (context.overdueCount != null) lines.push(`Tâches en retard : ${context.overdueCount}`);

  const taskCounts = context.todayTaskCounts ?? {};
  const taskEntries = Object.entries(taskCounts);
  if (taskEntries.length > 0) {
    lines.push("Tâches du jour :");
    for (const [type, count] of taskEntries) {
      lines.push(`- ${type} : ${count}`);
    }
  }

  if (context.weather?.temperatureCelsius != null) {
    lines.push(`Météo : ${context.weather.temperatureCelsius} °C${context.weather.condition ? `, ${context.weather.condition}` : ""}`);
  }

  if (context.waterTodayLiters != null || context.waterWeekLiters != null || context.waterMonthLiters != null) {
    lines.push(
      `Consommation d'eau (irrigation) : ${context.waterTodayLiters ?? 0} L aujourd'hui, ` +
        `${context.waterWeekLiters ?? 0} L cette semaine, ${context.waterMonthLiters ?? 0} L ce mois-ci`
    );
  }

  if (context.treesNeedingInspection?.length) {
    lines.push(`Arbres/palmiers à inspecter (jamais inspectés ou depuis plus de 6 mois) : ${context.treesNeedingInspection.join(", ")}`);
  }

  if (context.topInsights?.length) {
    lines.push("Alertes principales :");
    for (const insight of context.topInsights) {
      lines.push(`- ${insight}`);
    }
  }

  if (context.recentEvents?.length) {
    lines.push("Historique récent :");
    for (const event of context.recentEvents) {
      lines.push(`- ${event}`);
    }
  }

  return lines.join("\n");
}

class OpenAIError extends Error {}

async function callOpenAIText(apiKey: string, input: unknown[]): Promise<string> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: OPENAI_MODEL, input }),
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
  return textContent.text as string;
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
