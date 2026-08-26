import StoreKit
import SwiftUI

/// Phase 12 §"12J — ÉCRAN ABONNEMENT." "Afficher plan actuel, statut,
/// date de renouvellement si disponible, fonctions incluses. Boutons :
/// gérer abonnement, restaurer achats, découvrir Premium si Free."
struct SubscriptionSettingsView: View {
    @ObservedObject private var entitlementService = EntitlementService.shared
    @ObservedObject private var planService = PlanService.shared
    @State private var isShowingManageSubscriptions = false
    @State private var isShowingPaywall: PaywallOffer?
    @State private var isRestoring = false
    @State private var restoreMessage: String?

    private var snapshot: EntitlementSnapshot { entitlementService.snapshot }
    private var configuration: PlanConfiguration { planService.configuration(for: snapshot.plan) }

    var body: some View {
        Form {
            Section {
                LabeledContent("Offre actuelle", value: configuration.displayName)
                LabeledContent("Statut", value: snapshot.subscriptionStatus.label)
                if let expirationDate = snapshot.expirationDate {
                    LabeledContent("Renouvellement / expiration", value: expirationDate.formatted(date: .abbreviated, time: .omitted))
                }
            } footer: {
                // Honesty: an access granted server-side has no Apple
                // subscription behind it, so it must not be presented as
                // one — there is nothing to renew, and nothing to manage
                // in the Apple settings.
                if snapshot.source == .server {
                    Text("Accès offert, sans abonnement Apple. Rien ne vous est facturé et il n'y a rien à renouveler.")
                }
            }

            Section("Fonctions incluses") {
                ForEach(Array(configuration.entitlements).sorted { $0.displayName < $1.displayName }) { entitlement in
                    Text(entitlement.displayName)
                }
            }

            Section {
                if snapshot.plan == .free {
                    Button("Découvrir Premium") { isShowingPaywall = .premium }
                    Button("Découvrir BioLab") { isShowingPaywall = .biolab }
                } else if snapshot.source != .server {
                    // Hidden for a granted access: Apple's sheet would
                    // open on an empty subscription list and read as a bug.
                    Button("Gérer mon abonnement") { isShowingManageSubscriptions = true }
                }
                Button("Restaurer mes achats") {
                    Task { await restore() }
                }
                .disabled(isRestoring)
            }

            if let restoreMessage {
                Section {
                    Text(restoreMessage).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Mon abonnement")
        .navigationBarTitleDisplayMode(.inline)
        .manageSubscriptionsSheet(isPresented: $isShowingManageSubscriptions)
        .sheet(item: $isShowingPaywall) { offer in
            PaywallView(offer: offer)
        }
    }

    private func restore() async {
        isRestoring = true
        restoreMessage = nil
        defer { isRestoring = false }
        let result = await StoreKitService.shared.restorePurchases()
        switch result {
        case .success:
            restoreMessage = "Achats restaurés."
        case .failure(let error):
            restoreMessage = error.errorDescription
        }
    }
}

extension PaywallOffer: Identifiable {
    public var id: String {
        switch self {
        case .premium: return "premium"
        case .biolab: return "biolab"
        }
    }
}
