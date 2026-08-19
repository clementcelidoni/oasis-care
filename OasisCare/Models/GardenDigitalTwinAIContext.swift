import Foundation

/// Spec Phase 6L — "GardenDigitalTwinAIContext... contient uniquement
/// les données pertinentes : géométrie, végétaux, espèces, dimensions,
/// santé, irrigation, capteurs, météo, soleil, tâches, croissance
/// estimée." Zone-scoped (not a flat garden-wide dump) because every
/// one of spec's own example questions is really "which ZONE" —
/// "où planter," "quelle zone est la plus sèche" — so the AI needs
/// per-zone facts to compare, not just totals. Built fresh per request
/// from already-computed services, the same "summarize, never dump the
/// raw database" rule GardenAIContext already follows.
struct GardenDigitalTwinAIContext: Encodable {
    struct ZoneSummary: Encodable {
        var id: String
        var name: String
        var areaType: String
        var areaSquareMeters: Double
        var plantNames: [String]
        var speciesNames: [String]
        var healthCounts: [String: Int]
        var sunExposure: String?
        var hasSprinklerCoverage: Bool
        var pendingTaskCount: Int
        var growthNotes: [String]
    }

    var gardenName: String?
    var zones: [ZoneSummary]
    var weather: GardenAIContext.WeatherSummary?

    /// Deliberately not @MainActor — GardenMapEngine itself isn't (see
    /// its own doc comment on why), so this stays a plain synchronous
    /// function to match, callable from wherever the engine already is.
    static func build(engine: GardenMapEngine, weather: GardenAIContext.WeatherSummary? = nil) -> GardenDigitalTwinAIContext {
        let garden = engine.garden
        let zones = garden.areas.map { area -> ZoneSummary in
            let plants = engine.plants(inArea: area)
            var healthCounts: [String: Int] = [:]
            for plant in plants { healthCounts[plant.healthStatus.displayName, default: 0] += 1 }

            let objectsInZone = garden.mapObjects.filter { GardenGeometry.contains($0.position, polygon: area.points) }
            let hasSprinkler = objectsInZone.contains { $0.objectType == .sprinkler }

            var growthNotes: [String] = []
            for object in objectsInZone where object.objectType.isVegetation {
                let currentMeters = object.canopyDiameterMeters ?? object.widthMeters
                guard let adultMeters = object.estimatedAdultCanopyDiameterMeters, adultMeters > currentMeters else { continue }
                let yearsToMaturity = object.estimatedYearsToMaturity ?? object.objectType.defaultYearsToMaturity ?? 15
                let projectedIn5Years = GrowthSimulationService.projectedCanopyDiameterMeters(
                    currentMeters: currentMeters, adultMeters: adultMeters, yearsFromNow: 5, yearsToMaturity: yearsToMaturity
                )
                let label = engine.resolvedLinkedPlant(for: object)?.customName ?? object.label ?? object.objectType.label
                growthNotes.append("\(label) : ≈ \(String(format: "%.1f", currentMeters)) m aujourd'hui, ≈ \(String(format: "%.1f", projectedIn5Years)) m estimé dans 5 ans")
            }

            return ZoneSummary(
                id: area.id.uuidString,
                name: area.name.isEmpty ? area.areaType.label : area.name,
                areaType: area.areaType.label,
                areaSquareMeters: GardenGeometry.areaSquareMeters(of: area.points),
                plantNames: plants.map(\.customName),
                speciesNames: Array(Set(plants.compactMap { $0.scientificName ?? $0.commonName })),
                healthCounts: healthCounts,
                sunExposure: sunExposureSummary(for: area, garden: garden),
                hasSprinklerCoverage: hasSprinkler,
                pendingTaskCount: engine.pendingTaskCount(inArea: area),
                growthNotes: growthNotes
            )
        }
        return GardenDigitalTwinAIContext(gardenName: garden.name, zones: zones, weather: weather)
    }

    /// Mirrors GardenAreasSheet's own sunExposureLabel computation
    /// (same SunExposureService call, same inputs) — kept as a second,
    /// independent read rather than a shared refactor of that view's
    /// already-working private helper, to avoid touching UI code while
    /// building this unrelated AI context.
    private static func sunExposureSummary(for area: GardenArea, garden: Garden) -> String? {
        guard let latitude = garden.latitude, area.points.count >= 3 else { return nil }
        let casters = garden.mapObjects
            .filter { $0.objectType.castsShadow }
            .compactMap { object -> (position: GardenCoordinate, heightMeters: Double, widthMeters: Double)? in
                guard let height = object.structureHeightMeters else { return nil }
                return (object.position, height, object.widthMeters)
            }
        let exposure = SunExposureService.dailySunExposure(
            zoneCentroid: GardenGeometry.centroid(of: area.points), shadowCasters: casters, latitude: latitude, date: .now
        )
        let hours = Int(exposure.litHours)
        return "\(exposure.level.label), \(hours) h estimées aujourd'hui"
    }
}
