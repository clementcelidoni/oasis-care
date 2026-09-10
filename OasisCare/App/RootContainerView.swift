import SwiftUI

/// Top-level router driven by AuthState. `hasSeenWelcome` is a separate,
/// simpler flag from AuthState.status: an existing Phase 1/2 user (or
/// anyone who already tapped "Continuer sans compte" once) must never be
/// routed back through Welcome just because they're signed out — per the
/// spec, an accountless user keeps full access to local functionality.
struct RootContainerView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase

    @ObservedObject private var authState = AuthState.shared
    @ObservedObject private var syncEngine = SyncEngine.shared
    @ObservedObject private var deepLinkRouter = DeepLinkRouter.shared
    @AppStorage("hasSeenWelcome") private var hasSeenWelcome = false
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false

    var body: some View {
        Group {
            switch authState.status {
            case .loading:
                ProgressView()
            case .authenticated:
                RootTabView()
            case .guest:
                if hasSeenWelcome {
                    RootTabView()
                } else if hasCompletedOnboarding {
                    WelcomeView {
                        hasSeenWelcome = true
                    }
                } else {
                    OnboardingView {
                        hasCompletedOnboarding = true
                    }
                }
            }
        }
        .task {
            authState.start()
            // Independent of auth status: a guest's Apple ID can still
            // hold a real subscription (StoreKit doesn't require this
            // app's own account), consistent with guest mode otherwise
            // keeping full local functionality.
            StoreKitService.shared.start()
        }
        // ON OBSERVE LE COMPTE, PAS L'ÉTAT DE CONNEXION.
        //
        // `status` reste `.authenticated` quand on passe d'un compte à un
        // autre : la valeur ne change pas, donc rien ne se déclenchait.
        // C'est ce silence qui a laissé les végétaux d'un compte
        // s'afficher sous un autre. L'identifiant du compte, lui, change.
        //
        // Le lancement est couvert de la même façon — la session passe de
        // « aucune » à « celle-ci », donc l'identifiant change aussi.
        .onChange(of: authState.session?.user.id) { _, nouveauCompte in
            guard nouveauCompte != nil else { return }

            // AVANT TOUTE SYNCHRONISATION, et l'ordre est la sécurité :
            // si la copie locale appartient à quelqu'un d'autre, elle
            // part maintenant. Lancer la synchronisation d'abord
            // renverrait ses lignes au serveur estampillées au nom du
            // compte courant — la fuite d'affichage deviendrait une
            // copie réelle de données d'une personne chez une autre.
            //
            // Si l'effacement échoue, on ne bloque pas ici : le
            // propriétaire inscrit reste l'ancien compte, et la
            // synchronisation refusera de partir d'elle-même.
            authState.adopterOuNettoyer(context: modelContext)

            Task { await syncEngine.syncIfPossible(context: modelContext) }
            deepLinkRouter.retryPendingTokenIfNeeded(context: modelContext)
            Task { await CommercialConfigService.refresh() }
            // Picks up an entitlement granted server-side rather than
            // bought through StoreKit (complimentary account, support
            // gesture). Only ever upgrades — see ServerEntitlementService.
            Task { await ServerEntitlementService.refreshAndApply() }
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Task { await syncEngine.syncIfPossible(context: modelContext) }
        }
        .onOpenURL { url in
            deepLinkRouter.handle(url: url, context: modelContext)
        }
    }
}
