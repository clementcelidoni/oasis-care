import Foundation
import StoreKit

/// Phase 12 §"12B — STOREKIT 2." "Utiliser les APIs Apple modernes
/// StoreKit 2... AUCUNE logique de prix hardcodée. Afficher TOUJOURS le
/// prix fourni par StoreKit/App Store." The one place this app talks to
/// StoreKit — every price shown anywhere reads `Product.displayPrice`
/// from here, never a literal string.
///
/// Trust model: `Transaction.currentEntitlements` is Apple's own
/// on-device, cryptographically verified source of truth for "what
/// does this Apple ID currently own" — this class treats that as
/// authoritative and independent of network/server availability (§12C).
/// `SubscriptionSyncService` separately best-effort reconciles the
/// backend's own record from the SAME verified transactions; the
/// server is never this class's source of truth for what to grant
/// locally.
@MainActor
final class StoreKitService: ObservableObject {
    static let shared = StoreKitService()

    enum PurchaseOutcome {
        case success
        case pending
        case cancelled
    }

    enum PurchaseError: LocalizedError {
        case verificationFailed
        case unknown

        var errorDescription: String? {
            switch self {
            case .verificationFailed: return "L'achat n'a pas pu être vérifié. Contactez le support si le problème persiste."
            case .unknown: return "L'achat n'a pas pu être finalisé. Réessayez plus tard."
            }
        }
    }

    @Published private(set) var products: [Product] = []
    @Published private(set) var isLoadingProducts = false
    @Published private(set) var loadError: String?

    private var transactionListenerTask: Task<Void, Never>?

    private init() {}

    /// Called once at app launch (see OasisCareApp).
    func start() {
        guard transactionListenerTask == nil else { return }
        transactionListenerTask = Task { [weak self] in
            for await update in Transaction.updates {
                await self?.handle(update)
            }
        }
        Task {
            await loadProducts()
            await refreshEntitlements()
        }
    }

    func loadProducts() async {
        isLoadingProducts = true
        loadError = nil
        defer { isLoadingProducts = false }
        do {
            products = try await Product.products(for: ProductIdentifiers.all)
        } catch {
            // §"NE PAS inventer" extends to errors: never fabricate a
            // product/price when the real catalog can't be reached.
            loadError = "Impossible de charger les offres pour le moment. Vérifiez votre connexion et réessayez."
        }
    }

    func product(withID id: String) -> Product? {
        products.first { $0.id == id }
    }

    @discardableResult
    func purchase(_ product: Product) async -> Result<PurchaseOutcome, PurchaseError> {
        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                guard case .verified(let transaction) = verification else {
                    return .failure(.verificationFailed)
                }
                await transaction.finish()
                await refreshEntitlements()
                return .success(.success)
            case .userCancelled:
                return .success(.cancelled)
            case .pending:
                return .success(.pending)
            @unknown default:
                return .failure(.unknown)
            }
        } catch {
            return .failure(.unknown)
        }
    }

    /// §12F "Restaurer mes achats — Bouton obligatoire et fonctionnel."
    @discardableResult
    func restorePurchases() async -> Result<Void, PurchaseError> {
        do {
            try await AppStore.sync()
            await refreshEntitlements()
            return .success(())
        } catch {
            return .failure(.unknown)
        }
    }

    /// Rebuilds the local `EntitlementSnapshot` purely from Apple's own
    /// verified transactions — the only function in this app allowed to
    /// call `EntitlementService.update` with `source: .storeKit`.
    func refreshEntitlements() async {
        var ownedProductIDs: Set<String> = []
        var latestExpiration: Date?
        var oneVerifiedResult: VerificationResult<Transaction>?
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            ownedProductIDs.insert(transaction.productID)
            oneVerifiedResult = result
            if let expirationDate = transaction.expirationDate {
                latestExpiration = [latestExpiration, expirationDate].compactMap { $0 }.max()
            }
        }
        // Best-effort backend sync (§ SubscriptionSyncService) using
        // any one currently-verified transaction — Apple's own
        // originalTransactionId ties the whole subscription group
        // together server-side, so any single owned transaction is
        // enough to reconcile the full set.
        if let oneVerifiedResult {
            await SubscriptionSyncService.sync(oneVerifiedResult)
        }

        let plan = ProductIdentifiers.plan(for: ownedProductIDs)
        let status = await subscriptionStatus(for: ownedProductIDs, plan: plan)

        let snapshot: EntitlementSnapshot
        if plan == .free {
            snapshot = .free
        } else {
            snapshot = EntitlementSnapshot(
                plan: plan,
                activeEntitlements: PlanService.shared.configuration(for: plan).entitlements,
                expirationDate: latestExpiration,
                subscriptionStatus: status,
                lastVerifiedAt: .now,
                source: .storeKit
            )
        }
        EntitlementService.shared.update(snapshot)
    }

    /// §"Statuts — gérer proprement les états réellement
    /// fournis/supportés par les APIs Apple." Reads the real
    /// `Product.SubscriptionInfo.RenewalState` for whichever owned
    /// product's subscription group is relevant, rather than inferring
    /// a status from dates ourselves.
    private func subscriptionStatus(for ownedProductIDs: Set<String>, plan: OasisPlan) async -> SubscriptionStatus {
        guard plan != .free, let anyOwnedID = ownedProductIDs.first, let product = product(withID: anyOwnedID),
              let subscription = product.subscription else { return .none }
        guard let statuses = try? await subscription.status, let current = statuses.first else { return .none }
        switch current.state {
        case .subscribed: return .subscribed
        case .expired: return .expired
        case .inBillingRetryPeriod: return .inBillingRetryPeriod
        case .inGracePeriod: return .inGracePeriod
        case .revoked: return .revoked
        default: return .none
        }
    }

    private func handle(_ verification: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = verification else { return }
        await transaction.finish()
        await refreshEntitlements()
    }
}
