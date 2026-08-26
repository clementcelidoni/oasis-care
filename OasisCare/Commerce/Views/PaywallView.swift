import StoreKit
import SwiftUI

/// Phase 12 §"12F — PAYWALL." "Créer un paywall moderne, très simple et
/// sans dark patterns. Pas de faux compte à rebours. Pas de bouton de
/// fermeture volontairement invisible." — the close button is a plain,
/// always-visible toolbar item; there is no countdown anywhere.
enum PaywallOffer {
    case premium
    case biolab

    var monthlyProductID: String {
        switch self {
        case .premium: return ProductIdentifiers.premiumMonthly
        case .biolab: return ProductIdentifiers.biolabMonthly
        }
    }
    var yearlyProductID: String {
        switch self {
        case .premium: return ProductIdentifiers.premiumYearly
        case .biolab: return ProductIdentifiers.biolabYearly
        }
    }
    var title: String {
        switch self {
        case .premium: return "OASIS CARE PREMIUM"
        case .biolab: return "OASIS CARE BIOLAB"
        }
    }
    var tagline: String {
        switch self {
        case .premium: return "Votre jardin, plus intelligent."
        case .biolab: return "Tout Premium, plus le laboratoire."
        }
    }
    /// Spec's own bullet lists (§12F), verbatim.
    var features: [String] {
        switch self {
        case .premium:
            return [
                "Jardins avancés", "Oasis AI", "Digital Twin", "Capteurs et Connected Garden",
                "Irrigation intelligente", "Serre et bassin", "QR / NFC", "Analytics avancés"
            ]
        case .biolab:
            return [
                "Bioréacteurs", "Lots TC", "Recettes intelligentes", "Smart Media",
                "Protocoles", "Analyses BioLab", "Expérimentations", "Traçabilité complète"
            ]
        }
    }
}

struct PaywallView: View {
    var offer: PaywallOffer

    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var storeKit = StoreKitService.shared
    @State private var selectedProductID: String?
    @State private var isPurchasing = false
    @State private var isRestoring = false
    @State private var errorMessage: String?
    @State private var isShowingLegal: LegalDocument?

    private var monthlyProduct: Product? { storeKit.product(withID: offer.monthlyProductID) }
    private var yearlyProduct: Product? { storeKit.product(withID: offer.yearlyProductID) }

    /// §"BioLab: Tout Premium +" — shown only for the BioLab offer.
    private var includesPremiumHeader: Bool { offer == .biolab }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(offer.title)
                            .font(.title2.weight(.bold))
                        Text(offer.tagline)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        if includesPremiumHeader {
                            Text("Tout Premium +").font(.subheadline.weight(.semibold))
                        }
                        ForEach(offer.features, id: \.self) { feature in
                            Label(feature, systemImage: "checkmark")
                                .font(.subheadline)
                        }
                    }

                    if storeKit.isLoadingProducts {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if let loadError = storeKit.loadError {
                        Text(loadError).font(.caption).foregroundStyle(.red)
                    } else {
                        VStack(spacing: 10) {
                            planOptionRow(product: monthlyProduct, periodLabel: "Mensuel")
                            planOptionRow(product: yearlyProduct, periodLabel: "Annuel")
                        }
                    }

                    if let errorMessage {
                        Text(errorMessage).font(.caption).foregroundStyle(.red)
                    }

                    Button {
                        Task { await purchaseSelected() }
                    } label: {
                        if isPurchasing {
                            ProgressView().frame(maxWidth: .infinity)
                        } else {
                            Text("Continuer").frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(selectedProductID == nil || isPurchasing)

                    VStack(spacing: 8) {
                        Button("Restaurer mes achats") {
                            Task { await restore() }
                        }
                        .disabled(isRestoring)

                        HStack(spacing: 16) {
                            Button("Conditions") { isShowingLegal = .terms }
                            Button("Confidentialité") { isShowingLegal = .privacy }
                        }
                        .font(.caption)
                    }
                    .frame(maxWidth: .infinity)
                }
                .padding()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .task {
                if storeKit.products.isEmpty { await storeKit.loadProducts() }
                if selectedProductID == nil { selectedProductID = yearlyProduct?.id ?? monthlyProduct?.id }
            }
            .sheet(item: $isShowingLegal) { document in
                LegalDocumentView(document: document)
            }
        }
    }

    private func planOptionRow(product: Product?, periodLabel: String) -> some View {
        Button {
            selectedProductID = product?.id
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(periodLabel).font(.subheadline.weight(.semibold))
                    if let product {
                        // §"AUCUNE logique de prix hardcodée" — always
                        // StoreKit's own localized display price.
                        Text(product.displayPrice).font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text("Indisponible").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if product != nil, selectedProductID == product?.id {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.accentColor)
                } else {
                    Image(systemName: "circle").foregroundStyle(.tertiary)
                }
            }
            .padding()
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(product == nil)
    }

    private func purchaseSelected() async {
        guard let selectedProductID, let product = storeKit.product(withID: selectedProductID) else { return }
        errorMessage = nil
        isPurchasing = true
        defer { isPurchasing = false }
        let result = await storeKit.purchase(product)
        switch result {
        case .success(.success):
            dismiss()
        case .success(.pending):
            errorMessage = "Achat en attente d'approbation (contrôle parental ou autre validation)."
        case .success(.cancelled):
            break
        case .failure(let error):
            errorMessage = error.errorDescription
        }
    }

    private func restore() async {
        errorMessage = nil
        isRestoring = true
        defer { isRestoring = false }
        let result = await storeKit.restorePurchases()
        if case .failure(let error) = result {
            errorMessage = error.errorDescription
        } else {
            dismiss()
        }
    }
}

extension PaywallOffer: Equatable {}
