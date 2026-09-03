import Foundation
import Security
import UIKit

/// The tiny slice of persistence `InstallationIdentifier` needs, behind a
/// protocol for one reason: so the resolution rules below can be unit
/// tested. A test that wrote to the real keychain would leak state from
/// one run into the next, and the very thing worth testing here is what
/// happens the *second* time.
protocol InstallationIdentifierStorage {
    func readIdentifier() -> String?
    /// Returns `false` when the value could not be persisted. The caller
    /// must then NOT hand back a fresh identifier it has no way of
    /// remembering — see `InstallationIdentifier.resolve`.
    func writeIdentifier(_ identifier: String) -> Bool
}

/// Keychain-backed storage for the installation identifier.
///
/// WHY THE KEYCHAIN AND NOT `UserDefaults`: UserDefaults is wiped when the
/// app is deleted, so every reinstall would draw a new identifier and add
/// a row to `mobile_app_installations`. The device count would climb on
/// its own, with nothing in the data to reveal that it was climbing for no
/// reason. A keychain item survives a reinstall, so a returning user keeps
/// the same row.
struct KeychainInstallationIdentifierStorage: InstallationIdentifierStorage {
    static let shared = KeychainInstallationIdentifierStorage()

    private let service = "com.oasisrarecare.app.presence"
    private let account = "installation-identifier"

    private var identityQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func readIdentifier() -> String? {
        var query = identityQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let identifier = String(data: data, encoding: .utf8)
        else { return nil }
        return identifier
    }

    func writeIdentifier(_ identifier: String) -> Bool {
        guard let data = identifier.data(using: .utf8) else { return false }

        // Delete first: `SecItemAdd` on an existing (service, account)
        // pair returns errSecDuplicateItem instead of overwriting.
        _ = SecItemDelete(identityQuery as CFDictionary)

        var attributes = identityQuery
        attributes[kSecValueData as String] = data
        // `AfterFirstUnlock` and not `WhenUnlocked`: a sync can run with
        // the screen locked (a background refresh after a reboot), and an
        // item we cannot read is an item that sends us down the fallback
        // path for nothing.
        //
        // `ThisDeviceOnly` is the deliberate half: it excludes the item
        // from encrypted backups. Without it, restoring a backup onto a
        // new iPhone would carry the identifier across, two physical
        // devices would share one row, and the device count would
        // silently drop by one. A restored device IS a new installation.
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        return SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess
    }
}

/// A stable identifier for THIS INSTALLATION of the app, so the Control
/// Center can count devices ("nombre d'appareils", Control Center spec
/// p.8) without ever learning anything about the device itself.
///
/// WHAT THIS IS NOT — and the list is the whole point. It is not a
/// hardware identifier, not the device model, not the device name
/// ("iPhone de Clément" is a person's name, not a device attribute), not
/// an advertising identifier, not a location, not an IP address. It is a
/// random UUID this app draws once and keeps. It says "the same
/// installation came back", and nothing else at all.
enum InstallationIdentifier {
    /// Mirrors the guard in `declare_mobile_presence` (migration 0077):
    /// 8 to 64 characters, hex digits and dashes only — which is to say, a
    /// UUID with or without its dashes, and nothing else.
    ///
    /// IT IS AN ALLOW LIST, and that is the point. Rejecting whitespace
    /// alone kept nothing out: "iPhone-de-Clement-Celidoni" has none and
    /// fits comfortably inside 64 characters. Everything this app can
    /// legitimately produce — `UUID().uuidString`, `identifierForVendor`
    /// — is hex and dashes, so the allow list costs nothing and closes
    /// the question instead of closing one character.
    ///
    /// Repeating the server rule here means a corrupted or hand-edited
    /// keychain value is redrawn locally instead of producing a request
    /// the server is going to refuse anyway.
    static func isValid(_ identifier: String) -> Bool {
        guard (8...64).contains(identifier.count) else { return false }
        // Spelled out rather than `Character.isHexDigit`, which also
        // accepts full-width forms the server's `[0-9A-Fa-f-]` would
        // refuse. The two rules have to be the same rule.
        let allowed: Set<Character> = Set("0123456789abcdefABCDEF-")
        return identifier.allSatisfy { character in allowed.contains(character) }
    }

    /// Resolution order, and each fallback is a step down in quality:
    ///
    ///  1. the identifier we already drew and kept — the normal path;
    ///  2. a freshly drawn UUID, but only if we managed to persist it;
    ///  3. `identifierForVendor`, when nothing can be persisted at all;
    ///  4. nothing.
    ///
    /// Step 4 is not a defeat, it is the honest answer. Declaring under a
    /// made-up identifier would add a device that never existed, and a
    /// count inflated by our own retries is worse than a count that is
    /// merely late.
    static func resolve(storage: InstallationIdentifierStorage, vendorIdentifier: String?) -> String? {
        if let stored = storage.readIdentifier(), isValid(stored) {
            return stored
        }

        let drawn = UUID().uuidString
        if storage.writeIdentifier(drawn) {
            return drawn
        }

        // We could not remember `drawn`, so handing it back would mean a
        // brand-new identifier at every single launch — one row per
        // launch, forever. `identifierForVendor` is at least stable for as
        // long as the app stays installed, and it is not a hardware
        // identifier either: iOS resets it once the last app from this
        // vendor is deleted.
        if let vendorIdentifier, isValid(vendorIdentifier) {
            return vendorIdentifier
        }

        return nil
    }

    /// The real-device wiring. Kept apart from `resolve` so the rules
    /// above stay testable off-device.
    @MainActor
    static func current() -> String? {
        resolve(
            storage: KeychainInstallationIdentifierStorage.shared,
            vendorIdentifier: UIDevice.current.identifierForVendor?.uuidString
        )
    }
}
