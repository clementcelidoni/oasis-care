import SwiftData
import SwiftUI

/// Spec Phase 7L.
struct AcclimatizationBatchDetailView: View {
    var batch: AcclimatizationBatch

    @Environment(\.modelContext) private var modelContext
    @State private var isShowingAddStep = false
    @State private var isShowingCreatePlants = false
    @State private var isShowingQR = false
    @State private var isShowingNFC = false

    private var subjectName: String {
        "Acclimatation \(batch.cultureBatch?.batchCode ?? "?")"
    }

    var body: some View {
        Form {
            Section {
                if let cultureBatch = batch.cultureBatch {
                    LabeledContent("Lot source", value: cultureBatch.batchCode)
                }
                LabeledContent("Débuté le", value: DateFormatting.shortDate(batch.startedAt))
                if !batch.substrate.isEmpty { LabeledContent("Substrat", value: batch.substrate) }
                if !batch.humidityProgram.isEmpty { LabeledContent("Programme d'humidité", value: batch.humidityProgram) }
                if let temperature = batch.temperature {
                    LabeledContent("Température", value: "\(String(format: "%.1f", temperature)) °C")
                }
                if !batch.location.isEmpty { LabeledContent("Emplacement", value: batch.location) }
                Picker("Statut", selection: Binding(
                    get: { batch.status },
                    set: { batch.status = $0; batch.markDirty() }
                )) {
                    ForEach(AcclimatizationStatus.allCases) { status in
                        Text(status.label).tag(status)
                    }
                }
            }

            Section {
                SmartTagSectionView(
                    subjectName: subjectName, existingTags: batch.smartTags,
                    onShowQR: { isShowingQR = true }, onAssociateNFC: { isShowingNFC = true }
                )
            }

            Section {
                LabeledContent("Plantules initiales", value: "\(batch.initialPlantletCount)")
                Stepper(
                    "Survivants actuels : \(batch.currentSurvivorCount)",
                    value: Binding(
                        get: { batch.currentSurvivorCount },
                        set: { batch.currentSurvivorCount = $0; batch.markDirty() }
                    ),
                    in: 0...batch.initialPlantletCount
                )
                if let rate = batch.survivalRate {
                    LabeledContent("Taux de survie", value: "\(String(format: "%.1f", rate * 100)) %")
                }
            } header: {
                Text("Survie")
            }

            Section {
                if batch.steps.isEmpty {
                    Text("Aucune étape définie.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(batch.steps.sorted { $0.dayOffset < $1.dayOffset }) { step in
                        HStack {
                            Text("J\(step.dayOffset)")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .frame(width: 36, alignment: .leading)
                            Text(step.label)
                        }
                    }
                    .onDelete(perform: deleteSteps)
                }
                Button("Ajouter une étape") { isShowingAddStep = true }
            } header: {
                Text("Étapes du protocole")
            } footer: {
                Text("Vous définissez librement votre propre protocole — ex. Sortie in vitro J0, Humidité élevée J3, Ouverture progressive J7, Serre J14.")
            }

            Section("Notes") {
                TextField("Notes", text: Binding(
                    get: { batch.notes },
                    set: { batch.notes = $0; batch.markDirty() }
                ), axis: .vertical)
                    .lineLimit(2...6)
            }

            if batch.currentSurvivorCount > 0 {
                Section {
                    if batch.plantsCreated {
                        Label("Plantes créées dans Oasis Rare Care", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    } else {
                        Button("Créer les plantes acclimatées") { isShowingCreatePlants = true }
                    }
                } header: {
                    Text("Oasis Rare Care")
                } footer: {
                    Text("Crée un végétal par survivant actuel (\(batch.currentSurvivorCount)), chacun gardant le lien vers son lot d'origine et sa généalogie.")
                }
            }
        }
        .navigationTitle("Acclimatation")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isShowingAddStep) {
            AddAcclimatizationStepSheet(batch: batch)
        }
        .sheet(isPresented: $isShowingCreatePlants) {
            CreateAcclimatizedPlantsSheet(batch: batch)
        }
        .sheet(isPresented: $isShowingQR) {
            QRCodeSheet(subjectName: subjectName, tag: SmartTagService.tag(for: batch, type: .qr, in: modelContext))
        }
        .sheet(isPresented: $isShowingNFC) {
            NFCAssociationSheet(
                subjectName: subjectName, subjectID: batch.id, existingTags: batch.smartTags,
                createTag: { context in SmartTagService.tag(for: batch, type: .nfc, in: context) },
                reassignTag: { tag, context in SmartTagService.reassign(tag, to: batch, in: context) }
            )
        }
    }

