import SwiftUI
import SwiftData

/// Spec §43 — le scanner QR plein écran.
///
/// ══════════════════════════════════════════════════════════════════
/// LA RÉSOLUTION N'EST PLUS LOCALE SEULEMENT — § 15
/// ══════════════════════════════════════════════════════════════════
///
/// Cet écran s'arrêtait à la base locale et répondait « Ce QR code n'est
/// associé à aucun élément sur cet appareil », y compris quand le
/// serveur, lui, savait parfaitement de quoi il s'agissait. L'en-tête
/// d'origine assumait le choix : « Resolution is local-only (no remote
/// fallback) ». C'était tenable tant qu'une étiquette ne désignait qu'une
/// plante de son propre espace de travail ; ça ne l'est plus depuis que
/// le § 13 veut étiqueter des jardins clients, des lots de pépinière et
/// du matériel, qui n'existent nulle part dans SwiftData.
///
/// L'ORDRE EST CELUI DE `SmartTagService.resoudre` : le local d'abord —
/// c'est plus rapide, et c'est le seul chemin qui marche dans un jardin
/// sans couverture — le serveur seulement en repli.
struct QRScannerSheet: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var scanResult: SmartTagScanResult?
    @State private var etiquetteDistante: EtiquetteResolue?
    @State private var errorMessage: String?
    /// Empêche de relancer une résolution pendant qu'une autre court.
    @State private var resolutionEnCours = false
    /// LE DERNIER JETON TRAITÉ, ET C'EST UNE PROTECTION, PAS UN CONFORT.
    ///
    /// La caméra rend plusieurs trames par seconde tant que le code
    /// reste dans le champ. Sans cette mémoire, un QR refusé — celui
    /// d'une autre marque, ou une étiquette révoquée — relancerait un
    /// appel au résolveur à chaque trame : notre propre écran
    /// fabriquerait l'énumération que la garde du serveur est là pour
    /// repérer, et c'est l'utilisateur innocent qui finirait bloqué.
    @State private var dernierJetonTraite: String?

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
        .sheet(item: $scanResult) { result in
            if case .plant(let plant) = result {
                QuickActionsAfterScanSheet(plant: plant)
            } else {
                SmartTagScanResultSheet(result: result)
            }
        }
        .sheet(item: $etiquetteDistante) { etiquette in
            EtiquetteDistanteSheet(etiquette: etiquette)
        }
        // UNE FEUILLE REFERMÉE REND LE MÊME QR SCANNABLE À NOUVEAU.
        // Sans cela, refermer la fiche d'une plante et viser la même
        // étiquette ne ferait plus rien — le verrou anti-rafale
        // deviendrait un verrou tout court. Un REFUS, lui, garde son
        // verrou jusqu'à la réouverture du scanner : c'est exactement le
        // cas qu'on ne veut pas voir se rejouer trente fois par minute.
        .onChange(of: scanResult?.id) { _, nouveau in
            if nouveau == nil { dernierJetonTraite = nil }
        }
        .onChange(of: etiquetteDistante?.id) { _, nouveau in
            if nouveau == nil { dernierJetonTraite = nil }
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
        // Une résolution en vol, ou une feuille déjà ouverte : on ignore.
        guard !resolutionEnCours, scanResult == nil, etiquetteDistante == nil else { return }

        guard let url = URL(string: payload), let token = SmartTagConfig.token(from: url) else {
            // Ce n'est même pas une adresse Oasis : aucun appel réseau,
            // et un message qui dit la vérité — ce QR n'est pas le nôtre.
            errorMessage = "QR code non reconnu par Oasis Care."
            return
        }

        // LE MÊME JETON NE SE REJOUE PAS TOUT SEUL. Voir
        // `dernierJetonTraite` : sans ce contrôle, un QR laissé dans le
        // champ de la caméra frapperait le résolveur à chaque trame. Le
        // verrou se lève quand une feuille se referme (plus bas), ou à
        // la réouverture du scanner.
        guard token != dernierJetonTraite else { return }
        dernierJetonTraite = token

        Task { await resoudre(token) }
    }

    private func resoudre(_ token: String) async {
        resolutionEnCours = true
        defer { resolutionEnCours = false }

        switch await SmartTagService.resoudre(jeton: token, in: modelContext) {
        case .locale(let resultat):
            errorMessage = nil
            Haptics.success()
            scanResult = resultat
        case .distante(let etiquette):
            errorMessage = nil
            Haptics.success()
            etiquetteDistante = etiquette
        case .refusee(let phrase):
            errorMessage = phrase
        case .injoignable:
            // PAS UN REFUS. Le dire comme tel ferait renoncer quelqu'un
            // dont l'étiquette est parfaitement bonne — et c'est
            // justement dans un jardin qu'il n'y a pas de réseau.
            errorMessage = SmartTagService.phraseInjoignable
        }
    }
}
