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
    @State private var quotaStatuses: [AIFeature: AIQuotaService.Status] = [:]
    @State private var isLoadingQuotas = true

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

            // The 80% banner alone left no way to see consumption below
            // the threshold — you only learned your usage when you were
            // nearly out of it.
            Section {
                if isLoadingQuotas {
                    HStack { ProgressView(); Text("Chargement…").foregroundStyle(.secondary) }
                } else if quotaStatuses.isEmpty {
                    Text("Consommation indisponible pour le moment.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(AIFeature.allCases.filter { quotaStatuses[$0] != nil }) { feature in
                        if let status = quotaStatuses[feature] {
                            quotaRow(feature: feature, status: status)
                        }
                    }
                }
            } header: {
                Text("Consommation IA ce mois-ci")
            } footer: {
                Text("Chaque catégorie a son propre quota : épuiser l'une n'empêche pas d'utiliser les autres. Les compteurs repartent de zéro au début de chaque mois.")
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
        .task {
            defer { isLoadingQuotas = false }
            quotaStatuses = await AIQuotaService.allStatuses()
        }
        .manageSubscriptionsSheet(isPresented: $isShowingManageSubscriptions)
        .sheet(item: $isShowingPaywall) { offer in
            PaywallView(offer: offer)
        }
    }

    private func quotaRow(feature: AIFeature, status: AIQuotaService.Status) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(feature.displayName).font(.subheadline)
                Spacer()
                Text("\(status.used) / \(status.limit)")
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(status.isAtLimit ? Color.red : (status.isNearLimit ? Color.orange : Color.secondary))
            }
            ProgressView(value: min(status.usageFraction, 1))
                .tint(status.isAtLimit ? .red : (status.isNearLimit ? .orange : .accentColor))
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(feature.displayName) : \(status.used) sur \(status.limit) utilisées ce mois-ci")
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
