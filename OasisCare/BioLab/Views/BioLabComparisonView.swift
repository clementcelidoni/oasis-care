import SwiftUI
import SwiftData

/// Spec Phase 7I "COMPARAISON" — pick two bioreactors, show their
/// current configuration side by side (spec's own BR03/BR04 example:
/// immersion, température moyenne, recette, multiplication), then let
/// Oasis AI identify differences. CRITIQUE "pas de causalité inventée"
/// is enforced both server-side (the Edge Function's schema has no
/// "cause" field) and here in the UI copy, which never uses causal
/// language for what the AI returns.
struct BioLabComparisonView: View {
    @Query private var allBioreactors: [Bioreactor]
    @ObservedObject private var authState = AuthState.shared

    @State private var bioreactorA: Bioreactor?
    @State private var bioreactorB: Bioreactor?
    @State private var isComparing = false
    @State private var result: BioLabComparisonResult?
    @State private var errorMessage: String?
    @State private var isSignInPresented = false

    private var subjectA: BioLabComparisonSubject? {
        bioreactorA.map(BioLabComparisonSubject.build(for:))
    }
    private var subjectB: BioLabComparisonSubject? {
        bioreactorB.map(BioLabComparisonSubject.build(for:))
    }

    var body: some View {
        Form {
            Section {
                Picker("Bioréacteur A", selection: $bioreactorA) {
                    Text("Choisir").tag(Bioreactor?.none)
                    ForEach(allBioreactors) { reactor in
                        Text(reactor.code).tag(Optional(reactor))
                    }
                }
                Picker("Bioréacteur B", selection: $bioreactorB) {
                    Text("Choisir").tag(Bioreactor?.none)
                    ForEach(allBioreactors) { reactor in
                        Text(reactor.code).tag(Optional(reactor))
                    }
                }
            }

            if let subjectA {
                subjectSection(subjectA)
            }
            if let subjectB {
                subjectSection(subjectB)
            }

            if case .authenticated = authState.status {
                Section {
                    Button {
                        Task { await compare() }
                    } label: {
                        if isComparing {
                            HStack { ProgressView(); Text("Comparaison en cours…") }
                        } else {
                            Label("Comparer avec Oasis AI", systemImage: "sparkles")
                        }
                    }
                    .disabled(bioreactorA == nil || bioreactorB == nil || bioreactorA?.id == bioreactorB?.id || isComparing)

                    if bioreactorA != nil, bioreactorB != nil, bioreactorA?.id == bioreactorB?.id {
                        Text("Choisissez deux bioréacteurs différents.")
                            .font(.caption)
                            .foregroundStyle(.orange)
                    }
                }
            } else {
                Section {
                    Button("Se connecter pour comparer avec Oasis AI") { isSignInPresented = true }
                }
            }

            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }

            if let result {
                resultSection(result)
            }
        }
        .navigationTitle("Comparer")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isSignInPresented) {
            EmailSignInView()
        }
    }

    private func subjectSection(_ subject: BioLabComparisonSubject) -> some View {
        Section(subject.code) {
            LabeledContent("Type", value: subject.bioreactorType)
            if let immersion = subject.immersionSummary {
                LabeledContent("Immersion", value: immersion)
            }
            if let aeration = subject.aerationSummary {
                LabeledContent("Aération", value: aeration)
            }
            if let temperature = subject.averageTemperature {
                LabeledContent("Température moyenne", value: "\(String(format: "%.1f", temperature)) °C")
            }
            if let batchCode = subject.currentBatchCode {
                LabeledContent("Lot actuel", value: batchCode)
            }
            if let recipeVersion = subject.recipeVersion {
                LabeledContent("Recette", value: "V\(recipeVersion)")
            }
            if let rate = subject.multiplicationRate {
                LabeledContent("Multiplication", value: "x\(String(format: "%.1f", rate))")
            }
        }
    }

    private func resultSection(_ result: BioLabComparisonResult) -> some View {
        Section {
            if let differences = result.differences, !differences.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Différences observées")
                        .font(.caption.weight(.semibold))
                    ForEach(differences, id: \.self) { line in
                        Text("• \(line)").font(.subheadline)
                    }
                }
            }
            if let hypotheses = result.hypotheses, !hypotheses.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Hypothèses à tester")
                        .font(.caption.weight(.semibold))
                    ForEach(hypotheses, id: \.self) { line in
                        Text("• \(line)").font(.subheadline)
                    }
                }
                .padding(.top, 4)
            }
            LabeledContent("Confiance", value: result.confidenceLevel.displayName)
                .font(.caption)
            Text("Ce ne sont pas des causes établies, seulement des associations et des pistes à vérifier expérimentalement.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        } header: {
            Text("✨ Oasis AI")
        }
    }

    private func compare() async {
        guard let subjectA, let subjectB else { return }
        isComparing = true
        errorMessage = nil
        do {
            result = try await BioLabAIService.compare(subjectA, subjectB)
        } catch {
            errorMessage = error.localizedDescription
        }
        isComparing = false
    }
}
