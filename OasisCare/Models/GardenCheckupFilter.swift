import Foundation

/// Spec §63. `.zone` needs a specific zone id, stored separately on
/// GardenCheckup (`filterZoneID`) rather than as an associated value
/// here, so this stays a plain, directly SwiftData-storable enum like
/// every other one in this app.
enum GardenCheckupFilter: String, Codable, CaseIterable, Identifiable {
    case all
    case trees
    case palms
    case otherPlants
    case zone
    case needsAttention

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .all: return "Tout"
        case .trees: return "Arbres"
        case .palms: return "Palmiers"
        case .otherPlants: return "Plantes"
        case .zone: return "Zone"
        case .needsAttention: return "À surveiller"
        }
    }
}
