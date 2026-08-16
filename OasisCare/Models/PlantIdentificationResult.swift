import Foundation

/// Provider-independent identification candidate (spec §31) — the UI
/// never needs to know this came from Pl@ntNet specifically.
struct PlantIdentificationResult: Decodable, Identifiable {
    var scientificName: String
    var commonNames: [String]
    var family: String?
    var genus: String?
    var species: String?
    var score: Double
    var provider: String

    var id: String { scientificName }

    var scorePercent: Int {
        Int((score * 100).rounded())
    }
}
