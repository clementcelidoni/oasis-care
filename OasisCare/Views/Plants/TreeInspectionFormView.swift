import SwiftUI
import PhotosUI
import UIKit
import SwiftData

/// Spec §57-59 — the arboricultural checklist form plus the
/// "✨ Analyser les photos" AI entry point. Editable (unlike
/// PlantMeasurement): passing an existing `inspection` switches this
/// into edit mode.
struct TreeInspectionFormView: View {
    var plant: Plant
    var inspection: TreeInspection?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var date: Date
    @State private var generalCondition: String
    @State private var stability: String
    @State private var deadWood: String
    @State private var cavities: String
    @State private var fungi: String
    @State private var parasites: String
    @State private var trunkDefects: String
    @State private var canopyNotes: String
    @State private var notes: String
    @State private var result: TreeInspectionResult

    @State private var newPhotos: [Data] = []
    @State private var isPhotoSourceDialogPresented = false
    @State private var isCameraPresented = false
    @State private var isPhotosPickerPresented = false
    @State private var selectedPhotoItem: PhotosPickerItem?

    @State private var isAnalyzing = false
    @State private var analysis: TreeInspectionAnalysis?
    @State private var analysisError: String?

    init(plant: Plant, inspection: TreeInspection?) {
        self.plant = plant
        self.inspection = inspection
        _date = State(initialValue: inspection?.date ?? .now)
        _generalCondition = State(initialValue: inspection?.generalCondition ?? "")
        _stability = State(initialValue: inspection?.stability ?? "")
        _deadWood = State(initialValue: inspection?.deadWood ?? "")
        _cavities = State(initialValue: inspection?.cavities ?? "")
        _fungi = State(initialValue: inspection?.fungi ?? "")
        _parasites = State(initialValue: inspection?.parasites ?? "")
        _trunkDefects = State(initialValue: inspection?.trunkDefects ?? "")
        _canopyNotes = State(initialValue: inspection?.canopyNotes ?? "")
        _notes = State(initialValue: inspection?.notes ?? "")
        _result = State(initialValue: inspection?.result ?? .good)
    }

    private var existingPhotos: [PlantPhoto] {
        inspection?.photos ?? []
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                }

                Section("Checklist") {
                    field("État général", $generalCondition)
                    field("Stabilité", $stability)
                    field("Bois mort", $deadWood)
                    field("Cavités", $cavities)
                    field("Champignons", $fungi)
                    field("Parasites", $parasites)
                    field("Défauts du tronc", $trunkDefects)
                    field("Houppier", $canopyNotes)
                }

                photosSection
                aiSection

                Section("Résultat") {
                    TreeInspectionResultPicker(selection: $result)
                        .listRowInsets(EdgeInsets())
                        .padding(.vertical, 4)
                        .padding(.horizontal)
                }

