import SwiftUI

/// Spec Phase 7I "QUESTIONS" — the BioLab equivalent of HomeView's
/// OasisAssistantSheet, same shape (this codebase's own convention is
/// one small dedicated sheet per AI context rather than a shared generic
/// component — see PlantAssistantView/OasisAssistantSheet). Gated on a
/// real account like every other AI entry point (spec's own cost-control
/// reasoning from Phase 3D/4A).
struct BioLabAIAssistantSheet: View {
    var context: BioLabAIContext

    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var authState = AuthState.shared

    @State private var question = ""
    @State private var isAsking = false
    @State private var answer: String?
    @State private var errorMessage: String?
    @State private var isSignInPresented = false

    private let suggestedQuestions = [
        "Quels lots ont montré le plus d'hyperhydricité ?",
        "Montre-moi les lots avec suspicion de contamination.",
        "Quels paramètres diffèrent entre mes meilleurs lots ?",
    ]

    var body: some View {
        NavigationStack {
            Group {
                if case .authenticated = authState.status {
                    content
                } else {
                    signInPrompt
                }
            }
            .navigationTitle("✨ Oasis AI BioLab")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .sheet(isPresented: $isSignInPresented) {
                EmailSignInView()
            }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let answer {
                ScrollView {
                    Text(answer)
                        .font(.body)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Questions suggérées")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    ForEach(suggestedQuestions, id: \.self) { suggestion in
                        Button {
                            question = suggestion
                            Task { await ask() }
                        } label: {
                            Text(suggestion)
                                .font(.subheadline)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10)
                                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            Spacer()

            Text("Association, différence observée, hypothèse à tester — jamais une cause présentée comme certaine.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            HStack {
                TextField("Poser une question…", text: $question, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...3)
                Button {
                    Task { await ask() }
                } label: {
                    if isAsking {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.up.circle.fill").font(.title2)
                    }
                }
                .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isAsking)
            }
        }
        .padding()
    }

    private var signInPrompt: some View {
        VStack(spacing: 16) {
            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Assistant BioLab")
                .font(.title3.weight(.semibold))
            Text("Connectez-vous pour poser des questions à Oasis AI sur l'ensemble de votre laboratoire.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Se connecter") { isSignInPresented = true }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func ask() async {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isAsking = true
        errorMessage = nil
        do {
            answer = try await BioLabAIService.ask(trimmed, context: context)
        } catch {
            errorMessage = error.localizedDescription
        }
        isAsking = false
    }
}
