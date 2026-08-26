// Oasis Care — Phase 12 §12H "AI QUOTAS." Returns the caller's current
// usage count and configured limit for one AI feature this month, so
// the client can show an 80%-warning before actually calling the
// feature. The actual increment happens inside each AI Edge Function
// itself at call time (see e.g. identify-plant/index.ts's own
// checkAndIncrementUsage), never here — this endpoint only reads.
//
// NOT VERIFIED by CI — same caveat as every Edge Function in this app.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "ai-usage-status" → paste this file's contents →
// Deploy.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface StatusRequestBody {
  feature?: string;
}

// Mirrors PlanConfigurationStore.swift's aiRequestsPerMonth per plan —
// kept here too since this endpoint answers without needing to call
// back into Swift-only config; see recommend-medium/apple-subscription-*
// for the same "small static mirror, not a fourth source of truth"
// reasoning applied to entitlement sets.
const AI_REQUESTS_PER_MONTH: Record<string, number> = {
  free: 10,
  premium: 200,
  biolab: 400,
};

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Authentification requise." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const callerClient = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "Session invalide." }, 401);

  let body: StatusRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }
  const feature = body.feature;
  if (!feature) return jsonResponse({ error: "feature manquant." }, 400);

  const { data: entitlementRow } = await callerClient
    .from("subscription_entitlements")
    .select("plan")
    .eq("user_id", userData.user.id)
    .limit(1)
    .maybeSingle();
  const plan = entitlementRow?.plan ?? "free";
  const limit = AI_REQUESTS_PER_MONTH[plan] ?? AI_REQUESTS_PER_MONTH.free;

  const period = currentPeriod();
  const { data: counterRow } = await callerClient
    .from("usage_counters")
    .select("count")
    .eq("user_id", userData.user.id)
    .eq("feature", feature)
    .eq("period", period)
    .maybeSingle();

  return jsonResponse({ feature, period, used: counterRow?.count ?? 0, limit });
});

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
