import SwiftUI
import SwiftData

/// Spec's "QR / NFC" section — "rack" is the one taggable entity with no
/// backing model anywhere in this app (nothing in Phase 7A-7N ever asked
/// to create a LabRack), so a rack tag is just a physical label: no
/// "fiche" to open, no reassignment flow (there's no stable id to
/// compare against, unlike every other tag type here) — simplified
/// deliberately rather than inventing a Rack entity spec never asked for.
struct RackTagCreationView: View {
    @Environment(\.modelContext) private var modelContext

    @State private var label = ""
    @State private var generatedTag: SmartTag?
    @State private var isShowingQR = false
    @State private var isWritingNFC = false
    @State private var nfcResultMessage: String?

    private var isLabelValid: Bool {
        !label.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        Form {
            Section {
                TextField("Nom du rack (ex. Rack A3)", text: $label)
            } footer: {
                Text("Une étiquette de rack est un simple repère physique — contrairement aux étiquettes de bioréacteur, lot, recette ou acclimatation, elle n'ouvre aucune fiche.")
            }

            Section {
                Button("Générer un QR") {
                    generatedTag = SmartTagService.rackTag(label: label, type: .qr, in: modelContext)
                    isShowingQR = true
                }
                .disabled(!isLabelValid)

                Button {
                    Task { await writeNFC() }
                } label: {
                    if isWritingNFC {
                        ProgressView()
                    } else {
                        Text("Écrire un tag NFC")
                    }
                }
                .disabled(!isLabelValid || isWritingNFC)
            } footer: {
                if let nfcResultMessage {
                    Text(nfcResultMessage)
                }
            }
        }
        .navigationTitle("Étiquette de rack")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isShowingQR) {
            if let generatedTag {
                QRCodeSheet(subjectName: label, tag: generatedTag)
            }
        }
    }

    private func writeNFC() async {
        isWritingNFC = true
        nfcResultMessage = nil
        defer { isWritingNFC = false }
        let tag = SmartTagService.rackTag(label: label, type: .nfc, in: modelContext)
        guard let url = URL(string: tag.url) else {
            nfcResultMessage = "URL invalide."
            return
        }
        do {
            try await NFCService.shared.write(url: url, alertMessage: "Approchez votre iPhone du tag NFC")
            SmartTagService.markScanned(tag)
            nfcResultMessage = "✓ Tag NFC écrit pour « \(label) »."
        } catch let nfcError as NFCServiceError {
            SmartTagService.dissociate(tag, in: modelContext)
            if case .cancelled = nfcError {
                nfcResultMessage = nil
            } else {
                nfcResultMessage = nfcError.errorDescription ?? "Erreur NFC."
            }
        } catch {
            SmartTagService.dissociate(tag, in: modelContext)
            nfcResultMessage = error.localizedDescription
        }
    }
}
