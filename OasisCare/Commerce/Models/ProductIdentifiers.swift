import Foundation

/// Phase 12 §"Produits" — "Préparer les identifiers dans une
/// configuration centralisée." These are the identifiers spec's own
/// example uses; they must match whatever is actually configured in
/// App Store Connect before a purchase can succeed there (§"vérifier
/// les identifiers réellement configurés dans App Store Connect. NE
/// PAS casser des produits existants") — that verification needs a
/// human with App Store Connect access, which this session doesn't
/// have. If App Store Connect ends up using different identifiers,
/// only this file needs to change.
enum ProductIdentifiers {
    static let premiumMonthly = "com.oasiscare.premium.monthly"
    static let premiumYearly = "com.oasiscare.premium.yearly"
    static let biolabMonthly = "com.oasiscare.biolab.monthly"
    static let biolabYearly = "com.oasiscare.biolab.yearly"

    static let all: Set<String> = [premiumMonthly, premiumYearly, biolabMonthly, biolabYearly]

    static let premium: Set<String> = [premiumMonthly, premiumYearly]
    static let biolab: Set<String> = [biolabMonthly, biolabYearly]

    /// §"Hiérarchie" — BioLab entitlements are supersets of Premium's,
    /// so owning ANY biolab product implies the biolab plan outright
    /// (never "premium AND biolab" as two separate grants to combine).
    static func plan(for ownedProductIDs: Set<String>) -> OasisPlan {
        if !ownedProductIDs.isDisjoint(with: biolab) { return .biolab }
        if !ownedProductIDs.isDisjoint(with: premium) { return .premium }
        return .free
    }
}
