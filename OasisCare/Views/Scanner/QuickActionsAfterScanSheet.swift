import SwiftUI
import SwiftData
import PhotosUI
import UIKit

/// Spec §53 — after a QR/NFC scan, land directly on quick actions
/// instead of the full fiche: "intervention terrain en quelques
/// secondes." Reuses CareScheduleEngine exactly like PlantDetailView's
/// own quick-action buttons, not a second implementation of the same
/// logic.
struct QuickActionsAfterScanSheet: View {
    var plant: Plant
    /// Set only when presented from ScannerView's own NavigationStack,
    /// so "Voir la fiche" can push onto it instead of needing its own.
    var onOpenDetail: (() -> Void)?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var isPhotoSourceDialogPresented = false
    @State private var isPhotosPickerPresented = false
    @State private var isCameraPresented = false
    @State private var isAddEventPresented = false
    @State private var selectedPhotoItem: PhotosPickerItem?

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Image(systemName: plant.type.icon)
                        .font(.system(size: 40))
                        .foregroundStyle(.white)
                        .frame(width: 72, height: 72)
                        .background(plant.healthStatus.color.gradient, in: Circle())
                    Text(plant.customName)
                        .font(.title3.weight(.semibold))
                }
                .padding(.top, 16)

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    Button {
                        CareScheduleEngine.recordCare(.watering, for: plant, in: modelContext)
                        confirm(.watering)
                    } label: {
                        QuickActionTile(title: "Arroser", icon: "drop.fill", tint: .blue)
                    }
                    .buttonStyle(.plain)

                    Button {
                        CareScheduleEngine.recordCare(.fertilizing, for: plant, in: modelContext)
                        confirm(.fertilizing)
                    } label: {
                        QuickActionTile(title: "Engrais", icon: "sparkles", tint: .green)
                    }
                    .buttonStyle(.plain)

                    Button {
                        CareScheduleEngine.recordCare(.inspection, for: plant, in: modelContext)
                        confirm(.inspection)
                    } label: {
                        QuickActionTile(title: "Inspecter", icon: "magnifyingglass", tint: .purple)
                    }
                    .buttonStyle(.plain)

                    Button {
                        isPhotoSourceDialogPresented = true
                    } label: {
                        QuickActionTile(title: "Photo", icon: "camera.fill", tint: .orange)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal)

                Button {
                    isAddEventPresented = true
                } label: {
                    Label("Intervention détaillée", systemImage: "plus.circle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .padding(.horizontal)

                Button("Voir la fiche complète") {
                    dismiss()
                    onOpenDetail?()
                }
                .padding(.top, 4)

                Spacer()
            }
            .navigationTitle("Actions rapides")
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
                    CareScheduleEngine.addPhoto(imageData: data, for: plant, in: modelContext)
                }
                .ignoresSafeArea()
            }
            .onChange(of: selectedPhotoItem) { _, newItem in
                guard let newItem else { return }
                Task {
                    if let data = try? await newItem.loadTransferable(type: Data.self) {
                        CareScheduleEngine.addPhoto(imageData: data, for: plant, in: modelContext)
                    }
                    selectedPhotoItem = nil
                }
            }
            .sheet(isPresented: $isAddEventPresented) {
                AddCareEventSheet(plants: [plant])
            }
        }
    }

    private func confirm(_ type: CareEventType) {
        Haptics.success()
        ToastCenter.shared.show(title: "✓ \(type.displayName) — \(plant.customName)")
    }
}

private struct QuickActionTile: View {
    var title: String
    var icon: String
    var tint: Color

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
            Text(title)
                .font(.subheadline)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .foregroundStyle(tint)
    }
}
