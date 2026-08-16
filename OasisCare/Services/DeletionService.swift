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

    private static func recordPendingDeletion(id: UUID, type: EntityType, in context: ModelContext) {
        context.insert(PendingDeletion(id: id, entityType: type.rawValue))
    }
}
