// Oasis Care — photo-based plant problem diagnosis Edge Function.
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// test it against a few real "problem" photos before relying on it.
//
// Spec §45 asks for an abstraction that can use Pl@ntNet's disease/pest
// endpoints when the species/pathology is supported, "with a fallback
// to OpenAI's multimodal analysis" — and that the architecture allow
// swapping providers later. What ships here IS that fallback path (the
// always-available baseline); a Pl@ntNet-first branch is a deliberately
// left seam (see PROVIDER below) rather than something guessed at and
// shipped unverified, since Pl@ntNet's disease API shape wasn't
// confirmed the same way the identification API was for identify-plant.
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "diagnose-plant-problem" → paste this file's contents
// → Deploy. Requires an OPENAI_API_KEY secret (same one used by
// plant-info and plant-ai-assistant — Edge Functions → Manage secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 30_000;
const MAX_IMAGES = 4;
const PROVIDER = "openai"; // seam for a future "plantnet" branch, see header comment
const CONFIDENCE_LEVELS = ["high", "medium", "low", "unknown"];

function obj(properties: Record<string, unknown>) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
function stringArray() {
  return { type: "array", items: { type: "string" } };
}

const diagnosisSchema = obj({
  summary: { type: "string" },
  possibleCause: { type: "string" },
  confidence: { type: "string", enum: CONFIDENCE_LEVELS },
  reasoning: stringArray(),
  checksToPerform: stringArray(),
  recommendedActions: stringArray(),
});

const SYSTEM_PROMPT =
  "Tu es un assistant botanique qui aide un utilisateur à comprendre un problème visible sur sa " +
  "plante, à partir de photos et du contexte fourni (espèce, historique d'arrosage/engrais/" +
  "traitements récents, environnement). Règles impératives : " +
  "1) Ne présente JAMAIS une hypothèse comme certaine. Utilise des formulations comme « possible », " +
  "« probable », « compatible avec », « à vérifier ». N'écris jamais une phrase du type « votre " +
  "plante a absolument la maladie X », sauf certitude visuelle évidente et sans ambiguïté. " +
  "2) Base ton raisonnement sur les éléments concrets fournis (photos + historique), et dis-le dans " +
  "\"reasoning\". " +
  "3) checksToPerform doit lister des vérifications concrètes que l'utilisateur peut faire lui-même " +
  "(ex: humidité réelle du substrat, odeur des racines, dessous des feuilles). " +
  "4) confidence reflète honnêtement ta certitude réelle — utilise \"low\" ou \"unknown\" si les " +
  "photos sont peu claires ou le tableau ambigu, plutôt que de forcer une réponse assurée.";

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
interface DiagnoseRequestBody {
  images?: string[];
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

  let body: DiagnoseRequestBody;
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
    const diagnosis = await callOpenAIStructured(
      openaiKey,
      [
        { role: "developer", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user", content },
      ],
      "plant_diagnosis",
      diagnosisSchema,
    );
    return jsonResponse({ ...diagnosis, provider: PROVIDER, model: OPENAI_MODEL });
  } catch (error) {
    if (error instanceof OpenAIError) {
      return jsonResponse({ error: "Le service IA n'a pas pu analyser ces photos. Réessayez plus tard." }, 502);
    }
    return jsonResponse({ error: "Erreur inattendue." }, 500);
  }
});

function formatContext(context: PlantAIContextDTO | undefined): string {
  if (!context) return "Aucun contexte supplémentaire fourni.";
  const lines: string[] = [];
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
