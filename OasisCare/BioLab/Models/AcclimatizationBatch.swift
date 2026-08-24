import Foundation
import SwiftData

enum AcclimatizationStatus: String, Codable, CaseIterable, Identifiable {
    case active
    case completed
    case abandoned

    var id: String { rawValue }

    var label: String {
        switch self {
        case .active: return "En cours"
        case .completed: return "Terminée"
        case .abandoned: return "Abandonnée"
        }
    }
}

/// Spec Phase 7L "ÉTAPES — l'application doit laisser l'utilisateur
/// définir son protocole." A plain Codable array on the batch (same
/// pattern as MediumComponentAmount on MediumRecipeVersion) rather than
/// a fixed enum of stages or a separate synced @Model: spec's own
/// example (Sortie in vitro/Humidité élevée/Ouverture progressive/
/// Serre/Plante stabilisée) is illustrative, not an exhaustive
/// vocabulary — the user names and dates their own steps.
struct AcclimatizationStep: Codable, Identifiable, Hashable {
    var id: UUID = UUID()
    var dayOffset: Int
    var label: String
}

/// Spec Phase 7L — "AcclimatizationBatch... relié au CultureBatch
/// source." The last stage before a plantlet becomes a real, permanent
/// Plant record (see Plant.originBatch and CultureBatchDetailView).
@Model
final class AcclimatizationBatch: Syncable {
    var id: UUID
    var startedAt: Date
    var initialPlantletCount: Int
    var currentSurvivorCount: Int
    /// Free text — spec names this field but gives no fixed vocabulary,
    /// and substrate choice varies far too much by species/grower to
    /// enumerate without inventing one.
    var substrate: String
    var humidityProgram: String
    var temperature: Double?
    var location: String
    var status: AcclimatizationStatus
    var steps: [AcclimatizationStep]
    var notes: String
    /// Spec "CRÉER LES PLANTES" — guards against creating duplicate
    /// Plant records if the button is somehow triggered twice.
    var plantsCreated: Bool
    var createdAt: Date
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var cultureBatch: CultureBatch?

    /// Spec's "QR / NFC" section — "zone acclimatation."
    @Relationship(deleteRule: .cascade, inverse: \SmartTag.acclimatizationBatch)
    var smartTags: [SmartTag] = []

    /// Spec "SURVIE — calculer survivalRate."
    var survivalRate: Double? {
        guard initialPlantletCount > 0 else { return nil }
        return Double(currentSurvivorCount) / Double(initialPlantletCount)
    }

    init(
        cultureBatch: CultureBatch?, initialPlantletCount: Int, substrate: String = "",
        humidityProgram: String = "", temperature: Double? = nil, location: String = "", notes: String = ""
    ) {
        self.id = UUID()
        self.cultureBatch = cultureBatch
        self.startedAt = .now
        self.initialPlantletCount = initialPlantletCount
        self.currentSurvivorCount = initialPlantletCount
        self.substrate = substrate
        self.humidityProgram = humidityProgram
        self.temperature = temperature
        self.location = location
        self.status = .active
        self.steps = []
        self.notes = notes
        self.plantsCreated = false
        self.createdAt = .now
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }
}
