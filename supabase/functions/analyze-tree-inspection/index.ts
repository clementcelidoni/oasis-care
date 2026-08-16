// Oasis Care — tree inspection photo analysis Edge Function.
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// test it against a few real tree/palm photos before relying on it.
//
// Spec §59: "Oasis AI reçoit uniquement les informations pertinentes"
// and results must never be presented as certain arboricultural
// expertise. Mirrors diagnose-plant-problem's structure closely — same
// self-contained shape, same hedged-language requirement, different
// domain (structural/arboricultural signs instead of general plant
// health) and prompt.
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "analyze-tree-inspection" → paste this file's contents
// → Deploy. Requires an OPENAI_API_KEY secret (same one used by the
// other AI functions — Edge Functions → Manage secrets).

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
function stringArray() {
  return { type: "array", items: { type: "string" } };
}

const analysisSchema = obj({
  observations: stringArray(),
  pointsToCheck: stringArray(),
  confidence: { type: "string", enum: CONFIDENCE_LEVELS },
});

const SYSTEM_PROMPT =
  "Tu es un assistant qui aide un utilisateur non-expert à repérer des signes visibles sur des " +
  "photos d'un arbre ou palmier (état général, stabilité apparente, bois mort, cavités, champignons, " +
  "parasites, défauts du tronc, état du houppier), à partir des photos et du contexte fourni. " +
  "Règles impératives : " +
  "1) Ceci n'est PAS une expertise arboricole certaine et tu ne dois JAMAIS le présenter comme tel. " +
  "N'affirme rien avec certitude sur la sécurité ou la stabilité de l'arbre — un diagnostic de " +
  "sécurité réel nécessite un arboriste professionnel sur site. Utilise systématiquement des " +
  "formulations comme « semble », « possible », « à faire vérifier par un professionnel ». " +
  "2) observations liste ce qui est visuellement identifiable sur les photos (signes positifs ou " +
  "négatifs), en restant descriptif plutôt qu'alarmiste. " +
  "3) pointsToCheck liste des vérifications concrètes que l'utilisateur ou un professionnel peut " +
  "faire ensuite. " +
  "4) confidence reflète honnêtement ta certitude réelle — utilise \"low\" ou \"unknown\" si les " +
  "photos sont peu claires, mal cadrées, ou si le sujet ne semble pas être un arbre/palmier.";

interface TreeInspectionAIContextDTO {
  scientificName?: string | null;
  commonName?: string | null;
  plantType?: string | null;
  latestHeight?: number | null;
  latestTrunkCircumference?: number | null;
  latestCanopyDiameter?: number | null;
  estimatedAge?: number | null;
}
interface AnalyzeRequestBody {
  images?: string[];
  context?: TreeInspectionAIContextDTO;
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
      "tree_inspection_analysis",
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

function formatContext(context: TreeInspectionAIContextDTO | undefined): string {
  if (!context) return "Aucun contexte supplémentaire fourni.";
  const lines: string[] = [];
  if (context.scientificName) lines.push(`Espèce : ${context.scientificName}`);
  if (context.commonName) lines.push(`Nom commun : ${context.commonName}`);
  if (context.plantType) lines.push(`Type : ${context.plantType}`);
  if (context.latestHeight != null) lines.push(`Dernière hauteur mesurée : ${context.latestHeight} m`);
  if (context.latestTrunkCircumference != null) {
    lines.push(`Dernière circonférence du tronc mesurée : ${context.latestTrunkCircumference} cm`);
  }
  if (context.latestCanopyDiameter != null) lines.push(`Dernier diamètre de houppier mesuré : ${context.latestCanopyDiameter} m`);
  if (context.estimatedAge != null) lines.push(`Âge estimé : ${context.estimatedAge} ans`);
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
