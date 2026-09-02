// Oasis Care Pro — assistant métier (Phase 11, §11U OASIS PRO AI).
//
// NON VÉRIFIÉE PAR LA CI : le pipeline GitHub Actions de ce projet ne
// construit que l'app Swift. Ce fichier n'a jamais été exécuté ici.
// Déployez-le et posez-lui deux vraies questions avant de compter
// dessus.
//
// C'EST POUR ÇA QU'IL NE CONTIENT PRESQUE RIEN.
//
// §11U demande un registre d'outils. Les onze outils ne sont pas ici :
// ce sont des fonctions Postgres (migration 0058), testées par
// `supabase/tests/analytics_ai_tools.sql`. Cette fonction-ci est un
// AIGUILLEUR — elle reçoit un nom d'outil, appelle la fonction
// correspondante, et rend le résultat au modèle.
//
// Deux conséquences, et les deux comptent :
//
//   • le calcul métier vit là où il peut être testé, pas ici ;
//   • chaque outil s'exécute AVEC LE JETON DE L'UTILISATEUR, donc sous
//     la RLS. L'assistant ne voit jamais plus que la personne qui lui
//     parle. Ce n'est pas une promesse du prompt — c'est Postgres qui
//     refuse.
//
// §SÉCURITÉ IA — « L'IA peut : read, analyze, suggest, draft. Par
// défaut elle ne peut PAS : send quote, issue invoice, pay, purchase,
// delete, transfer money, sign — sans confirmation explicite. »
//
// La traduction retenue est une ABSENCE : aucun outil du registre
// n'envoie, n'émet, ne paie, n'achète, ne supprime, ne vire ni ne
// signe. Un modèle ne peut pas appeler ce qui n'existe pas, et aucune
// tournure de phrase ne fabrique un outil manquant. Le seul outil qui
// écrit crée un BROUILLON, ce que la spec autorise nommément, et laisse
// une trace dans le journal d'audit.
//
// Déploiement : Supabase → Edge Functions → nouvelle fonction
// « oasis-pro-ai » → coller ce fichier → Deploy. Nécessite le secret
// OPENAI_API_KEY (le même que les autres fonctions IA).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-5.6";
const OPENAI_TIMEOUT_MS = 60_000;
const MAX_QUESTION_LENGTH = 2000;
// Combien d'allers-retours d'outils avant de rendre la main. Un modèle
// qui boucle sur `findStock` coûte de l'argent à chaque tour ; six
// suffisent largement à croiser devis, stock et commandes.
const MAX_TOOL_ROUNDS = 6;
// Garde-fou de coût par organisation et par mois. Pas une offre
// commerciale : Oasis Care Pro n'a pas encore de tarification.
const AI_REQUESTS_PER_MONTH = 500;

const SYSTEM_PROMPT = [
  "Tu es Oasis AI, l'assistant intégré à Oasis Care Pro, le logiciel de gestion des paysagistes et",
  "pépiniéristes. Tu réponds en français, brièvement, et tu dis QUOI FAIRE plutôt que ce qui existe.",
  "",
  "TU NE CALCULES RIEN TOI-MÊME. Les outils rendent des chiffres déjà justes, calculés en base de",
  "données. Ne refais pas leurs additions, ne convertis pas leurs montants : ils sont en CENTIMES,",
  "divise par 100 pour les afficher en euros et n'invente aucun total qu'un outil n'a pas rendu.",
  "",
  "Si un outil rend une liste vide, dis qu'il n'y a rien — n'extrapole pas. Si une question demande",
  "une information qu'aucun outil ne fournit, dis-le franchement plutôt que de deviner.",
  "",
  "TU NE PEUX PAS envoyer un devis, émettre une facture, encaisser, commander, supprimer, virer de",
  "l'argent ni signer. Ces gestes n'ont pas d'outil et tu ne dois jamais laisser croire que tu les as",
  "faits. Tu peux préparer un BROUILLON de devis : dis alors clairement qu'il reste à relire et à",
  "envoyer par une personne.",
].join("\n");

// ------------------------------------------------------------
// Le registre — §11U TOOL REGISTRY
// ------------------------------------------------------------
// Chaque entrée dit quelle fonction Postgres appeler et quels
// arguments lui passer. `needsOrg` injecte l'organisation active côté
// serveur plutôt que de la laisser au modèle : une organisation choisie
// par le modèle serait une organisation choisie par la question.
interface ToolDefinition {
  rpc: string;
  needsOrg: boolean;
  description: string;
  parameters: Record<string, unknown>;
}

