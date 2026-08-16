// Oasis Care — plant name suggestions + AI species-profile completion.
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// test both modes (see below) against a disposable/cheap query before
// relying on it in the app.
//
// Two modes, selected by the "mode" field in the request body:
//
//   { "mode": "suggest", "query": "Alocasia Frydek" }
//     → { "suggestions": [{ "scientificName": "...", "commonName": "..." }] }
//     Fast/cheap name correction for the manual-add search field
//     (spec §33/§49). No caching — queries are short and varied, caching
//     wouldn't help much and would add complexity for little benefit.
//
//   { "mode": "complete", "scientificName": "Monstera deliciosa" }
//     → { "profile": { ...SpeciesProfile... }, "cached": boolean }
//     Full botanical profile generation (spec §34-39), checked against
//     the species_profiles cache first (spec §47-48: don't pay for an
//     OpenAI call every time someone adds a common species). Cache
//     writes use the service_role admin client, which bypasses RLS —
//     regular users only ever get read access to that table.
//
// Both modes require a real authenticated Supabase session (guests see
// a sign-in prompt client-side instead of reaching this function) —
// this call costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "plant-info" → paste this file's contents → Deploy.
// Requires an OPENAI_API_KEY secret (Edge Functions → Manage secrets →
// New secret). Get one at https://platform.openai.com/api-keys — create
// an account, add billing, then "Create new secret key".
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already provisioned to
// every Edge Function automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Centralizing the model name here (spec §40: "NE PAS disperser un
// identifiant de modèle dans toute l'application") — change it in this
// one place if OpenAI renames/deprecates it.
const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 30_000;
const CACHE_MAX_AGE_DAYS = 180;

// ============================================================
// JSON Schema helpers — every object built with obj() automatically
// gets additionalProperties:false and required = all its keys, which
// is what OpenAI's strict structured-output mode demands. Fields that
// are conceptually optional are typed nullable instead of omitted
// (spec §38: "Si une donnée n'est pas connue : NE PAS INVENTER.
// Retourner null / inconnu" maps directly onto strict mode's
// "everything required, but null is a valid value" shape).
// ============================================================
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
function nullableNumber() {
  return { type: ["number", "null"] };
}
function nullableBoolean() {
  return { type: ["boolean", "null"] };
}
function stringArray() {
  return { type: "array", items: { type: "string" } };
}
function nullableEnum(values: string[]) {
  return { type: ["string", "null"], enum: [...values, null] };
}

const CONFIDENCE_LEVELS = ["high", "medium", "low", "unknown"];
const CONFIDENCE_SECTIONS = [
  "taxonomy", "type", "exposure", "watering", "humidity", "temperature",
  "hardiness", "soil", "fertilizing", "growth", "maintenance", "health",
  "toxicity", "propagation",
];
const PLANT_TYPES = [
  "indoor", "tree", "palm", "shrub", "perennial", "annual", "climbing",
  "groundcover", "succulent", "cactus", "aquatic", "other",
];
const NEED_LEVELS = ["low", "moderate", "high"];
const SUNLIGHT = ["fullSun", "partialShade", "shade", "indirectLight"];
const GROWTH_SPEED = ["slow", "moderate", "fast"];

const speciesProfileSchema = obj({
  scientificName: { type: "string" },
  commonName: nullableString(),
  otherCommonNames: stringArray(),
  family: nullableString(),
  genus: nullableString(),
  species: nullableString(),
  cultivar: nullableString(),
  variety: nullableString(),
  geographicOrigin: nullableString(),
  plantType: nullableEnum(PLANT_TYPES),
  exposure: obj({
    sunlight: nullableEnum(SUNLIGHT),
    recommendations: nullableString(),
  }),
  watering: obj({
    needLevel: nullableEnum(NEED_LEVELS),
    frequencyIndicative: nullableString(),
    letDrySoilBetweenWaterings: nullableBoolean(),
    overwateringSensitivity: nullableEnum(NEED_LEVELS),
    seasonalAdvice: nullableString(),
  }),
  humidity: obj({
    idealPercentRange: nullableString(),
    dryAirTolerance: nullableEnum(NEED_LEVELS),
  }),
  temperature: obj({
    minimumCelsius: nullableNumber(),
    idealMinCelsius: nullableNumber(),
    idealMaxCelsius: nullableNumber(),
    maximumIndicativeCelsius: nullableNumber(),
    frostSensitive: nullableBoolean(),
  }),
  hardiness: obj({
    indicative: nullableString(),
    minimumTemperatureCelsius: nullableNumber(),
    outdoorIndoorByClimate: nullableString(),
  }),
  soil: obj({
    recommendedType: nullableString(),
    phIndicative: nullableString(),
    drainage: nullableString(),
    suggestedComposition: nullableString(),
  }),
  fertilizing: obj({
    needLevel: nullableEnum(NEED_LEVELS),
    frequencyIndicative: nullableString(),
    period: nullableString(),
    fertilizerType: nullableString(),
  }),
  growth: obj({
    speed: nullableEnum(GROWTH_SPEED),
    habit: nullableString(),
    adultHeight: nullableString(),
    adultWidth: nullableString(),
  }),
  maintenance: obj({
    pruning: nullableString(),
    repotting: nullableString(),
    staking: nullableString(),
    cleaning: nullableString(),
    restPeriod: nullableString(),
    dormancy: nullableString(),
  }),
  health: obj({
    commonPests: stringArray(),
    commonDiseases: stringArray(),
    overwateringSymptoms: nullableString(),
    underwateringSymptoms: nullableString(),
  }),
  toxicity: obj({
    humanToxicity: nullableString(),
    petToxicity: nullableString(),
  }),
  propagation: obj({
    cutting: nullableBoolean(),
    division: nullableBoolean(),
    seed: nullableBoolean(),
    otherTechniques: nullableString(),
  }),
  // Spec §50 — generated in the same call so applying it is a single
  // extra step, not a second AI round-trip.
  suggestedCareProgram: obj({
    wateringFrequencyDays: nullableNumber(),
    fertilizingFrequencyDays: nullableNumber(),
    rotationFrequencyDays: nullableNumber(),
  }),
  confidence: obj(
    Object.fromEntries(
      CONFIDENCE_SECTIONS.map((key) => [key, { type: "string", enum: CONFIDENCE_LEVELS }]),
    ),
  ),
});

