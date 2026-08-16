// Oasis Care — before/after tree photo comparison Edge Function.
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// test it against a few real "before/after" photo pairs before relying
// on it.
//
// Spec §60: compare two photos of the same tree across time on
// foliage/density/growth/yellowing/visible decline. Same self-contained
// shape and hedged-language requirement as the other AI functions.
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "compare-tree-photos" → paste this file's contents →
// Deploy. Requires an OPENAI_API_KEY secret (same one used by the other
// AI functions — Edge Functions → Manage secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 30_000;
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

const comparisonSchema = obj({
  summary: { type: "string" },
  foliageChange: { type: "string" },
  densityChange: { type: "string" },
  growthObserved: { type: "string" },
  yellowingObserved: { type: "string" },
  declineObserved: { type: "string" },
  confidence: { type: "string", enum: CONFIDENCE_LEVELS },
});

const SYSTEM_PROMPT =
  "Tu compares deux photos du même arbre ou palmier prises à des dates différentes (\"avant\" et " +
  "\"après\") pour aider un utilisateur non-expert à repérer une évolution visible. " +
  "Règles impératives : " +
  "1) Ceci n'est PAS une expertise arboricole certaine. N'affirme rien avec certitude sur la santé " +
  "ou la sécurité de l'arbre. Utilise des formulations comme « semble », « paraît », « suggère ». " +
  "2) Commente spécifiquement, dans les champs dédiés : foliageChange (feuillage), densityChange " +
  "(densité), growthObserved (croissance visible), yellowingObserved (jaunissement), " +
  "declineObserved (dépérissement visible). Si un aspect n'est pas observable ou ne semble pas " +
  "avoir changé, dis-le simplement plutôt que d'inventer une observation. " +
  "3) Si les deux photos ne semblent pas montrer le même arbre, ou sont trop différentes en angle/" +
  "distance pour permettre une vraie comparaison, dis-le clairement dans summary et utilise une " +
  "confidence basse. " +
  "4) confidence reflète honnêtement ta certitude réelle.";

interface TreeInspectionAIContextDTO {
  scientificName?: string | null;
  commonName?: string | null;
  plantType?: string | null;
  latestHeight?: number | null;
  latestTrunkCircumference?: number | null;
  latestCanopyDiameter?: number | null;
  estimatedAge?: number | null;
}
interface CompareRequestBody {
  beforeImage?: string;
  afterImage?: string;
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

  let body: CompareRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  if (!body.beforeImage || !body.afterImage) {
    return jsonResponse({ error: "Deux photos sont nécessaires pour une comparaison." }, 400);
  }

  const content: Record<string, unknown>[] = [
    { type: "input_text", text: formatContext(body.context) },
    { type: "input_text", text: "Photo \"avant\" :" },
    { type: "input_image", image_url: `data:image/jpeg;base64,${body.beforeImage}` },
    { type: "input_text", text: "Photo \"après\" :" },
    { type: "input_image", image_url: `data:image/jpeg;base64,${body.afterImage}` },
  ];

  try {
    const comparison = await callOpenAIStructured(
      openaiKey,
      [
        { role: "developer", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user", content },
      ],
      "tree_photo_comparison",
      comparisonSchema,
    );
    return jsonResponse({ ...comparison, provider: PROVIDER, model: OPENAI_MODEL });
  } catch (error) {
    if (error instanceof OpenAIError) {
      return jsonResponse({ error: "Le service IA n'a pas pu comparer ces photos. Réessayez plus tard." }, 502);
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
