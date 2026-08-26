import Foundation

/// Phase 12 §12H "QUOTAS IA — CRITIQUE POUR LA RENTABILITÉ." The
/// spec's own six named categories — kept as an enum so every call
/// site names one explicitly rather than a loose string.
enum AIFeature: String, Codable {
    case plantIdentification
    case profileGeneration
    case assistantMessage
    case photoDiagnosis
    case biolabRecommendation
    case smartMediaResearch
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
}
