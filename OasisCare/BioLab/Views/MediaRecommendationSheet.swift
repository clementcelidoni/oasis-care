import SwiftUI

/// Enhancement §1-9 "PROPOSER AUTOMATIQUEMENT UN MILIEU" +
/// "PLUSIEURS PROPOSITIONS" + "FICHE DE PROPOSITION" + "APPLICATION."
/// Presented from CultureBatchFormView once species is filled in.
/// `onUse` hands the chosen `MediaRecommendation` back to the caller
/// rather than creating a MediumRecipe/Version here — at this point in
/// the flow the batch itself may not exist as a persisted object yet
/// (still mid-creation-form), so this view stays a pure picker.
struct MediaRecommendationSheet: View {
    var request: MediaRecommendationRequest
    var onUse: (MediaRecommendation) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var recommendations: [MediaRecommendation] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ContentUnavailableView {
                        ProgressView()
                    } description: {
                        Text("Oasis réfléchit à une proposition de milieu…")
                    }
                } else if let errorMessage {
                    ContentUnavailableView("Proposition indisponible", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                } else if recommendations.isEmpty {
                    ContentUnavailableView(
                        "Aucune proposition",
                        systemImage: "flask",
                        description: Text("Je n'ai pas suffisamment de données fiables pour proposer un protocole précis pour cette espèce. Vous pouvez partir d'une recette existante ou en créer une manuellement.")
                    )
                } else {
                    List(recommendations) { recommendation in
                        MediaRecommendationCard(recommendation: recommendation) {
                            onUse(recommendation)
                            dismiss()
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("✨ Proposition Oasis")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            recommendations = try await SmartMediaService.recommendMedium(for: request)
        } catch {
            errorMessage = "L'assistant IA n'a pas pu proposer de milieu. Réessayez plus tard."
        }
        isLoading = false
    }
}

private struct MediaRecommendationCard: View {
    var recommendation: MediaRecommendation
    var onUse: () -> Void

    @State private var showingDetail = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(recommendation.label)
                    .font(.headline)
                Spacer()
                confidenceBadge
            }
            Text(recommendation.basalMediumName)
                .font(.subheadline.bold())
            Text(evidenceLabel)
                .font(.caption)
                .foregroundStyle(.secondary)

            Button("Pourquoi cette proposition ?") { showingDetail = true }
                .font(.caption)

            HStack {
                Button("Utiliser cette recette", action: onUse)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                Spacer()
            }
        }
        .padding(.vertical, 6)
        .sheet(isPresented: $showingDetail) {
            NavigationStack {
                Form {
                    Section("Explication") {
                        Text(recommendation.evidence.explanation)
                    }
                    if let count = recommendation.evidence.basedOnBatchCount {
                        Section {
                            Text("Basé sur \(count) lot(s) de ce laboratoire.")
                        }
                    }
                    if !recommendation.evidence.sources.isEmpty {
                        Section("Sources") {
                            ForEach(recommendation.evidence.sources) { source in
                                VStack(alignment: .leading) {
                                    Text(source.title ?? "Source sans titre").font(.subheadline)
                                    if let authors = source.authors { Text(authors).font(.caption).foregroundStyle(.secondary) }
                                    if let doi = source.doi { Text("DOI: \(doi)").font(.caption).foregroundStyle(.secondary) }
                                }
                            }
                        }
                    } else {
                        Section {
                            Text("Source non disponible.").foregroundStyle(.secondary)
                        }
                    }
                    Section("Composition") {
                        ForEach(Array(recommendation.ingredients.enumerated()), id: \.offset) { _, ingredient in
                            LabeledContent(ingredient.name, value: "\(formatted(ingredient.amount)) \(ingredient.unit.label)")
                        }
                    }
                }
                .navigationTitle(recommendation.label)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Fermer") { showingDetail = false }
                    }
                }
            }
        }
    }

    private var evidenceLabel: String {
        "\(recommendation.evidence.evidenceType.label) · Confiance \(recommendation.evidence.confidence.label.lowercased())"
    }

    private var confidenceBadge: some View {
        Text(recommendation.evidence.confidence.label)
            .font(.caption2.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(confidenceColor.opacity(0.15), in: Capsule())
            .foregroundStyle(confidenceColor)
    }

    private var confidenceColor: Color {
        switch recommendation.evidence.confidence {
        case .high: return .green
        case .medium: return .orange
        case .low, .unknown: return .secondary
        }
    }

    private func formatted(_ value: Double) -> String {
        String(format: "%.3g", value)
    }
}
