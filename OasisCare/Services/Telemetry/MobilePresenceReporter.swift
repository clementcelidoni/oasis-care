import Foundation
import Supabase
import UIKit

/// The five arguments of `declare_mobile_presence`, and no sixth. The
/// parameter names are the SQL function's, which is why they go through
/// CodingKeys rather than being spelled that way in Swift.
///
/// Note what is NOT here: no user identifier. 0077 takes none on purpose —
/// the only identity the function knows is the bearer of the token, so
/// there is nothing on this side to get wrong or to spoof.
private struct DeclareMobilePresenceParams: Encodable, Sendable {
    let installID: String
    let platform: String
    let appVersion: String
    let appBuild: String
    let osMajor: Int

    enum CodingKeys: String, CodingKey {
        case installID = "p_install_id"
        case platform = "p_platform"
        case appVersion = "p_app_version"
        case appBuild = "p_app_build"
        case osMajor = "p_os_major"
    }
}

/// Announces to Supabase that this installation exists, so the Control
/// Center can stop showing "—" next to "Oasis Care Mobile" (migration
/// 0077, `declare_mobile_presence`).
///
/// FOUR RULES, and they are the whole design:
///
///  1. NOTHING IS SENT FOR A GUEST. The KPI counts accounts; a guest has
///     none, so there is nothing to declare. This is also why the number
///     must be read as "mobile *accounts*", never "mobile users".
///
///  2. AT MOST ONE ATTEMPT PER ACCOUNT PER LAUNCH. `scenePhase == .active`
///     fires on every return to the foreground; without this gate the
///     table would be rewritten all day for nothing. One attempt, not one
///     success: if it fails there is nothing urgent to deliver — the next
///     launch will say the same thing.
///
///  3. IT NEVER MAKES A NOISE AND IT NEVER FAILS UPWARD. A user with no
///     signal must see nothing, and above all the sync of their real data
///     must not fail because a telemetry call did. This is administrative
///     comfort, never a dependency.
///
///  4. IT SENDS NO IDENTITY. `declare_mobile_presence` takes no user
///     parameter by design: the only identity it knows is the bearer of
///     the token. There is nothing here to get wrong.
@MainActor
enum MobilePresenceReporter {
    /// Rule 2. Keyed by account rather than a single flag, so that signing
    /// out and signing in as someone else during the same launch still
    /// declares the second account — otherwise that account would simply
    /// never be counted.
    private static var accountsHandledThisLaunch: Set<UUID> = []

    static func declareIfNeeded(defaults: UserDefaults = .standard) async {
        // Rule 1.
        guard case .authenticated = AuthState.shared.status,
              let userID = AuthState.shared.session?.user.id
        else { return }

        // Rule 2. Marked handled BEFORE the work, not after: one attempt
        // per launch means one attempt, whatever the outcome.
        guard !accountsHandledThisLaunch.contains(userID) else { return }
        accountsHandledThisLaunch.insert(userID)

        guard let installID = InstallationIdentifier.current() else {
            // Nothing stable to identify this installation by. Saying
            // nothing beats inventing a device.
            OasisLog.sync.debug("Mobile presence: no stable installation identifier, declaration skipped.")
            return
        }

        let info = Bundle.main.infoDictionary
        guard let appVersion = MobilePresenceEnvironment.appVersion(from: info),
              let appBuild = MobilePresenceEnvironment.appBuild(from: info),
              let osMajor = MobilePresenceEnvironment.osMajor(
                  fromSystemVersion: UIDevice.current.systemVersion
              )
        else {
            // 0077 refuses a partial declaration on purpose: a made-up
            // "0.1.0" would become a line in the version distribution.
            OasisLog.sync.debug("Mobile presence: incomplete build information, declaration skipped.")
            return
        }

        let declaration = MobilePresenceDeclaration(
            installID: installID,
            appVersion: appVersion,
            appBuild: appBuild,
            osMajor: osMajor
        )
        let fingerprint = declaration.fingerprint(userID: userID)
        let now = Date()

        guard MobilePresenceThrottle.shouldDeclare(
            fingerprint: fingerprint,
            lastRecord: MobilePresenceThrottleStore.load(from: defaults),
            now: now
        ) else { return }

        let params = DeclareMobilePresenceParams(
            installID: declaration.installID,
            platform: MobilePresenceDeclaration.platform,
            appVersion: declaration.appVersion,
            appBuild: declaration.appBuild,
            osMajor: declaration.osMajor
        )

        do {
            try await AuthService.client
                .rpc("declare_mobile_presence", params: params)
                .execute()
            // Recorded only on success, so an offline launch retries at
            // the next one instead of pretending it has been counted.
            MobilePresenceThrottleStore.save(
                MobilePresenceThrottle.Record(fingerprint: fingerprint, declaredAt: now),
                to: defaults
            )
        } catch {
            // Rule 3. Swallowed on purpose, and logged at debug level with
            // no interpolated value: there is no user-visible consequence
            // and nothing here is worth a personal detail in the log.
            OasisLog.sync.debug("Mobile presence: declaration not delivered, ignored.")
        }
    }
}
