import SwiftUI
import PhotosUI
import UIKit

/// "Analyser un problème" photo-based diagnosis (spec §43-45). Mirrors
/// PlantDetailView's existing photo-capture pattern (camera/library
/// confirmation dialog) rather than introducing a new one.
struct PlantDiagnosisView: View {
    var plant: Plant

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var photos: [Data] = []
    @State private var isAnalyzing = false
    @State private var diagnosis: PlantDiagnosis?
    @State private var errorMessage: String?
    @State private var isPhotoSourceDialogPresented = false
    @State private var isCameraPresented = false
    @State private var isPhotosPickerPresented = false
    @State private var selectedPhotoItem: PhotosPickerItem?

    var body: some View {
        NavigationStack {
            Group {
                if let diagnosis {
                    resultView(diagnosis)
                } else {
                    VStack(spacing: 0) {
                        AIQuotaBanner(feature: .photoDiagnosis)
                            .padding(.top, 8)
                        captureView
                    }
                }
            }
            .navigationTitle("Analyser un problème")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .confirmationDialog("Ajouter une photo", isPresented: $isPhotoSourceDialogPresented, titleVisibility: .visible) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button("Prendre une photo") { isCameraPresented = true }
                }
                Button("Choisir dans la photothèque") { isPhotosPickerPresented = true }
                Button("Annuler", role: .cancel) {}
            }
            .photosPicker(isPresented: $isPhotosPickerPresented, selection: $selectedPhotoItem, matching: .images)
            .fullScreenCover(isPresented: $isCameraPresented) {
                CameraCaptureView(isPresented: $isCameraPresented) { data in
                    photos.append(data)
                }
                .ignoresSafeArea()
            }
            .onChange(of: selectedPhotoItem) { _, newItem in
                guard let newItem else { return }
                Task {
                    if let data = try? await newItem.loadTransferable(type: Data.self) {
                        photos.append(data)
                    }
                    selectedPhotoItem = nil
                }
            }
        }
    }

    @ViewBuilder
    private var captureView: some View {
        ScrollView {
            VStack(spacing: 20) {
                Text("Prenez 1 à 4 photos du problème : la plante entière, la partie touchée, un détail rapproché.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.top, 16)

                if !photos.isEmpty {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 8)], spacing: 8) {
                        ForEach(Array(photos.enumerated()), id: \.offset) { index, data in
                            thumbnail(data, index: index)
                        }
                    }
                    .padding(.horizontal)
                }

                if photos.count < PlantHealthService.maxImages {
                    Button {
                        isPhotoSourceDialogPresented = true
                    } label: {
                        Label("Ajouter une photo", systemImage: "plus")
                    }
                    .buttonStyle(.bordered)
                }

                if isAnalyzing {
                    ProgressView("Analyse en cours…")
                } else if !photos.isEmpty {
                    Button {
                        Task { await analyze() }
                    } label: {
                        Label("Analyser", systemImage: "stethoscope")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.horizontal)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }
            }
            .padding(.vertical)
        }
    }

    private func thumbnail(_ data: Data, index: Int) -> some View {
        ZStack(alignment: .topTrailing) {
            if let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 90, height: 90)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            Button {
                photos.remove(at: index)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.white, .black.opacity(0.6))
            }
            .padding(4)
        }
    }

    private func resultView(_ diagnosis: PlantDiagnosis) -> some View {
        List {
            if let summary = diagnosis.summary, !summary.isEmpty {
                Section {
                    Text(summary)
                }
            }
            Section("Cause possible") {
                Text(diagnosis.possibleCause ?? "Non déterminée")
                LabeledContent("Confiance", value: diagnosis.confidenceLevel.displayName)
            }
            if let reasoning = diagnosis.reasoning, !reasoning.isEmpty {
                Section("Pourquoi") {
                    ForEach(reasoning, id: \.self) { line in
                        Text("• \(line)")
                    }
                }
            }
            if let checks = diagnosis.checksToPerform, !checks.isEmpty {
                Section("À vérifier") {
                    ForEach(checks, id: \.self) { line in
                        Text("• \(line)")
                    }
                }
            }
            if let actions = diagnosis.recommendedActions, !actions.isEmpty {
                Section("Actions conseillées") {
                    ForEach(actions, id: \.self) { line in
                        Text("• \(line)")
                    }
                }
            }
            Section {
                Button("Analyser d'autres photos") {
                    self.diagnosis = nil
                    photos = []
                }
            }
        }
    }

    private func analyze() async {
        isAnalyzing = true
        errorMessage = nil
        do {
            let context = PlantAIContext.build(for: plant)
            let result = try await PlantHealthService.diagnose(images: photos, context: context)
            diagnosis = result
            saveToHistory(result)
        } catch {
            errorMessage = error.localizedDescription
        }
        isAnalyzing = false
    }

    private func saveToHistory(_ result: PlantDiagnosis) {
        let json = (try? JSONEncoder().encode(result)).flatMap { String(data: $0, encoding: .utf8) }
        let analysis = AIAnalysis(
            plant: plant,
            type: .diagnosis,
            summary: result.summary ?? result.possibleCause ?? "Analyse effectuée.",
            structuredDataJSON: json,
            provider: result.provider ?? "openai",
            model: result.model,
            confidence: result.confidenceLevel
        )
        modelContext.insert(analysis)
    }
}
