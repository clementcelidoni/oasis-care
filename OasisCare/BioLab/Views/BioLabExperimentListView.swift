import SwiftData
import SwiftUI

/// Spec Phase 7K.
struct BioLabExperimentListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \BioLabExperiment.startedAt, order: .reverse) private var experiments: [BioLabExperiment]
    @State private var isShowingNewExperiment = false
    @State private var experimentPendingDeletion: BioLabExperiment?

    var body: some View {
        Group {
            if experiments.isEmpty {
                EmptyStateView(
                    icon: "flask",
                    title: "Aucune expérimentation",
                    message: "Créez une expérimentation pour comparer plusieurs conditions (programmes, recettes) sur des groupes de lots."
                )
            } else {
                List {
                    ForEach(experiments) { experiment in
                        NavigationLink {
                            BioLabExperimentDetailView(experiment: experiment)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(experiment.code).font(.headline)
                                Text(experiment.question)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                experimentPendingDeletion = experiment
                            } label: {
                                Label("Supprimer", systemImage: "trash")
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Expérimentations")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { isShowingNewExperiment = true } label: { Label("Ajouter", systemImage: "plus") }
            }
        }
        .sheet(isPresented: $isShowingNewExperiment) {
            BioLabExperimentFormView(experiment: nil)
        }
        .confirmationDialog(
            "Supprimer l'expérimentation \(experimentPendingDeletion?.code ?? "") ?",
            isPresented: Binding(get: { experimentPendingDeletion != nil }, set: { if !$0 { experimentPendingDeletion = nil } }),
            titleVisibility: .visible
        ) {
            Button("Supprimer", role: .destructive) {
                if let experimentPendingDeletion { DeletionService.delete(experimentPendingDeletion, in: modelContext) }
                experimentPendingDeletion = nil
            }
            Button("Annuler", role: .cancel) { experimentPendingDeletion = nil }
        } message: {
            Text("Les groupes de cette expérimentation seront aussi supprimés. Les lots qui y étaient rattachés seront conservés, sans groupe associé. Cette action est irréversible.")
        }
    }
}
