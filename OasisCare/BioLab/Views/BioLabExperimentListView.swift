import SwiftData
import SwiftUI

/// Spec Phase 7K.
struct BioLabExperimentListView: View {
    @Query(sort: \BioLabExperiment.startedAt, order: .reverse) private var experiments: [BioLabExperiment]
    @State private var isShowingNewExperiment = false

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
    }
}
