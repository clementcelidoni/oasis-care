// Oasis Care — BioLab bioreactor performance comparison Edge Function
// (spec Phase 7I "COMPARAISON").
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// test it against a couple of real bioreactor pairs before relying on it.
//
// Spec's own CRITIQUE for this feature, "PAS DE CAUSALITÉ INVENTÉE" — the
// AI must write "association / différence observée / hypothèse / à
// tester", never "X est forcément la cause de Y" without sufficient
// data. This is why the schema below has no "cause" field at all, only
// differences (plain observed facts) and hypotheses (always phrased as
// something to test).
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "compare-biolab-performance" → paste this file's
// contents → Deploy. Requires an OPENAI_API_KEY secret (same one used by
// the other AI functions — Edge Functions → Manage secrets).

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
function stringArray() {
  return { type: "array", items: { type: "string" } };
}

const comparisonSchema = obj({
  differences: stringArray(),
  hypotheses: stringArray(),
  confidence: { type: "string", enum: CONFIDENCE_LEVELS },
});

const SYSTEM_PROMPT =
  "Tu compares les performances de deux bioréacteurs de culture in vitro (immersion temporaire) à " +
  "partir de leur configuration actuelle (programme, température moyenne, recette utilisée par leur " +
  "lot actuel, taux de multiplication de ce lot). RÈGLE IMPÉRATIVE, sans exception : n'affirme JAMAIS " +
  "qu'un paramètre est la cause certaine d'une différence de performance. Tu dois structurer ta " +
  "réponse ainsi : " +
  "1) differences : liste des différences factuelles réellement observées entre les deux (« BR04 " +
  "fonctionne 2°C plus chaud que BR03 », « BR03 utilise la recette V2, BR04 la V3 »...). Reste " +
  "purement descriptif, jamais causal. " +
  "2) hypotheses : liste d'hypothèses PLAUSIBLES à tester expérimentalement pour expliquer un écart de " +
  "performance, toujours formulées comme une hypothèse et jamais comme un fait établi (« La " +
  "température plus élevée de BR04 pourrait contribuer à sa multiplication plus faible — à vérifier " +
  "en isolant ce paramètre », pas « BR04 multiplie moins bien à cause de la température »). N'invente " +
  "aucune hypothèse si les données ne montrent aucune différence notable — dis-le simplement. " +
  "3) confidence reflète honnêtement ta certitude réelle, et doit rester modérée à faible dès que " +
  "peu de paramètres sont fournis : deux bioréacteurs peuvent différer pour de nombreuses raisons non " +
  "mesurées ici (génétique du lot, manipulation, contamination non détectée...).";

interface ComparisonSubjectDTO {
  code?: string;
  bioreactorType?: string;
  immersionSummary?: string | null;
  aerationSummary?: string | null;
  averageTemperature?: number | null;
  currentBatchCode?: string | null;
  recipeVersion?: number | null;
  multiplicationRate?: number | null;
}
interface CompareRequestBody {
  subjectA?: ComparisonSubjectDTO;
  subjectB?: ComparisonSubjectDTO;
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

  if (!body.subjectA || !body.subjectB) {
    return jsonResponse({ error: "Deux bioréacteurs sont nécessaires pour une comparaison." }, 400);
  }

  const prompt =
    `Bioréacteur A :\n${formatSubject(body.subjectA)}\n\nBioréacteur B :\n${formatSubject(body.subjectB)}`;

  try {
    const comparison = await callOpenAIStructured(
      openaiKey,
      [
        { role: "developer", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user", content: [{ type: "input_text", text: prompt }] },
      ],
      "biolab_performance_comparison",
      comparisonSchema,
    );
    return jsonResponse({ ...comparison, provider: PROVIDER, model: OPENAI_MODEL });
  } catch (error) {
    if (error instanceof OpenAIError) {
      return jsonResponse({ error: "Le service IA n'a pas pu comparer ces bioréacteurs. Réessayez plus tard." }, 502);
    }
    return jsonResponse({ error: "Erreur inattendue." }, 500);
  }
});

function formatSubject(subject: ComparisonSubjectDTO): string {
  const lines: string[] = [`Code : ${subject.code ?? "?"}`, `Type : ${subject.bioreactorType ?? "inconnu"}`];
  if (subject.immersionSummary) lines.push(`Immersion : ${subject.immersionSummary}`);
  if (subject.aerationSummary) lines.push(`Aération : ${subject.aerationSummary}`);
  if (subject.averageTemperature != null) lines.push(`Température moyenne : ${subject.averageTemperature} °C`);
  if (subject.currentBatchCode) lines.push(`Lot actuel : ${subject.currentBatchCode}`);
  if (subject.recipeVersion != null) lines.push(`Recette : V${subject.recipeVersion}`);
  if (subject.multiplicationRate != null) lines.push(`Multiplication : x${subject.multiplicationRate.toFixed(1)}`);
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
