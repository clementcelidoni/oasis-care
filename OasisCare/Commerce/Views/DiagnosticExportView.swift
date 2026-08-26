import SwiftData
import SwiftUI

/// Phase 12 §"12P — Exporter un diagnostic." "version app, version iOS,
/// modèle appareil, sync status, subscription status technique,
/// derniers codes d'erreur non sensibles. Ne jamais inclure password,
/// tokens, service role, API keys ou contenu personnel complet."
struct DiagnosticExportView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var syncEngine = SyncEngine.shared
    @ObservedObject private var entitlementService = EntitlementService.shared

    private var diagnosticText: String {
        let info = Bundle.main.infoDictionary
        let appVersion = info?["CFBundleShortVersionString"] as? String ?? "?"
        let buildNumber = info?["CFBundleVersion"] as? String ?? "?"
        var systemInfo = utsname()
        uname(&systemInfo)
        let deviceModel = withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
        }

        let lines = [
            "Oasis Care — Diagnostic",
            "Version app : \(appVersion) (\(buildNumber))",
            "Version iOS : \(UIDevice.current.systemVersion)",
            "Modèle appareil : \(deviceModel)",
            "Statut de synchronisation : \(syncEngine.isSyncing ? "en cours" : "au repos")",
            "Dernière synchronisation : \(syncEngine.lastSyncedAt.map { DateFormatting.shortDate($0) } ?? "jamais")",
            "Dernière erreur de synchronisation : \(syncEngine.lastSyncError ?? "aucune")",
            "Offre : \(entitlementService.snapshot.plan.displayName)",
            "Statut d'abonnement (technique) : \(entitlementService.snapshot.subscriptionStatus.rawValue)",
            "Source de l'abonnement : \(entitlementService.snapshot.source.rawValue)",
            // §12Z — without this, a Sandbox/TestFlight purchase and a
            // real one look identical in a support ticket.
            "Environnement d'achat : \(CommercializationState.current.label)",
        ]
        return lines.joined(separator: "\n")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(diagnosticText)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .navigationTitle("Diagnostic")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    ShareLink(item: diagnosticText)
                }
            }
        }
    }
}
