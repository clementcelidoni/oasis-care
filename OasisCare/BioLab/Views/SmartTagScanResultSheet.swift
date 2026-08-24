import SwiftUI

/// Spec's "QR / NFC" section — its own two worked examples ("BR04 →
/// Ouvrir", "Lot AF-2026-018 → Inspection") are exactly this simple:
/// name + one primary action, nothing close to the full quick-actions
/// dashboard PlantDetailView's own scan flow (QuickActionsAfterScanSheet)
/// offers for care events/photos — building four more of those would be
/// well past what spec actually asks for here. `.plant` is included only
/// for switch-exhaustiveness; ScannerView/QRScannerSheet always route a
/// resolved plant to QuickActionsAfterScanSheet directly instead of here.
struct SmartTagScanResultSheet: View {
    var result: SmartTagScanResult

    @Environment(\.dismiss) private var dismiss
    @State private var isShowingDetail = false
    @State private var isShowingInspectionForm = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Image(systemName: icon)
                    .font(.system(size: 48))
                    .foregroundStyle(.white)
                    .frame(width: 88, height: 88)
                    .background(Color.accentColor.gradient, in: Circle())
                    .padding(.top, 24)

                VStack(spacing: 4) {
                    Text(title)
                        .font(.title3.weight(.semibold))
                    if let subtitle {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                VStack(spacing: 12) {
                    if hasDetail {
                        Button {
                            isShowingDetail = true
                        } label: {
                            Label("Ouvrir", systemImage: "arrow.up.forward.circle.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    if case .cultureBatch = result {
                        Button {
                            isShowingInspectionForm = true
                        } label: {
                            Label("Inspection", systemImage: "eye.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .padding(.horizontal, 32)

                Spacer()
            }
            .navigationTitle("Scan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .navigationDestination(isPresented: $isShowingDetail) {
                detailDestination
            }
            .sheet(isPresented: $isShowingInspectionForm) {
                if case .cultureBatch(let batch) = result {
                    BioreactorInspectionFormView(batch: batch, inspection: nil)
                }
            }
        }
    }

    private var hasDetail: Bool {
        if case .rack = result { return false }
        if case .plant = result { return false }
        return true
    }

    private var icon: String {
        switch result {
        case .plant: return "leaf.fill"
        case .bioreactor: return "testtube.2"
        case .cultureBatch: return "flask"
        case .mediumRecipeVersion: return "testtube.2"
        case .acclimatizationBatch: return "sun.max.fill"
        case .rack: return "shippingbox"
        }
    }

    private var title: String {
        switch result {
        case .plant(let plant): return plant.customName
        case .bioreactor(let bioreactor): return bioreactor.code
        case .cultureBatch(let batch): return "Lot \(batch.batchCode)"
        case .mediumRecipeVersion(let version): return "\(version.recipe?.name ?? "Recette") V\(version.versionNumber)"
        case .acclimatizationBatch(let batch): return "Acclimatation \(batch.cultureBatch?.batchCode ?? "?")"
        case .rack(let label): return label
        }
    }

    private var subtitle: String? {
        switch result {
        case .plant, .rack: return nil
        case .bioreactor(let bioreactor): return bioreactor.bioreactorType.label
        case .cultureBatch(let batch): return batch.speciesName
        case .mediumRecipeVersion: return "Recette imprimée"
        case .acclimatizationBatch(let batch): return "\(batch.currentSurvivorCount) / \(batch.initialPlantletCount) survivants"
        }
    }

    @ViewBuilder
    private var detailDestination: some View {
        switch result {
        case .plant, .rack:
            EmptyView()
        case .bioreactor(let bioreactor):
            BioreactorDetailView(bioreactor: bioreactor)
        case .cultureBatch(let batch):
            CultureBatchDetailView(batch: batch)
        case .mediumRecipeVersion(let version):
            MediumRecipeVersionDetailView(version: version)
        case .acclimatizationBatch(let batch):
            AcclimatizationBatchDetailView(batch: batch)
        }
    }
}
