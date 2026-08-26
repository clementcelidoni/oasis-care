import Foundation

/// Phase 12 §"Statuts" — "Gérer proprement les états réellement
/// fournis/supportés par les APIs Apple... Ne pas inventer un statut
/// Apple." Mirrors StoreKit 2's own `Product.SubscriptionInfo.RenewalState`
/// exactly (`.subscribed`, `.expired`, `.inBillingRetryPeriod`,
/// `.inGracePeriod`, `.revoked`) plus `.none`, the one real state
/// StoreKit expresses by the ABSENCE of a subscription status entry
/// rather than a case of its own — not an invented addition.
enum SubscriptionStatus: String, Codable, CaseIterable, Identifiable {
    case none
    case subscribed
    case expired
    case inBillingRetryPeriod
    case inGracePeriod
    case revoked

    var id: String { rawValue }

    var label: String {
        switch self {
        case .none: return "Aucun abonnement"
        case .subscribed: return "Actif"
        case .expired: return "Expiré"
        case .inBillingRetryPeriod: return "Problème de paiement"
        case .inGracePeriod: return "Période de grâce"
        case .revoked: return "Révoqué"
        }
    }

    /// Whether this status should currently grant the plan's
    /// entitlements — grace period counts (Apple's own recommendation:
    /// keep access during grace period so a user mid-retry doesn't lose
    /// service over a temporary card issue), billing retry does not
    /// (Apple's StoreKit already stops reporting it in
    /// currentEntitlements once truly lapsed; this only matters for the
    /// cached snapshot's own bookkeeping).
    var grantsAccess: Bool {
        switch self {
        case .subscribed, .inGracePeriod: return true
        case .none, .expired, .inBillingRetryPeriod, .revoked: return false
        }
    }
}

/// Phase 12 §"12C — ENTITLEMENTS LOCAUX" — `EntitlementSnapshot.source`.
enum EntitlementSource: String, Codable {
    case storeKit
    case server
    case cachedVerified
    case free
}
