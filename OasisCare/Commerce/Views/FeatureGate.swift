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
            LockedFeatureView(featureName: featureName)
        }
    }
}

struct LockedFeatureView: View {
    var featureName: String
    @State private var isShowingPaywall = false

    var body: some View {
        ContentUnavailableView {
            Label(featureName, systemImage: "lock.fill")
        } description: {
            Text("Disponible avec Oasis Care Premium.")
        } actions: {
            Button("Découvrir Premium") { isShowingPaywall = true }
                .buttonStyle(.borderedProminent)
        }
        .sheet(isPresented: $isShowingPaywall) {
            PaywallView(offer: .premium)
        }
    }
}
