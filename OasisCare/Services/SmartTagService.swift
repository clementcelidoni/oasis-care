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
        tag.plant?.smartTags.removeAll { $0.id == tag.id }
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
