import SwiftUI

/// Enhancement "COMPARAISONS INTELLIGENTES" + §22 "DIFF ENTRE VERSIONS."
/// A plain local diff table (see ProtocolComparisonService's own doc
/// comment for why this isn't an AI call) with the differing rows
/// called out per §29 "Ces protocoles diffèrent principalement sur."
struct RecipeVersionComparisonSheet: View {
    var versions: [MediumRecipeVersion]
    var batches: [CultureBatch]
    var acclimatizationBatches: [AcclimatizationBatch]

    @Environment(\.dismiss) private var dismiss
    @State private var selectedVersionIDs: Set<UUID> = []

    private var selectedVersions: [MediumRecipeVersion] {
        versions.filter { selectedVersionIDs.contains($0.id) }.sorted { $0.versionNumber < $1.versionNumber }
    }

    private var comparison: ProtocolComparisonService.Comparison? {
        guard selectedVersions.count >= 2 else { return nil }
        let performances = BioLabKnowledgeEngine.performance(for: selectedVersions, batches: batches, acclimatizationBatches: acclimatizationBatches)
        let byId = Dictionary(uniqueKeysWithValues: performances.map { ($0.versionId, $0) })
        return ProtocolComparisonService.compare(versions: selectedVersions, performances: byId)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Versions à comparer") {
                    ForEach(versions.sorted { $0.versionNumber > $1.versionNumber }) { version in
                        Toggle("Version \(version.versionNumber)", isOn: Binding(
                            get: { selectedVersionIDs.contains(version.id) },
                            set: { isOn in
                                if isOn { selectedVersionIDs.insert(version.id) } else { selectedVersionIDs.remove(version.id) }
                            }
                        ))
                    }
                }

                if let comparison {
                    if !comparison.differingFieldNames.isEmpty {
                        Section {
                            Text("Ces versions diffèrent principalement sur : \(comparison.differingFieldNames.joined(separator: ", ")).")
                                .font(.callout)
                        }
                    }
                    Section("Comparaison") {
                        ScrollView(.horizontal) {
                            Grid(alignment: .leading) {
                                GridRow {
                                    Text("").frame(minWidth: 120, alignment: .leading)
                                    ForEach(comparison.versionLabels, id: \.self) { label in
                                        Text(label).font(.caption.bold()).frame(minWidth: 90, alignment: .leading)
                                    }
                                }
                                ForEach(comparison.rows) { row in
                                    GridRow {
                                        Text(row.field)
                                            .font(.caption)
                                            .foregroundStyle(row.isDifferent ? .primary : .secondary)
                                            .frame(minWidth: 120, alignment: .leading)
                                        ForEach(Array(row.values.enumerated()), id: \.offset) { _, value in
                                            Text(value)
                                                .font(.caption)
                                                .foregroundStyle(row.isDifferent ? .orange : .secondary)
                                                .frame(minWidth: 90, alignment: .leading)
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else if selectedVersionIDs.count == 1 {
                    Section {
                        Text("Sélectionnez au moins une deuxième version.").foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Comparer les versions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
    }
}
