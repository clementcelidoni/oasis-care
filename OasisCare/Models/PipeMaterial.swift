import Foundation

/// Spec Phase 6D — IrrigationPipe.material. PE and PVC are the two
/// materials actually named in the spec's own example ("PE 25 mm");
/// `.other` covers everything else rather than guessing at a longer
/// catalogue the spec never lists.
enum PipeMaterial: String, Codable, CaseIterable, Identifiable {
    case pe, pvc, other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pe: return "PE"
        case .pvc: return "PVC"
        case .other: return "Autre"
        }
    }
}
