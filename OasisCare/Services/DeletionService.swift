import Foundation
import SwiftData

/// Single entry point for deleting synced objects — pairs the local
/// SwiftData delete with a PendingDeletion tombstone in the same
/// operation, so nothing can be removed locally without the cloud side
/// eventually finding out. `entityType` values match the Postgres table
/// names in supabase/migrations, since that's what the sync engine sends
/// the delete request to.
enum DeletionService {
    enum EntityType: String {
        case garden = "gardens"
        case gardenZone = "garden_zones"
        case plant = "plants"
        case irrigationZone = "irrigation_zones"
        case smartTag = "smart_tags"
        case treeInspection = "tree_inspections"
        case gardenCheckup = "garden_checkups"
        case connectedDevice = "connected_devices"
    }

    static func delete(_ garden: Garden, in context: ModelContext) {
        recordPendingDeletion(id: garden.id, type: .garden, in: context)
        context.delete(garden)
    }

    static func delete(_ zone: GardenZone, in context: ModelContext) {
        recordPendingDeletion(id: zone.id, type: .gardenZone, in: context)
        context.delete(zone)
    }

    static func delete(_ plant: Plant, in context: ModelContext) {
        recordPendingDeletion(id: plant.id, type: .plant, in: context)
        context.delete(plant)
    }

    static func delete(_ zone: IrrigationZone, in context: ModelContext) {
        recordPendingDeletion(id: zone.id, type: .irrigationZone, in: context)
        context.delete(zone)
    }

    static func delete(_ tag: SmartTag, in context: ModelContext) {
        recordPendingDeletion(id: tag.id, type: .smartTag, in: context)
        context.delete(tag)
    }

    static func delete(_ inspection: TreeInspection, in context: ModelContext) {
        recordPendingDeletion(id: inspection.id, type: .treeInspection, in: context)
        context.delete(inspection)
    }

    /// Abandons an in-progress check-up (its entries cascade-delete
    /// with it) — without this, activeOrNewCheckup would resume the
    /// same session forever, with no way to restart with a different
    /// filter once progress exists.
    static func delete(_ checkup: GardenCheckup, in context: ModelContext) {
        recordPendingDeletion(id: checkup.id, type: .gardenCheckup, in: context)
        context.delete(checkup)
    }

    static func delete(_ device: ConnectedDevice, in context: ModelContext) {
        recordPendingDeletion(id: device.id, type: .connectedDevice, in: context)
        context.delete(device)
    }

    private static func recordPendingDeletion(id: UUID, type: EntityType, in context: ModelContext) {
        context.insert(PendingDeletion(id: id, entityType: type.rawValue))
    }
}
