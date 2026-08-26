import Foundation

/// Phase 12 §"12O — Créer remote commercial config pour quotas, limites
/// Free, textes optionnels et flags." Read-only fetch (the
/// `feature_flags`/`commercial_config` tables have no write policy for
/// any client — see 0041's own RLS comments) applied on top of the
/// local defaults in PlanConfigurationStore/FeatureFlagService. Never
/// required for the app to function: both services already have safe
/// local defaults, so a failed or slow fetch just means "today's launch
/// defaults apply a little longer," never a blocked feature.
enum CommercialConfigService {
    private struct FeatureFlagRow: Decodable {
        var flagKey: String
        var isEnabled: Bool

        enum CodingKeys: String, CodingKey {
            case flagKey = "flag_key"
            case isEnabled = "is_enabled"
        }
    }

    static func refresh() async {
        guard case .authenticated = await AuthState.shared.status else { return }
        do {
            let rows: [FeatureFlagRow] = try await AuthService.client.from("feature_flags").select().execute().value
            let flags = Dictionary(uniqueKeysWithValues: rows.map { ($0.flagKey, $0.isEnabled) })
            await FeatureFlagService.shared.applyRemote(flags)
        } catch {
            // Best-effort — local defaults already cover this app's
            // needs; see this type's own doc comment.
        }
    }
}
