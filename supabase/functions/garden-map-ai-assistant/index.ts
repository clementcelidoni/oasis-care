// Oasis Care — map-aware garden AI assistant Edge Function (spec Phase
// 6L: GardenDigitalTwinAIContext, "Où puis-je planter un bananier ?",
// "Imaginer un aménagement").
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// ask it a couple of real questions before relying on it.
//
// Separate from garden-ai-assistant (dashboard-scoped counts/events) —
// this context is zone/geometry-based, matching the pattern of every
// other Oasis AI feature being its own dedicated function rather than
// one growing do-everything endpoint.
//
// Two modes, one function, exactly like plant-info's suggest/complete
// split — "mode":"query" answers a free-form question and may highlight
// real zones by id (never invents a polygon); "mode":"design" proposes
// species names + notes for one real zone, never coordinates — spec's
// own "NE PAS LAISSER L'IA MODIFIER DIRECTEMENT LE PLAN" means the only
// thing this function is ever allowed to hand back is a suggestion the
// Swift client previews and the user must explicitly confirm.
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "garden-map-ai-assistant" → paste this file's contents
// → Deploy. Requires an OPENAI_API_KEY secret (same one used by every
// other AI Edge Function — Edge Functions → Manage secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 30_000;
const MAX_QUESTION_LENGTH = 2000;

// ============================================================
// JSON Schema helpers — same conventions as plant-info: obj() gives
// additionalProperties:false + required=all keys (OpenAI's strict mode
// demands this), optional fields are nullable rather than omitted.
// ============================================================
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

const recommendedAreaSchema = obj({
  zoneId: { type: "string" },
  score: { type: "number" },
  reasons: stringArray(),
  warnings: stringArray(),
});

const queryResponseSchema = obj({
  answer: { type: "string" },
  recommendedAreas: { type: "array", items: recommendedAreaSchema },
});

const designResponseSchema = obj({
  speciesNames: stringArray(),
  notes: { type: "string" },
});

const QUERY_SYSTEM_PROMPT =
  "Tu es Oasis AI, l'assistant intégré à l'application de jardinage Oasis Care, en mode « jumeau numérique du " +
  "jardin ». L'utilisateur te pose une question sur l'aménagement de son jardin (ex. « Où puis-je planter un " +
  "bananier ? », « Quelle zone est la plus sèche ? », « Où manque-t-il des asperseurs ? », « Quels arbres vont " +
  "devenir trop proches ? », « Quelle partie du jardin reçoit le plus de soleil ? »). Un résumé zone par zone " +
  "(géométrie, dimensions, végétaux et espèces présents, santé, ensoleillement estimé, couverture d'arrosage, " +
  "tâches en attente, croissance estimée) t'est fourni ci-dessous — chaque zone a un identifiant réel (zoneId). " +
  "Réponds en français, de façon concise et actionnable. Si ta réponse recommande une ou plusieurs zones " +
  "précises, remplis recommendedAreas avec leur zoneId RÉEL tiré du contexte (jamais un identifiant inventé), " +
  "un score de pertinence de 0 à 100, les raisons qui justifient ce choix, et les éventuels avertissements " +
  "(ex. zone déjà chargée, exposition limite). Si aucune zone précise n'est pertinente pour la question, laisse " +
  "recommendedAreas vide. Ne prétends jamais connaître une donnée qui ne figure pas dans le contexte — dis-le " +
  "plutôt que d'inventer.";

const DESIGN_SYSTEM_PROMPT =
  "Tu es Oasis AI en mode « Imaginer un aménagement ». L'utilisateur décrit ce qu'il aimerait planter dans une " +
  "zone précise de son jardin (ex. « Je veux un massif tropical dans cette zone »). Le contexte ci-dessous " +
  "décrit cette zone (géométrie, dimensions, ensoleillement estimé, végétaux déjà présents) ainsi que la " +
  "météo/le climat du jardin si connus. Propose une liste de 2 à 6 espèces adaptées à cette zone précise " +
  "(speciesNames, noms usuels ou scientifiques) et une courte note d'implantation suggérée en français " +
  "(notes) — par exemple quelles espèces mettre au centre versus en bordure, en tenant compte de leur taille " +
  "adulte respective. Ne propose jamais de positions ni de coordonnées : uniquement des espèces et des " +
  "conseils qualitatifs, l'application se charge elle-même de leur placement. Si l'ensoleillement ou le " +
  "climat de la zone ne permettent pas raisonnablement ce que l'utilisateur demande, dis-le dans notes plutôt " +
  "que de proposer des espèces mal adaptées.";

