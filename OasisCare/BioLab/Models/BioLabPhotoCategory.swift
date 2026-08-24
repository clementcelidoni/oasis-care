import Foundation

/// Spec Phase 7H — "PHOTOS: Vue globale / Détail tissus / Milieu /
/// Bocal / Équipement." Required on BioLabInspectionPhoto — every photo
/// that model stores is a BioLab inspection photo, unlike PlantPhoto
/// which serves several unrelated purposes.
enum BioLabPhotoCategory: String, Codable, CaseIterable, Identifiable {
    case globalView
    case tissueDetail
    case medium
    case vessel
    case equipment

    var id: String { rawValue }

    var label: String {
        switch self {
        case .globalView: return "Vue globale"
        case .tissueDetail: return "Détail tissus"
        case .medium: return "Milieu"
        case .vessel: return "Bocal"
        case .equipment: return "Équipement"
        }
    }
}
