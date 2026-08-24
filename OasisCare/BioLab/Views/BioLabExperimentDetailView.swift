import SwiftData
import SwiftUI
import Charts

/// Spec Phase 7K. "ANALYSE" (moyennes/dispersion/comparer groupes/
/// graphiques) delegates entirely to BioLabExperimentAnalytics — see
/// that type's own doc comment for exactly why there's no significance
/// test here, only descriptive statistics.
struct BioLabExperimentDetailView: View {
    var experiment: BioLabExperiment

    @Environment(\.modelContext) private var modelContext
    @State private var groupSheet: GroupSheet?

    private var groupStats: [BioLabExperimentAnalytics.GroupStats] {
        BioLabExperimentAnalytics.groupStats(for: experiment)
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Question", value: experiment.question)
                if !experiment.independentVariables.isEmpty {
                    LabeledContent("Variable indépendante", value: experiment.independentVariables)
                }
                if !experiment.controlledVariables.isEmpty {
                    LabeledContent("Variable contrôlée", value: experiment.controlledVariables)
                }
                if !experiment.outcomes.isEmpty {
                    LabeledContent("Résultat mesuré", value: experiment.outcomes)
                }
            }

            Section {
                if experiment.groups.isEmpty {
                    Text("Aucun groupe. Ajoutez au moins un groupe contrôle et un groupe test.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(experiment.groups) { group in
                        Button {
                            groupSheet = .edit(group)
                        } label: {
                            groupRow(group)
                        }
                        .buttonStyle(.plain)
                    }
                }
                Button("Ajouter un groupe") { groupSheet = .add }
            } header: {
                Text("Groupes")
            }

            if groupStats.contains(where: { $0.averageMultiplicationRate != nil }) {
                Section {
                    Chart(groupStats) { stats in
                        BarMark(
                            x: .value("Groupe", stats.name),
                            y: .value("Multiplication moyenne", stats.averageMultiplicationRate ?? 0)
                        )
                        .foregroundStyle(Color.accentColor)
                    }
                    .frame(height: 200)
                } header: {
                    Text("Comparaison des groupes")
                } footer: {
                    Text("Moyenne et dispersion descriptives uniquement — une différence visible entre groupes n'est pas présentée comme statistiquement significative sans test approprié.")
                }
            }

            Section("Notes") {
                TextField("Notes", text: Binding(
                    get: { experiment.notes },
                    set: { experiment.notes = $0; experiment.markDirty() }
                ), axis: .vertical)
                    .lineLimit(2...6)
            }
        }
        .navigationTitle(experiment.code)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $groupSheet) { sheet in
            switch sheet {
            case .add:
                ExperimentGroupFormView(experiment: experiment, group: nil)
            case .edit(let group):
                ExperimentGroupFormView(experiment: experiment, group: group)
            }
        }
    }

    private func groupRow(_ group: ExperimentGroup) -> some View {
        let stats = groupStats.first { $0.id == group.id }
        return VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(group.name).fontWeight(.medium)
                Spacer()
                if let rate = stats?.averageMultiplicationRate {
                    Text("x\(String(format: "%.1f", rate))")
                        .foregroundStyle(.secondary)
                }
            }
            HStack(spacing: 6) {
                if let program = group.programVersion?.program {
                    Text("\(program.name) V\(group.programVersion?.versionNumber ?? 0)")
                }
                Text("· \(group.batches.count) lot(s)")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
    }
}

private enum GroupSheet: Identifiable {
    case add
    case edit(ExperimentGroup)

    var id: String {
        switch self {
        case .add: return "add"
        case .edit(let group): return group.id.uuidString
        }
    }
}

private struct ExperimentGroupFormView: View {
    var experiment: BioLabExperiment
    var group: ExperimentGroup?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Query private var allPrograms: [BioreactorProgram]

    @State private var name: String
    @State private var programVersion: BioreactorProgramVersion?

    init(experiment: BioLabExperiment, group: ExperimentGroup?) {
        self.experiment = experiment
        self.group = group
        _name = State(initialValue: group?.name ?? "")
        _programVersion = State(initialValue: group?.programVersion)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nom du groupe (ex. Contrôle, Test 1)", text: $name)
                    Picker("Programme", selection: $programVersion) {
                        Text("Aucun").tag(BioreactorProgramVersion?.none)
                        ForEach(allPrograms) { program in
                            if let version = program.latestVersion {
                                Text("\(program.name) (V\(version.versionNumber))").tag(Optional(version))
                            }
                        }
                    }
                }
            }
            .navigationTitle(group == nil ? "Nouveau groupe" : "Modifier le groupe")
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
        }
    }

    private func save() {
        if let group {
            group.name = name
            group.programVersion = programVersion
            group.markDirty()
        } else {
            let newGroup = ExperimentGroup(experiment: experiment, name: name, programVersion: programVersion)
            modelContext.insert(newGroup)
            experiment.groups.append(newGroup)
        }
        try? modelContext.save()
        dismiss()
    }
}
