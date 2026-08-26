import SwiftData
import SwiftUI

/// Phase 12 §12I — "Refaire ou compléter l'onboarding si nécessaire, en
/// restant très simple." Adds the spec's 5 product-tour screens BEFORE
/// the existing WelcomeView, which is kept completely unchanged as the
/// sign-in/guest choice per "Conserver si possible `Continuer
/// gratuitement` et le mode invité existant si cohérent" — this view
/// never itself offers a subscription (§"NE PAS FORCER L'ABONNEMENT
/// IMMÉDIATEMENT").
struct OnboardingView: View {
    var onComplete: () -> Void

    @Environment(\.modelContext) private var modelContext
    @State private var page = 0

    @State private var wantsIndoorPlants = true
    @State private var wantsGarden = true
    @State private var wantsGreenhouse = false
    @State private var wantsPond = false
    @State private var wantsConnectedGarden = false
    @State private var wantsBioLab = false

    private struct FeatureScreen {
        var icon: String
        var title: String
        var subtitle: String
    }

    /// Écrans 2-5, spec's own copy verbatim (§12I). Écran 1 is
    /// `introScreen` below, reusing WelcomeView's existing header text.
    private let featureScreens: [FeatureScreen] = [
        FeatureScreen(icon: "leaf.fill", title: "Vos plantes", subtitle: "Suivi, arrosage, photos, santé, historique."),
        FeatureScreen(icon: "map.fill", title: "Votre jardin", subtitle: "Digital Twin, irrigation, capteurs, serre, bassin."),
        FeatureScreen(icon: "sparkles", title: "Oasis AI", subtitle: "Identification, conseils, diagnostic assisté."),
        FeatureScreen(icon: "testtube.2", title: "Oasis BioLab", subtitle: "Culture in vitro, bioréacteurs, protocoles, traçabilité.")
    ]

    /// Intro + the four feature screens + the preferences screen.
    private var lastPage: Int { featureScreens.count + 1 }
    private var isOnLastPage: Bool { page == lastPage }

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $page) {
                introScreen.tag(0)
                ForEach(Array(featureScreens.enumerated()), id: \.offset) { index, screen in
                    featureScreenView(screen).tag(index + 1)
                }
                preferencesScreen.tag(lastPage)
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))

            // One persistent CTA rather than a copy on every page: the
            // pages stay pure content, and there's exactly one "Suivant"
            // in the accessibility tree at any time (a per-page button
            // would appear several times over, since a paged TabView
            // keeps neighbouring pages mounted).
            Button(isOnLastPage ? "Continuer" : "Suivant") {
                if isOnLastPage {
                    complete()
                } else {
                    withAnimation { page += 1 }
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(.horizontal)
            .padding(.bottom, 24)
            .accessibilityIdentifier("onboardingPrimaryButton")
        }
        .task {
            PurchaseAnalyticsService.track(.onboardingStarted)
        }
    }

    private var introScreen: some View {
        VStack(spacing: 16) {
            Spacer()
            Image("OasisLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 96, height: 96)
            Text("Oasis Care")
                .font(.largeTitle.weight(.bold))
            Text("Prenez soin de tout votre univers végétal.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Spacer()
        }
        .padding()
    }

    private func featureScreenView(_ screen: FeatureScreen) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: screen.icon)
                .font(.system(size: 56))
                .foregroundStyle(Color.accentColor)
            Text(screen.title)
                .font(.title.weight(.bold))
            Text(screen.subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Spacer()
        }
        .padding()
    }

    private var preferencesScreen: some View {
        VStack(spacing: 4) {
            Text("Que souhaitez-vous gérer ?")
                .font(.title2.weight(.bold))
                .multilineTextAlignment(.center)
                .padding(.top, 32)
                .padding(.horizontal, 32)
            Text("Cela personnalise l'interface, jamais le prix.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.bottom, 8)

            List {
                Toggle("Plantes d'intérieur", isOn: $wantsIndoorPlants)
                Toggle("Jardin", isOn: $wantsGarden)
                Toggle("Serre", isOn: $wantsGreenhouse)
                Toggle("Bassin", isOn: $wantsPond)
                Toggle("Jardin connecté", isOn: $wantsConnectedGarden)
                Toggle("Culture in vitro / BioLab", isOn: $wantsBioLab)
            }
            .scrollContentBackground(.hidden)
        }
    }

    private func complete() {
        applyPreferences()
        PurchaseAnalyticsService.track(.onboardingCompleted)
        onComplete()
    }

    /// Only `showConnectedHome`/`showBioLab` have a matching
    /// DashboardPreferences toggle today — indoor plants and gardens are
    /// core, always-shown functionality (nothing to personalize), and
    /// greenhouse/pond have no independent visibility toggle yet (see
    /// the Phase 12 report). Wiring the two that exist still satisfies
    /// spec's own framing of this screen as an optional, best-effort
    /// personalization signal, never a commercial gate.
    private func applyPreferences() {
        let preferences = DashboardService.preferences(in: modelContext)
        preferences.showConnectedHome = wantsConnectedGarden
        preferences.showBioLab = wantsBioLab
    }
}
