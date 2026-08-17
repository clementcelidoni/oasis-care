import AppIntents
import SwiftData
import Foundation

/// Spec §77 — lets Siri/Shortcuts resolve "la zone tropicale", "la
/// serre", "la scène Serre nuit" by name to a real local record. Every
/// query here opens its own ModelContext on SharedModelContainer.shared
/// rather than anything tied to a SwiftUI view hierarchy, since App
/// Intents run outside it — see SharedModelContainer's own doc comment.
@MainActor
struct IrrigationZoneEntity: AppEntity {
    let id: UUID
    let name: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Zone d'irrigation"
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
    static var defaultQuery = IrrigationZoneEntityQuery()
}

@MainActor
struct IrrigationZoneEntityQuery: EntityQuery {
    func entities(for identifiers: [UUID]) async throws -> [IrrigationZoneEntity] {
        let context = ModelContext(SharedModelContainer.shared)
        let zones = try context.fetch(FetchDescriptor<IrrigationZone>())
        return zones.filter { identifiers.contains($0.id) }.map { IrrigationZoneEntity(id: $0.id, name: $0.name) }
    }

    func suggestedEntities() async throws -> [IrrigationZoneEntity] {
        let context = ModelContext(SharedModelContainer.shared)
        return try context.fetch(FetchDescriptor<IrrigationZone>()).map { IrrigationZoneEntity(id: $0.id, name: $0.name) }
    }
}

@MainActor
struct GreenhouseEntity: AppEntity {
    let id: UUID
    let name: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Serre"
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
    static var defaultQuery = GreenhouseEntityQuery()
}

@MainActor
struct GreenhouseEntityQuery: EntityQuery {
    func entities(for identifiers: [UUID]) async throws -> [GreenhouseEntity] {
        let context = ModelContext(SharedModelContainer.shared)
        let greenhouses = try context.fetch(FetchDescriptor<Greenhouse>())
        return greenhouses.filter { identifiers.contains($0.id) }.map { GreenhouseEntity(id: $0.id, name: $0.name) }
    }

    func suggestedEntities() async throws -> [GreenhouseEntity] {
        let context = ModelContext(SharedModelContainer.shared)
        return try context.fetch(FetchDescriptor<Greenhouse>()).map { GreenhouseEntity(id: $0.id, name: $0.name) }
    }
}

@MainActor
struct OasisSceneEntity: AppEntity {
    let id: UUID
    let name: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Scène"
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
    static var defaultQuery = OasisSceneEntityQuery()
}

@MainActor
struct OasisSceneEntityQuery: EntityQuery {
    func entities(for identifiers: [UUID]) async throws -> [OasisSceneEntity] {
        let context = ModelContext(SharedModelContainer.shared)
        let scenes = try context.fetch(FetchDescriptor<OasisScene>())
        return scenes.filter { identifiers.contains($0.id) }.map { OasisSceneEntity(id: $0.id, name: $0.name) }
    }

    func suggestedEntities() async throws -> [OasisSceneEntity] {
        let context = ModelContext(SharedModelContainer.shared)
        return try context.fetch(FetchDescriptor<OasisScene>()).map { OasisSceneEntity(id: $0.id, name: $0.name) }
    }
}
