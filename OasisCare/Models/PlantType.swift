import Foundation

enum PlantType: String, Codable, CaseIterable, Identifiable {
    case houseplant
    case pottedPlant
    case tree
    case palm
    case shrub
    case hedge
    case flowerBed
    case lawn
    case vegetable
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .houseplant: return "Plante d'intérieur"
        case .pottedPlant: return "Plante en pot"
        case .tree: return "Arbre"
        case .palm: return "Palmier"
        case .shrub: return "Arbuste"
        case .hedge: return "Haie"
        case .flowerBed: return "Massif"
        case .lawn: return "Pelouse"
        case .vegetable: return "Potager"
        case .other: return "Autre"
        }
    }

    var icon: String {
        switch self {
        case .houseplant: return "leaf.fill"
        case .pottedPlant: return "leaf.circle.fill"
        case .tree: return "tree.fill"
        case .palm: return "tree.fill"
        case .shrub: return "leaf.fill"
        case .hedge: return "rectangle.grid.1x2.fill"
        case .flowerBed: return "leaf.fill"
        case .lawn: return "square.grid.3x3.fill"
        case .vegetable: return "leaf.fill"
        case .other: return "questionmark.circle.fill"
        }
    }
}
