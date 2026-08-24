import SwiftData
import SwiftUI

/// Spec Phase 7K "VARIABLE — identifier explicitement independentVariables/
/// controlledVariables/outcomes."
struct BioLabExperimentFormView: View {
    var experiment: BioLabExperiment?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Query private var allExperiments: [BioLabExperiment]

    @State private var code: String
    @State private var question: String
    @State private var independentVariables: String
    @State private var controlledVariables: String
    @State private var outcomes: String
    @State private var notes: String

    init(experiment: BioLabExperiment?) {
        self.experiment = experiment
        _code = State(initialValue: experiment?.code ?? "")
        _question = State(initialValue: experiment?.question ?? "")
        _independentVariables = State(initialValue: experiment?.independentVariables ?? "")
        _controlledVariables = State(initialValue: experiment?.controlledVariables ?? "")
        _outcomes = State(initialValue: experiment?.outcomes ?? "")
        _notes = State(initialValue: experiment?.notes ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Code (ex. EXP-023)", text: $code)
                    TextField("Question de recherche", text: $question, axis: .vertical)
                        .lineLimit(1...3)
                }

                Section {
                    TextField("Variable(s) indépendante(s)", text: $independentVariables, axis: .vertical)
                        .lineLimit(1...3)
                    TextField("Variable(s) contrôlée(s)", text: $controlledVariables, axis: .vertical)
                        .lineLimit(1...3)
                    TextField("Résultat(s) mesuré(s)", text: $outcomes, axis: .vertical)
                        .lineLimit(1...3)
                } header: {
                    Text("Variables")
                } footer: {
                    Text("Ex. indépendante : fréquence d'immersion. Contrôlée : recette, température. Résultat : taux de multiplication.")
                }

                Section("Notes") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }
            }
            .navigationTitle(experiment == nil ? "Nouvelle expérimentation" : "Modifier")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || question.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task {
                guard experiment == nil, code.isEmpty else { return }
                code = suggestedCode()
            }
        }
    }

    private func suggestedCode() -> String {
        "EXP-\(String(format: "%03d", allExperiments.count + 1))"
    }

    private func save() {
        if let experiment {
            experiment.code = code
            experiment.question = question
            experiment.independentVariables = independentVariables
            experiment.controlledVariables = controlledVariables
            experiment.outcomes = outcomes
            experiment.notes = notes
            experiment.markDirty()
        } else {
            let newExperiment = BioLabExperiment(
                code: code, question: question, independentVariables: independentVariables,
                controlledVariables: controlledVariables, outcomes: outcomes, notes: notes
            )
            modelContext.insert(newExperiment)
        }
        try? modelContext.save()
        dismiss()
    }
}
