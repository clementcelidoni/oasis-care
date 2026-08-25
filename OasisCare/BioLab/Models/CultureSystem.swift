import Foundation

/// Enhancement §2 — one of the inputs the media-recommendation engine
/// keys off, alongside espèce/cultivar/type d'explant/stade. Distinct
/// from `BioreactorType` (a physical vessel model like RITA/Plantform):
/// this describes the culture's physical medium state, which stays
/// meaningful even before any bioreactor is assigned.
enum CultureSystem: String, Codable, CaseIterable, Identifiable {
    case solid
    case semiSolid
    case liquid
    case temporaryImmersion
    case continuousImmersion
    case custom

    var id: String { rawValue }

    var label: String {
        switch self {
        case .solid: return "Solide"
        case .semiSolid: return "Semi-solide"
        case .liquid: return "Liquide"
        case .temporaryImmersion: return "Immersion temporaire"
        case .continuousImmersion: return "Immersion continue"
        case .custom: return "Personnalisé"
        }
    }
}
