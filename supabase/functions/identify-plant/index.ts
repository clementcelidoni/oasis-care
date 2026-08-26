// Oasis Care — plant identification Edge Function.
//
// NOT verified by CI: this project's GitHub Actions pipeline only builds
// and tests the Swift app. This file has never been run. Deploy it and
// test it against a few real photos before trusting the Scanner flow —
// see the deployment note below.
//
// Calls Pl@ntNet's v2 identify API server-side so the Pl@ntNet API key
// never has to exist in the iOS app or in Git.
//
// Requires a real authenticated Supabase session — deliberately NOT
// available to guest/no-account users. Two reasons: this call costs
// real money against the app owner's Pl@ntNet quota (spec's "coûts IA"
// concern), and an unauthenticated endpoint would be a free-for-all for
// anyone who finds the URL. The client shows a "sign in to use this"
// prompt for guests rather than calling this function at all.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "identify-plant" → paste this file's contents →
// Deploy. Requires a PLANTNET_API_KEY secret (Edge Functions → Manage
// secrets → New secret). Get a key at https://my.plantnet.org — create
// a free account, then "My account" → API access / "Get an API key".
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already provisioned to
// every Edge Function automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PLANTNET_PROJECT = "all";
const MAX_IMAGES = 5;
const VALID_ORGANS = new Set(["auto", "leaf", "flower", "fruit", "bark"]);

interface IdentifyRequestBody {
  images?: string[]; // base64-encoded JPEG, no data-URI prefix
  organs?: string[]; // same length/order as images; defaults to "auto"
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

  const plantnetKey = Deno.env.get("PLANTNET_API_KEY");
  if (!plantnetKey) {
    return jsonResponse({ error: "Identification indisponible pour le moment (configuration manquante)." }, 500);
  }

  // Phase 12 §12H "QUOTAS IA — CRITIQUE POUR LA RENTABILITÉ." See
  // checkAndIncrementUsage's own doc comment for the shared pattern —
  // duplicated per Edge Function (no _shared/ folder in this project).
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const quota = await checkAndIncrementUsage(admin, userData.user.id, "plantIdentification");
  if (!quota.allowed) {
    return jsonResponse({ error: "Quota d'identifications atteint pour ce mois. Passez à une offre supérieure pour continuer." }, 429);
  }

  let body: IdentifyRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  if (!Array.isArray(body.images) || body.images.length === 0) {
    return jsonResponse({ error: "Aucune photo fournie." }, 400);
  }
  if (body.images.length > MAX_IMAGES) {
    return jsonResponse({ error: `Maximum ${MAX_IMAGES} photos par identification.` }, 400);
  }

  const form = new FormData();
  for (let index = 0; index < body.images.length; index++) {
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(body.images[index]);
    } catch {
      return jsonResponse({ error: "Photo invalide." }, 400);
    }
    form.append("images", new Blob([bytes], { type: "image/jpeg" }), `photo-${index}.jpg`);
    const organ = body.organs?.[index];
    form.append("organs", organ && VALID_ORGANS.has(organ) ? organ : "auto");
  }

  const url =
    `https://my-api.plantnet.org/v2/identify/${PLANTNET_PROJECT}` +
    `?api-key=${encodeURIComponent(plantnetKey)}&nb-results=3&lang=fr`;

  let plantnetResponse: Response;
  try {
    plantnetResponse = await fetch(url, { method: "POST", body: form });
  } catch {
    return jsonResponse({ error: "Service d'identification injoignable. Réessayez plus tard." }, 502);
  }

  if (!plantnetResponse.ok) {
    if (plantnetResponse.status === 401 || plantnetResponse.status === 403) {
      return jsonResponse({ error: "Identification indisponible pour le moment (configuration invalide)." }, 500);
    }
    if (plantnetResponse.status === 429) {
      return jsonResponse({ error: "Trop de demandes d'identification pour le moment. Réessayez plus tard." }, 429);
    }
    return jsonResponse({ error: "Le service d'identification n'a pas pu traiter ces photos." }, 502);
  }

  let payload: PlantNetResponse;
  try {
    payload = await plantnetResponse.json();
  } catch {
    return jsonResponse({ error: "Réponse invalide du service d'identification." }, 502);
  }

  const results = Array.isArray(payload.results)
    ? payload.results.slice(0, 3).map(toIdentificationResult)
    : [];

  return jsonResponse({ results });
});

interface PlantNetSpecies {
  scientificNameWithoutAuthor?: string;
  scientificName?: string;
  commonNames?: string[];
  genus?: { scientificNameWithoutAuthor?: string };
  family?: { scientificNameWithoutAuthor?: string };
}

interface PlantNetResult {
  score?: number;
  species?: PlantNetSpecies;
}

interface PlantNetResponse {
  results?: PlantNetResult[];
}

function toIdentificationResult(result: PlantNetResult) {
  const species = result.species ?? {};
  const scientificName = species.scientificNameWithoutAuthor ?? species.scientificName ?? "Espèce inconnue";
  const genus = species.genus?.scientificNameWithoutAuthor ?? null;
  // Pl@ntNet doesn't return a bare species epithet field; derive it by
  // dropping the genus prefix from the binomial name (best-effort, only
  // used for display).
  const epithet = genus && scientificName.startsWith(genus)
    ? scientificName.slice(genus.length).trim() || null
    : null;

  return {
    scientificName,
    commonNames: Array.isArray(species.commonNames) ? species.commonNames : [],
    family: species.family?.scientificNameWithoutAuthor ?? null,
    genus,
    species: epithet,
    score: typeof result.score === "number" ? result.score : 0,
    provider: "plantnet",
  };
}

// Phase 12 §12H — mirrors PlanConfigurationStore.swift's
// aiRequestsPerMonth per plan; see ai-usage-status/index.ts's own
// comment on why this small static list is duplicated rather than
// treated as a fourth source of truth to keep in sync via a table.
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