    private func deleteSteps(at offsets: IndexSet) {
        let sorted = batch.steps.sorted { $0.dayOffset < $1.dayOffset }
        let idsToRemove = Set(offsets.map { sorted[$0].id })
        batch.steps.removeAll { idsToRemove.contains($0.id) }
        batch.markDirty()
        try? modelContext.save()
    }
}

private struct AddAcclimatizationStepSheet: View {
    var batch: AcclimatizationBatch
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var dayOffset = ""
    @State private var label = ""

    var body: some View {
        NavigationStack {
            Form {
                HStack {
                    Text("Jour")
                    Spacer()
                    TextField("ex. 7", text: $dayOffset)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 60)
                }
                TextField("Étape (ex. Ouverture progressive)", text: $label)
            }
            .navigationTitle("Nouvelle étape")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Ajouter") {
                        guard let day = Int(dayOffset), !label.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                        batch.steps.append(AcclimatizationStep(dayOffset: day, label: label))
                        batch.markDirty()
                        try? modelContext.save()
                        dismiss()
                    }
                    .disabled(Int(dayOffset) == nil || label.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }
}

/// Spec "CRÉER LES PLANTES — éviter une interface lente pour de gros
/// lots." One shared PlantType/garden/zone for the whole batch (asking
/// per-survivor would be absurd for 85 plants) and a single
/// modelContext.save() at the end rather than one per insert.
private struct CreateAcclimatizedPlantsSheet: View {
    var batch: AcclimatizationBatch

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Query private var gardens: [Garden]
    @Query private var zones: [GardenZone]

    @State private var namePrefix: String
    @State private var plantType: PlantType = .houseplant
    @State private var garden: Garden?
    @State private var zone: GardenZone?
    @State private var isCreating = false

    init(batch: AcclimatizationBatch) {
        self.batch = batch
        _namePrefix = State(initialValue: batch.cultureBatch?.speciesName ?? "Plante")
    }

    private var zonesForGarden: [GardenZone] {
        guard let garden else { return [] }
        return zones.filter { $0.garden?.id == garden.id }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("\(batch.currentSurvivorCount) plante(s) seront créées, une par survivant actuel.")
                        .font(.subheadline)
                }
                Section {
                    TextField("Préfixe de nom", text: $namePrefix)
                    Picker("Type", selection: $plantType) {
                        ForEach(PlantType.allCases) { type in
                            Text(type.displayName).tag(type)
                        }
                    }
                    Picker("Jardin", selection: $garden) {
                        Text("Aucun").tag(Garden?.none)
                        ForEach(gardens) { garden in
                            Text(garden.name).tag(Optional(garden))
                        }
                    }
                    if garden != nil {
                        Picker("Zone", selection: $zone) {
                            Text("Aucune").tag(GardenZone?.none)
                            ForEach(zonesForGarden) { zone in
                                Text(zone.name).tag(Optional(zone))
                            }
                        }
                    }
                }
            }
            .navigationTitle("Créer les plantes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        createPlants()
                    } label: {
                        if isCreating {
                            ProgressView()
                        } else {
                            Text("Créer \(batch.currentSurvivorCount)")
                        }
                    }
                    .disabled(isCreating || namePrefix.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func createPlants() {
        isCreating = true
        for index in 1...batch.currentSurvivorCount {
            let plant = Plant(
                customName: "\(namePrefix) #\(index)",
                scientificName: batch.cultureBatch?.speciesProfile?.scientificName,
                type: plantType, garden: garden, zone: zone, originBatch: batch.cultureBatch
            )
            modelContext.insert(plant)
        }
        batch.plantsCreated = true
        batch.markDirty()
        try? modelContext.save()
        isCreating = false
        dismiss()
    }
}
