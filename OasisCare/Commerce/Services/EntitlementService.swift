import Foundation

/// Phase 12 §"Architecture commerciale" — the one place any feature
/// asks "am I allowed to do this," via `has(_:)`. Never `plan ==
/// .premium` anywhere else in the app (§"NE PAS mettre partout dans le
/// code : if premium { ... }").
///
/// §12C "ne jamais inventer un abonnement actif": this class never
/// grants an entitlement itself — it only stores whatever snapshot
/// StoreKitService/SubscriptionSyncService last gave it, defaulting to
/// `.free` (zero access beyond the Free plan) until a real, verified
/// snapshot arrives. Persisted to UserDefaults purely as an offline
/// convenience cache (§12C "fonctionner même si Supabase est
/// momentanément indisponible") — the actual trust boundary is
/// StoreKit's own on-device cryptographic verification
/// (Transaction.currentEntitlements), re-established at every launch
/// and on every Transaction.updates event; this cache only bridges the
/// gap between app launch and that first refresh completing, and
/// between refreshes while offline.
@MainActor
final class EntitlementService: ObservableObject {
    static let shared = EntitlementService()

    @Published private(set) var snapshot: EntitlementSnapshot

    private static let storageKey = "com.oasiscare.entitlementSnapshot"

    private init() {
        snapshot = Self.loadCached() ?? .free
    }

    func has(_ entitlement: Entitlement) -> Bool {
        snapshot.activeEntitlements.contains(entitlement)
    }

    /// The one setter — called by StoreKitService after verifying
    /// on-device transactions, and by SubscriptionSyncService after a
    /// successful server reconciliation. Never called with a
    /// caller-asserted "premium=true"; always derived from a real
    /// PlanConfiguration + real StoreKit/server state.
    func update(_ newSnapshot: EntitlementSnapshot) {
        snapshot = newSnapshot
        persist(newSnapshot)
    }

    /// §12C "un abonné ne doit pas perdre brutalement Premium en mode
    /// avion" — falling back to Free only happens when the caller
    /// explicitly decides there's truly nothing else to trust (e.g. no
    /// cached snapshot exists at all on first launch), never as a
    /// silent side effect of a network hiccup.
    func resetToFree() {
        update(.free)
    }

    private func persist(_ snapshot: EntitlementSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        UserDefaults.standard.set(data, forKey: Self.storageKey)
    }

    private static func loadCached() -> EntitlementSnapshot? {
        guard let data = UserDefaults.standard.data(forKey: storageKey) else { return nil }
        return try? JSONDecoder().decode(EntitlementSnapshot.self, from: data)
    }
}
