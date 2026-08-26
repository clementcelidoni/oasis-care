import Foundation

/// Phase 12 §"12A — PLANS OASIS CARE." `.pro` exists only so the type is
/// extensible later ("préparer l'architecture pour ajouter plus tard
/// PRO, mais NE PAS créer les fonctions Pro") — nothing in this app
/// grants or checks `.pro` yet, and no UI names it.
enum OasisPlan: String, Codable, CaseIterable, Identifiable {
    case free
    case premium
    case biolab
    case pro

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .free: return "Free"
        case .premium: return "Premium"
        case .biolab: return "BioLab"
        case .pro: return "Pro"
        }
    }

    /// §"Hiérarchie" — "BioLab doit hériter des fonctions Premium."
    /// Ordering only, never used as `plan == .premium`-style gating
    /// (see FeatureGateService, which checks entitlements instead).
    var rank: Int {
        switch self {
        case .free: return 0
        case .premium: return 1
        case .biolab: return 2
        case .pro: return 3
        }
    }
}
