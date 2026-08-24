import SwiftUI
import PhotosUI
import UIKit
import SwiftData

/// Spec Phase 7H. Deliberately no AI section here (unlike its closest
/// analog, TreeInspectionFormView) — photo-based AI analysis with a
/// confidence level is Phase 7I's "Oasis AI BioLab," a separate,
/// dedicated sub-phase; building it here would duplicate that work.
/// CRITIQUE respected by construction: contaminationStatus is always a
/// value this screen's human user picks — nothing here ever sets it
/// from an automated analysis.
struct BioreactorInspectionFormView: View {
    var batch: CultureBatch
    var inspection: BioreactorInspection?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Query private var allBioreactors: [Bioreactor]

    @State private var date: Date
    @State private var bioreactor: Bioreactor?
    @State private var cultureAppearance: String
    @State private var contaminationStatus: ContaminationStatus
    @State private var hyperhydricityStatus: ObservedSeverity
    @State private var necrosisStatus: ObservedSeverity
    @State private var browningStatus: ObservedSeverity
    @State private var growthStatus: String
    @State private var estimatedCount: String
    @State private var notes: String

    @State private var newPhotos: [PendingPhoto] = []
    @State private var isPhotoSourceDialogPresented = false
    @State private var isCameraPresented = false
    @State private var isPhotosPickerPresented = false
    @State private var selectedPhotoItem: PhotosPickerItem?

    private struct PendingPhoto: Identifiable {
        let id = UUID()
        var data: Data
        var category: BioLabPhotoCategory = .globalView
    }

    init(batch: CultureBatch, inspection: BioreactorInspection?) {
        self.batch = batch
        self.inspection = inspection
        _date = State(initialValue: inspection?.date ?? .now)
        _bioreactor = State(initialValue: inspection?.bioreactor)
        _cultureAppearance = State(initialValue: inspection?.cultureAppearance ?? "")
        _contaminationStatus = State(initialValue: inspection?.contaminationStatus ?? .noneObserved)
        _hyperhydricityStatus = State(initialValue: inspection?.hyperhydricityStatus ?? .none)
        _necrosisStatus = State(initialValue: inspection?.necrosisStatus ?? .none)
        _browningStatus = State(initialValue: inspection?.browningStatus ?? .none)
        _growthStatus = State(initialValue: inspection?.growthStatus ?? "")
        _estimatedCount = State(initialValue: inspection?.estimatedCount.map { String($0) } ?? "")
        _notes = State(initialValue: inspection?.notes ?? "")
    }

    private var existingPhotos: [BioLabInspectionPhoto] {
        inspection?.photos ?? []
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                    Picker("Bioréacteur", selection: $bioreactor) {
                        Text("Non renseigné").tag(Bioreactor?.none)
                        ForEach(allBioreactors) { reactor in
                            Text(reactor.code).tag(Optional(reactor))
                        }
                    }
                }

                Section("Observation") {
                    TextField("Aspect de la culture", text: $cultureAppearance, axis: .vertical)
                        .lineLimit(1...3)
                    TextField("Croissance", text: $growthStatus, axis: .vertical)
                        .lineLimit(1...3)
                    HStack {
                        Text("Nombre estimé")
                        Spacer()
                        TextField("Facultatif", text: $estimatedCount)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                    }
                }

                Section {
                    Picker("Contamination", selection: $contaminationStatus) {
                        ForEach(ContaminationStatus.allCases) { status in
                            Text(status.label).tag(status)
                        }
                    }
                    Picker("Hyperhydricité", selection: $hyperhydricityStatus) {
                        ForEach(ObservedSeverity.allCases) { severity in
                            Text(severity.label).tag(severity)
                        }
                    }
                    Picker("Nécrose", selection: $necrosisStatus) {
                        ForEach(ObservedSeverity.allCases) { severity in
                            Text(severity.label).tag(severity)
                        }
                    }
                    Picker("Brunissement", selection: $browningStatus) {
                        ForEach(ObservedSeverity.allCases) { severity in
                            Text(severity.label).tag(severity)
                        }
                    }
                } header: {
                    Text("États sanitaires")
                } footer: {
                    Text("« Confirmée » est un constat humain — l'application ne déclare jamais une contamination certaine à votre place.")
                }

