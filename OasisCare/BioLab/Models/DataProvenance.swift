import Foundation

/// Enhancement §46 — "chaque paramètre recommandé doit être
/// classifiable." Attached per-ingredient (see MediumComponentAmount)
/// and usable anywhere else a value's origin matters, so the UI can
/// always show whether a number is a literature fact, this workspace's
/// own experience, a user's own choice, a deterministic calculation, or
/// an AI guess — never presented as more certain than it is.
enum DataProvenance: String, Codable, CaseIterable, Identifiable {
    case published
    case internalExperimental
    case userDefined
    case calculated
    case aiSuggested
    case unknown

    var id: String { rawValue }

    var label: String {
        switch self {
        case .published: return "Publié"
        case .internalExperimental: return "Expérimental interne"
        case .userDefined: return "Défini par l'utilisateur"
        case .calculated: return "Calculé"
        case .aiSuggested: return "Suggéré par l'IA"
        case .unknown: return "Inconnu"
        }
    }
}

/// Enhancement §5 "PROVENANCE DE LA RECOMMANDATION — CRITIQUE." How
/// close a recommendation's basis is to the actual plant/situation being
/// asked about, from an exact match on this workspace's own past
/// results down to a plain AI extrapolation. Never upgraded to a
/// stronger type than the underlying evidence actually supports.
enum EvidenceType: String, Codable, CaseIterable, Identifiable {
    case exactSpeciesEvidence
    case cultivarEvidence
    case sameSpeciesDifferentCultivar
    case sameGenus
    case relatedTaxon
    case internalBioLabData
    case publishedProtocol
    case userProtocol
    case aiExtrapolation
    case unknown

    var id: String { rawValue }

    var label: String {
        switch self {
        case .exactSpeciesEvidence: return "Espèce exacte"
        case .cultivarEvidence: return "Cultivar exact"
        case .sameSpeciesDifferentCultivar: return "Même espèce, cultivar différent"
        case .sameGenus: return "Même genre"
        case .relatedTaxon: return "Taxon proche"
        case .internalBioLabData: return "Données internes du laboratoire"
        case .publishedProtocol: return "Protocole publié"
        case .userProtocol: return "Protocole utilisateur"
        case .aiExtrapolation: return "Extrapolation IA"
        case .unknown: return "Inconnu"
        }
    }

    /// Enhancement's "PROPOSITIONS PAR NIVEAU DE PREUVE" section, given
    /// as a display simplification of this same list ("ou équivalent")
    /// rather than a second, separately-maintained taxonomy — one
    /// source of truth for evidence strength.
    var evidenceLevel: Int {
        switch self {
        case .internalBioLabData: return 1
        case .exactSpeciesEvidence, .cultivarEvidence, .publishedProtocol: return 2
        case .sameSpeciesDifferentCultivar, .sameGenus, .relatedTaxon, .userProtocol: return 3
        case .aiExtrapolation, .unknown: return 4
        }
    }
}

/// Enhancement §6 — "l'IA ne doit pas inventer une confiance
/// artificiellement précise en pourcentage si elle ne peut pas être
/// correctement justifiée." A coarse, 4-value scale on purpose — no
/// numeric percentage anywhere in this app claims a precision the
/// underlying evidence can't support.
enum ConfidenceLevel: String, Codable, CaseIterable, Identifiable {
    case high
    case medium
    case low
    case unknown

    var id: String { rawValue }

    var label: String {
        switch self {
        case .high: return "Élevée"
        case .medium: return "Moyenne"
        case .low: return "Faible"
        case .unknown: return "Inconnue"
        }
    }
}
