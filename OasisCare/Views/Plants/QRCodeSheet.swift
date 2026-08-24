import SwiftUI
import SwiftData

/// Spec §42 — generate/view/share/export a smart tag's QR code. Not
/// Plant-specific despite the spec section number: spec's later "QR /
/// NFC" section reuses the exact same tag for bioréacteur/lot/recette
/// imprimée/zone d'acclimatation, and this sheet never actually needed
/// the whole Plant object — only its display name — so generalizing it
/// to a plain `subjectName` covers every entity type with no risk to
/// the existing plant flow (same behavior, just the name passed in
/// directly instead of read off a Plant). Share/export are the same
/// action here: the system share sheet's own "Enregistrer l'image"
/// destination covers export, so there's no separate export button to
/// build or maintain. Takes an already resolved `tag` rather than
/// fetching-or-creating one itself — that happens once, at the moment
/// the caller opens this sheet.
struct QRCodeSheet: View {
    var subjectName: String
    var tag: SmartTag

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    private var qrImage: UIImage? {
        QRCodeGenerator.image(for: tag.url)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text(subjectName)
                    .font(.title3.weight(.semibold))

                if let qrImage {
                    Image(uiImage: qrImage)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 240, height: 240)
                        .padding()
                        .background(.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .shadow(color: .black.opacity(0.08), radius: 8, y: 4)

                    ShareLink(
                        item: Image(uiImage: qrImage),
                        preview: SharePreview("Étiquette Oasis — \(subjectName)", image: Image(uiImage: qrImage))
                    ) {
                        Label("Partager", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.horizontal, 40)
                } else {
                    Text("Impossible de générer le QR code.")
                        .foregroundStyle(.secondary)
                }

                Text("Scannez ce QR code depuis l'onglet Scanner pour ouvrir directement cette fiche.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)

                Spacer()
            }
            .padding(.top, 32)
            .navigationTitle("Étiquette QR")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
                ToolbarItem(placement: .destructiveAction) {
                    Button("Dissocier", role: .destructive) {
                        SmartTagService.dissociate(tag, in: modelContext)
                        dismiss()
                    }
                }
            }
        }
    }
}
