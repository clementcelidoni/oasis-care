import Foundation
import SwiftUI

/// Spec Phase 7D — "TYPES... le modèle doit rester extensible."
enum BioreactorType: String, Codable, CaseIterable, Identifiable {
    case temporaryImmersionTwinVessel
    case temporaryImmersionSingleVessel
    case rita
    case plantform
    case continuousImmersion
    case custom

    var id: String { rawValue }

    var label: String {
        switch self {
        case .temporaryImmersionTwinVessel: return "Immersion temporaire (double bocal)"
        case .temporaryImmersionSingleVessel: return "Immersion temporaire (bocal simple)"
        case .rita: return "RITA"
        case .plantform: return "Plantform"
        case .continuousImmersion: return "Immersion continue"
        case .custom: return "Personnalisé"
        }
    }
}

/// Spec Phase 7D — "ÉTAT."
enum BioreactorStatus: String, Codable, CaseIterable, Identifiable {
    case idle
    case aerating
    case immersing
    case draining
    case paused
    case warning
    case fault
    case maintenance

    var id: String { rawValue }

    var label: String {
        switch self {
        case .idle: return "Au repos"
        case .aerating: return "Aération"
        case .immersing: return "Immersion"
        case .draining: return "Vidange"
        case .paused: return "En pause"
        case .warning: return "Avertissement"
        case .fault: return "Défaut"
        case .maintenance: return "Maintenance"
        }
    }

    /// Spec's own Digital Twin rule reapplied here — "ne jamais dépendre
    /// uniquement de la couleur," so every status also has its own icon.
    var icon: String {
        switch self {
        case .idle: return "moon.zzz"
        case .aerating: return "wind"
        case .immersing: return "drop.fill"
        case .draining: return "arrow.down.right.circle"
        case .paused: return "pause.circle"
        case .warning: return "exclamationmark.triangle.fill"
        case .fault: return "xmark.octagon.fill"
        case .maintenance: return "wrench.and.screwdriver.fill"
        }
    }

    var color: Color {
        switch self {
        case .idle: return .secondary
        case .aerating: return .cyan
        case .immersing: return .blue
        case .draining: return .brown
        case .paused: return .gray
        case .warning: return .orange
        case .fault: return .red
        case .maintenance: return .purple
        }
    }
}
