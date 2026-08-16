import SwiftUI
import SwiftData
import UIKit

/// Spec §60 — "Comparer l'évolution". Picks from the plant's existing
/// photo history (general Évolution photos and inspection photos
/// alike — PlantPhoto doesn't distinguish for this purpose) rather
/// than capturing fresh photos: comparing evolution over time means
/// comparing photos that already span time.
struct PhotoComparisonView: View {
    var plant: Plant

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var beforePhoto: PlantPhoto?
    @State private var afterPhoto: PlantPhoto?
    @State private var pickerTarget: PickerTarget?
    @State private var isComparing = false
    @State private var comparison: TreePhotoComparison?
    @State private var errorMessage: String?

    private enum PickerTarget: Identifiable {
        case before, after
        var id: Self { self }
    }

    private var sortedPhotos: [PlantPhoto] { plant.sortedPhotos }

    var body: some View {
        NavigationStack {
            Group {
                if sortedPhotos.count < 2 {
                    EmptyStateView(
                        icon: "photo.on.rectangle.angled",
                        title: "Pas assez de photos",
                        message: "Ajoutez au moins deux photos dans l'Évolution de ce végétal pour pouvoir comparer."
                    )
                } else if let comparison {
                    resultView(comparison)
                } else {
                    pickerView
                }
            }
            .navigationTitle("Comparer l'évolution")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .sheet(item: $pickerTarget) { target in
                photoPickerSheet(for: target)
            }
        }
    }

    private var pickerView: some View {
        ScrollView {
            VStack(spacing: 24) {
                HStack(spacing: 16) {
                    photoSlot(title: "Avant", photo: beforePhoto) { pickerTarget = .before }
                    Image(systemName: "arrow.right")
                        .foregroundStyle(.secondary)
                    photoSlot(title: "Après", photo: afterPhoto) { pickerTarget = .after }
                }
                .padding(.top, 24)

                if isComparing {
                    ProgressView("Comparaison en cours…")
                } else if beforePhoto != nil && afterPhoto != nil {
                    Button {
                        Task { await compare() }
                    } label: {
                        Label("Comparer", systemImage: "sparkles")
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
            .padding()
        }
    }

    private func photoSlot(title: String, photo: PlantPhoto?, onTap: @escaping () -> Void) -> some View {
        VStack(spacing: 8) {
            Text(title)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            Button(action: onTap) {
                if let photo, let uiImage = UIImage(data: photo.thumbnailData) {
                    VStack(spacing: 4) {
                        Image(uiImage: uiImage)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 120, height: 120)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                        Text(DateFormatting.shortDate(photo.date))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(.secondarySystemGroupedBackground))
                        .frame(width: 120, height: 120)
                        .overlay {
                            Image(systemName: "plus")
                                .foregroundStyle(.secondary)
                        }
                }
            }
            .buttonStyle(.plain)
        }
    }

    private func photoPickerSheet(for target: PickerTarget) -> some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 8)], spacing: 8) {
                    ForEach(sortedPhotos) { photo in
                        Button {
                            switch target {
                            case .before: beforePhoto = photo
                            case .after: afterPhoto = photo
                            }
                            pickerTarget = nil
                        } label: {
                            if let uiImage = UIImage(data: photo.thumbnailData) {
                                VStack(spacing: 2) {
                                    Image(uiImage: uiImage)
                                        .resizable()
                                        .scaledToFill()
                                        .frame(width: 90, height: 90)
                                        .clipShape(RoundedRectangle(cornerRadius: 10))
                                    Text(DateFormatting.shortDate(photo.date))
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
            .navigationTitle(target == .before ? "Photo « avant »" : "Photo « après »")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { pickerTarget = nil }
                }
            }
        }
    }

    private func compare() async {
        guard let beforePhoto, let afterPhoto else { return }
        isComparing = true
        errorMessage = nil
        do {
            let context = TreeInspectionAIContext.build(for: plant)
            let result = try await TreeInspectionAIService.comparePhotos(
                before: beforePhoto.imageData, after: afterPhoto.imageData, context: context
            )
            comparison = result
            saveToHistory(result)
        } catch {
            errorMessage = error.localizedDescription
        }
        isComparing = false
    }

    private func saveToHistory(_ result: TreePhotoComparison) {
        let json = (try? JSONEncoder().encode(result)).flatMap { String(data: $0, encoding: .utf8) }
        let entry = AIAnalysis(
            plant: plant,
            type: .treePhotoComparison,
            summary: result.summary ?? "Comparaison de photos effectuée.",
            structuredDataJSON: json,
            provider: result.provider ?? "openai",
            model: result.model,
            confidence: result.confidenceLevel
        )
        modelContext.insert(entry)
    }

    private func resultView(_ comparison: TreePhotoComparison) -> some View {
        List {
            if let summary = comparison.summary, !summary.isEmpty {
                Section { Text(summary) }
            }
            Section("Observations") {
                if let foliage = comparison.foliageChange, !foliage.isEmpty {
                    LabeledContent("Feuillage", value: foliage)
                }
                if let density = comparison.densityChange, !density.isEmpty {
                    LabeledContent("Densité", value: density)
                }
                if let growth = comparison.growthObserved, !growth.isEmpty {
                    LabeledContent("Croissance", value: growth)
                }
                if let yellowing = comparison.yellowingObserved, !yellowing.isEmpty {
                    LabeledContent("Jaunissement", value: yellowing)
                }
                if let decline = comparison.declineObserved, !decline.isEmpty {
                    LabeledContent("Dépérissement", value: decline)
                }
                LabeledContent("Confiance", value: comparison.confidenceLevel.displayName)
            }
            Section {
                Text("Analyse IA indicative — ne remplace pas l'avis d'un arboriste professionnel.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section {
                Button("Comparer d'autres photos") {
                    self.comparison = nil
                    beforePhoto = nil
                    afterPhoto = nil
                }
            }
        }
    }
}
