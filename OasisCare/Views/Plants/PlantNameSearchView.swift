import SwiftUI

/// Smart manual-add (spec §33 — "C'EST UNE FONCTION PRIORITAIRE" — and
/// §49 name search). Debounced so typing doesn't fire an OpenAI call per
/// keystroke (spec §47/§55: cost control and speed).
struct PlantNameSearchView: View {
    /// Set only when presented from the "+" chooser — see ScannerView's
    /// matching property for why.
    var onSaved: (() -> Void)?

    @ObservedObject private var authState = AuthState.shared

    @State private var query = ""
    @State private var suggestions: [PlantInformationService.NameSuggestion] = []
    @State private var isSearching = false
    @State private var searchError: String?
    @State private var searchTask: Task<Void, Never>?
    @State private var isSignInPresented = false
    @State private var prefill: PlantPrefill?

    var body: some View {
        NavigationStack {
            Group {
                if case .authenticated = authState.status {
                    content
                } else {
                    signInPrompt
                }
            }
            .navigationTitle("Rechercher par nom")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Nom d'une plante, même approximatif")
            .onChange(of: query) { _, newValue in
                scheduleSearch(for: newValue)
            }
            .sheet(isPresented: $isSignInPresented) {
                EmailSignInView()
            }
            .sheet(item: $prefill) { prefill in
                PlantFormView(
                    plant: nil,
                    initialScientificName: prefill.scientificName,
                    initialCommonName: prefill.commonName,
                    onSaved: onSaved
                )
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        List {
            if let searchError {
                Text(searchError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            if isSearching {
                HStack {
                    ProgressView()
                    Text("Recherche…")
                        .foregroundStyle(.secondary)
                }
            }

            ForEach(suggestions) { suggestion in
                Button {
                    prefill = PlantPrefill(scientificName: suggestion.scientificName, commonName: suggestion.commonName)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(suggestion.scientificName)
                            .font(.body.italic())
                            .foregroundStyle(.primary)
                        if let commonName = suggestion.commonName {
                            Text(commonName)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button {
                    prefill = PlantPrefill(scientificName: query.trimmingCharacters(in: .whitespacesAndNewlines), commonName: nil)
                } label: {
                    Label("Utiliser « \(query) » tel quel", systemImage: "pencil")
                }
            }
        }
    }

    private var signInPrompt: some View {
        VStack(spacing: 16) {
            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Recherche intelligente")
                .font(.title3.weight(.semibold))
            Text("Connectez-vous pour laisser l'IA corriger et compléter le nom de vos plantes. Vous pouvez continuer à utiliser Oasis Care sans compte pour tout le reste.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Se connecter") { isSignInPresented = true }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func scheduleSearch(for value: String) {
        searchTask?.cancel()
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            suggestions = []
            return
        }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled else { return }
            isSearching = true
            searchError = nil
            do {
                suggestions = try await PlantInformationService.suggestions(for: trimmed)
            } catch {
                searchError = error.localizedDescription
            }
            isSearching = false
        }
    }
}
