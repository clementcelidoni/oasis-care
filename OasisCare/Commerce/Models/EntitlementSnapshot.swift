import Foundation

/// Phase 12 §"12C — ENTITLEMENTS LOCAUX." "L'application doit
/// fonctionner même si Supabase est momentanément indisponible...
/// Utiliser les transactions StoreKit vérifiées localement... Un
/// abonné ne doit pas perdre brutalement Premium en mode avion."
///
/// Plain Codable + UserDefaults, not a SwiftData model: this isn't
/// user-generated data that needs cross-device merge — every device
/// independently re-derives it from its own on-device StoreKit
/// verification (Transaction.currentEntitlements, which Apple's own
/// framework cryptographically verifies) plus an opportunistic server
/// reconciliation. The snapshot is a fast local cache of that, refreshed
/// whenever the app can, never invented when it can't — see
/// EntitlementService's own doc comment for what "never invent" means
/// here in practice.
struct EntitlementSnapshot: Codable, Equatable {
    var plan: OasisPlan
    var activeEntitlements: Set<Entitlement>
    var expirationDate: Date?
    var subscriptionStatus: SubscriptionStatus
    var lastVerifiedAt: Date
    var source: EntitlementSource

    static let free = EntitlementSnapshot(
        plan: .free, activeEntitlements: [], expirationDate: nil,
        subscriptionStatus: .none, lastVerifiedAt: .now, source: .free
    )
}
