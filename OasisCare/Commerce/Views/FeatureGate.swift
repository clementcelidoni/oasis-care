import SwiftUI

/// Phase 12 §"12G — FEATURE GATING." "Si non accessible, afficher un
/// écran pédagogique... Ne pas transformer l'app en succession de
/// cadenas" — one calm screen naming the feature and one button to
/// Premium, never a stack of nested locks.
struct FeatureGate<Content: View>: View {
    var entitlement: Entitlement
    var featureName: String
    @ViewBuilder var content: () -> Content

    @ObservedObject private var entitlementService = EntitlementService.shared

    var body: some View {
        if entitlementService.has(entitlement) {
            content()
        } else {
            LockedFeatureView(featureName: featureName, offer: Self.offer(for: entitlement))
        }
    }

    /// BioLab-only entitlements (biolab, bioreactors, smartMedia...)
    /// aren't granted by Premium alone (PlanConfigurationStore) — sending
    /// their locked screen to the plain Premium paywall would let a user
    /// buy Premium and come back still locked out, with no clear next
    /// step. Route to whichever real offer actually grants it.
    private static func offer(for entitlement: Entitlement) -> PaywallOffer {
        PlanService.shared.configuration(for: .premium).entitlements.contains(entitlement) ? .premium : .biolab
    }
}

/// LockedFeatureView presented as a sheet in its own right — used where
/// a limit is checked imperatively before opening a sheet (a count limit,
/// or a button that starts a hardware session) rather than by wrapping a
/// destination view. Adds the explicit "Fermer" a bare
/// ContentUnavailableView has no room for, so the only way out of the
/// sheet isn't an undiscoverable swipe.
struct LockedFeatureSheet: View {
    var featureName: String
    var offer: PaywallOffer = .premium

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            LockedFeatureView(featureName: featureName, offer: offer)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Fermer") { dismiss() }
                    }
                }
        }
    }
}

struct LockedFeatureView: View {
    var featureName: String
    var offer: PaywallOffer = .premium
    @State private var isShowingPaywall = false

    var body: some View {
        ContentUnavailableView {
            Label(featureName, systemImage: "lock.fill")
        } description: {
            Text(offer == .biolab ? "Disponible avec Oasis Care BioLab." : "Disponible avec Oasis Care Premium.")
        } actions: {
            Button(offer == .biolab ? "Découvrir BioLab" : "Découvrir Premium") { isShowingPaywall = true }
                .buttonStyle(.borderedProminent)
        }
        .onAppear {
            PurchaseAnalyticsService.track(.featureLockedViewed, detail: featureName)
        }
        .sheet(isPresented: $isShowingPaywall) {
            PaywallView(offer: offer)
        }
    }
}
