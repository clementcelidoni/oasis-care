import Foundation
import SwiftData

/// Token → plant resolution and tag lifecycle (spec §40-52). Local
/// SwiftData is always checked first (works offline, matches this app's
/// local-first design everywhere else); Supabase is only a fallback for
/// a token this device hasn't synced yet, and RLS on `smart_tags` keeps
/// that fallback from bypassing workspace permissions (spec §51).
enum SmartTagService {
    /// Fetch-or-create: a plant keeps at most one *active* tag per type
    /// (spec §42's two buttons, "Afficher QR" / "Associer NFC", each
    /// operate on their own tag).
    static func tag(for plant: Plant, type: SmartTagType, in context: ModelContext) -> SmartTag {
        if let existing = plant.smartTags.first(where: { $0.type == type && $0.active }) {
            return existing
        }
        let tag = SmartTag(plant: plant, type: type)
        context.insert(tag)
        plant.smartTags.append(tag)
        return tag
    }

    /// The tag row already claiming `token`, regardless of which plant it
    /// currently points to — used to detect the "tag already used"
    /// conflict (spec §47) before overwriting a physical tag.
    static func existingTag(forToken token: String, in context: ModelContext) -> SmartTag? {
        var descriptor = FetchDescriptor<SmartTag>(predicate: #Predicate { $0.publicToken == token && $0.active })
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    static func markScanned(_ tag: SmartTag) {
        tag.lastScannedAt = .now
        tag.markDirty()
    }

    /// Spec §47's "Réassigner": moves an existing physical tag onto a
    /// different plant rather than creating a second row for the same
    /// token. A plant keeps at most one active tag per type, so if
    /// `plant` already has one, it's superseded (dissociated) rather
    /// than left as a second, never-reachable-from-the-UI orphan.
    static func reassign(_ tag: SmartTag, to plant: Plant, in context: ModelContext) {
        if let priorSameType = plant.smartTags.first(where: { $0.type == tag.type && $0.active && $0.id != tag.id }) {
            dissociate(priorSameType, in: context)
        }
        clearLink(of: tag)
        tag.plant = plant
        plant.smartTags.append(tag)
        tag.lastScannedAt = .now
        tag.markDirty()
    }

    /// Spec §52 — the plant never depends on the tag, so dissociating
    /// just removes the tag row; the plant itself is untouched.
    static func dissociate(_ tag: SmartTag, in context: ModelContext) {
        DeletionService.delete(tag, in: context)
    }

    // MARK: - BioLab entities (spec's "QR / NFC" section)
    //
    // Same fetch-or-create / reassign shape as the Plant functions above,
    // one overload per entity type rather than a generic function over a
    // shared protocol — this codebase's own established convention for
    // "the same behavior across several unrelated model types"
    // (DeletionService is the precedent: one delete(_:in:) overload per
    // type, not a generic one).

    static func tag(for bioreactor: Bioreactor, type: SmartTagType, in context: ModelContext) -> SmartTag {
        if let existing = bioreactor.smartTags.first(where: { $0.type == type && $0.active }) {
            return existing
        }
        let tag = SmartTag(type: type, bioreactor: bioreactor)
        context.insert(tag)
        bioreactor.smartTags.append(tag)
        return tag
    }

    static func reassign(_ tag: SmartTag, to bioreactor: Bioreactor, in context: ModelContext) {
        if let priorSameType = bioreactor.smartTags.first(where: { $0.type == tag.type && $0.active && $0.id != tag.id }) {
            dissociate(priorSameType, in: context)
        }
        clearLink(of: tag)
        tag.bioreactor = bioreactor
        bioreactor.smartTags.append(tag)
        tag.lastScannedAt = .now
        tag.markDirty()
    }

    static func tag(for batch: CultureBatch, type: SmartTagType, in context: ModelContext) -> SmartTag {
        if let existing = batch.smartTags.first(where: { $0.type == type && $0.active }) {
            return existing
        }
        let tag = SmartTag(type: type, cultureBatch: batch)
        context.insert(tag)
        batch.smartTags.append(tag)
        return tag
    }

    static func reassign(_ tag: SmartTag, to batch: CultureBatch, in context: ModelContext) {
        if let priorSameType = batch.smartTags.first(where: { $0.type == tag.type && $0.active && $0.id != tag.id }) {
            dissociate(priorSameType, in: context)
        }
        clearLink(of: tag)
        tag.cultureBatch = batch
        batch.smartTags.append(tag)
        tag.lastScannedAt = .now
        tag.markDirty()
    }

    static func tag(for version: MediumRecipeVersion, type: SmartTagType, in context: ModelContext) -> SmartTag {
        if let existing = version.smartTags.first(where: { $0.type == type && $0.active }) {
            return existing
        }
        let tag = SmartTag(type: type, mediumRecipeVersion: version)
        context.insert(tag)
        version.smartTags.append(tag)
        return tag
    }

    static func reassign(_ tag: SmartTag, to version: MediumRecipeVersion, in context: ModelContext) {
        if let priorSameType = version.smartTags.first(where: { $0.type == tag.type && $0.active && $0.id != tag.id }) {
            dissociate(priorSameType, in: context)
        }
        clearLink(of: tag)
        tag.mediumRecipeVersion = version
        version.smartTags.append(tag)
        tag.lastScannedAt = .now
        tag.markDirty()
    }

    static func tag(for accBatch: AcclimatizationBatch, type: SmartTagType, in context: ModelContext) -> SmartTag {
        if let existing = accBatch.smartTags.first(where: { $0.type == type && $0.active }) {
            return existing
        }
        let tag = SmartTag(type: type, acclimatizationBatch: accBatch)
        context.insert(tag)
        accBatch.smartTags.append(tag)
        return tag
    }

    static func reassign(_ tag: SmartTag, to accBatch: AcclimatizationBatch, in context: ModelContext) {
        if let priorSameType = accBatch.smartTags.first(where: { $0.type == tag.type && $0.active && $0.id != tag.id }) {
            dissociate(priorSameType, in: context)
        }
        clearLink(of: tag)
        tag.acclimatizationBatch = accBatch
        accBatch.smartTags.append(tag)
        tag.lastScannedAt = .now
        tag.markDirty()
    }

    /// "Rack" has no backing entity (see SmartTag's own doc comment) —
    /// just a free-text label, created fresh every time rather than
    /// fetch-or-created, since there's no owning record to search for an
    /// existing tag on.
    static func rackTag(label: String, type: SmartTagType, in context: ModelContext) -> SmartTag {
        let tag = SmartTag(type: type, rackLabel: label)
        context.insert(tag)
        return tag
    }

    /// Removes `tag` from whichever entity's own `smartTags` array
    /// currently holds it, before `reassign` points it somewhere else —
    /// every entity type's inverse relationship needs this same cleanup.
    private static func clearLink(of tag: SmartTag) {
        tag.plant?.smartTags.removeAll { $0.id == tag.id }
        tag.bioreactor?.smartTags.removeAll { $0.id == tag.id }
        tag.cultureBatch?.smartTags.removeAll { $0.id == tag.id }
        tag.mediumRecipeVersion?.smartTags.removeAll { $0.id == tag.id }
        tag.acclimatizationBatch?.smartTags.removeAll { $0.id == tag.id }
        tag.plant = nil
        tag.bioreactor = nil
        tag.cultureBatch = nil
        tag.mediumRecipeVersion = nil
        tag.acclimatizationBatch = nil
    }

    /// What a scanned tag actually points to — the single place both
    /// QRScannerSheet and ScannerView's NFC path resolve a tag to
    /// "what do I show now," so a token resolving to e.g. a bioreactor
    /// gets the same handling regardless of which scan method found it.
    static func scanResult(for tag: SmartTag) -> SmartTagScanResult? {
        if let plant = tag.plant { return .plant(plant) }
        if let bioreactor = tag.bioreactor { return .bioreactor(bioreactor) }
        if let batch = tag.cultureBatch { return .cultureBatch(batch) }
        if let version = tag.mediumRecipeVersion { return .mediumRecipeVersion(version) }
        if let accBatch = tag.acclimatizationBatch { return .acclimatizationBatch(accBatch) }
        if let rackLabel = tag.rackLabel { return .rack(rackLabel) }
        return nil
    }

    private struct RemoteTagRow: Decodable {
        var plantId: UUID
        enum CodingKeys: String, CodingKey { case plantId = "plant_id" }
    }

    static func resolveRemotely(token: String) async throws -> UUID? {
        let rows: [RemoteTagRow] = try await AuthService.client
            .from("smart_tags")
            .select("plant_id")
            .eq("public_token", value: token)
            .eq("active", value: true)
            .limit(1)
            .execute()
            .value
        return rows.first?.plantId
    }
}
