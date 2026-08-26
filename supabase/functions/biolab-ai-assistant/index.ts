// Oasis Care — Oasis AI BioLab assistant Edge Function (spec Phase 7I).
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// ask it a couple of real questions before relying on it.
//
// Same shape as garden-ai-assistant, but the context summarizes the
// whole BioLab (batches, bioreactors, recent contamination/
// hyperhydricity findings) instead of a garden. Free-form Q&A — no
// structured JSON output, the answer is just plain text.
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "biolab-ai-assistant" → paste this file's contents →
// Deploy. Requires an OPENAI_API_KEY secret (same one used by the other
// AI functions — Edge Functions → Manage secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 30_000;
const MAX_QUESTION_LENGTH = 2000;

const SYSTEM_PROMPT =
  "Tu es Oasis AI, l'assistant intégré au module BioLab (culture in vitro / micropropagation) de " +
  "l'application Oasis Care. L'utilisateur te pose une question sur l'ensemble de son laboratoire " +
  "(plusieurs lots de culture et bioréacteurs, pas un seul) ; un résumé de ce laboratoire (lots avec " +
  "leur stade et taux de multiplication, bioréacteurs avec leur programme et température moyenne, " +
  "constats récents de contamination/hyperhydricité) t'est fourni ci-dessous. Tu dois notamment " +
  "pouvoir répondre à des questions comme « Pourquoi BR04 multiplie moins vite que BR03 ? », « Quels " +
  "lots ont montré le plus d'hyperhydricité ? », « Quels paramètres diffèrent entre mes meilleurs " +
  "lots ? » ou « Montre-moi les lots avec suspicion de contamination » à partir de ce contexte. " +
  "Réponds en français, de façon concise et actionnable. RÈGLE IMPÉRATIVE, sans exception : tu ne dois " +
  "jamais présenter une causalité comme certaine (jamais « X est forcément la cause de Y »). Distingue " +
  "toujours une association ou différence réellement observée dans les données d'une hypothèse — " +
  "formule toute explication possible comme une hypothèse à tester expérimentalement, pas comme un " +
  "fait établi. Si une réponse certaine n'est pas possible avec les informations disponibles, dis-le " +
  "plutôt que d'inventer.";

interface BioLabAIContextDTO {
  batchCount?: number;
  bioreactorCount?: number;
  batchSummaries?: string[];
  bioreactorSummaries?: string[];
  recentFindings?: string[];
}
interface AssistantRequestBody {
  question?: string;
  context?: BioLabAIContextDTO;
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

function formatContext(context: BioLabAIContextDTO | undefined): string {
  if (!context) return "Aucun contexte de laboratoire fourni.";
  const lines: string[] = [
    `Lots de culture : ${context.batchCount ?? 0}`,
    `Bioréacteurs : ${context.bioreactorCount ?? 0}`,
  ];

  if (context.batchSummaries?.length) {
    lines.push("Lots :");
    for (const summary of context.batchSummaries) {
      lines.push(`- ${summary}`);
    }
  }

  if (context.bioreactorSummaries?.length) {
    lines.push("Bioréacteurs :");
    for (const summary of context.bioreactorSummaries) {
      lines.push(`- ${summary}`);
    }
  }

  if (context.recentFindings?.length) {
    lines.push("Constats récents (contamination / hyperhydricité) :");
    for (const finding of context.recentFindings) {
      lines.push(`- ${finding}`);
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
