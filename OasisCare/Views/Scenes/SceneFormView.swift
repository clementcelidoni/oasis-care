import SwiftUI
import SwiftData

/// Spec §79-80. `scene == nil` creates a new one, inserted only on Save —
/// same pattern as AutomationRuleFormView/GreenhouseFormView.
struct SceneFormView: View {
    var garden: Garden
    var scene: OasisScene?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext

    @State private var name = ""
    @State private var icon = "sparkles"
    @State private var greenhouse: Greenhouse?
    @State private var climateControlChoice: ClimateControlChoice = .unchanged
    @State private var actions: [OasisSceneAction] = []
    @State private var editingAction: OasisSceneAction?
    @State private var isAddingAction = false

    private enum ClimateControlChoice: String, CaseIterable, Identifiable {
        case unchanged, enable, disable
        var id: String { rawValue }
        var label: String {
            switch self {
            case .unchanged: return "Ne pas modifier"
            case .enable: return "Activer"
            case .disable: return "Désactiver"
            }
        }
    }

    private static let iconChoices = ["sparkles", "moon.stars.fill", "sun.max.fill", "thermometer.snowflake", "airplane", "wrench.and.screwdriver.fill"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Nom") {
                    TextField("Ex. Serre nuit", text: $name)
                    Picker("Icône", selection: $icon) {
                        ForEach(Self.iconChoices, id: \.self) { icon in
                            Label(icon, systemImage: icon).labelStyle(.iconOnly).tag(icon)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                if !garden.greenhouses.isEmpty {
                    Section {
                        Picker("Serre", selection: $greenhouse) {
                            Text("Aucune").tag(Greenhouse?.none)
                            ForEach(garden.greenhouses) { greenhouse in
                                Text(greenhouse.name).tag(Greenhouse?.some(greenhouse))
                            }
                        }
                        if greenhouse != nil {
                            Picker("Pilotage automatique", selection: $climateControlChoice) {
                                ForEach(ClimateControlChoice.allCases) { choice in
                                    Text(choice.label).tag(choice)
                                }
                            }
                        }
                    } header: {
                        Text("Serre")
                    } footer: {
                        Text("« Activer »/« Désactiver » bascule le pilotage automatique de la serre (spec §80 : Ventilation/Chauffage/Brumisation « Auto ») plutôt que de forcer un état précis pour chacun.")
                    }
                }

                Section {
                    ForEach(actions) { action in
                        Button { editingAction = action } label: {
                            HStack {
                                Text(action.device?.name ?? "?")
                                Spacer()
                                Text(action.targetOn ? "Marche" : "Arrêt")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                    .onDelete { offsets in actions.remove(atOffsets: offsets) }
                    Button("Ajouter une action") { isAddingAction = true }
                } header: {
                    Text("Actions")
                }

                if scene != nil {
                    Section {
                        Button("Supprimer cette scène", role: .destructive) { deleteScene() }
                    }
                }
            }
            .navigationTitle(scene == nil ? "Nouvelle scène" : "Modifier la scène")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .sheet(isPresented: $isAddingAction) {
                SceneActionEditSheet(action: nil, availableDevices: garden.connectedDevices) { newAction in
                    actions.append(newAction)
                }
            }
            .sheet(item: $editingAction) { action in
                SceneActionEditSheet(action: action, availableDevices: garden.connectedDevices) { _ in }
            }
            .task {
                guard let scene else { return }
                name = scene.name
                icon = scene.icon
                greenhouse = scene.greenhouse
                climateControlChoice = scene.setClimateControlEnabled.map { $0 ? .enable : .disable } ?? .unchanged
                actions = scene.actions.sorted { $0.order < $1.order }
            }
        }
    }

    private func save() {
        let target = scene ?? OasisScene(name: name, icon: icon, garden: garden)
        target.name = name
        target.icon = icon
        target.greenhouse = greenhouse
        target.setClimateControlEnabled = greenhouse == nil ? nil : {
            switch climateControlChoice {
            case .unchanged: return nil
            case .enable: return true
            case .disable: return false
            }
        }()
        if target.syncStatus == .synced { target.syncStatus = .pendingUpdate }
        target.updatedAt = .now

        if scene == nil {
            modelContext.insert(target)
        }
        for (index, action) in actions.enumerated() {
            action.order = index
            action.scene = target
            modelContext.insert(action)
        }
        let keptActionIDs = Set(actions.map(\.id))
        for existing in target.actions where !keptActionIDs.contains(existing.id) {
            modelContext.delete(existing)
        }

        try? modelContext.save()
        dismiss()
    }

    private func deleteScene() {
        guard let scene else { return }
        DeletionService.delete(scene, in: modelContext)
        try? modelContext.save()
        dismiss()
    }
}
