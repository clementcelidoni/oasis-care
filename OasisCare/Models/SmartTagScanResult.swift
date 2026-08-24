import Foundation

/// What a resolved SmartTag scan actually points to — see
/// SmartTagService.scanResult(for:). Plant is handled by the existing
/// QuickActionsAfterScanSheet unchanged; the other cases get
/// SmartTagScanResultSheet's much simpler "open the fiche" treatment.
enum SmartTagScanResult: Identifiable {
    case plant(Plant)
    case bioreactor(Bioreactor)
    case cultureBatch(CultureBatch)
    case mediumRecipeVersion(MediumRecipeVersion)
    case acclimatizationBatch(AcclimatizationBatch)
    case rack(String)

    /// For `.sheet(item:)` at the scan call sites — content differs per
    /// case (plant routes to the existing QuickActionsAfterScanSheet,
    /// everything else to SmartTagScanResultSheet), but one Identifiable
    /// value covers both without a second wrapper enum.
    var id: String {
        switch self {
        case .plant(let plant): return "plant-\(plant.id)"
        case .bioreactor(let bioreactor): return "bioreactor-\(bioreactor.id)"
        case .cultureBatch(let batch): return "batch-\(batch.id)"
        case .mediumRecipeVersion(let version): return "recipeVersion-\(version.id)"
        case .acclimatizationBatch(let batch): return "acclimatization-\(batch.id)"
        case .rack(let label): return "rack-\(label)"
        }
    }
}
