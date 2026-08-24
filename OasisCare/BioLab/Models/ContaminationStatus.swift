import SwiftUI

/// Spec Phase 7H — "STATUT CONTAMINATION." CRITIQUE: "ne jamais demander
/// à l'IA de déclarer automatiquement une contamination comme
/// certitude" — `.confirmed` is reserved for a human's own explicit
/// judgment call, never something Oasis AI BioLab (Phase 7I) is allowed
/// to set on its own.
enum ContaminationStatus: String, Codable, CaseIterable, Identifiable {
    case noneObserved
    case suspected
    case confirmed
    case unknown

    var id: String { rawValue }

    var label: String {
        switch self {
        case .noneObserved: return "Aucune observée"
        case .suspected: return "Suspectée"
        case .confirmed: return "Confirmée"
        case .unknown: return "Inconnue"
        }
    }

    var color: Color {
        switch self {
        case .noneObserved: return .green
        case .suspected: return .orange
        case .confirmed: return .red
        case .unknown: return .secondary
        }
    }
}
