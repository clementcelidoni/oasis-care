import SwiftUI

/// Spec §70 — "Montre-moi tous les palmiers qui n'ont pas reçu
/// d'engrais depuis plus de 60 jours." Separate from PlantListView's
/// existing plain-text `.searchable` field on purpose: that one does a
/// simple name/species/garden substring match locally and instantly,
/// this one is a distinct, clearly AI-branded entry point for a
/// genuinely different kind of query (a full sentence describing a
/// condition, not a name fragment).
struct NaturalLanguageSearchSheet: View {
    var plants: [Plant]

    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var isSearching = false
    @State private var filter: NaturalLanguageFilter?
    @State private var errorMessage: String?

    private var results: [Plant] {
        guard let filter else { return [] }
        return NaturalLanguageSearchService.apply(filter, to: plants)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Décrivez ce que vous cherchez, en une phrase.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    HStack {
                        TextField("Ex. : palmiers sans engrais depuis 60 jours", text: $query, axis: .vertical)
                            .lineLimit(1...3)
                            .textFieldStyle(.roundedBorder)
                        Button {
                            Task { await search() }
                        } label: {
                            if isSearching {
                                ProgressView()
                            } else {
                                Image(systemName: "sparkles")
                            }
                        }
                        .disabled(query.trimmingCharacters(in: .whitespaces).isEmpty || isSearching)
                        .accessibilityIdentifier("naturalLanguageSearchButton")
                    }

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    if let filter {
                        Text(filter.summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.top, 4)
                    }
                }
                .padding()

                Divider()

                if let filter {
                    if results.isEmpty {
                        EmptyStateView(
                            icon: "magnifyingglass",
                            title: "Aucun résultat",
                            message: "Aucun végétal ne correspond à : \(filter.summary)"
                        )
                    } else {
                        List(results) { plant in
                            NavigationLink(value: plant) {
                                PlantRow(plant: plant)
                            }
                        }
                        .listStyle(.plain)
                    }
                } else {
                    Spacer()
                }
            }
            .navigationTitle("Recherche IA")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: Plant.self) { plant in
                PlantDetailView(plant: plant)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
    }

    private func search() async {
        isSearching = true
        errorMessage = nil
        do {
            filter = try await NaturalLanguageSearchService.search(query: query, plants: plants)
        } catch {
            errorMessage = error.localizedDescription
        }
        isSearching = false
    }
}
