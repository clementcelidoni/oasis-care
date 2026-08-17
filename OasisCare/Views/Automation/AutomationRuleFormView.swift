import SwiftUI
import SwiftData

/// Spec §29's "Builder" — Quand [conditions] Alors [actions], plus
/// mode/limits/simulation. `rule == nil` creates a new one (inserted
/// only on Save, matching PlantFormView's pattern); an existing rule
/// edits in place.
struct AutomationRuleFormView: View {
    var rule: AutomationRule?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Garden.name) private var gardens: [Garden]

    @State private var name = ""
    @State private var mode: AutomationMode = .manual
    @State private var scopeGarden: Garden?
    @State private var scopeZone: GardenZone?
    @State private var scopePlant: Plant?
    @State private var conditions: [AutomationCondition] = []
    @State private var actions: [AutomationAction] = []
    @State private var maxRunsPerDay = ""
    @State private var minimumDelayMinutes = ""
    @State private var editingCondition: AutomationCondition?
    @State private var isAddingCondition = false
    @State private var editingAction: AutomationAction?
    @State private var isAddingAction = false
    @State private var simulationResult: [Date]?
    @State private var didLoad = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Nom") {
                    TextField("Ex. Arrosage matinal Zone 3", text: $name)
                }

                Section("Portée") {
                    Picker("Jardin", selection: $scopeGarden) {
                        Text("Aucun").tag(Garden?.none)
                        ForEach(gardens) { garden in Text(garden.name).tag(Garden?.some(garden)) }
                    }
                    if let scopeGarden {
                        Picker("Zone", selection: $scopeZone) {
                            Text("Aucune").tag(GardenZone?.none)
                            ForEach(scopeGarden.zones) { zone in Text(zone.name).tag(GardenZone?.some(zone)) }
                        }
                        Picker("Végétal", selection: $scopePlant) {
                            Text("Aucun").tag(Plant?.none)
                            ForEach(scopeGarden.plants) { plant in Text(plant.customName).tag(Plant?.some(plant)) }
                        }
                    }
                }

                Section {
                    Picker("Mode", selection: $mode) {
                        ForEach(AutomationMode.allCases) { mode in Text(mode.displayName).tag(mode) }
                    }
                    .pickerStyle(.segmented)
                    Text(mode.explanation)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    ForEach(conditions) { condition in
                        Button { editingCondition = condition } label: {
                            ConditionRow(condition: condition)
                        }
                        .buttonStyle(.plain)
                    }
                    .onDelete { offsets in conditions.remove(atOffsets: offsets) }
                    Button("Ajouter une condition") { isAddingCondition = true }
                } header: {
                    Text("Quand (toutes les conditions)")
                }

                Section {
                    ForEach(actions) { action in
                        Button { editingAction = action } label: {
                            Text(action.type.displayName)
                        }
                        .buttonStyle(.plain)
                    }
                    .onDelete { offsets in actions.remove(atOffsets: offsets) }
                    Button("Ajouter une action") { isAddingAction = true }
                } header: {
                    Text("Alors")
                }

                Section {
                    TextField("Nombre max. de déclenchements par jour", text: $maxRunsPerDay)
                        .keyboardType(.numberPad)
                    TextField("Délai minimum entre deux déclenchements (min)", text: $minimumDelayMinutes)
                        .keyboardType(.numberPad)
                } header: {
                    Text("Limites")
                }

                Section {
                    Button("Simuler sur les 7 derniers jours") { runSimulation() }
                        .disabled(conditions.isEmpty)
                    if let simulationResult {
                        if simulationResult.isEmpty {
                            Text("Cette règle ne se serait pas déclenchée.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Cette règle aurait déclenché :")
                                .font(.caption.weight(.medium))
                            ForEach(simulationResult, id: \.self) { date in
                                Text(date.formatted(.dateTime.weekday(.wide).hour().minute()))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Test")
                }

                if rule != nil {
                    Section {
                        Button("Supprimer cette automatisation", role: .destructive) { deleteRule() }
                    }
                }
            }
            .navigationTitle(rule == nil ? "Nouvelle automatisation" : "Modifier l'automatisation")
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
            .sheet(isPresented: $isAddingCondition) {
                AutomationConditionEditSheet(condition: nil, scopeGarden: scopeGarden, scopeZone: scopeZone, scopePlant: scopePlant) { newCondition in
                    conditions.append(newCondition)
                }
            }
            .sheet(item: $editingCondition) { condition in
                AutomationConditionEditSheet(condition: condition, scopeGarden: scopeGarden, scopeZone: scopeZone, scopePlant: scopePlant) { _ in }
            }
            .sheet(isPresented: $isAddingAction) {
                AutomationActionEditSheet(action: nil, scopeGarden: scopeGarden, scopeZone: scopeZone, scopePlant: scopePlant) { newAction in
                    actions.append(newAction)
                }
            }
            .sheet(item: $editingAction) { action in
                AutomationActionEditSheet(action: action, scopeGarden: scopeGarden, scopeZone: scopeZone, scopePlant: scopePlant) { _ in }
            }
            .task {
                guard !didLoad else { return }
                didLoad = true
                if let rule {
                    name = rule.name
                    mode = rule.mode
                    scopeGarden = rule.scopeGarden
                    scopeZone = rule.scopeZone
                    scopePlant = rule.scopePlant
                    conditions = rule.conditions.sorted { $0.order < $1.order }
                    actions = rule.actions.sorted { $0.order < $1.order }
                    maxRunsPerDay = rule.maxRunsPerDay.map(String.init) ?? ""
                    minimumDelayMinutes = rule.minimumDelayBetweenRunsMinutes.map(String.init) ?? ""
                }
            }
        }
    }

    private func runSimulation() {
        let scratchRule = rule ?? AutomationRule(name: name)
        scratchRule.conditions = conditions
        simulationResult = AutomationEngine.simulate(scratchRule, overPastDays: 7)
    }

    private func save() {
        let target = rule ?? AutomationRule(name: name)
        target.name = name
        target.mode = mode
        target.scopeGarden = scopeGarden
        target.scopeZone = scopeZone
        target.scopePlant = scopePlant
        target.maxRunsPerDay = Int(maxRunsPerDay)
        target.minimumDelayBetweenRunsMinutes = Int(minimumDelayMinutes)
        if target.syncStatus == .synced { target.syncStatus = .pendingUpdate }
        target.updatedAt = .now

        if rule == nil {
            modelContext.insert(target)
        }
        for (index, condition) in conditions.enumerated() {
            condition.order = index
            condition.rule = target
            // insert(_:) on an object already tracked by this context
            // is a safe no-op — simpler than checking whether each one
            // is new (just-created in the add sheet) or pre-existing
            // (loaded from rule.conditions).
            modelContext.insert(condition)
        }
        for (index, action) in actions.enumerated() {
            action.order = index
            action.rule = target
            modelContext.insert(action)
        }
        // Conditions/actions removed from the local arrays during this
        // session are simply left with rule == nil going forward; the
        // .cascade delete rule only fires when the *rule* is deleted, so
        // orphaned removals are cleaned up explicitly here instead.
        let keptConditionIDs = Set(conditions.map(\.id))
        for existing in target.conditions where !keptConditionIDs.contains(existing.id) {
            modelContext.delete(existing)
        }
        let keptActionIDs = Set(actions.map(\.id))
        for existing in target.actions where !keptActionIDs.contains(existing.id) {
            modelContext.delete(existing)
        }

        try? modelContext.save()
        dismiss()
    }

    private func deleteRule() {
        guard let rule else { return }
        DeletionService.delete(rule, in: modelContext)
        try? modelContext.save()
        dismiss()
    }
}

private struct ConditionRow: View {
    var condition: AutomationCondition

    var body: some View {
        HStack {
            Text(condition.type.displayName)
                .font(.subheadline)
            Spacer()
            if let threshold = condition.numericThreshold {
                Text(threshold.formatted())
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