interface ZoneSummaryDTO {
  id: string;
  name: string;
  areaType: string;
  areaSquareMeters: number;
  plantNames: string[];
  speciesNames: string[];
  healthCounts: Record<string, number>;
  sunExposure?: string | null;
  hasSprinklerCoverage: boolean;
  pendingTaskCount: number;
  growthNotes: string[];
}
interface DigitalTwinContextDTO {
  gardenName?: string | null;
  zones?: ZoneSummaryDTO[];
  weather?: { temperatureCelsius?: number | null; condition?: string | null } | null;
}
interface RequestBody {
  mode?: string;
  question?: string;
  zoneId?: string;
  context?: DigitalTwinContextDTO;
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

  let body: RequestBody;
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

  const mode = body.mode === "design" ? "design" : "query";
  const contextText = formatContext(body.context, { focusZoneId: mode === "design" ? body.zoneId : undefined });

  try {
    if (mode === "design") {
      const prompt = `${contextText}\n\nDemande de l'utilisateur : ${question}`;
      const result = await callOpenAIStructured(
        openaiKey,
        [
          { role: "developer", content: [{ type: "input_text", text: DESIGN_SYSTEM_PROMPT }] },
          { role: "user", content: [{ type: "input_text", text: prompt }] },
        ],
        "garden_design_proposal",
        designResponseSchema,
      );
      return jsonResponse({ designProposal: result, provider: "openai", model: OPENAI_MODEL });
    }

    const prompt = `${contextText}\n\nQuestion de l'utilisateur : ${question}`;
    const result = await callOpenAIStructured(
      openaiKey,
      [
        { role: "developer", content: [{ type: "input_text", text: QUERY_SYSTEM_PROMPT }] },
        { role: "user", content: [{ type: "input_text", text: prompt }] },
      ],
      "garden_map_query_result",
      queryResponseSchema,
    );
    return jsonResponse({ ...result, provider: "openai", model: OPENAI_MODEL });
  } catch (error) {
    if (error instanceof OpenAIError) {
      return jsonResponse({ error: "L'assistant IA n'a pas pu répondre. Réessayez plus tard." }, 502);
    }
    return jsonResponse({ error: "Erreur inattendue." }, 500);
  }
});

function formatContext(context: DigitalTwinContextDTO | undefined, opts: { focusZoneId?: string } = {}): string {
  if (!context?.zones?.length) return "Aucune zone dessinée sur le plan du jardin pour le moment.";
  const lines: string[] = [`Jardin : ${context.gardenName ?? "sans nom"}`];

  if (context.weather?.temperatureCelsius != null) {
    lines.push(`Météo actuelle : ${context.weather.temperatureCelsius} °C${context.weather.condition ? `, ${context.weather.condition}` : ""}`);
  }

  const zones = opts.focusZoneId ? context.zones.filter((z) => z.id === opts.focusZoneId) : context.zones;
  if (opts.focusZoneId && zones.length === 0) {
    lines.push("Zone demandée introuvable dans le contexte fourni.");
    return lines.join("\n");
  }

  lines.push("Zones du jardin :");
  for (const zone of zones) {
    lines.push(`- zoneId=${zone.id} — ${zone.name} (${zone.areaType}, ${zone.areaSquareMeters.toFixed(1)} m²)`);
    if (zone.sunExposure) lines.push(`  Ensoleillement estimé : ${zone.sunExposure}`);
    lines.push(`  Arrosage automatique présent : ${zone.hasSprinklerCoverage ? "oui" : "non"}`);
    if (zone.plantNames.length) lines.push(`  Végétaux : ${zone.plantNames.join(", ")}`);
    if (zone.speciesNames.length) lines.push(`  Espèces : ${zone.speciesNames.join(", ")}`);
    const healthEntries = Object.entries(zone.healthCounts);
    if (healthEntries.length) {
      lines.push(`  Santé : ${healthEntries.map(([status, count]) => `${count} ${status}`).join(", ")}`);
    }
    if (zone.pendingTaskCount > 0) lines.push(`  Tâches en attente : ${zone.pendingTaskCount}`);
    if (zone.growthNotes.length) lines.push(`  Croissance estimée : ${zone.growthNotes.join("; ")}`);
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
    return JSON.parse(textContent.text as string);
  } catch {
    throw new OpenAIError("Réponse IA illisible (JSON invalide).");
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
