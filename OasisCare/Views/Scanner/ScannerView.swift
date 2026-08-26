import SwiftUI
import PhotosUI
import UIKit

/// Photo-based plant identification (spec §30-32, UX flow §53). Doubles
/// as the "Scanner" tab root and as a sheet presented from the "+"
/// chooser in PlantListView — both contexts work unmodified since this
/// view only ever dismisses itself, never assumes who presented it.
struct ScannerView: View {
    /// Set only when presented from the "+" chooser, so choosing a
    /// result and saving closes that whole chain in one go rather than
    /// leaving the results list showing behind the saved plant's sheet.
    /// Left nil for the Scanner tab, which has nothing to close.
    var onSaved: (() -> Void)?

    @ObservedObject private var authState = AuthState.shared

    @State private var photos: [Data] = []
    @State private var isAnalyzing = false
    @State private var results: [PlantIdentificationResult]?
    @State private var analysisError: String?
    @State private var isPhotoSourceDialogPresented = false
    @State private var isCameraPresented = false
    @State private var isPhotosPickerPresented = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var isSignInPresented = false
    @State private var prefill: PlantPrefill?
    @State private var isQRScannerPresented = false
    @State private var isScanningNFC = false
    @State private var nfcScanResult: SmartTagScanResult?
    @State private var nfcErrorMessage: String?
    @State private var isQRNFCLockedSheetPresented = false
    @ObservedObject private var entitlementService = EntitlementService.shared
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Spec §49: QR/NFC scanning is local-only (SmartTagService
                // resolves purely from on-device data) and, per this same
                // screen's own sign-in prompt below, guests keep full
                // access to everything except AI photo identification —
                // so unlike `content`, this row is never gated behind
                // authState.
                scanButtonsSection
                    .padding()

                Divider()

                Group {
                    if case .authenticated = authState.status {
                        VStack(spacing: 0) {
                            AIQuotaBanner(feature: .plantIdentification)
                                .padding(.top, 8)
                            content
                        }
                    } else {
                        signInPrompt
                    }
                }
            }
            .navigationTitle("Scanner une plante")
            .navigationBarTitleDisplayMode(.inline)
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
            .sheet(isPresented: $isSignInPresented) {
                EmailSignInView()
            }
            .sheet(item: $prefill) { prefill in
                PlantFormView(
                    plant: nil,
                    initialScientificName: prefill.scientificName,
                    initialCommonName: prefill.commonName,
                    onSaved: onSaved
                )
            }
            .fullScreenCover(isPresented: $isQRScannerPresented) {
                QRScannerSheet()
            }
            .sheet(isPresented: $isQRNFCLockedSheetPresented) {
                LockedFeatureSheet(featureName: "Scanner QR / NFC")
            }
            .sheet(item: $nfcScanResult) { result in
                if case .plant(let plant) = result {
                    QuickActionsAfterScanSheet(plant: plant)
                } else {
                    SmartTagScanResultSheet(result: result)
                }
            }
        }
    }

    private var scanButtonsSection: some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                Button {
                    if entitlementService.has(.qrNfc) {
                        isQRScannerPresented = true
                    } else {
                        isQRNFCLockedSheetPresented = true
                    }
                } label: {
                    Label("Scanner QR", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("scanQRButton")

                Button {
                    if entitlementService.has(.qrNfc) {
                        Task { await scanNFC() }
                    } else {
                        isQRNFCLockedSheetPresented = true
                    }
                } label: {
                    if isScanningNFC {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                    } else {
                        Label("Scanner NFC", systemImage: "wave.3.right")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.bordered)
                .disabled(isScanningNFC)
                .accessibilityIdentifier("scanNFCButton")
            }

            if let nfcErrorMessage {
                Text(nfcErrorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private func scanNFC() async {
        isScanningNFC = true
        nfcErrorMessage = nil
        defer { isScanningNFC = false }
        do {
            let url = try await NFCService.shared.read(alertMessage: "Approchez l'iPhone de l'étiquette NFC")
            guard let token = SmartTagConfig.token(from: url),
                  let tag = SmartTagService.existingTag(forToken: token, in: modelContext),
                  let result = SmartTagService.scanResult(for: tag) else {
                nfcErrorMessage = "Ce tag NFC n'est associé à aucun élément sur cet appareil."
                return
            }
            SmartTagService.markScanned(tag)
            Haptics.success()
            nfcScanResult = result
        } catch NFCServiceError.cancelled {
            // User backed out — no error to show.
        } catch let error as NFCServiceError {
            nfcErrorMessage = error.errorDescription
        } catch {
            nfcErrorMessage = error.localizedDescription
        }
    }

    @ViewBuilder
    private var content: some View {
        if isAnalyzing {
            ProgressView("Analyse en cours…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let results {
            resultsList(results)
        } else {
            captureView
        }
    }

    private var captureView: some View {
        ScrollView {
            VStack(spacing: 20) {
                if photos.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "camera.viewfinder")
                            .font(.system(size: 56))
                            .foregroundStyle(.secondary)
                        Text("Prenez 1 à 5 photos de la plante à identifier : la plante entière, une feuille, une fleur…")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }
                    .padding(.top, 40)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 8)], spacing: 8) {
                        ForEach(Array(photos.enumerated()), id: \.offset) { index, data in
                            thumbnail(data, index: index)
                        }
                    }
                    .padding(.horizontal)
                }

                if photos.count < PlantIdentificationService.maxImages {
                    Button {
                        isPhotoSourceDialogPresented = true
                    } label: {
                        Label("Ajouter une photo", systemImage: "plus")
                    }
                    .buttonStyle(.bordered)
                }

                if let analysisError {
                    Text(analysisError)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                if !photos.isEmpty {
                    Button {
                        Task { await analyze() }
                    } label: {
                        Label("Analyser \(photos.count) photo\(photos.count > 1 ? "s" : "")", systemImage: "sparkles")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.horizontal)
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

    private func resultsList(_ results: [PlantIdentificationResult]) -> some View {
        List {
            Section {
                ForEach(results) { result in
                    Button {
                        prefill = PlantPrefill(scientificName: result.scientificName, commonName: result.commonNames.first)
                    } label: {
                        resultRow(result)
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                Text("Résultats")
            } footer: {
                Text("Choisissez la correspondance qui vous semble la plus probable. Vous pourrez toujours corriger le nom ensuite.")
            }

            Section {
                Button("Reprendre des photos", role: .cancel) {
                    self.results = nil
                    photos = []
                }
            }
        }
    }

    private func resultRow(_ result: PlantIdentificationResult) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(result.scientificName)
                    .font(.body.italic())
                if let commonName = result.commonNames.first {
                    Text(commonName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let family = result.family {
                    Text(family)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text("\(result.scorePercent) %")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(result.scorePercent >= 60 ? .green : .orange)
        }
        .padding(.vertical, 4)
    }

    private var signInPrompt: some View {
        VStack(spacing: 16) {
            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Identification par IA")
                .font(.title3.weight(.semibold))
            Text("Connectez-vous pour identifier vos plantes par photo. Vous pouvez continuer à utiliser Oasis Care sans compte pour tout le reste.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Se connecter") { isSignInPresented = true }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func analyze() async {
        isAnalyzing = true
        analysisError = nil
        do {
            let captured = photos.map { PlantIdentificationService.CapturedPhoto(imageData: $0, organ: .auto) }
            results = try await PlantIdentificationService.identify(captured)
            if results?.isEmpty == true {
                analysisError = "Aucune correspondance trouvée. Essayez avec d'autres photos, mieux cadrées ou mieux éclairées."
                results = nil
            }
        } catch {
            analysisError = error.localizedDescription
        }
        isAnalyzing = false
    }
}
