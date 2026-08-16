import Foundation

enum IrrigationType: String, Codable, CaseIterable, Identifiable {
    case drip
    case sprinkler
    case microSprinkler
    case bubbler
    case manual
    case hose
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .drip: return "Goutte-à-goutte"
        case .sprinkler: return "Asperseur"
        case .microSprinkler: return "Micro-asperseur"
        case .bubbler: return "Bulleur"
        case .manual: return "Manuel"
        case .hose: return "Tuyau"
        case .other: return "Autre"
        }
    }

    var icon: String {
        switch self {
        case .drip: return "drop.circle"
        case .sprinkler, .microSprinkler: return "cloud.drizzle.fill"
        case .bubbler: return "drop.circle.fill"
        case .manual, .hose: return "hand.raised.fill"
        case .other: return "questionmark.circle"
        }
    }
}
