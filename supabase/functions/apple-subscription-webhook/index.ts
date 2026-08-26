// Oasis Care — Phase 12 §12D "BACKEND APP STORE." Receives Apple's App
// Store Server Notifications V2 (a signed JWS POST body Apple sends
// directly, no user Authorization header — this endpoint is public but
// only trusts a request whose signature verifies against Apple's own
// certificate chain).
//
// ============================================================
// NOT VERIFIED — HIGHEST-RISK FILE IN THIS PHASE.
// ============================================================
// Unlike every other Edge Function in this app, this one was never run
// or tested against a single real signed payload (no Apple sandbox
// notification can reach an endpoint that isn't yet deployed and
// registered in App Store Connect). The JWS/X.509 verification below
// was written from Apple's documented format as precisely as possible,
// but a cryptographic verification routine that has never actually
// verified a real signature is a real risk, not a formality:
//   - too strict → legitimate renewals/refunds silently never update
//     entitlements (an availability bug, annoying but not dangerous).
//   - too permissive → a forged notification could grant an
//     entitlement it shouldn't (a real security bug).
// Before this gates real money, it MUST be tested against real
// signed notifications from App Store Connect's Sandbox (§12V "tests
// Sandbox"), and reviewing this file's crypto specifically is strongly
// recommended. Chain validation uses @peculiar/x509, a real X.509
// library (this is not a hand-rolled ASN.1 parser), but its exact
// import resolution under Deno has not been exercised either.
//
// Critically, this webhook is NOT the only gate: StoreKit 2's own
// on-device verification (Transaction.currentEntitlements, verified by
// Apple's own framework code, not this file) is what actually decides
// what a user can access on their own device — see StoreKitService's
// doc comment. This webhook only keeps the BACKEND's own record in
// sync for cross-device awareness and for reacting to server-pushed
// events (refunds, revocations) — a bug here degrades sync, it does
// not by itself hand out client-side access.
//
// Deploy via the Supabase dashboard: Edge Functions → Create a new
// function named "apple-subscription-webhook" → paste this file's
// contents → Deploy. Then register the resulting URL as the
// "Production Server URL" (and "Sandbox Server URL") in App Store
// Connect → your app → App Information → App Store Server
// Notifications. Requires SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// (auto-provisioned) — no additional secret needed, verification uses
// only the certificates Apple embeds in each notification plus the
// hardcoded Apple root below.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { compactVerify, importX509 } from "https://esm.sh/jose@5";
import * as x509 from "https://esm.sh/@peculiar/x509@1.12.1";

// Apple's own publicly published root certificate ("Apple Root CA - G3"),
// PEM-encoded — a public trust anchor, not a secret. Hardcoded because
// the verifier must trust SOMETHING outside of what the message itself
// provides — trusting a root shipped inside the message being verified
// would defeat the purpose entirely.
//
// VERIFIED 2026-08-26 against the authoritative source: downloaded from
// https://www.apple.com/certificateauthority/AppleRootCA-G3.cer (DER,
// 583 bytes), converted with openssl, and diffed byte-for-byte against
// the value below — identical.
//   subject/issuer: CN=Apple Root CA - G3, OU=Apple Certification
//                   Authority, O=Apple Inc., C=US   (self-signed root)
//   validity:       2014-04-30 → 2039-04-30
//   SHA-256:        63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:
//                   7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79
//
// If this value is ever edited, re-check that fingerprint. A wrong
// certificate here fails SAFE (every verification is rejected, so
// notifications are simply never processed) rather than dangerously —
// but "silently never processed" is its own painful bug to chase, so
// still confirm a real Sandbox notification verifies (§12V).
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

interface AppleServerNotificationBody {
  signedPayload?: string;
}

