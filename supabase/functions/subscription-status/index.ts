// Oasis Care — Phase 12 §12D. A convenience read: the same data is
// already directly readable by the client via RLS on
// subscription_entitlements/subscription_customers (§12E "un
// utilisateur peut lire son état d'abonnement nécessaire"), but this
// bundles it into one consolidated response for the "Mon abonnement"
// screen instead of several round trips, and is a natural place to add
// a live Apple App Store Server API cross-check later if ever needed —
// none is done today; this only reads what's already recorded.
//
// NOT VERIFIED by CI — same caveat as every Edge Function in this app.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "subscription-status" → paste this file's contents →
// Deploy.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Authentification requise." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const callerClient = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "Session invalide." }, 401);

  const { data: entitlementRows, error } = await callerClient
    .from("subscription_entitlements")
    .select("plan, entitlement, status, started_at, expires_at")
    .eq("user_id", userData.user.id);
  if (error) return jsonResponse({ error: "Impossible de lire l'abonnement." }, 500);

  if (!entitlementRows || entitlementRows.length === 0) {
    return jsonResponse({ plan: "free", status: "none", entitlements: [], expiresAt: null });
  }

  const first = entitlementRows[0];
  return jsonResponse({
    plan: first.plan,
    status: first.status,
    expiresAt: first.expires_at,
    entitlements: entitlementRows.map((row: { entitlement: string }) => row.entitlement),
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
