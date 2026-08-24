import SwiftData
import SwiftUI

/// Spec Phase 7B.
struct CultureBatchDetailView: View {
    var batch: CultureBatch
    @Environment(\.modelContext) private var modelContext
    @Query private var allExperiments: [BioLabExperiment]

    @State private var isShowingSplit = false
    @State private var isShowingDiscardConfirm = false
    @State private var inspectionSheet: InspectionSheet?
    @State private var isShowingAcclimatizationForm = false

    private var lineageRoot: CultureLineageService.LineageNode {
        CultureLineageService.tree(for: batch)
    }
    private var motherPlant: Plant? {
        CultureLineageService.motherPlant(for: batch)
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Code", value: batch.batchCode)
                LabeledContent("Espèce", value: batch.speciesName)
                if let motherPlant {
                    NavigationLink {
                        PlantDetailView(plant: motherPlant)
                    } label: {
                        LabeledContent("Plante mère", value: motherPlant.customName)
                    }
                }
                Picker("Stade", selection: Binding(
                    get: { batch.cultureStage },
                    set: { batch.cultureStage = $0; batch.markDirty() }
                )) {
                    ForEach(CultureStage.allCases) { stage in
                        Text(stage.label).tag(stage)
                    }
                }
                LabeledContent("Statut", value: batch.status.label)
                LabeledContent("Explants", value: "\(batch.currentCount) (initial \(batch.initialExplantCount))")
                LabeledContent("Débuté le", value: DateFormatting.shortDate(batch.startedAt))
                Picker("Groupe d'expérimentation", selection: Binding(
                    get: { batch.experimentGroup },
                    set: { batch.experimentGroup = $0; batch.markDirty() }
                )) {
                    Text("Aucun").tag(ExperimentGroup?.none)
                    ForEach(allExperiments) { experiment in
                        ForEach(experiment.groups) { group in
                            Text("\(experiment.code) — \(group.name)").tag(Optional(group))
                        }
                    }
                }
            }

