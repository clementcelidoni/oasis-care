import Foundation
import StoreKit

/// Phase 12 §"Architecture commerciale" — best-effort push of a
/// verified StoreKit transaction to the backend (apple-subscription-sync)
/// right after a purchase/restore, so other devices and the backend's
/// own record aren't stuck waiting for Apple's server-to-server webhook
/// to eventually arrive. Never required for the purchasing device
/// itself to work — StoreKitService already updated EntitlementService
/// directly from the verified on-device transaction before this is even
/// called; this is purely a best-effort sync, and its failure is
/// silently tolerated (logged, not surfaced as a purchase error) since
/// the purchase itself already succeeded.
enum SubscriptionSyncService {
    struct Response: Decodable {
        var plan: String
        var entitlements: [String]
    }

    static func sync(_ verification: VerificationResult<Transaction>) async {
        guard case .authenticated = AuthState.shared.status else { return }
        struct RequestBody: Encodable {
            var signedTransaction: String
        }
        do {
            let _: Response = try await AIBackend.invoke(
                "apple-subscription-sync", body: RequestBody(signedTransaction: verification.jwsRepresentation)
            )
        } catch {
            // Best-effort — the client's own StoreKit-derived entitlement
            // already applies regardless of whether this reaches the
            // backend; a later app launch or Apple's own webhook will
            // eventually reconcile it.
        }
    }
}
