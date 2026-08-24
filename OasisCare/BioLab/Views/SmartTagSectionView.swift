import SwiftUI

/// Spec's "QR / NFC" section — the same "Étiquette intelligente" row
/// PlantDetailView already has (spec §42), generalized so all four new
/// taggable BioLab entities can drop it in without duplicating the
/// button styling four times. PlantDetailView's own version stays
/// exactly as it was — no reason to touch already-shipped, working code
/// just to share this.
struct SmartTagSectionView: View {
    var subjectName: String
    var existingTags: [SmartTag]
    var onShowQR: () -> Void
    var onAssociateNFC: () -> Void

    private var qrTag: SmartTag? { existingTags.first { $0.type == .qr && $0.active } }
    private var nfcTag: SmartTag? { existingTags.first { $0.type == .nfc && $0.active } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Étiquette intelligente")
                .font(.headline)
            HStack(spacing: 12) {
                Button(action: onShowQR) {
                    tile(title: qrTag != nil ? "Voir le QR" : "Afficher QR", icon: "qrcode", tint: .indigo)
                }
                .buttonStyle(.plain)

                Button(action: onAssociateNFC) {
                    tile(title: nfcTag != nil ? "Tag NFC associé" : "Associer NFC", icon: "wave.3.right", tint: .teal)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func tile(title: String, icon: String, tint: Color) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.title2)
            Text(title)
                .font(.caption.weight(.medium))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .foregroundStyle(tint)
    }
}
