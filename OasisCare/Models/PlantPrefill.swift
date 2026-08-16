import Foundation

/// A confirmed species name handed from the Scanner or the name-search
/// flow to PlantFormView, which pre-fills its fields and offers to
/// complete the rest with AI.
struct PlantPrefill: Identifiable {
    var scientificName: String
    var commonName: String?

    var id: String { scientificName }
}
