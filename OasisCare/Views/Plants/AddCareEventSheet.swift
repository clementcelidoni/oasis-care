import SwiftUI
import SwiftData
import PhotosUI
import UIKit

struct AddCareEventSheet: View {
    var plants: [Plant]

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var type: CareEventType = .inspection
    @State private var date = Date.now
    @State private var notes = ""
    @State private var product = ""
    @State private var quantity = ""
    @State private var unit = ""
    @State private var photoData: Data?
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var isPhotoSourceDialogPresented = false
    @State private var isPhotosPickerPresented = false
    @State private var isCameraPresented = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $type) {
                        ForEach(CareEventType.allCases) { type in
                            Label(type.displayName, systemImage: type.icon).tag(type)
                        }
                    }
                    DatePicker("Date", selection: $date, displayedComponents: [.date])
                }

                Section("Produit") {
                    TextField("Nom du produit (facultatif)", text: $product)
                    HStack {
                        TextField("Quantité", text: $quantity)
                            .keyboardType(.decimalPad)
                        TextField("Unité (ml, g…)", text: $unit)
                    }
                }

                Section("Notes") {
                    TextField("Notes (facultatif)", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("Photo") {
                    if let photoData, let uiImage = UIImage(data: photoData) {
                        HStack {
                            Image(uiImage: uiImage)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 56, height: 56)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            Spacer()
                            Button("Retirer", role: .destructive) { self.photoData = nil }
                        }
                    } else {
                        Button {
                            isPhotoSourceDialogPresented = true
                        } label: {
                            Label("Ajouter une photo", systemImage: "camera")
                        }
                    }
                }
            }
            .navigationTitle(plants.count > 1 ? "Intervention (\(plants.count) végétaux)" : "Ajouter une intervention")
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
                    photoData = data
                }
                .ignoresSafeArea()
            }
            .onChange(of: selectedPhotoItem) { _, newItem in
                guard let newItem else { return }
                Task {
                    if let data = try? await newItem.loadTransferable(type: Data.self) {
                        photoData = data
                    }
                    selectedPhotoItem = nil
                }
            }
        }
    }

    private func save() {
        for plant in plants {
            CareScheduleEngine.recordCare(
                type,
                for: plant,
                on: date,
                notes: notes,
                quantity: Double(quantity.replacingOccurrences(of: ",", with: ".")),
                unit: unit.isEmpty ? nil : unit,
                product: product.isEmpty ? nil : product,
                photoData: photoData,
                in: modelContext
            )
        }
        dismiss()
    }
}
