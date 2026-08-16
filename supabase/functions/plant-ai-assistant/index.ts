// Oasis Care — per-plant AI assistant Edge Function ("✨ Assistant IA").
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// ask it a couple of real questions before relying on it.
//
// Free-form Q&A, so unlike plant-info/diagnose-plant-problem this does
// NOT use structured JSON output — the answer is just the model's plain
// text reply (spec §41-42: the user asks something like "Pourquoi les
// feuilles jaunissent ?" and gets a written answer, not structured data
// to insert anywhere).
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "plant-ai-assistant" → paste this file's contents →
// Deploy. Requires an OPENAI_API_KEY secret (same one used by
// plant-info and diagnose-plant-problem — Edge Functions → Manage
// secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 30_000;
const MAX_QUESTION_LENGTH = 2000;

const SYSTEM_PROMPT =
  "Tu es Oasis AI, l'assistant botanique intégré à l'application Oasis Care. L'utilisateur te pose " +
  "une question au sujet d'une plante précise ; le contexte de cette plante (espèce, historique de " +
  "soins récents, environnement) t'est fourni ci-dessous. Réponds en français, de façon concise, " +
  "concrète et bienveillante. Appuie-toi sur le contexte fourni quand il est pertinent. Si une " +
  "réponse certaine n'est pas possible avec les informations disponibles, dis-le et propose ce que " +
  "l'utilisateur pourrait vérifier ou observer, plutôt que d'affirmer quelque chose que tu ne sais " +
  "pas réellement.";

interface CareEventContext {
  type: string;
  date: string;
  notes?: string | null;
  quantity?: number | null;
  unit?: string | null;
}
interface CareScheduleContext {
  type: string;
  frequencyDays: number;
  lastCompletedDate?: string | null;
}
interface PlantAIContextDTO {
  scientificName?: string | null;
  commonName?: string | null;
  plantType?: string | null;
  isIndoor?: boolean | null;
  notes?: string | null;
  recentCareEvents?: CareEventContext[];
  careSchedules?: CareScheduleContext[];
  environment?: { temperatureCelsius?: number | null; humidityPercent?: number | null } | null;
}
interface AssistantRequestBody {
  question?: string;
  context?: PlantAIContextDTO;
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

function formatContext(context: PlantAIContextDTO | undefined): string {
  if (!context) return "Aucun contexte de plante fourni.";
  const lines: string[] = ["Contexte de la plante :"];
  if (context.scientificName) lines.push(`Espèce : ${context.scientificName}`);
  if (context.commonName) lines.push(`Nom commun : ${context.commonName}`);
  if (context.plantType) lines.push(`Type : ${context.plantType}`);
  if (context.isIndoor !== undefined && context.isIndoor !== null) {
    lines.push(`Emplacement : ${context.isIndoor ? "intérieur" : "extérieur"}`);
  }
  if (context.environment?.temperatureCelsius != null) {
    lines.push(`Température connue : ${context.environment.temperatureCelsius} °C`);
  }
  if (context.environment?.humidityPercent != null) {
    lines.push(`Humidité connue : ${context.environment.humidityPercent} %`);
  }
  if (context.notes) lines.push(`Notes de l'utilisateur : ${context.notes}`);

  if (context.careSchedules?.length) {
    lines.push("Programmes de soins actifs :");
    for (const s of context.careSchedules) {
      lines.push(`- ${s.type} : tous les ${s.frequencyDays} jours` + (s.lastCompletedDate ? `, dernier le ${s.lastCompletedDate}` : ""));
    }
  }

  if (context.recentCareEvents?.length) {
    lines.push("Historique récent :");
    for (const e of context.recentCareEvents.slice(0, 20)) {
      const qty = e.quantity != null ? ` (${e.quantity}${e.unit ?? ""})` : "";
      const notes = e.notes ? ` — ${e.notes}` : "";
      lines.push(`- ${e.date} : ${e.type}${qty}${notes}`);
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
