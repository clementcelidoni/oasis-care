// Oasis Care — irrigation design proposal Edge Function (Phase 6D).
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// try a few real zones before relying on it.
//
// Spec Phase 6D: "l'utilisateur sélectionne une zone. Oasis AI reçoit
// forme/dimensions/type/végétation/débit disponible si connu. Il peut
// PROPOSER nombre d'asperseurs, positions, rayons, types, zones.
// L'utilisateur doit confirmer. Ne jamais prétendre qu'un plan généré
// constitue une étude hydraulique professionnelle certifiée." This
// function only ever returns a structured suggestion — it never touches
// garden_map_objects itself. The Swift side (IrrigationAIService) only
// creates real GardenMapObject sprinklers from a proposal when the user
// explicitly taps "Créer" on the reviewed proposal.
//
// Sprinkler positions/angles are in the same garden-local meter frame as
// the zone points sent in the request (GardenCoordinate's own axis
// convention: 0°=east, increasing counter-clockwise) — the client places
// them directly with no coordinate transform, so a mismatch here would
// put sprinklers in the wrong place with no client-side check to catch it.
//
// Requires a real authenticated Supabase session (guests see a sign-in
// prompt client-side instead of reaching this function) — this call
// costs real money against the app owner's OpenAI usage.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "propose-irrigation" → paste this file's contents →
// Deploy. Requires an OPENAI_API_KEY secret (same one used by the other
// AI functions — Edge Functions → Manage secrets).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 30_000;
const MAX_SPRINKLERS = 12;

function obj(properties: Record<string, unknown>) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const sprinklerSchema = obj({
  xMeters: { type: "number" },
  yMeters: { type: "number" },
  radiusMeters: { type: "number" },
  startAngleDegrees: { type: "number" },
  endAngleDegrees: { type: "number" },
  kind: { type: "string" },
});

const proposalSchema = obj({
  canPropose: { type: "boolean" },
  explanation: { type: "string" },
  sprinklers: { type: "array", items: sprinklerSchema },
  summary: { type: "string" },
});

const SYSTEM_PROMPT =
  "Tu es Oasis AI, l'assistant de conception d'arrosage d'Oasis Care. L'utilisateur te donne la forme, " +
  "les dimensions, le type et la végétation d'une zone de son jardin, et éventuellement le débit d'eau " +
  "disponible. Règles impératives : " +
  "1) Toutes les positions (xMeters, yMeters) que tu proposes doivent être des coordonnées ABSOLUES " +
  "dans le même repère que les points de la zone fournis dans le contexte — pas des coordonnées " +
  `relatives à 0,0. Place chaque asperseur STRICTEMENT à l'intérieur du polygone de la zone. ` +
  `2) Ne propose jamais plus de ${MAX_SPRINKLERS} asperseurs. Le nombre doit être raisonnable pour la ` +
  "surface donnée — ne sur-équipe pas une petite zone. " +
  "3) radiusMeters doit être cohérent avec le débit disponible si connu (un débit faible ne justifie pas " +
  "plusieurs asperseurs à grand rayon) ; si le débit n'est pas connu, choisis des rayons usuels et " +
  "dis-le dans explanation. " +
  "4) startAngleDegrees/endAngleDegrees définissent le secteur arrosé (0° = est, sens antihoraire, " +
  "comme un cercle trigonométrique standard) ; mets 0 et 360 pour un asperseur circulaire complet, ou " +
  "un secteur plus étroit pour un asperseur en bordure de zone qui ne doit pas arroser au-delà. " +
  "5) kind est une description courte en français (\"asperseur rotatif\", \"asperseur fixe\"...), " +
  "informative seulement — n'invente pas une caractéristique technique non déductible des informations " +
  "fournies. " +
  "6) Si la zone est trop petite, mal formée, ou si les informations sont insuffisantes pour une " +
  "proposition sensée, mets canPropose à false et explique pourquoi dans explanation plutôt que de " +
  "forcer une proposition arbitraire. " +
  "7) summary doit être une phrase unique en français résumant la proposition (nombre d'asperseurs, " +
  "couverture visée) — c'est ce que l'utilisateur lit pour décider de créer ou non ces asperseurs. " +
  "8) Ceci n'est PAS une étude hydraulique professionnelle certifiée et ne doit jamais être présenté " +
  "comme telle — reste dans explanation et summary sur un ton de suggestion à vérifier, jamais de " +
  "garantie technique.";

interface ZonePointDTO {
  xMeters: number;
  yMeters: number;
}
interface IrrigationProposalContextDTO {
  zoneTypeLabel?: string;
  points?: ZonePointDTO[];
  widthMeters?: number;
  heightMeters?: number;
  areaSquareMeters?: number;
  vegetationSummary?: string | null;
  availableFlowRateLitersPerHour?: number | null;
}
interface ProposeRequestBody {
  context?: IrrigationProposalContextDTO;
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

  let body: ProposeRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  if (!body.context?.points || body.context.points.length < 3) {
    return jsonResponse({ error: "La zone doit avoir au moins 3 points pour concevoir un arrosage." }, 400);
  }

  const prompt = formatContext(body.context);

  try {
    const proposal = await callOpenAIStructured(
      openaiKey,
      [
        { role: "developer", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
        { role: "user", content: [{ type: "input_text", text: prompt }] },
      ],
      "irrigation_proposal",
      proposalSchema,
    );
    return jsonResponse(proposal);
  } catch (error) {
    if (error instanceof OpenAIError) {
      return jsonResponse({ error: "L'assistant IA n'a pas pu proposer d'arrosage. Réessayez plus tard." }, 502);
    }
    return jsonResponse({ error: "Erreur inattendue." }, 500);
  }
});

function formatContext(context: IrrigationProposalContextDTO): string {
  const lines: string[] = [];
  lines.push(`Type de zone : ${context.zoneTypeLabel ?? "inconnu"}`);
  lines.push(`Dimensions approximatives : ${context.widthMeters?.toFixed(1) ?? "?"} m × ${context.heightMeters?.toFixed(1) ?? "?"} m`);
  lines.push(`Surface : ${context.areaSquareMeters?.toFixed(1) ?? "?"} m²`);
  lines.push(`Végétation dans la zone : ${context.vegetationSummary ?? "aucune information"}`);
  lines.push(
    context.availableFlowRateLitersPerHour
      ? `Débit d'eau disponible : ${context.availableFlowRateLitersPerHour} L/h`
      : "Débit d'eau disponible : non renseigné",
  );
  const pointsList = (context.points ?? []).map((p) => `(${p.xMeters.toFixed(2)}, ${p.yMeters.toFixed(2)})`).join(", ");
  lines.push(`Points du polygone de la zone (mètres, repère du jardin) : ${pointsList}`);
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
