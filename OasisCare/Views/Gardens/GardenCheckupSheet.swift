import SwiftUI
import SwiftData
import PhotosUI
import UIKit

/// Spec §61-65 — "Commencer le check-up". A single sheet with three
/// internal phases (pick a filter, walk the plants, see the summary)
/// rather than three separate sheets, so the whole flow shares one
/// dismiss action and reopening it naturally resumes (spec §64).
struct GardenCheckupSheet: View {
    var garden: Garden

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var checkup: GardenCheckup?
    @State private var selectedFilter: GardenCheckupFilter = .all
    @State private var selectedZone: GardenZone?
    @State private var isAbandonConfirmationPresented = false

    /// Only offered once there's real progress to lose — with zero
    /// entries recorded, closing and resuming already has the same
    /// effect as abandoning, so the option would just be noise.
    private var hasProgressToAbandon: Bool {
        guard let checkup else { return false }
        return !checkup.entries.isEmpty
    }

    var body: some View {
        NavigationStack {
            Group {
                if let checkup {
                    if GardenCheckupService.remainingPlants(for: checkup).isEmpty {
                        GardenCheckupSummaryView(checkup: checkup) { dismiss() }
                    } else {
                        GardenCheckupWalkView(checkup: checkup, garden: garden)
                    }
                } else {
                    filterSelectionView
                }
            }
            .navigationTitle("Check-up du jardin")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
                if hasProgressToAbandon {
                    ToolbarItem(placement: .destructiveAction) {
                        Button("Abandonner", role: .destructive) {
                            isAbandonConfirmationPresented = true
                        }
                    }
                }
            }
            .confirmationDialog(
                "Abandonner ce check-up ?",
                isPresented: $isAbandonConfirmationPresented,
                titleVisibility: .visible
            ) {
                Button("Abandonner", role: .destructive) {
                    if let checkup {
                        DeletionService.delete(checkup, in: modelContext)
                    }
                    checkup = nil
                }
                Button("Continuer le check-up", role: .cancel) {}
            } message: {
                Text("L'historique de ce check-up sera supprimé. L'état de santé déjà mis à jour pour les végétaux vérifiés est conservé. Cette action est irréversible.")
            }
            .task {
                if let existing = garden.checkups.first(where: { !$0.isComplete }) {
                    checkup = existing
                }
            }
        }
    }

    private var previewCount: Int {
        GardenCheckupService.scopedPlants(in: garden, filter: selectedFilter, zoneID: selectedZone?.id).count
    }

    private var filterSelectionView: some View {
        Form {
            Section {
                Picker("Filtrer", selection: $selectedFilter) {
                    ForEach(GardenCheckupFilter.allCases) { filter in
                        Text(filter.displayName).tag(filter)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()

                if selectedFilter == .zone {
                    Picker("Zone", selection: $selectedZone) {
                        Text("Choisir une zone").tag(GardenZone?.none)
                        ForEach(garden.zones.sorted { $0.name < $1.name }) { zone in
                            Text(zone.name).tag(GardenZone?.some(zone))
                        }
                    }
                }
            } footer: {
                Text("\(previewCount) végétal\(previewCount > 1 ? "aux" : "") concerné\(previewCount > 1 ? "s" : "").")
            }

            Section {
                Button {
                    checkup = GardenCheckupService.activeOrNewCheckup(
                        for: garden, filter: selectedFilter, zone: selectedZone, in: modelContext
                    )
                } label: {
                    Label("Commencer le check-up", systemImage: "checklist")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(previewCount == 0 || (selectedFilter == .zone && selectedZone == nil))
                .accessibilityIdentifier("startCheckupButton")
            }
        }
    }
}

/// Spec §63's exact pluralization trap: "végétal" + "aux" ≠ "végétaux"
/// as a suffix concatenation would produce — this file's footer text
/// deliberately writes the whole word per branch, not a suffix.
private struct GardenCheckupWalkView: View {
    var checkup: GardenCheckup
    var garden: Garden

    @Environment(\.modelContext) private var modelContext

    private var scoped: [Plant] { GardenCheckupService.scopedPlants(for: checkup) }
    private var remaining: [Plant] { GardenCheckupService.remainingPlants(for: checkup) }
    private var currentPlant: Plant? { remaining.first }
    private var currentIndex: Int { checkup.entries.count + 1 }

    var body: some View {
        if let currentPlant {
            GardenCheckupPlantCard(
                plant: currentPlant,
                index: currentIndex,
                total: scoped.count,
                checkup: checkup
            )
            .id(currentPlant.id)
        }
    }
}

private struct GardenCheckupPlantCard: View {
    var plant: Plant
    var index: Int
    var total: Int
    var checkup: GardenCheckup

    @Environment(\.modelContext) private var modelContext

    @State private var selectedResult: TreeInspectionResult?
    @State private var notes = ""
    @State private var photos: [Data] = []
    @State private var isPhotoSourceDialogPresented = false
    @State private var isCameraPresented = false
    @State private var isPhotosPickerPresented = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var isNotePresented = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                Text("\(index) / \(total)")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)

                VStack(spacing: 8) {
                    Image(systemName: plant.type.icon)
                        .font(.system(size: 40))
                        .foregroundStyle(.white)
                        .frame(width: 72, height: 72)
                        .background(plant.healthStatus.color.gradient, in: Circle())
                    Text(plant.customName)
                        .font(.title3.weight(.semibold))
                    if let zoneName = plant.zone?.name {
                        Text(zoneName)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                TreeInspectionResultPicker(selection: Binding(
                    get: { selectedResult ?? .good },
                    set: { selectedResult = $0 }
                ))
                .padding(.horizontal)
                .opacity(selectedResult == nil ? 0.5 : 1)

                HStack(spacing: 12) {
                    Button {
                        isPhotoSourceDialogPresented = true
                    } label: {
                        Label(photos.isEmpty ? "Photo" : "\(photos.count) photo\(photos.count > 1 ? "s" : "")", systemImage: "camera")
                    }
                    .buttonStyle(.bordered)

                    Button {
                        isNotePresented = true
                    } label: {
                        Label(notes.isEmpty ? "Note" : "Note ajoutée", systemImage: "note.text")
                    }
                    .buttonStyle(.bordered)
                }

                Button {
                    recordAndAdvance()
                } label: {
                    Label("Suivant", systemImage: "arrow.right")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(selectedResult == nil)
                .padding(.horizontal)
                .accessibilityIdentifier("checkupNextButton")
            }
            .padding(.vertical, 24)
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
        .sheet(isPresented: $isNotePresented) {
            NavigationStack {
                Form {
                    TextField("Note", text: $notes, axis: .vertical)
                        .lineLimit(4...8)
                }
                .navigationTitle("Note")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("OK") { isNotePresented = false }
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private func recordAndAdvance() {
        guard let selectedResult else { return }
        guard let entry = GardenCheckupService.recordEntry(
            for: plant, result: selectedResult, notes: notes, checkup: checkup, in: modelContext
        ) else { return }
        for data in photos {
            GardenCheckupService.attachPhoto(data, to: entry, plant: plant, in: modelContext)
        }
        Haptics.success()
    }
}

private struct GardenCheckupSummaryView: View {
    var checkup: GardenCheckup
    var onDone: () -> Void

    private var summary: GardenCheckupService.Summary {
        GardenCheckupService.summary(for: checkup)
    }

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 56))
                .foregroundStyle(.green)

            Text("Check-up terminé")
                .font(.title2.weight(.semibold))

            Text("\(summary.total) végétal\(summary.total > 1 ? "aux" : "") vérifié\(summary.total > 1 ? "s" : "")")
                .foregroundStyle(.secondary)

            VStack(spacing: 8) {
                ForEach(TreeInspectionResult.allCases) { level in
                    HStack {
                        Circle()
                            .fill(level.color)
                            .frame(width: 10, height: 10)
                        Text(level.displayName)
                        Spacer()
                        Text("\(summary.count(level))")
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 40)
                }
            }

            Spacer()

            Button("Terminer") {
                onDone()
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 40)
            .padding(.bottom, 24)
        }
        .task {
            if !checkup.isComplete {
                GardenCheckupService.complete(checkup)
            }
        }
    }
}
