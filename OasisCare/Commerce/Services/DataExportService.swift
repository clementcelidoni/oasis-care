import Foundation

/// Phase 12 §"12M — EXPORT DES DONNÉES." JSON only for now — "Formats
/// adaptés : JSON, CSV lorsque pertinent, ZIP pour export complet si
/// raisonnable" hedges all three as options, and JSON alone already
/// faithfully represents every field without inventing a CSV column
/// layout or bundling photos into a ZIP this session has no way to
/// build and verify. See the Phase 12 report's limitations section for
/// what a CSV/ZIP-with-photos follow-up would add.
///
/// Scope: plants, gardens, care history and measurements — the
/// categories spec names first and that most directly answer "what do
/// you know about me." BioLab and connected-device data are real,
/// separate follow-up categories (a lab's worth of recipes/batches is
/// a different shape of export than personal plant data) rather than
/// squeezed into the same flat structure — see the report.
enum DataExportService {
    struct ExportedPlant: Encodable {
        var name: String
        var species: String?
        var commonName: String?
        var isIndoor: Bool
        var healthStatus: String
        var dateAdded: Date
        var notes: String
        var careEvents: [ExportedCareEvent]
        var measurements: [ExportedMeasurement]
    }
    struct ExportedCareEvent: Encodable {
        var type: String
        var date: Date
        var notes: String
    }
    struct ExportedMeasurement: Encodable {
        var date: Date
        var height: Double?
        var canopyDiameter: Double?
        var trunkCircumference: Double?
    }
    struct ExportedGarden: Encodable {
        var name: String
        var locationName: String?
        var zoneNames: [String]
    }
    struct ExportBundle: Encodable {
        var exportedAt: Date
        var plants: [ExportedPlant]
        var gardens: [ExportedGarden]
    }

    static func buildExport(plants: [Plant], gardens: [Garden]) -> Data? {
        let exportedPlants = plants.map { plant in
            ExportedPlant(
                name: plant.customName,
                species: plant.scientificName,
                commonName: plant.commonName,
                isIndoor: plant.isIndoor,
                healthStatus: plant.healthStatus.rawValue,
                dateAdded: plant.dateAdded,
                notes: plant.notes,
                careEvents: plant.careEvents.map {
                    ExportedCareEvent(type: $0.type.rawValue, date: $0.date, notes: $0.notes)
                },
                measurements: plant.measurements.map {
                    ExportedMeasurement(date: $0.date, height: $0.height, canopyDiameter: $0.canopyDiameter, trunkCircumference: $0.trunkCircumference)
                }
            )
        }
        let exportedGardens = gardens.map { garden in
            ExportedGarden(name: garden.name, locationName: garden.locationName, zoneNames: garden.zones.map(\.name))
        }
        let bundle = ExportBundle(exportedAt: .now, plants: exportedPlants, gardens: exportedGardens)

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try? encoder.encode(bundle)
    }
}