                photosSection

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
                    newPhotos.append(PendingPhoto(data: data))
                }
                .ignoresSafeArea()
            }
            .onChange(of: selectedPhotoItem) { _, newItem in
                guard let newItem else { return }
                Task {
                    if let data = try? await newItem.loadTransferable(type: Data.self) {
                        newPhotos.append(PendingPhoto(data: data))
                    }
                    selectedPhotoItem = nil
                }
            }
            .task {
                // Default a new inspection to whichever bioreactor
                // currently holds this batch, if any — still editable,
                // just a reasonable starting point. allBioreactors isn't
                // available yet inside init(), hence doing this here.
                guard inspection == nil, bioreactor == nil else { return }
                bioreactor = allBioreactors.first { $0.currentBatch?.id == batch.id }
            }
        }
    }

    @ViewBuilder
    private var photosSection: some View {
        Section {
            // Existing photos show their category read-only —
            // BioLabInspectionPhoto is append-only by convention (same
            // as PlantPhoto elsewhere in this app), only set at creation.
            ForEach(existingPhotos) { photo in
                HStack {
                    if let uiImage = UIImage(data: photo.thumbnailData) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 56, height: 56)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    Text(photo.category.label)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                }
            }
            ForEach($newPhotos) { $pending in
                photoRow(
                    thumbnail: pending.data,
                    category: $pending.category,
                    onRemove: { newPhotos.removeAll { $0.id == pending.id } }
                )
            }
            Button {
                isPhotoSourceDialogPresented = true
            } label: {
                Label("Ajouter une photo", systemImage: "plus")
            }
        } header: {
            Text("Photos")
        } footer: {
            Text("Vue globale, détail tissus, milieu, bocal ou équipement.")
        }
    }

    private func photoRow(thumbnail: Data, category: Binding<BioLabPhotoCategory>, onRemove: (() -> Void)?) -> some View {
        HStack {
            if let uiImage = UIImage(data: thumbnail) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            Picker("Catégorie", selection: category) {
                ForEach(BioLabPhotoCategory.allCases) { cat in
                    Text(cat.label).tag(cat)
                }
            }
            .labelsHidden()
            if let onRemove {
                Spacer()
                Button(role: .destructive, action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func save() {
        let target: BioreactorInspection
        let parsedCount = Int(estimatedCount)
        if let inspection {
            inspection.date = date
            inspection.bioreactor = bioreactor
            inspection.cultureAppearance = cultureAppearance
            inspection.contaminationStatus = contaminationStatus
            inspection.hyperhydricityStatus = hyperhydricityStatus
            inspection.necrosisStatus = necrosisStatus
            inspection.browningStatus = browningStatus
            inspection.growthStatus = growthStatus
            inspection.estimatedCount = parsedCount
            inspection.notes = notes
            inspection.markDirty()
            target = inspection
        } else {
            let newInspection = BioreactorInspection(
                cultureBatch: batch, bioreactor: bioreactor, date: date, cultureAppearance: cultureAppearance,
                contaminationStatus: contaminationStatus, hyperhydricityStatus: hyperhydricityStatus,
                necrosisStatus: necrosisStatus, browningStatus: browningStatus, growthStatus: growthStatus,
                estimatedCount: parsedCount, notes: notes
            )
            modelContext.insert(newInspection)
            batch.inspections.append(newInspection)
            target = newInspection
        }

        for pending in newPhotos {
            attachPhoto(pending, to: target)
        }

        try? modelContext.save()
        dismiss()
    }

    private func attachPhoto(_ pending: PendingPhoto, to inspection: BioreactorInspection) {
        let processed = ImageProcessing.prepareForStorage(pending.data)
        let detailData = processed?.detailData ?? pending.data
        let thumbnailData = processed?.thumbnailData ?? pending.data
        let photo = BioLabInspectionPhoto(
            inspection: inspection, imageData: detailData, thumbnailData: thumbnailData,
            category: pending.category, date: inspection.date
        )
        modelContext.insert(photo)
        inspection.photos.append(photo)
    }
}
