import SwiftUI
import UIKit

/// Phase 12 §"12P — SUPPORT UTILISATEUR."
struct SupportView: View {
    @Environment(\.modelContext) private var modelContext
    @ObservedObject private var authState = AuthState.shared
    @State private var isShowingDiagnostic = false
    @State private var isShowingPrivacy = false

    /// A starting point, not a dedicated inbox — change this to a real
    /// support address before launch if you want one separate from your
    /// own inbox (see the Phase 12 report's own flagged action items).
    private let supportEmail = "clement.celidoni@gmail.com"

    var body: some View {
        Form {
            Section("Aide") {
                Button("Contacter le support") { openSupportEmail(subject: "Support Oasis Care") }
                Button("Signaler un problème") { openSupportEmail(subject: "Problème signalé — Oasis Care") }
            }

            Section("Abonnement") {
                NavigationLink("Mon abonnement") { SubscriptionSettingsView() }
            }

            Section("Confidentialité") {
                Button("Politique de confidentialité") { isShowingPrivacy = true }
                NavigationLink("Exporter mes données") { DataExportView() }
            }

            Section {
                Button("Exporter un diagnostic") { isShowingDiagnostic = true }
            } footer: {
                Text("Un diagnostic technique (version, appareil, état de synchronisation) que vous pouvez joindre à un message de support. Ne contient jamais de mot de passe, de clé ou le contenu de vos plantes.")
            }

            Section {
                LabeledContent("Identifiant support", value: supportIdentifier)
            } footer: {
                Text("Communiquez cet identifiant au support plutôt que votre e-mail si vous préférez rester anonyme dans votre message.")
            }
        }
        .navigationTitle("Aide & Support")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isShowingDiagnostic) {
            DiagnosticExportView()
        }
        .sheet(isPresented: $isShowingPrivacy) {
            LegalDocumentView(document: .privacy)
        }
    }

    /// A pseudonymous identifier (§"Afficher un identifiant support
    /// pseudonyme") derived from the account's own stable UUID, never
    /// the email — safe to read aloud or paste into a support ticket.
    private var supportIdentifier: String {
        guard let userID = authState.session?.user.id else { return "Invité" }
        return String(userID.uuidString.prefix(8)).uppercased()
    }

    private func openSupportEmail(subject: String) {
        let encodedSubject = subject.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? subject
        let body = "\n\n—\nIdentifiant support : \(supportIdentifier)"
        let encodedBody = body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        guard let url = URL(string: "mailto:\(supportEmail)?subject=\(encodedSubject)&body=\(encodedBody)") else { return }
        UIApplication.shared.open(url)
    }
}
