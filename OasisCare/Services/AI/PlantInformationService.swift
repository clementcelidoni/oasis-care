import Foundation

/// Calls the plant-info Edge Function (OpenAI) — name suggestions for
/// smart manual-add (spec §33/§49) and full species-profile completion
/// (spec §34-39, §47-48 cost/caching).
enum PlantInformationService {
    struct NameSuggestion: Decodable, Identifiable {
        var scientificName: String
        var commonName: String?
        var id: String { scientificName }
    }

    static func suggestions(for query: String) async throws -> [NameSuggestion] {
        struct RequestBody: Encodable {
            var mode = "suggest"
            var query: String
        }
        struct ResponseBody: Decodable {
            var suggestions: [NameSuggestion]
        }
        let response: ResponseBody = try await AIBackend.invoke("plant-info", body: RequestBody(query: query))
        return response.suggestions
    }

    struct CompletionResult {
        var profile: SpeciesProfilePayload
        /// The profile re-encoded to Data, ready to store verbatim in
        /// SpeciesProfile.profileJSON.
        var profileJSON: Data
        var cached: Bool
    }

    static func complete(scientificName: String) async throws -> CompletionResult {
        struct RequestBody: Encodable {
            var mode = "complete"
            var scientificName: String
        }
        struct ResponseBody: Decodable {
            var profile: SpeciesProfilePayload
            var cached: Bool
        }
        let response: ResponseBody = try await AIBackend.invoke(
            "plant-info",
            body: RequestBody(scientificName: scientificName)
        )
        let profileJSON = (try? JSONEncoder().encode(response.profile)) ?? Data()
        return CompletionResult(profile: response.profile, profileJSON: profileJSON, cached: response.cached)
    }
}
