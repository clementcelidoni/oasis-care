import SwiftUI

/// Spec Phase 6C — "une zone est un polygone éditable," same editing
/// paradigm as GardenBoundary (6B) applied to a typed, colored area
/// instead of the single property outline.
enum GardenAreaType: String, Codable, CaseIterable, Identifiable {
    case lawn, flowerBed, vegetableGarden, greenhouseArea, pondArea, terrace, gravel, mulch
    case noGoZone, technicalZone, custom

    var id: String { rawValue }

    var label: String {
        switch self {
        case .lawn: return "Pelouse"
        case .flowerBed: return "Massif"
        case .vegetableGarden: return "Potager"
        case .greenhouseArea: return "Zone de serre"
        case .pondArea: return "Zone de bassin"
        case .terrace: return "Terrasse"
        case .gravel: return "Gravier"
        case .mulch: return "Paillage"
        case .noGoZone: return "Zone interdite"
        case .technicalZone: return "Zone technique"
        case .custom: return "Personnalisée"
        }
    }

    var icon: String {
        switch self {
        case .lawn: return "leaf.fill"
        case .flowerBed: return "camera.macro"
        case .vegetableGarden: return "carrot.fill"
        case .greenhouseArea: return "house.fill"
        case .pondArea: return "drop.fill"
        case .terrace: return "square.grid.3x3.fill"
        case .gravel: return "circle.grid.3x3.fill"
        case .mulch: return "square.fill"
        case .noGoZone: return "xmark.octagon.fill"
        case .technicalZone: return "wrench.and.screwdriver.fill"
        case .custom: return "square.dashed"
        }
    }

    var color: Color {
        switch self {
        case .lawn: return .green
        case .flowerBed: return .pink
        case .vegetableGarden: return .orange
        case .greenhouseArea: return .mint
        case .pondArea: return .blue
        case .terrace: return .brown
        case .gravel: return .gray
        case .mulch: return .brown
        case .noGoZone: return .red
        case .technicalZone: return .yellow
        case .custom: return .purple
        }
    }

    /// Spec Phase 6C — "comme un robot tondeuse... zone interdite":
    /// rock/pond/fragile-area/technical-equipment zones the mower (and,
    /// later, Phase 6I's route planner) must stay out of.
    var isNoGo: Bool { self == .noGoZone }
}
