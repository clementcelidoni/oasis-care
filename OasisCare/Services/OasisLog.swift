import Foundation
import OSLog

/// Phase 12 §12Q — "Centraliser les logs par catégories : Auth, Sync,
/// StoreKit, Subscription, AI, BioLab, ConnectedGarden, Database.
/// Utiliser OSLog lorsque pertinent."
///
/// OSLog rather than `print`: entries go to the unified log with a
/// subsystem/category, so they can be filtered in Console.app or read
/// off a real device with `log stream --predicate 'subsystem ==
/// "com.oasisrarecare.app"'` — which matters here because the parts of
/// this app most likely to fail (a purchase, a webhook reconciliation,
/// a sync) fail on the user's device, long after any debugger is
/// attached. `print` writes nothing retrievable in a TestFlight build.
///
/// PRIVACY (§12K/§12N): OSLog redacts interpolated values by default
/// unless marked `privacy: .public`. Never mark a plant name, note,
/// e-mail, token, or any user-authored text public — only stable
/// technical values (a product id, a state name, an error code). The
/// helpers below take a plain `String` message, so the caller is
/// responsible for not building that string out of personal data.
enum OasisLog {
    private static let subsystem = "com.oasisrarecare.app"

    static let auth = Logger(subsystem: subsystem, category: "Auth")
    static let sync = Logger(subsystem: subsystem, category: "Sync")
    static let storeKit = Logger(subsystem: subsystem, category: "StoreKit")
    static let subscription = Logger(subsystem: subsystem, category: "Subscription")
    static let ai = Logger(subsystem: subsystem, category: "AI")
    static let bioLab = Logger(subsystem: subsystem, category: "BioLab")
    static let connectedGarden = Logger(subsystem: subsystem, category: "ConnectedGarden")
    static let database = Logger(subsystem: subsystem, category: "Database")
}