                Section("Notes") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle(inspection == nil ? "Nouvelle inspection" : "Modifier l'inspection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
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
                    newPhotos.append(data)
                }
                .ignoresSafeArea()
            }
            .onChange(of: selectedPhotoItem) { _, newItem in
                guard let newItem else { return }
                Task {
                    if let data = try? await newItem.loadTransferable(type: Data.self) {
                        newPhotos.append(data)
                    }
                    selectedPhotoItem = nil
                }
            }
        }
    }

    private func field(_ title: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("Observation", text: text, axis: .vertical)
                .lineLimit(1...3)
        }
    }

    @ViewBuilder
    private var photosSection: some View {
        Section("Photos") {
            if !existingPhotos.isEmpty || !newPhotos.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 70), spacing: 8)], spacing: 8) {
                    ForEach(existingPhotos) { photo in
                        if let uiImage = UIImage(data: photo.thumbnailData) {
                            Image(uiImage: uiImage)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 70, height: 70)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                    }
                    ForEach(Array(newPhotos.enumerated()), id: \.offset) { index, data in
                        newPhotoThumbnail(data, index: index)
                    }
                }
            }
            Button {
                isPhotoSourceDialogPresented = true
            } label: {
                Label("Ajouter une photo", systemImage: "plus")
            }
        }
    }

    private func newPhotoThumbnail(_ data: Data, index: Int) -> some View {
        ZStack(alignment: .topTrailing) {
            if let uiImage = UIImage(data: data) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 70, height: 70)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            Button {
                newPhotos.remove(at: index)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.white, .black.opacity(0.6))
            }
            .padding(2)
        }
    }

    @ViewBuilder
    private var aiSection: some View {
        Section {
            if isAnalyzing {
                HStack {
                    ProgressView()
                    Text("Analyse en cours…")
                        .foregroundStyle(.secondary)
                }
            } else {
                Button {
                    Task { await analyzePhotos() }
                } label: {
                    Label("Analyser les photos", systemImage: "sparkles")
                }
                .disabled(existingPhotos.isEmpty && newPhotos.isEmpty)
            }

            if let analysisError {
                Text(analysisError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            if let analysis {
                if let observations = analysis.observations, !observations.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Observations possibles")
                            .font(.caption.weight(.semibold))
                        ForEach(observations, id: \.self) { line in
                            Text("• \(line)")
                                .font(.caption)
                        }
                    }
                }
                if let points = analysis.pointsToCheck, !points.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Points à contrôler")
                            .font(.caption.weight(.semibold))
                        ForEach(points, id: \.self) { line in
                            Text("• \(line)")
                                .font(.caption)
                        }
                    }
                }
                LabeledContent("Confiance", value: analysis.confidenceLevel.displayName)
                    .font(.caption)
                Text("Analyse IA indicative — ne remplace pas l'avis d'un arboriste professionnel.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("✨ Oasis AI")
        }
    }

    private func analyzePhotos() async {
        isAnalyzing = true
        analysisError = nil
        do {
            var images = newPhotos
            images.append(contentsOf: existingPhotos.map(\.imageData))
            let context = TreeInspectionAIContext.build(for: plant)
            let result = try await TreeInspectionAIService.analyzeInspectionPhotos(images: images, context: context)
            analysis = result
            saveAnalysisToHistory(result)
        } catch {
            analysisError = error.localizedDescription
        }
        isAnalyzing = false
    }

    private func saveAnalysisToHistory(_ result: TreeInspectionAnalysis) {
        let json = (try? JSONEncoder().encode(result)).flatMap { String(data: $0, encoding: .utf8) }
        let entry = AIAnalysis(
            plant: plant,
            type: .treeInspectionAnalysis,
            summary: result.observations?.first ?? "Analyse d'inspection effectuée.",
            structuredDataJSON: json,
            provider: result.provider ?? "openai",
            model: result.model,
            confidence: result.confidenceLevel
        )
        modelContext.insert(entry)
    }

    private func save() {
        let target: TreeInspection
        if let inspection {
            inspection.date = date
            inspection.generalCondition = generalCondition
            inspection.stability = stability
            inspection.deadWood = deadWood
            inspection.cavities = cavities
            inspection.fungi = fungi
            inspection.parasites = parasites
            inspection.trunkDefects = trunkDefects
            inspection.canopyNotes = canopyNotes
            inspection.notes = notes
            inspection.result = result
            inspection.markDirty()
            target = inspection
        } else {
            let newInspection = TreeInspection(
                plant: plant, date: date, generalCondition: generalCondition, stability: stability,
                deadWood: deadWood, cavities: cavities, fungi: fungi, parasites: parasites,
                trunkDefects: trunkDefects, canopyNotes: canopyNotes, notes: notes, result: result
            )
            modelContext.insert(newInspection)
            plant.treeInspections.append(newInspection)
            target = newInspection
        }

        for data in newPhotos {
            attachPhoto(data, to: target)
        }

        dismiss()
    }

    private func attachPhoto(_ data: Data, to inspection: TreeInspection) {
        let processed = ImageProcessing.prepareForStorage(data)
        let detailData = processed?.detailData ?? data
        let thumbnailData = processed?.thumbnailData ?? data
        let photo = PlantPhoto(plant: plant, imageData: detailData, thumbnailData: thumbnailData, date: inspection.date)
        photo.treeInspection = inspection
        modelContext.insert(photo)
        plant.photos.append(photo)
        inspection.photos.append(photo)
    }
}
