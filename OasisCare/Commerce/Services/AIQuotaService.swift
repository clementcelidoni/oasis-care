import Foundation

/// Phase 12 §12H "QUOTAS IA — CRITIQUE POUR LA RENTABILITÉ." The
/// spec's own six named categories — kept as an enum so every call
/// site names one explicitly rather than a loose string.
enum AIFeature: String, Codable, CaseIterable, Identifiable {
    case plantIdentification
    case profileGeneration
    case assistantMessage
    case photoDiagnosis
    case biolabRecommendation
    case smartMediaResearch

    var id: String { rawValue }

    /// Named after what the user actually did, not after the Edge
    /// Function that ran — someone reading their consumption should
    /// recognise the feature they used.
    var displayName: String {
        switch self {
        case .plantIdentification: return "Identification de plantes"
        case .profileGeneration: return "Fiches d'espèce"
        case .assistantMessage: return "Assistant IA"
        case .photoDiagnosis: return "Analyses photo"
        case .biolabRecommendation: return "Analyses BioLab"
        case .smartMediaResearch: return "Smart Media"
        }
    }
}

/// Client-side status check only — the real enforcement (incrementing
/// the counter, refusing at 100%) happens server-side inside each AI
/// Edge Function, since a client-only check could trivially be
/// bypassed (§"un utilisateur ne doit pas contourner le quota en
/// réinstallant l'application"). This service exists so the UI can show
/// an honest "80%" warning before the user even attempts the call.
enum AIQuotaService {
    struct Status: Decodable {
        var feature: String
        var period: String
        var used: Int
        var limit: Int

        var usageFraction: Double {
            guard limit > 0 else { return 0 }
            return Double(used) / Double(limit)
        }
        var isNearLimit: Bool { usageFraction >= 0.8 }
        var isAtLimit: Bool { used >= limit }
    }

    static func status(for feature: AIFeature) async throws -> Status {
        struct RequestBody: Encodable { var feature: String }
        return try await AIBackend.invoke("ai-usage-status", body: RequestBody(feature: feature.rawValue))
    }

    /// Every category at once, for the "Mon abonnement" screen. Six
    /// concurrent calls rather than one batched endpoint: the per-feature
    /// endpoint is already deployed and this screen is opened rarely, so
    /// batching would mean redeploying a function to save round-trips
    /// nobody is waiting on. Worth revisiting if it ever moves somewhere
    /// hot.
    ///
    /// A category that fails is omitted rather than shown as zero —
    /// reporting "0 utilisées" for a call that never answered would be
    /// a plain lie about the user's consumption.
    static func allStatuses() async -> [AIFeature: Status] {
        await withTaskGroup(of: (AIFeature, Status?).self) { group in
            for feature in AIFeature.allCases {
                group.addTask { (feature, try? await status(for: feature)) }
            }
            var results: [AIFeature: Status] = [:]
            for await (feature, status) in group {
                if let status { results[feature] = status }
            }
            return results
        }
    }
}
