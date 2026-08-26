import Foundation

/// Reads entitlements granted server-side (`subscription_entitlements`)
/// and merges them with whatever StoreKit proved on this device.
///
/// Why this exists: StoreKit alone can only ever describe what this
/// Apple ID *bought*. Some legitimate grants have no purchase behind
/// them at all — a complimentary/owner account, a support gesture after
/// a billing problem, a comped reviewer. Those live in
/// `subscription_entitlements` with an explicit non-Apple `source`.
///
/// Why trusting the server here is safe: that table has no insert or
/// update policy for any client role (see 0041's RLS), so a user cannot
/// grant themselves anything — only a `service_role` backend function,
/// or the developer in the SQL editor, can write a row. The client can
/// only ever *read its own* rows. Forging a grant would require the
/// service-role key, which never leaves the server.
///
/// Merge rule: take the HIGHER of the two plans, never the lower. A
/// server hiccup must not be able to demote a paying subscriber, and a
/// complimentary Premium must not override a real BioLab purchase.
enum ServerEntitlementService {
    struct Response: Decodable {
        var plan: String
        var status: String
        var expiresAt: Date?
        var entitlements: [String]
    }

    /// Best-effort: returns nil on any failure, which callers must treat
    /// as "no server grant known", never as "downgrade to free"
    /// (§12C — an abonné must not lose Premium in a tunnel).
    static func fetch() async -> Response? {
        guard case .authenticated = await AuthState.shared.status else { return nil }
        struct EmptyBody: Encodable {}
        do {
            return try await AIBackend.invoke("subscription-status", body: EmptyBody())
        } catch {
            OasisLog.subscription.error("Server entitlement fetch failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    /// Applies a server grant on top of the current snapshot, but only
    /// when it is strictly better. Returns the snapshot to store, or nil
    /// if nothing should change.
    @MainActor
    static func merged(with response: Response, current: EntitlementSnapshot) -> EntitlementSnapshot? {
        guard let serverPlan = OasisPlan(rawValue: response.plan), serverPlan.rank > current.plan.rank else {
            return nil
        }
        return EntitlementSnapshot(
            plan: serverPlan,
            // Deliberately the plan's full local entitlement set rather
            // than the individual rows the server sent: the plan matrix
            // is the single source of truth for what a plan includes
            // (PlanConfigurationStore), and a partially-written row set
            // shouldn't silently define a new half-plan.
            activeEntitlements: PlanService.shared.configuration(for: serverPlan).entitlements,
            expirationDate: response.expiresAt,
            subscriptionStatus: SubscriptionStatus(rawValue: response.status) ?? .subscribed,
            lastVerifiedAt: .now,
            source: .server
        )
    }

    /// Fetches and applies in one step. Safe to call on every launch.
    @MainActor
    static func refreshAndApply() async {
        guard let response = await fetch() else { return }
        guard let snapshot = merged(with: response, current: EntitlementService.shared.snapshot) else { return }
        EntitlementService.shared.update(snapshot)
        OasisLog.subscription.notice("Applied server-granted plan: \(snapshot.plan.rawValue, privacy: .public)")
    }
}