const TOOLS: Record<string, ToolDefinition> = {
  getClientContext: {
    rpc: "ai_get_client_context",
    needsOrg: false,
    description:
      "Fiche complète d'un client : coordonnées, propriétés, devis, chantiers, factures impayées, derniers échanges.",
    parameters: {
      type: "object",
      properties: { p_customer_id: { type: "string", description: "Identifiant du client (UUID)." } },
      required: ["p_customer_id"],
      additionalProperties: false,
    },
  },
  getProjectContext: {
    rpc: "ai_get_project_context",
    needsOrg: false,
    description: "État d'un chantier : phases, avancement, budget vendu, coûts engagés, heures pointées.",
    parameters: {
      type: "object",
      properties: { p_project_id: { type: "string", description: "Identifiant du chantier (UUID)." } },
      required: ["p_project_id"],
      additionalProperties: false,
    },
  },
  getDigitalTwinQuantities: {
    rpc: "ai_get_digital_twin_quantities",
    needsOrg: false,
    description:
      "Quantités mesurées sur le plan d'un jardin : surfaces des zones, végétaux, équipements, mètres d'irrigation et de câble.",
    parameters: {
      type: "object",
      properties: { p_garden_id: { type: "string", description: "Identifiant du jardin (UUID)." } },
      required: ["p_garden_id"],
      additionalProperties: false,
    },
  },
  analyzeProjectMargin: {
    rpc: "ai_analyze_project_margin",
    needsOrg: true,
    description:
      "Tous les chantiers avec vendu, coût prévu, coût réel et dépassement. Sert à répondre à « quels chantiers ont dépassé leur budget ».",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  summarizeProject: {
    rpc: "ai_summarize_project",
    needsOrg: false,
    description: "Résumé d'un chantier sous forme de faits courts, prêts à reprendre.",
    parameters: {
      type: "object",
      properties: { p_project_id: { type: "string" } },
      required: ["p_project_id"],
      additionalProperties: false,
    },
  },
  findStock: {
    rpc: "ai_find_stock",
    needsOrg: true,
    description: "Stock de pépinière par espèce : physique, disponible, réservé, en production, attendu.",
    parameters: {
      type: "object",
      properties: { p_query: { type: "string", description: "Nom d'espèce, ou vide pour tout le stock." } },
      additionalProperties: false,
    },
  },
  forecastAvailability: {
    rpc: "ai_forecast_availability",
    needsOrg: true,
    description: "Ce qui sera disponible plus tard : lots encore en production et commandes fournisseurs attendues.",
    parameters: {
      type: "object",
      properties: { p_query: { type: "string" } },
      additionalProperties: false,
    },
  },
  suggestPurchaseNeeds: {
    rpc: "ai_suggest_purchase_needs",
    needsOrg: true,
    description:
      "Ce qu'il reste à commander pour les chantiers signés et non terminés : besoin, stock disponible, déjà commandé, manquant.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  getDailyPriorities: {
    rpc: "ai_get_daily_priorities",
    needsOrg: true,
    description:
      "Oasis Daily : interventions du jour, devis à relancer ou qui expirent, factures en retard, chantiers en retard, pointages à valider, réceptions attendues.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  analyzeNurseryLosses: {
    rpc: "ai_analyze_nursery_losses",
    needsOrg: true,
    description: "Pertes de pépinière par espèce sur une période, avec les motifs et les inspections défavorables.",
    parameters: {
      type: "object",
      properties: {
        p_from: { type: "string", description: "Date de début, AAAA-MM-JJ." },
        p_to: { type: "string", description: "Date de fin, AAAA-MM-JJ." },
      },
      additionalProperties: false,
    },
  },
  createQuoteDraft: {
    rpc: "ai_create_quote_draft",
    needsOrg: true,
    description:
      "Crée un BROUILLON de devis. Ne l'envoie pas et ne l'émet pas. Montants en centimes. À utiliser seulement si l'utilisateur demande explicitement de préparer un devis.",
    parameters: {
      type: "object",
      properties: {
        p_customer_id: { type: "string" },
        p_title: { type: "string" },
        p_lines: {
          type: "array",
          description: "Lignes du devis.",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              unit: { type: "string" },
              quantity: { type: "number" },
              unit_sale_price_cents: { type: "integer" },
              unit_cost_cents: { type: "integer" },
              vat_rate: { type: "number" },
              cost_kind: { type: "string" },
            },
            required: ["description", "quantity", "unit_sale_price_cents"],
            additionalProperties: false,
          },
        },
      },
      required: ["p_customer_id", "p_title", "p_lines"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Authentification requise." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // LE CLIENT DE L'APPELANT. Toutes les fonctions d'outil passent par
  // lui : elles s'exécutent donc sous les droits de l'utilisateur, avec
  // sa RLS. La clé de service ne sert qu'à construire ce client-là,
  // jamais à contourner une politique.
  const callerClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Session invalide." }, 401);
  }

  let body: { organizationId?: string; question?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  const organizationId = (body.organizationId ?? "").trim();
  const question = (body.question ?? "").trim();
  if (!organizationId) return jsonResponse({ error: "Organisation manquante." }, 400);
  if (question.length === 0) return jsonResponse({ error: "Question manquante." }, 400);
  if (question.length > MAX_QUESTION_LENGTH) return jsonResponse({ error: "Question trop longue." }, 400);

  // §SECURITY « rate limiting IA ». La fonction vérifie elle-même
  // l'appartenance à l'organisation : un identifiant inventé dans le
  // corps de la requête lève ici, pas plus loin.
  const { data: quotaRows, error: quotaError } = await callerClient.rpc("consume_pro_ai_quota", {
    p_organization_id: organizationId,
    p_limit: AI_REQUESTS_PER_MONTH,
  });
  if (quotaError) {
    return jsonResponse({ error: "Organisation inaccessible." }, 403);
  }
  const quota = Array.isArray(quotaRows) ? quotaRows[0] : quotaRows;
  if (quota && quota.allowed === false) {
    return jsonResponse({
      error: `Plafond mensuel d'assistant atteint (${AI_REQUESTS_PER_MONTH} questions). Il se remet à zéro le 1er du mois.`,
    }, 429);
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return jsonResponse({ error: "Assistant indisponible pour le moment (configuration manquante)." }, 500);
  }

  // deno-lint-ignore no-explicit-any
  const input: any[] = [
    { role: "developer", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
    { role: "user", content: [{ type: "input_text", text: question }] },
  ];

  const toolsUsed: string[] = [];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const payload = await callOpenAI(openaiKey, input);

      const calls = (payload.output ?? []).filter(
        // deno-lint-ignore no-explicit-any
        (item: any) => item.type === "function_call",
      );

      if (calls.length === 0) {
        return jsonResponse({
          answer: extractText(payload),
          toolsUsed,
          quotaRemaining: quota?.remaining ?? null,
          model: OPENAI_MODEL,
        });
      }

      // On rejoue les appels dans l'entrée du tour suivant, comme le
      // demande l'API Responses.
      for (const call of calls) input.push(call);

      for (const call of calls) {
        const result = await runTool(callerClient, organizationId, call.name, call.arguments);
        if (result.ok) toolsUsed.push(call.name);
        input.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result.value),
        });
      }
    }

    // Le modèle a épuisé ses tours sans conclure. Mieux vaut le dire
    // que rendre une réponse construite sur un raisonnement interrompu.
    return jsonResponse({
      error: "L'assistant n'a pas réussi à conclure. Reformulez la question plus précisément.",
    }, 502);
  } catch (error) {
    if (error instanceof OpenAIError) {
      console.error("openai", error.message);
      return jsonResponse({ error: "L'assistant n'a pas pu répondre. Réessayez plus tard." }, 502);
    }
    console.error("unexpected", error);
    return jsonResponse({ error: "Erreur inattendue." }, 500);
  }
});

