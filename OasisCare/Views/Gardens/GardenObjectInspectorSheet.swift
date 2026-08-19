import SwiftData
import SwiftUI

/// Spec Phase 6C — edit one placed object's transform, vegetation
/// sizing, and real-entity link; "toucher l'objet ouvre la vraie
/// fiche" is the Ouvrir row here once linked. Edits are staged in
/// local @State and committed in `save()`, called from `onDisappear`
/// so every dismissal path (Fermer button, swipe-down, tapping outside)
/// saves the same way — a button-only save would silently drop edits
/// on a swipe-to-dismiss.
struct GardenObjectInspectorSheet: View {
    @ObservedObject var engine: GardenMapEngine
    var object: GardenMapObject

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var label: String
    @State private var rotationDegrees: Double
    @State private var widthMeters: Double
    @State private var heightMeters: Double
    @State private var canopyMeters: Double
    @State private var adultCanopyMeters: Double
    @State private var isConfirmingDelete = false
    @State private var linkedDetail: LinkedDetail?

    /// A single enum + one `.sheet(item:)` rather than two separate
    /// optionals each with their own `.sheet(item:)` — chaining
    /// multiple `.sheet` modifiers on one view is a bug class this
    /// codebase already hit once (PlantDetailView/GardenDetailView,
    /// Phase 1) and fixed by unifying to one `ActiveSheet` enum; this
    /// follows the same established fix rather than reintroducing it.
    private enum LinkedDetail: Identifiable {
        case plant(Plant)
        case sensor(Sensor)

        var id: UUID {
            switch self {
            case .plant(let plant): return plant.id
            case .sensor(let sensor): return sensor.id
            }
        }
    }

    init(engine: GardenMapEngine, object: GardenMapObject) {
        self.engine = engine
        self.object = object
        _label = State(initialValue: object.label ?? "")
        _rotationDegrees = State(initialValue: object.rotationRadians * 180 / .pi)
        _widthMeters = State(initialValue: object.widthMeters)
        _heightMeters = State(initialValue: object.heightMeters)
        _canopyMeters = State(initialValue: object.canopyDiameterMeters ?? object.widthMeters)
        _adultCanopyMeters = State(initialValue: object.estimatedAdultCanopyDiameterMeters ?? object.widthMeters)
    }

    private var linkedPlant: Plant? { engine.resolvedLinkedPlant(for: object) }
    private var linkedSensor: Sensor? { engine.resolvedLinkedSensor(for: object) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Image(systemName: object.objectType.icon)
                            .foregroundStyle(.white)
                            .frame(width: 36, height: 36)
                            .background(Color.accentColor.gradient, in: Circle())
                        TextField("Nom (optionnel)", text: $label)
                    }
                }

                Section("Position") {
                    HStack {
                        Text("Rotation")
                        Slider(value: $rotationDegrees, in: 0...359, step: 1)
                        Text("\(Int(rotationDegrees))°")
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .frame(width: 44, alignment: .trailing)
                    }
                }

                Section("Dimensions") {
                    Stepper(value: $widthMeters, in: 0.1...30, step: 0.1) {
                        HStack {
                            Text("Largeur")
                            Spacer()
                            Text(String(format: "%.1f m", widthMeters)).foregroundStyle(.secondary)
                        }
                    }
                    Stepper(value: $heightMeters, in: 0.1...30, step: 0.1) {
                        HStack {
                            Text("Profondeur")
                            Spacer()
                            Text(String(format: "%.1f m", heightMeters)).foregroundStyle(.secondary)
                        }
                    }
                }

                if object.objectType.isVegetation {
                    Section {
                        Stepper(value: $canopyMeters, in: 0.1...30, step: 0.1) {
                            HStack {
                                Text("Houppier actuel")
                                Spacer()
                                Text(String(format: "%.1f m", canopyMeters)).foregroundStyle(.secondary)
                            }
                        }
                        Stepper(value: $adultCanopyMeters, in: 0.1...30, step: 0.1) {
                            HStack {
                                Text("Houppier adulte estimé")
                                Spacer()
                                Text(String(format: "%.1f m", adultCanopyMeters)).foregroundStyle(.secondary)
                            }
                        }
                    } header: {
                        Text("Arbre à l'échelle")
                    } footer: {
                        Text("Le plan affiche la taille actuelle. La taille adulte estimée servira au mode simulation (Phase 6G).")
                    }
                }

                Section("Entité liée") {
                    if let linkedPlant {
                        Button {
                            linkedDetail = .plant(linkedPlant)
                        } label: {
                            Label("Ouvrir \(linkedPlant.customName)", systemImage: "arrow.up.forward.square")
                        }
                        Button("Retirer le lien", role: .destructive) {
                            engine.linkObject(object, entityId: nil, kind: nil, context: modelContext)
                        }
                    } else if let linkedSensor {
                        Button {
                            linkedDetail = .sensor(linkedSensor)
                        } label: {
                            Label("Ouvrir \(linkedSensor.name)", systemImage: "arrow.up.forward.square")
                        }
                        Button("Retirer le lien", role: .destructive) {
                            engine.linkObject(object, entityId: nil, kind: nil, context: modelContext)
                        }
                    } else {
                        linkMenu
                    }
                }

                Section {
                    Button("Supprimer cet objet", role: .destructive) {
                        isConfirmingDelete = true
                    }
                }
            }
            .navigationTitle(object.objectType.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .onDisappear { save() }
            .confirmationDialog("Supprimer cet objet ?", isPresented: $isConfirmingDelete, titleVisibility: .visible) {
                Button("Supprimer", role: .destructive) {
                    engine.removeObject(object, context: modelContext)
                    dismiss()
                }
                Button("Annuler", role: .cancel) {}
            }
            .sheet(item: $linkedDetail) { detail in
                switch detail {
                case .plant(let plant):
                    NavigationStack { PlantDetailView(plant: plant) }
                case .sensor(let sensor):
                    SensorDetailSheet(sensor: sensor)
                }
            }
        }
    }

    private var linkMenu: some View {
        Menu {
            if !engine.garden.plants.isEmpty {
                Menu("Végétal") {
                    ForEach(engine.garden.plants) { plant in
                        Button(plant.customName) {
                            engine.linkObject(object, entityId: plant.id, kind: .plant, context: modelContext)
                        }
                    }
                }
            }
            if !engine.garden.sensors.isEmpty {
                Menu("Capteur") {
                    ForEach(engine.garden.sensors) { sensor in
                        Button(sensor.name) {
                            engine.linkObject(object, entityId: sensor.id, kind: .sensor, context: modelContext)
                        }
                    }
                }
            }
        } label: {
            Label("Associer à un élément existant", systemImage: "link")
        }
    }

    private func save() {
        engine.renameObject(object, label: label, context: modelContext)
        engine.rotateObject(object, to: rotationDegrees * .pi / 180, context: modelContext)
        engine.resizeObject(object, widthMeters: widthMeters, heightMeters: heightMeters, context: modelContext)
        if object.objectType.isVegetation {
            engine.setCanopy(object, currentMeters: canopyMeters, adultMeters: adultCanopyMeters, context: modelContext)
        }
    }
}