const suggestionsSchema = obj({
  suggestions: {
    type: "array",
    // No maxItems: not confirmed as part of OpenAI's supported strict
    // structured-output schema subset, and getting that wrong would
    // reject every request with a schema error. The system prompt's
    // "jusqu'à 5" instruction is enough here.
    items: obj({
      scientificName: { type: "string" },
      commonName: nullableString(),
    }),
  },
});

const SUGGEST_SYSTEM_PROMPT =
  "Tu aides à corriger et compléter des noms de plantes saisis dans une application de jardinage. " +
  "À partir d'un nom partiel, mal orthographié ou approximatif, propose jusqu'à 5 correspondances " +
  "plausibles de noms scientifiques réels (genre + espèce, cultivar entre guillemets simples si " +
  "pertinent), avec leur nom commun français le plus courant si connu. Si aucune correspondance " +
  "plausible et réelle n'existe, retourne une liste vide. Ne jamais inventer une espèce qui n'existe pas.";

const COMPLETE_SYSTEM_PROMPT =
  "Tu es un expert en botanique qui remplit une fiche d'information générale sur une ESPÈCE de " +
  "plante — jamais sur un exemplaire précis appartenant à un utilisateur. Ne mentionne jamais un " +
  "pot, un emplacement, une taille actuelle ou un historique d'arrosage spécifique : ce ne sont pas " +
  "des informations d'espèce. Remplis chaque champ du schéma avec les meilleures informations " +
  "botaniques générales disponibles. Pour chaque section, indique honnêtement un niveau de confiance " +
  "(high/medium/low/unknown) ; si une information n'est pas connue avec une confiance raisonnable, " +
  "retourne null pour ce champ plutôt que d'inventer une valeur précise. Les températures sont en " +
  "degrés Celsius. suggestedCareProgram doit contenir des fréquences en jours, raisonnables pour un " +
  "usage domestique courant.";

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

  let body: { mode?: string; query?: string; scientificName?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    if (body.mode === "suggest") {
      return await handleSuggest(openaiKey, body.query ?? "");
    }
    if (body.mode === "complete") {
      return await handleComplete(openaiKey, admin, body.scientificName ?? "");
    }
    return jsonResponse({ error: "Mode inconnu (attendu: suggest ou complete)." }, 400);
  } catch (error) {
    if (error instanceof OpenAIError) {
      return jsonResponse({ error: "Le service IA n'a pas pu répondre. Réessayez plus tard." }, 502);
    }
    return jsonResponse({ error: "Erreur inattendue." }, 500);
  }
});

async function handleSuggest(apiKey: string, query: string): Promise<Response> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return jsonResponse({ suggestions: [] });
  }
  const result = await callOpenAIStructured(
    apiKey,
    [
      { role: "developer", content: [{ type: "input_text", text: SUGGEST_SYSTEM_PROMPT }] },
      { role: "user", content: [{ type: "input_text", text: trimmed }] },
    ],
    "plant_name_suggestions",
    suggestionsSchema,
  );
  return jsonResponse(result);
}

async function handleComplete(
  apiKey: string,
  admin: ReturnType<typeof createClient>,
  scientificName: string,
): Promise<Response> {
  const trimmed = scientificName.trim();
  if (trimmed.length < 2) {
    return jsonResponse({ error: "Nom scientifique manquant." }, 400);
  }
  const normalized = normalizeName(trimmed);

  const { data: cached } = await admin
    .from("species_profiles")
    .select("profile_json, generated_at")
    .eq("normalized_name", normalized)
    .maybeSingle();

  if (cached && isFresh(cached.generated_at as string)) {
    return jsonResponse({ profile: cached.profile_json, cached: true });
  }

  const profile = await callOpenAIStructured(
    apiKey,
    [
      { role: "developer", content: [{ type: "input_text", text: COMPLETE_SYSTEM_PROMPT }] },
      { role: "user", content: [{ type: "input_text", text: trimmed }] },
    ],
    "species_profile",
    speciesProfileSchema,
  );

  const { error: upsertError } = await admin.from("species_profiles").upsert(
    {
      scientific_name: (profile as { scientificName?: string }).scientificName ?? trimmed,
      normalized_name: normalized,
      profile_json: profile,
      source: "openai",
      generated_at: new Date().toISOString(),
      version: 1,
    },
    { onConflict: "normalized_name" },
  );
  if (upsertError) {
    // Cache write failing shouldn't block returning a good profile to
    // the user — just means the next request pays for another call.
    console.error("species_profiles upsert failed:", upsertError.message);
  }

  return jsonResponse({ profile, cached: false });
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function isFresh(generatedAt: string): boolean {
  const ageMs = Date.now() - new Date(generatedAt).getTime();
  return ageMs < CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
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
