import SwiftData
import SwiftUI

/// Spec Phase 6F — "GardenMicroclimate... exemple: Zone piscine, +2,1°C
/// vs moyenne du jardin, Très ensoleillée, Vent modéré, Sol sec."
/// Descriptors are Saisie utilisateur; the temperature delta (if shown
/// at all) is computed fresh from real sensor readings, never entered
/// by hand — see `temperatureDelta`.
///
/// "Oasis AI peut identifier des microclimates" (automatic detection
/// from sensor/light/humidity/temperature history) is not built this
/// pass — it needs spatial+temporal clustering across sparse sensor
/// data, a substantially different and larger problem than the rest of
/// this sub-phase; manual description plus the one real computed
/// signal (temperature delta) is what ships now.
struct MicroclimateEditSheet: View {
    @ObservedObject var engine: GardenMapEngine
    var area: GardenArea

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var sunLevel: MicroclimateSunLevel?
    @State private var windLevel: MicroclimateWindLevel?
    @State private var soilLevel: MicroclimateSoilLevel?
    @State private var notes: String

    init(engine: GardenMapEngine, area: GardenArea) {
        self.engine = engine
        self.area = area
        _sunLevel = State(initialValue: area.microclimateSunLevel)
        _windLevel = State(initialValue: area.microclimateWindLevel)
        _soilLevel = State(initialValue: area.microclimateSoilLevel)
        _notes = State(initialValue: area.microclimateNotes ?? "")
    }

    /// Spec: "toujours distinguer mesure et estimation" — only shown
    /// when there's a real temperature sensor (linked to a
    /// GardenMapObject) both inside this zone and elsewhere in the
    /// garden to compare against; nil otherwise, never guessed.
    private var temperatureDelta: Double? {
        let temperatureSamples: [(position: GardenCoordinate, value: Double)] = engine.garden.mapObjects.compactMap { object in
            guard object.objectType == .sensor, let sensor = engine.resolvedLinkedSensor(for: object),
                  sensor.type == .airTemperature, let value = sensor.latestReading?.value else { return nil }
            return (object.position, value)
        }
        let inZone = temperatureSamples.filter { GardenGeometry.contains($0.position, polygon: area.points) }
        let outsideZone = temperatureSamples.filter { !GardenGeometry.contains($0.position, polygon: area.points) }
        guard !inZone.isEmpty, !outsideZone.isEmpty else { return nil }
        let zoneAverage = inZone.map(\.value).reduce(0, +) / Double(inZone.count)
        let gardenAverage = outsideZone.map(\.value).reduce(0, +) / Double(outsideZone.count)
        return zoneAverage - gardenAverage
    }

    var body: some View {
        NavigationStack {
            Form {
                if let temperatureDelta {
                    Section {
                        LabeledContent("Écart de température", value: "\(temperatureDelta >= 0 ? "+" : "")\(String(format: "%.1f", temperatureDelta)) °C vs reste du jardin")
                    } footer: {
                        Text("Mesuré à partir des capteurs de température placés sur le plan.")
                    }
                }

                Section("Ensoleillement") {
                    Picker("Ensoleillement", selection: $sunLevel) {
                        Text("Non renseigné").tag(MicroclimateSunLevel?.none)
                        ForEach(MicroclimateSunLevel.allCases) { level in
                            Text(level.label).tag(Optional(level))
                        }
                    }
                }

                Section("Vent") {
                    Picker("Vent", selection: $windLevel) {
                        Text("Non renseigné").tag(MicroclimateWindLevel?.none)
                        ForEach(MicroclimateWindLevel.allCases) { level in
                            Text(level.label).tag(Optional(level))
                        }
                    }
                }

                Section("Sol") {
                    Picker("Sol", selection: $soilLevel) {
                        Text("Non renseigné").tag(MicroclimateSoilLevel?.none)
                        ForEach(MicroclimateSoilLevel.allCases) { level in
                            Text(level.label).tag(Optional(level))
                        }
                    }
                }

                Section("Notes") {
                    TextField("Observations libres", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle("Microclimat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .onDisappear {
                engine.setMicroclimate(area, sunLevel: sunLevel, windLevel: windLevel, soilLevel: soilLevel, notes: notes, context: modelContext)
            }
        }
    }
}
