import Foundation

/// Phase 12 §"RÈGLE ABSOLUE" — "Un utilisateur qui dépasse une future
/// limite Free doit pouvoir continuer à consulter ses données... mais
/// JAMAIS supprimer automatiquement."
///
/// This type answers a narrower question than UsageLimitService
/// (numeric "can I create one more") or EntitlementService (boolean
/// "do I have X right now"): given the ENTITLEMENTS a user had a moment
/// ago and the ones a fresh StoreKit refresh just gave them, what did
/// they lose — so the app can say so once, instead of a feature
/// silently vanishing with no explanation.
///
/// It never deletes or hides existing data itself, and it never decides
/// what to grant — StoreKitService already rebuilt `current` from real,
/// verified StoreKit state before this ever runs. This only diffs two
/// already-decided snapshots for the sake of a one-time user-facing
/// notice.
enum DowngradePolicy {
    static func lostEntitlements(previous: EntitlementSnapshot, current: EntitlementSnapshot) -> Set<Entitlement> {
        previous.activeEntitlements.subtracting(current.activeEntitlements)
    }

    static func isDowngrade(previous: EntitlementSnapshot, current: EntitlementSnapshot) -> Bool {
        !lostEntitlements(previous: previous, current: current).isEmpty
    }

    /// A short, calm French sentence for ToastCenter — never alarmist,
    /// never implies data was deleted (RÈGLE ABSOLUE: only access to
    /// premium-only screens changed, nothing was removed).
    static func notice(for lost: Set<Entitlement>) -> String? {
        guard !lost.isEmpty else { return nil }
        let names = lost.map(\.displayName).sorted().joined(separator: ", ")
        return "Certaines fonctionnalités ne sont plus disponibles : \(names). Vos données restent intactes."
    }
}