/**
 * Exécute un outil du registre.
 *
 * Une erreur d'outil N'INTERROMPT PAS la conversation : elle est rendue
 * au modèle comme un résultat. Un chantier introuvable, un droit
 * manquant — ce sont des réponses, et le modèle doit pouvoir les
 * expliquer plutôt que voir la page se briser.
 */
async function runTool(
  // deno-lint-ignore no-explicit-any
  client: any,
  organizationId: string,
  name: string,
  rawArguments: string,
): Promise<{ ok: boolean; value: unknown }> {
  const tool = TOOLS[name];
  if (!tool) {
    // Le modèle a inventé un outil. C'est précisément le cas que
    // §SÉCURITÉ IA vise : il n'existe pas, donc il ne se produit rien.
    return { ok: false, value: { erreur: `Outil inconnu : ${name}.` } };
  }

  let args: Record<string, unknown>;
  try {
    args = rawArguments ? JSON.parse(rawArguments) : {};
  } catch {
    return { ok: false, value: { erreur: "Arguments illisibles." } };
  }

  // L'organisation vient du serveur, jamais du modèle.
  if (tool.needsOrg) args.p_organization_id = organizationId;

  const { data, error } = await client.rpc(tool.rpc, args);
  if (error) {
    return { ok: false, value: { erreur: error.message } };
  }
  return { ok: true, value: data };
}

class OpenAIError extends Error {}

// deno-lint-ignore no-explicit-any
async function callOpenAI(apiKey: string, input: any[]): Promise<any> {
  const tools = Object.entries(TOOLS).map(([name, tool]) => ({
    type: "function",
    name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: OPENAI_MODEL, input, tools }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
  } catch (error) {
    throw new OpenAIError(`OpenAI injoignable : ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OpenAIError(`OpenAI HTTP ${response.status} : ${detail.slice(0, 500)}`);
  }

  const payload = await response.json();
  if (payload.status && payload.status !== "completed") {
    throw new OpenAIError(`Réponse OpenAI non terminée : ${payload.status}`);
  }
  return payload;
}

// deno-lint-ignore no-explicit-any
function extractText(payload: any): string {
  // deno-lint-ignore no-explicit-any
  const message = (payload.output ?? []).find((item: any) => item.type === "message");
  // deno-lint-ignore no-explicit-any
  const text = message?.content?.find((c: any) => c.type === "output_text");
  if (!text?.text) {
    // deno-lint-ignore no-explicit-any
    const refusal = message?.content?.find((c: any) => c.type === "refusal");
    throw new OpenAIError(refusal?.refusal ?? "Réponse vide.");
  }
  return text.text as string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
