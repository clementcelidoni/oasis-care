import SwiftUI
import SwiftData

/// Spec §43 — full-screen QR scanner. Resolution is local-only (no
/// remote fallback): by the time a user is scanning, their tags have
/// almost always already synced down alongside their plants (both ride
/// the same restore-on-new-device pass), and the one remaining edge
/// case — a brand new device that hasn't synced yet — is already
/// handled at the point of the sync itself, not worth the extra
/// round-trip here.
struct QRScannerSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var scannedPlant: Plant?
    @State private var errorMessage: String?

    var body: some View {
        ZStack(alignment: .top) {
            if QRScannerView.isSupported {
                QRScannerView { payload in
                    handleScan(payload)
                }
                .ignoresSafeArea()

                VStack {
                    Text("Visez un QR code Oasis")
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.top, 60)

                    Spacer()

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(.red.opacity(0.85), in: Capsule())
                            .padding(.bottom, 40)
                    }
                }
            } else {
                unavailableView
            }

            HStack {
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title)
                        .foregroundStyle(.white, .black.opacity(0.4))
                }
                .padding()
            }
        }
        .sheet(item: $scannedPlant) { plant in
            QuickActionsAfterScanSheet(plant: plant)
        }
    }

    private var unavailableView: some View {
        VStack(spacing: 16) {
            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Le scan QR n'est pas disponible sur cet appareil.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }

    private func handleScan(_ payload: String) {
        guard let url = URL(string: payload), let token = SmartTagConfig.token(from: url) else {
            errorMessage = "QR code non reconnu par Oasis Care."
            return
        }
        guard let tag = SmartTagService.existingTag(forToken: token, in: modelContext), let plant = tag.plant else {
            errorMessage = "Ce QR code n'est associé à aucun végétal sur cet appareil."
            return
        }
        errorMessage = nil
        SmartTagService.markScanned(tag)
        Haptics.success()
        scannedPlant = plant
    }
}
