import SwiftUI

/// "✨ Assistant IA" per-plant Q&A (spec §41-42). Each exchange is saved
/// as an AIAnalysis so the conversation survives closing and reopening
/// this sheet — the question is round-tripped through structuredDataJSON
/// since AIAnalysis only has one free-text `summary` field, used here
/// for the answer.
struct PlantAssistantView: View {
    var plant: Plant

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var question = ""
    @State private var isAsking = false
    @State private var errorMessage: String?

    private var exchanges: [AIAnalysis] {
        plant.aiAnalyses.filter { $0.type == .assistantQuestion }.sorted { $0.date < $1.date }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            if exchanges.isEmpty {
                                Text("Posez une question sur \(plant.customName), par exemple « Pourquoi les feuilles jaunissent ? »")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .padding(.top, 24)
                            }
                            ForEach(exchanges) { exchange in
                                conversationBubble(exchange)
                                    .id(exchange.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: exchanges.count) { _, _ in
                        guard let last = exchanges.last else { return }
                        withAnimation {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                }

                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Poser une question…", text: $question, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...4)
                    Button {
                        Task { await ask() }
                    } label: {
                        if isAsking {
                            ProgressView()
                                .frame(width: 32, height: 32)
                        } else {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 32))
                        }
                    }
                    .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isAsking)
                }
                .padding()
            }
            .navigationTitle("✨ Assistant IA")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
    }

    private func conversationBubble(_ exchange: AIAnalysis) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let question = Self.decodeQuestion(exchange.structuredDataJSON) {
                HStack {
                    Spacer(minLength: 40)
                    Text(question)
                        .font(.subheadline)
                        .padding(10)
                        .background(Color.accentColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 14))
                }
            }
            HStack {
                Text(exchange.summary)
                    .font(.subheadline)
                    .padding(10)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
                Spacer(minLength: 40)
            }
        }
    }

    private static func decodeQuestion(_ json: String?) -> String? {
        guard let data = json?.data(using: .utf8) else { return nil }
        let dict = try? JSONDecoder().decode([String: String].self, from: data)
        return dict?["question"]
    }

    private func ask() async {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        isAsking = true
        errorMessage = nil
        question = ""
        do {
            let answer = try await PlantAIService.ask(trimmed, about: plant)
            let questionJSON = (try? JSONEncoder().encode(["question": trimmed])).flatMap { String(data: $0, encoding: .utf8) }
            let analysis = AIAnalysis(
                plant: plant,
                type: .assistantQuestion,
                summary: answer,
                structuredDataJSON: questionJSON,
                provider: "openai"
            )
            modelContext.insert(analysis)
        } catch {
            errorMessage = error.localizedDescription
            question = trimmed
        }
        isAsking = false
    }
}
