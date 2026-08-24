import Foundation
import SwiftData

/// Spec §40-41 — a physical QR sticker or NFC chip that resolves to a
/// plant via a random, unguessable token, never by embedding the plant's
/// own data in the tag. `workspaceId`/`gardenId`/`zoneId` from the spec's
/// field list aren't stored here: workspaceId is push-time-only (like
/// every other synced model in this app), and garden/zone are always
/// derivable via `plant.garden`/`plant.zone` — storing a snapshot would
/// just go stale the moment a plant moves.
///
/// Spec's own later "QR / NFC" section (BioLab) extends this same tag
/// to bioréacteur/lot/recette imprimée/zone d'acclimatation — four more
/// plain optional relationships, same "any one of several, never more
/// than one meaningfully set" shape as Sensor's own plant/garden/zone/
/// device/bioreactor scoping. "Rack" gets no relationship at all
/// (`rackLabel` instead): no LabRack model exists anywhere in this app
/// (nothing in Phase 7 ever asked to create one), and a rack tag has
/// nothing to open — it's a plain physical label, not a linked record.
@Model
final class SmartTag: Syncable {
    var id: UUID
    var publicToken: String
    var type: SmartTagType
    var active: Bool
    var createdAt: Date
    var lastScannedAt: Date?
    var syncStatus: SyncStatus?
    var updatedAt: Date?

    var plant: Plant?
    var bioreactor: Bioreactor?
    var cultureBatch: CultureBatch?
    var mediumRecipeVersion: MediumRecipeVersion?
    var acclimatizationBatch: AcclimatizationBatch?
    var rackLabel: String?

    /// `plant`/`type` stay first, in that exact order — every existing
    /// call site (SmartTagService.tag(for: Plant, type:...)) already
    /// calls this positionally-ordered-and-labeled, and Swift requires
    /// labeled arguments to still appear in declaration order, so
    /// reordering here would silently break every one of them.
    init(
        plant: Plant? = nil, type: SmartTagType, bioreactor: Bioreactor? = nil, cultureBatch: CultureBatch? = nil,
        mediumRecipeVersion: MediumRecipeVersion? = nil, acclimatizationBatch: AcclimatizationBatch? = nil, rackLabel: String? = nil
    ) {
        self.id = UUID()
        self.publicToken = Self.generateToken()
        self.type = type
        self.active = true
        self.createdAt = .now
        self.plant = plant
        self.bioreactor = bioreactor
        self.cultureBatch = cultureBatch
        self.mediumRecipeVersion = mediumRecipeVersion
        self.acclimatizationBatch = acclimatizationBatch
        self.rackLabel = rackLabel
        self.syncStatus = .pendingCreate
        self.updatedAt = .now
    }

    var url: String { SmartTagConfig.url(forToken: publicToken) }

    /// Whichever real entity this tag currently points to, purely for
    /// "is this the same target" comparisons during reassignment — never
    /// used to fetch the whole entity, since the caller already knows
    /// which one it's dealing with.
    var linkedEntityID: UUID? {
        plant?.id ?? bioreactor?.id ?? cultureBatch?.id ?? mediumRecipeVersion?.id ?? acclimatizationBatch?.id
    }

    /// A short human-readable name for whatever this tag points to —
    /// display-only (conflict dialogs, "already associated with X").
    var linkedDisplayName: String? {
        if let plant { return plant.customName }
        if let bioreactor { return bioreactor.code }
        if let cultureBatch { return cultureBatch.batchCode }
        if let mediumRecipeVersion {
            return "\(mediumRecipeVersion.recipe?.name ?? "Recette") V\(mediumRecipeVersion.versionNumber)"
        }
        if let acclimatizationBatch { return "Acclimatation \(acclimatizationBatch.cultureBatch?.batchCode ?? "?")" }
        return rackLabel
    }

    /// 128 bits from Foundation's CSPRNG-backed UUID generator — same
    /// entropy class as a session token, just reformatted without dashes
    /// for a cleaner URL (spec §41: "token aléatoire non prévisible").
    private static func generateToken() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }
}
