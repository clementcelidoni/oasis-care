import Foundation

/// Phase 12 §12Z — "Éviter toute confusion entre achats Sandbox et
/// Production."
///
/// Detected, never configured: a hand-set flag would inevitably ship
/// wrong one day. The App Store receipt's own filename is the standard
/// signal — StoreKit writes `sandboxReceipt` for both the Xcode/Sandbox
/// tester flow and TestFlight, and `receipt` for a real App Store
/// install. TestFlight is then separated from Sandbox by the fact that
/// `DEBUG` is not defined in a TestFlight (Release) build.
///
/// This is for diagnostics and support only (see DiagnosticExportView):
/// nothing about what a user is *allowed* to do may depend on it.
/// Entitlements come from Apple's own verified transactions, which are
/// already environment-correct on their own.
enum CommercializationState: String {
    case development
    case sandbox
    case testFlight
    case production

    static var current: CommercializationState {
        #if DEBUG
        return .development
        #else
        guard let receiptURL = Bundle.main.appStoreReceiptURL else {
            // No receipt at all: normal for a fresh install that has
            // never talked to the App Store. Reporting `production`
            // here would be a guess, but it is the safest guess in a
            // non-DEBUG build — and this value is never used to grant
            // anything.
            return .production
        }
        return receiptURL.lastPathComponent == "sandboxReceipt" ? .testFlight : .production
        #endif
    }

    var label: String {
        switch self {
        case .development: return "Développement"
        case .sandbox: return "Sandbox"
        case .testFlight: return "TestFlight"
        case .production: return "Production"
        }
    }
}
