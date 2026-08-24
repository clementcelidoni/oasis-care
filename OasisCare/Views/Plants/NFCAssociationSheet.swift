import SwiftUI
import SwiftData

/// Orchestrates spec §45-48's associate-a-tag flow. Core NFC shows its
/// own system scanning UI via `session.alertMessage` — this view's job
/// is just to kick off read/write through NFCService and react to the
/// outcome; it never touches CoreNFC types directly (spec §44).
///
/// Generalized past Plant for spec's later "QR / NFC" section (same
/// tag, now also bioréacteur/lot/recette imprimée/zone d'acclimatation):
/// rather than a protocol retrofitted onto five otherwise-unrelated
/// model types, the caller already has its own concrete entity in scope
/// and passes in exactly the three things this view actually needs —
/// its display name, its existing tags, and how to create/reassign a
/// tag onto it — so this view itself stays entity-agnostic without ever
/// naming Bioreactor/CultureBatch/etc.
struct NFCAssociationSheet: View {
    var subjectName: String
    var subjectID: UUID
    var existingTags: [SmartTag]
    var createTag: (ModelContext) -> SmartTag
    var reassignTag: (SmartTag, ModelContext) -> Void

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    private enum Phase {
        case idle
        case working
        case conflict(tag: SmartTag, otherName: String)
        case success
        case failure(String)
    }

    @State private var phase: Phase = .idle

    private var existingNFCTag: SmartTag? {
        existingTags.first { $0.type == .nfc && $0.active }
    }

    var body: some View {
        NavigationStack {
            VStack {
                Spacer()
                content
                Spacer()
            }
            .padding()
            .navigationTitle("Associer un tag NFC")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .idle:
            VStack(spacing: 16) {
                Image(systemName: "wave.3.right.circle")
                    .font(.system(size: 56))
                    .foregroundStyle(.blue)
                if let existingNFCTag {
                    Text("\(subjectName) a déjà un tag NFC associé.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Button("Remplacer par un nouveau tag") {
                        Task { await startAssociation() }
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("startNFCAssociationButton")
                    Button("Dissocier ce tag", role: .destructive) {
                        SmartTagService.dissociate(existingNFCTag, in: modelContext)
                        dismiss()
                    }
                } else {
                    Text("Approchez votre iPhone d'un tag NFC pour l'associer à \(subjectName).")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Button("Approcher un tag NFC") {
                        Task { await startAssociation() }
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("startNFCAssociationButton")
                }
            }
        case .working:
            ProgressView("Suivez les instructions à l'écran…")
        case .conflict(let tag, let otherName):
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.orange)
                Text("Ce tag est déjà associé à :")
                    .foregroundStyle(.secondary)
                Text(otherName)
                    .font(.headline)
                HStack(spacing: 12) {
                    Button("Annuler", role: .cancel) { phase = .idle }
                        .buttonStyle(.bordered)
                    Button("Réassigner") {
                        Task { await reassign(tag) }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        case .success:
            VStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(.green)
                Text("✓ Tag NFC associé")
                    .font(.headline)
                Text(subjectName)
                Text("Le tag peut désormais ouvrir directement cette fiche.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("Terminer") { dismiss() }
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 8)
            }
        case .failure(let message):
            VStack(spacing: 16) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.red)
                Text(message)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Button("Réessayer") { phase = .idle }
                    .buttonStyle(.bordered)
            }
        }
    }

    private func startAssociation() async {
        phase = .working
        let readURL: URL
        do {
            readURL = try await NFCService.shared.read(alertMessage: "Approchez votre iPhone du tag NFC")
        } catch {
            guard let nfcError = error as? NFCServiceError else {
                phase = .failure(error.localizedDescription)
                return
            }
            switch nfcError {
            case .cancelled:
                phase = .idle
            case .notNDEF, .underlying:
                // Blank or unrecognized tag: nothing to conflict with, proceed to write.
                await writeTag()
            case .unavailable, .busy, .notWritable:
                phase = .failure(nfcError.errorDescription ?? "Erreur NFC.")
            }
            return
        }

        guard let token = SmartTagConfig.token(from: readURL),
              let existing = SmartTagService.existingTag(forToken: token, in: modelContext) else {
            await writeTag()
            return
        }

        if existing.linkedEntityID == subjectID {
            SmartTagService.markScanned(existing)
            phase = .success
            return
        }

        phase = .conflict(tag: existing, otherName: existing.linkedDisplayName ?? "un autre élément")
    }

    private func reassign(_ tag: SmartTag) async {
        phase = .working
        reassignTag(tag, modelContext)
        phase = .success
    }

    private func writeTag() async {
        phase = .working
        let tag = createTag(modelContext)
        guard let url = URL(string: tag.url) else {
            phase = .failure("URL invalide.")
            return
        }
        do {
            try await NFCService.shared.write(url: url, alertMessage: "Approchez votre iPhone du tag NFC")
            SmartTagService.markScanned(tag)
            phase = .success
        } catch {
            guard let nfcError = error as? NFCServiceError else {
                phase = .failure(error.localizedDescription)
                return
            }
            if case .cancelled = nfcError {
                phase = .idle
            } else {
                phase = .failure(nfcError.errorDescription ?? "Erreur NFC.")
            }
        }
    }
}
