import SwiftData
import SwiftUI

/// Spec Phase 7B.
struct CultureBatchDetailView: View {
    var batch: CultureBatch
    @Environment(\.modelContext) private var modelContext

    @State private var isShowingSplit = false
    @State private var isShowingDiscardConfirm = false

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
        .confirmationDialog("Écarter ce lot ?", isPresented: $isShowingDiscardConfirm, titleVisibility: .visible) {
            Button("Écarter", role: .destructive) {
                CultureBatchService.discard(batch, reason: "")
                try? modelContext.save()
            }
            Button("Annuler", role: .cancel) {}
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
