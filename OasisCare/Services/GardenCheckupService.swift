import Foundation
import SwiftData

/// Spec §61-65 — the walk-every-plant check-up flow.
enum GardenCheckupService {
    /// Resumes the garden's incomplete check-up if one exists (spec
    /// §64), otherwise starts a fresh one with `filter`.
    static func activeOrNewCheckup(
        for garden: Garden, filter: GardenCheckupFilter, zone: GardenZone?, in context: ModelContext
    ) -> GardenCheckup {
        if let existing = garden.checkups.first(where: { !$0.isComplete }) {
            return existing
        }
        let checkup = GardenCheckup(garden: garden, filterCategory: filter, filterZoneID: zone?.id)
        context.insert(checkup)
        garden.checkups.append(checkup)
        return checkup
    }

    /// Shared by the real check-up scope and the filter-selection
    /// screen's live preview count, so both always agree.
    static func scopedPlants(in garden: Garden, filter: GardenCheckupFilter, zoneID: UUID?) -> [Plant] {
        let base = garden.plants.filter { !$0.isArchived }
        let scoped: [Plant]
        switch filter {
        case .all: scoped = base
        case .trees: scoped = base.filter { $0.type == .tree }
        case .palms: scoped = base.filter { $0.type == .palm }
        case .otherPlants: scoped = base.filter { $0.type != .tree && $0.type != .palm }
        case .needsAttention: scoped = base.filter { $0.healthStatus != .healthy }
        case .zone: scoped = base.filter { $0.zone?.id == zoneID }
        }
        return scoped.sorted { $0.customName < $1.customName }
    }

    /// The full scope for this checkup's filter, in a stable order.
    static func scopedPlants(for checkup: GardenCheckup) -> [Plant] {
        guard let garden = checkup.garden else { return [] }
        return scopedPlants(in: garden, filter: checkup.filterCategory, zoneID: checkup.filterZoneID)
    }

    /// Plants in scope that don't have an entry yet — the walk order.
    static func remainingPlants(for checkup: GardenCheckup) -> [Plant] {
        let checkedIDs = Set(checkup.entries.compactMap { $0.plant?.id })
        return scopedPlants(for: checkup).filter { !checkedIDs.contains($0.id) }
    }

    /// Records one plant's result (spec §64: saved immediately, not
    /// batched) and folds it into the plant's actual healthStatus so a
    /// check-up finding isn't siloed from the rest of the app.
    @discardableResult
    static func recordEntry(
        for plant: Plant, result: TreeInspectionResult, notes: String, checkup: GardenCheckup, in context: ModelContext
    ) -> GardenCheckupEntry? {
        guard !checkup.entries.contains(where: { $0.plant?.id == plant.id }) else { return nil }
        let entry = GardenCheckupEntry(checkup: checkup, plant: plant, result: result, notes: notes)
        context.insert(entry)
        checkup.entries.append(entry)
        plant.checkupEntries.append(entry)

        plant.healthStatus = result.healthStatus
        plant.markDirty()

        return entry
    }

    static func attachPhoto(_ data: Data, to entry: GardenCheckupEntry, plant: Plant, in context: ModelContext) {
        let processed = ImageProcessing.prepareForStorage(data)
        let detailData = processed?.detailData ?? data
        let thumbnailData = processed?.thumbnailData ?? data
        let photo = PlantPhoto(plant: plant, imageData: detailData, thumbnailData: thumbnailData, date: entry.date)
        photo.checkupEntry = entry
        context.insert(photo)
        plant.photos.append(photo)
        entry.photos.append(photo)
    }

    static func complete(_ checkup: GardenCheckup) {
        checkup.completedAt = .now
        checkup.markDirty()
    }

    struct Summary {
        var total: Int
        var counts: [TreeInspectionResult: Int]

        func count(_ result: TreeInspectionResult) -> Int { counts[result] ?? 0 }
    }

    static func summary(for checkup: GardenCheckup) -> Summary {
        var counts: [TreeInspectionResult: Int] = [:]
        for entry in checkup.entries {
            counts[entry.result, default: 0] += 1
        }
        return Summary(total: checkup.entries.count, counts: counts)
    }
}