interface DecodedNotificationPayload {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  data?: {
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
}

interface DecodedTransactionInfo {
  transactionId?: string;
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  purchaseDate?: number;
  expiresDate?: number;
  environment?: string;
  revocationDate?: number;
}

const EXPECTED_BUNDLE_ID = "com.oasisrarecare.app";

Deno.serve(async (req: Request) => {
  let body: AppleServerNotificationBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  if (!body.signedPayload) {
    return jsonResponse({ error: "signedPayload manquant." }, 400);
  }

  let payload: DecodedNotificationPayload;
  try {
    payload = await verifyAndDecodeJWS<DecodedNotificationPayload>(body.signedPayload);
  } catch (error) {
    console.error("Notification signature verification failed", error);
    return jsonResponse({ error: "Signature invalide." }, 401);
  }

  if (payload.data?.bundleId && payload.data.bundleId !== EXPECTED_BUNDLE_ID) {
    return jsonResponse({ error: "bundleId inattendu." }, 400);
  }

  let transactionInfo: DecodedTransactionInfo | null = null;
  if (payload.data?.signedTransactionInfo) {
    try {
      transactionInfo = await verifyAndDecodeJWS<DecodedTransactionInfo>(payload.data.signedTransactionInfo);
    } catch (error) {
      console.error("Transaction info signature verification failed", error);
      return jsonResponse({ error: "Signature de transaction invalide." }, 401);
    }
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // §"Idempotence — une notification Apple reçue plusieurs fois ne doit
  // pas créer plusieurs événements ou droits": the unique constraint on
  // (transaction_id, event_type) makes this insert a no-op on replay.
  const { error: eventError } = await admin.from("subscription_events").upsert(
    {
      event_type: payload.notificationType ?? "UNKNOWN",
      product_id: transactionInfo?.productId ?? null,
      original_transaction_id: transactionInfo?.originalTransactionId ?? null,
      transaction_id: transactionInfo?.transactionId ?? null,
      environment: payload.data?.environment ?? transactionInfo?.environment ?? "Unknown",
      occurred_at: new Date().toISOString(),
    },
    { onConflict: "transaction_id,event_type", ignoreDuplicates: true },
  );
  if (eventError) {
    console.error("Failed to record subscription event", eventError);
  }

  if (transactionInfo?.originalTransactionId) {
    await reconcileEntitlements(admin, transactionInfo, payload.notificationType);
  }

  return jsonResponse({ received: true });
});

/// Shared with apple-subscription-sync's own copy of this same logic —
/// looks up which user this originalTransactionId belongs to (only
/// known once the client has linked it via apple-subscription-sync
/// after a purchase on that same account) and updates their
/// entitlements to match what this transaction currently says. If no
/// customer row is linked yet (a webhook can arrive before the client
/// ever calls sync, e.g. a renewal while the app isn't running),
/// there's nothing to do here — nothing is invented for an unknown user.
async function reconcileEntitlements(
  // deno-lint-ignore no-explicit-any
  admin: any,
  transactionInfo: DecodedTransactionInfo,
  notificationType?: string,
) {
  const { data: customer } = await admin
    .from("subscription_customers")
    .select("user_id, workspace_id")
    .eq("apple_original_transaction_id", transactionInfo.originalTransactionId)
    .maybeSingle();
  if (!customer) return;

  const isRevoked = notificationType === "REVOKE" || notificationType === "REFUND";
  const isExpired = notificationType === "EXPIRED" || (transactionInfo.expiresDate ?? 0) < Date.now();

  let plan = "free";
  if (transactionInfo.productId && !isRevoked) {
    const { data: product } = await admin
      .from("subscription_products")
      .select("plan")
      .eq("product_id", transactionInfo.productId)
      .maybeSingle();
    if (product) plan = product.plan;
  }

  const status = isRevoked ? "revoked" : isExpired ? "expired" : "subscribed";
  const entitlements = plan === "free" ? [] : await entitlementsForPlan(admin, plan);

  // Clear this user's previous rows for entitlements no longer granted,
  // then upsert the current set — simplest way to guarantee no stale
  // entitlement lingers after a downgrade/cancellation.
  await admin.from("subscription_entitlements").delete().eq("user_id", customer.user_id);
  if (entitlements.length > 0) {
    const rows = entitlements.map((entitlement: string) => ({
      user_id: customer.user_id,
      workspace_id: customer.workspace_id,
      plan,
      entitlement,
      source: "server",
      status,
      expires_at: transactionInfo.expiresDate ? new Date(transactionInfo.expiresDate).toISOString() : null,
      updated_at: new Date().toISOString(),
    }));
    await admin.from("subscription_entitlements").upsert(rows, { onConflict: "user_id,entitlement" });
  }
}

// deno-lint-ignore no-explicit-any
async function entitlementsForPlan(admin: any, plan: string): Promise<string[]> {
  // Mirrors PlanConfigurationStore.swift's entitlement sets — kept as a
  // literal table here rather than a second Supabase table, since this
  // mapping only needs to exist server-side for this one reconciliation
  // step and duplicating a small static list is simpler than keeping a
  // third source of truth in sync.
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

/// Verifies a compact JWS against the certificate chain embedded in its
/// own header (`x5c`), then returns the decoded JSON payload. Trust
/// path: leaf certificate (x5c[0]) verifies the JWS signature; each
/// certificate in the chain must be signed by the next one; the last
/// certificate in the chain must chain up to (or match) the hardcoded
/// Apple root above. See this file's own top-of-file warning — this
/// exact routine has not been exercised against a real Apple signature.
async function verifyAndDecodeJWS<T>(jws: string): Promise<T> {
  const headerB64 = jws.split(".")[0];
  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
  const chain: string[] | undefined = header.x5c;
  if (!chain || chain.length === 0) {
    throw new Error("No x5c certificate chain in JWS header.");
  }

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
    if (!isValid) {
      throw new Error(`Certificate at chain position ${i} was not signed by the next certificate in the chain.`);
    }
  }

  // The chain's own last link must itself be verifiable against the
  // hardcoded root (covers the common case where Apple's chain already
  // omits the root itself and ends at the intermediate).
  const lastCert = certs[certs.length - 1];
  const rootVerified = await lastCert.verify({ publicKey: root.publicKey, signatureOnly: true });
  if (!rootVerified) {
    throw new Error("Certificate chain does not terminate at the trusted Apple root.");
  }
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