            Section("Généalogie") {
                OutlineGroup([lineageRoot], children: \.children) { node in
                    HStack {
                        if node.id == batch.id {
                            Image(systemName: "arrow.right.circle.fill").foregroundStyle(.teal)
                        }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(node.title).fontWeight(node.id == batch.id ? .semibold : .regular)
                            Text(node.subtitle).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section {
                // Spec Phase 7H "TIMELINE" — J0 inoculation, J7
                // multiplication, J14 inspection... rendered here as
                // days-since-start next to each inspection's most
                // notable finding, rather than a separate dedicated
                // timeline view.
                if batch.inspections.isEmpty {
                    Text("Aucune inspection enregistrée.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(batch.inspections.sorted { $0.date < $1.date }) { inspection in
                        Button {
                            inspectionSheet = .edit(inspection)
                        } label: {
                            HStack(alignment: .top, spacing: 10) {
                                Text("J\(dayNumber(for: inspection))")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .frame(width: 32, alignment: .leading)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(inspectionSummary(inspection))
                                        .foregroundStyle(.primary)
                                    Text(DateFormatting.shortDate(inspection.date))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                Button("Ajouter une inspection") { inspectionSheet = .add }
            } header: {
                Text("Inspections")
            }

            Section {
                if batch.acclimatizationBatches.isEmpty {
                    Text("Aucune acclimatation en cours.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(batch.acclimatizationBatches.sorted { $0.startedAt > $1.startedAt }) { accBatch in
                        NavigationLink {
                            AcclimatizationBatchDetailView(batch: accBatch)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(accBatch.currentSurvivorCount) / \(accBatch.initialPlantletCount) survivants")
                                Text(accBatch.status.label)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Button("Démarrer une acclimatation") { isShowingAcclimatizationForm = true }
            } header: {
                Text("Acclimatation")
            }

            Section("Notes") {
                TextField("Notes", text: Binding(
                    get: { batch.notes },
                    set: { batch.notes = $0; batch.markDirty() }
                ), axis: .vertical)
                    .lineLimit(2...6)
            }

            if batch.status == .active {
                Section {
                    Button("Diviser le lot") { isShowingSplit = true }
                    Button("Écarter le lot", role: .destructive) { isShowingDiscardConfirm = true }
                }
            }
        }
        .navigationTitle(batch.batchCode)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isShowingSplit) {
            CultureBatchSplitSheet(batch: batch)
        }
        .sheet(item: $inspectionSheet) { sheet in
            switch sheet {
            case .add:
                BioreactorInspectionFormView(batch: batch, inspection: nil)
            case .edit(let inspection):
                BioreactorInspectionFormView(batch: batch, inspection: inspection)
            }
        }
        .sheet(isPresented: $isShowingAcclimatizationForm) {
            AcclimatizationBatchFormView(cultureBatch: batch)
        }
        .confirmationDialog("Écarter ce lot ?", isPresented: $isShowingDiscardConfirm, titleVisibility: .visible) {
            Button("Écarter", role: .destructive) {
                CultureBatchService.discard(batch, reason: "")
                try? modelContext.save()
            }
            Button("Annuler", role: .cancel) {}
        }
    }

    private func dayNumber(for inspection: BioreactorInspection) -> Int {
        max(0, Calendar.current.dateComponents([.day], from: batch.startedAt, to: inspection.date).day ?? 0)
    }

    /// Most safety-relevant finding first, matching the spec's own
    /// timeline example labels (e.g. "hyperhydricité légère") rather
    /// than a generic "Inspection" whenever there's something notable
    /// to actually name.
    private func inspectionSummary(_ inspection: BioreactorInspection) -> String {
        if inspection.contaminationStatus == .confirmed { return "Contamination confirmée" }
        if inspection.contaminationStatus == .suspected { return "Contamination suspectée" }
        if inspection.hyperhydricityStatus != .none, inspection.hyperhydricityStatus != .unknown {
            return "Hyperhydricité \(inspection.hyperhydricityStatus.label.lowercased())"
        }
        if inspection.necrosisStatus != .none, inspection.necrosisStatus != .unknown {
            return "Nécrose \(inspection.necrosisStatus.label.lowercased())"
        }
        if inspection.browningStatus != .none, inspection.browningStatus != .unknown {
            return "Brunissement \(inspection.browningStatus.label.lowercased())"
        }
        return "Inspection"
    }
}

private enum InspectionSheet: Identifiable {
    case add
    case edit(BioreactorInspection)

    var id: String {
        switch self {
        case .add: return "add"
        case .edit(let inspection): return inspection.id.uuidString
        }
    }
}

private struct CultureBatchSplitSheet: View {
    var batch: CultureBatch
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var splitCounts: [String] = ["", ""]

    private var parsedCounts: [Int] {
        splitCounts.compactMap { Int($0) }.filter { $0 > 0 }
    }
    private var totalSplit: Int { parsedCounts.reduce(0, +) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Explants disponibles", value: "\(batch.currentCount)")
                } footer: {
                    if totalSplit > batch.currentCount {
                        Text("Le total dépasse le nombre d'explants disponibles.")
                            .foregroundStyle(.red)
                    }
                }

                Section("Nouveaux lots") {
                    ForEach(splitCounts.indices, id: \.self) { index in
                        HStack {
                            Text("Lot \(splitLabel(for: index))")
                            Spacer()
                            TextField("explants", text: $splitCounts[index])
                                .keyboardType(.numberPad)
                                .multilineTextAlignment(.trailing)
                                .frame(width: 80)
                        }
                    }
                    Button("Ajouter un lot") { splitCounts.append("") }
                }
            }
            .navigationTitle("Diviser \(batch.batchCode)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Diviser") {
                        _ = CultureBatchService.split(batch, into: parsedCounts, context: modelContext)
                        dismiss()
                    }
                    .disabled(parsedCounts.count < 2 || totalSplit > batch.currentCount)
                }
            }
        }
    }

    private func splitLabel(for index: Int) -> String {
        let letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        if index < letters.count {
            return String(letters[letters.index(letters.startIndex, offsetBy: index)])
        }
        return "\(index + 1)"
    }
}
