// Oasis Care — Phase 12 §12D "BACKEND APP STORE." Called by the client
// right after StoreKit confirms a purchase/restore (see
// SubscriptionSyncService.swift), passing the raw signed transaction
// string StoreKit itself already verified on-device
// (VerificationResult.jwsRepresentation). This function independently
// re-verifies that same JWS server-side (never trusts a client-supplied
// productId/plan directly — §"NE PAS faire confiance à un productId
// envoyé par l'iPhone... NE PAS donner un entitlement parce que le
// client dit premium = true"), then links this Apple customer to the
// signed-in Supabase account and updates their entitlements.
//
// This exists mainly for responsiveness and cross-device awareness: a
// user's OWN device already has its entitlement from StoreKit directly
// (see StoreKitService — that is the actual gate on that device).
// Without this sync call, a SECOND device wouldn't know about the
// purchase until Apple's server-to-server webhook eventually arrives
// (which can be delayed); calling this right after purchase makes the
// backend's record — and therefore other devices — current immediately.
//
// NOT VERIFIED — see apple-subscription-webhook/index.ts's own warning;
// the JWS/X.509 verification code below is identical in nature and
// carries the same caveat (never tested against a real signature, must
// be validated in Sandbox before relying on it).
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "apple-subscription-sync" → paste this file's contents
// → Deploy.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { compactVerify, importX509 } from "https://esm.sh/jose@5";
import * as x509 from "https://esm.sh/@peculiar/x509@1.12.1";

// See apple-subscription-webhook/index.ts for the same constant and its
// own "replace before relying on this" warning — keep both files' copies
// identical if you update one.
const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

interface SyncRequestBody {
  signedTransaction?: string;
}

interface DecodedTransactionInfo {
  transactionId?: string;
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  expiresDate?: number;
  environment?: string;
}

const EXPECTED_BUNDLE_ID = "com.oasisrarecare.app";

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Authentification requise." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const callerClient = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "Session invalide." }, 401);

  let body: SyncRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }
  if (!body.signedTransaction) return jsonResponse({ error: "signedTransaction manquant." }, 400);

  let transactionInfo: DecodedTransactionInfo;
  try {
    transactionInfo = await verifyAndDecodeJWS<DecodedTransactionInfo>(body.signedTransaction);
  } catch (error) {
    console.error("Transaction signature verification failed", error);
    return jsonResponse({ error: "Signature de transaction invalide." }, 401);
  }

  if (transactionInfo.bundleId && transactionInfo.bundleId !== EXPECTED_BUNDLE_ID) {
    return jsonResponse({ error: "bundleId inattendu." }, 400);
  }
  if (!transactionInfo.originalTransactionId) {
    return jsonResponse({ error: "Transaction incomplète." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: workspaceRows } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userData.user.id)
    .limit(1);
  const workspaceId = workspaceRows?.[0]?.workspace_id;
  if (!workspaceId) return jsonResponse({ error: "Aucun espace de travail trouvé pour ce compte." }, 400);

  // §"Liaison compte — lier l'achat au compte Supabase avec un
  // identifiant stable approprié. Ne pas utiliser l'email comme clé
  // principale de facturation" — originalTransactionId is Apple's own
  // stable per-subscription identifier, used here, never email.
  await admin.from("subscription_customers").upsert(
    {
      user_id: userData.user.id,
      workspace_id: workspaceId,
      apple_original_transaction_id: transactionInfo.originalTransactionId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  let plan = "free";
  if (transactionInfo.productId) {
    const { data: product } = await admin
      .from("subscription_products")
      .select("plan")
      .eq("product_id", transactionInfo.productId)
      .maybeSingle();
    if (product) plan = product.plan;
  }

  const entitlements = plan === "free" ? [] : entitlementsForPlan(plan);
  await admin.from("subscription_entitlements").delete().eq("user_id", userData.user.id);
  if (entitlements.length > 0) {
    const rows = entitlements.map((entitlement) => ({
      user_id: userData.user.id,
      workspace_id: workspaceId,
      plan,
      entitlement,
      source: "server",
      status: "subscribed",
      expires_at: transactionInfo.expiresDate ? new Date(transactionInfo.expiresDate).toISOString() : null,
      updated_at: new Date().toISOString(),
    }));
    await admin.from("subscription_entitlements").upsert(rows, { onConflict: "user_id,entitlement" });
  }

  return jsonResponse({ plan, entitlements });
});

function entitlementsForPlan(plan: string): string[] {
  const premium = [
    "plantManagement", "cloudSync", "aiIdentification", "aiAssistant", "aiDiagnosis", "dataExport",
    "unlimitedPlants", "multipleGardens", "advancedPhotos", "digitalTwin", "advancedMapLayers",
    "smartIrrigation", "sensorHistory", "connectedGarden", "matterHomeKit", "greenhouseAdvanced",
    "pondAdvanced", "advancedAnalytics", "qrNfc",
  ];
  const biolab = [...premium, "biolab", "bioreactors", "smartMedia", "biolabAI", "biolabAnalytics", "biolabExperiments"];
  if (plan === "biolab") return biolab;
  if (plan === "premium") return premium;
  return [];
}

async function verifyAndDecodeJWS<T>(jws: string): Promise<T> {
  const headerB64 = jws.split(".")[0];
  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
  const chain: string[] | undefined = header.x5c;
  if (!chain || chain.length === 0) throw new Error("No x5c certificate chain in JWS header.");

  await verifyCertificateChain(chain);

  const leafPem = derBase64ToPem(chain[0]);
  const leafKey = await importX509(leafPem, "ES256");
  const { payload } = await compactVerify(jws, leafKey);
  return JSON.parse(new TextDecoder().decode(payload)) as T;
}

async function verifyCertificateChain(chainDerBase64: string[]): Promise<void> {
  const certs = chainDerBase64.map((der) => new x509.X509Certificate(base64ToBytes(der)));
  const root = new x509.X509Certificate(pemToDer(APPLE_ROOT_CA_G3_PEM));

  for (let i = 0; i < certs.length; i++) {
    const issuer = i + 1 < certs.length ? certs[i + 1] : root;
    const isValid = await certs[i].verify({ publicKey: issuer.publicKey, signatureOnly: true });
    if (!isValid) throw new Error(`Certificate at chain position ${i} was not signed by the next certificate in the chain.`);
  }

  const lastCert = certs[certs.length - 1];
  const rootVerified = await lastCert.verify({ publicKey: root.publicKey, signatureOnly: true });
  if (!rootVerified) throw new Error("Certificate chain does not terminate at the trusted Apple root.");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return base64ToBytes(padded);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function derBase64ToPem(derBase64: string): string {
  const lines = derBase64.match(/.{1,64}/g) ?? [derBase64];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}

function pemToDer(pem: string): Uint8Array {
  const base64 = pem.replace(/-----BEGIN CERTIFICATE-----/, "").replace(/-----END CERTIFICATE-----/, "").replace(/\s+/g, "");
  return base64ToBytes(base64);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
