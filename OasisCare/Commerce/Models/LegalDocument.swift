import Foundation

/// Phase 12 §12K "Le texte légal définitif doit pouvoir être modifié
/// facilement... tout élément nécessitant validation humaine doit être
/// signalé." Plain local strings (not fetched from anywhere) so editing
/// them is a one-file change, no CMS/backend needed.
///
/// IMPORTANT — NOT REAL LEGAL ADVICE: the text in `LegalContent.swift`
/// is a factual draft of what this app actually does (data collected,
/// third parties used, rights offered), written from reading the
/// codebase — not reviewed by a lawyer. It must be read and approved
/// (or replaced) by the user, and ideally a legal professional, before
/// this app is publicly released. See the Phase 12 report's own
/// flagged list of what needs human validation before publication.
enum LegalDocument: String, Identifiable {
    case terms
    case privacy

    var id: String { rawValue }

    var title: String {
        switch self {
        case .terms: return "Conditions d'utilisation"
        case .privacy: return "Politique de confidentialité"
        }
    }
}
