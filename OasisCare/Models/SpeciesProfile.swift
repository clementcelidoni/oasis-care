import Foundation
import SwiftData

/// Local cache of one species' AI-generated botanical profile (spec §36:
/// "Séparer espèce et exemplaire" — many Plant exemplars can point at
/// the same SpeciesProfile instead of duplicating the whole description).
///
/// This is deliberately NOT a Syncable/synced entity: the canonical
/// shared copy already lives server-side in the species_profiles table,
/// written directly by the plant-info Edge Function. This local row is
/// only a read-mostly offline mirror of whatever that function last
/// returned, refreshed whenever the user (re-)completes a profile.
///
/// The full profile is stored as raw JSON (`profileJSON`) rather than
/// modeled as native SwiftData attributes — decode on demand with
/// `decodedPayload()`. See SpeciesProfilePayload for the shape.
@Model
final class SpeciesProfile {
    var id: UUID
    var scientificName: String
    var normalizedName: String
    var profileJSON: Data
    var source: String
    var generatedAt: Date

    @Relationship(deleteRule: .nullify, inverse: \Plant.speciesProfile)
    var plants: [Plant] = []

    init(scientificName: String, normalizedName: String, profileJSON: Data, source: String = "openai", generatedAt: Date = .now) {
        self.id = UUID()
        self.scientificName = scientificName
        self.normalizedName = normalizedName
        self.profileJSON = profileJSON
        self.source = source
        self.generatedAt = generatedAt
    }

    func decodedPayload() -> SpeciesProfilePayload? {
        try? JSONDecoder().decode(SpeciesProfilePayload.self, from: profileJSON)
    }

    static func normalize(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    }
}
