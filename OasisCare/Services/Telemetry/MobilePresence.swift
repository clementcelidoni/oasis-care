import Foundation

/// Everything the phone declares about itself to `declare_mobile_presence`
/// (migration 0077) — and nothing else. Five values, chosen so that the
/// Control Center can answer five questions ("how many mobile users",
/// "which version", "which platform", "how many devices", "last seen
/// when") and cannot answer a sixth.
struct MobilePresenceDeclaration: Equatable {
    let installID: String
    let appVersion: String
    let appBuild: String
    let osMajor: Int

    /// A constant, not a reading. This target only ever runs on iOS, and
    /// 0077's CHECK constraint accepts nothing else on purpose: a value
    /// the platform would accept in advance would suggest we measure it.
    static let platform = "ios"

    /// What the throttle compares two launches on. It never leaves the
    /// device — it exists only to decide whether a call is worth making.
    ///
    /// The account is part of it, and that is deliberate: two accounts can
    /// share one phone, and without the account in here the second one to
    /// sign in would be swallowed by the throttle window and never
    /// counted. That is an undercount nothing downstream could notice.
    func fingerprint(userID: UUID) -> String {
        [
            userID.uuidString,
            installID,
            Self.platform,
            appVersion,
            appBuild,
            String(osMajor),
        ].joined(separator: "|")
    }
}

/// Reads the three values that describe the running build. Split out from
/// the reporter as plain functions over plain inputs, because "which part
/// of 26.3.1 do we keep" is exactly the kind of thing that is wrong in a
/// way no one notices for a year.
enum MobilePresenceEnvironment {
    /// `CFBundleShortVersionString` — the marketing version, the number a
    /// release is announced under. Read the same way
    /// `DiagnosticExportView` already reads it.
    static func appVersion(from infoDictionary: [String: Any]?) -> String? {
        shortValue(infoDictionary?["CFBundleShortVersionString"] as? String)
    }

    /// `CFBundleVersion` — the build number, and not a redundant one:
    /// `project.yml` pins MARKETING_VERSION to 0.1.0 while the CI rewrites
    /// only CURRENT_PROJECT_VERSION, so every TestFlight build so far
    /// carries the same marketing version. A version distribution built on
    /// `appVersion` alone would read "100% on 0.1.0" — true, and useless.
    static func appBuild(from infoDictionary: [String: Any]?) -> String? {
        shortValue(infoDictionary?["CFBundleVersion"] as? String)
    }

    /// The MAJOR only: 26, never 26.3.1. The minor changes no decision
    /// anyone takes — the question this answers is "can we raise the
    /// deployment target without cutting someone off" — and a finer value
    /// is a finer fingerprint. Being coarse is the feature.
    static func osMajor(fromSystemVersion systemVersion: String) -> Int? {
        let head = String(systemVersion.prefix { $0 != "." })
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let major = Int(head), (1...999).contains(major) else { return nil }
        return major
    }

    /// 0077 refuses anything empty or longer than 32 characters. Same
    /// reasoning as the identifier guard: better refused here than
    /// refused there.
    private static func shortValue(_ raw: String?) -> String? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty,
              trimmed.count <= 32
        else { return nil }
        return trimmed
    }
}

/// The client-side half of the "cheap" rule that 0077 states on the
/// server. The server already refuses to rewrite a row that has not
/// changed and was touched less than an hour ago; this saves the round
/// trip that would have discovered that.
enum MobilePresenceThrottle {
    /// Mirrors `interval '1 hour'` inside `declare_mobile_presence`.
    /// Past that the server would rewrite the row, so the call is worth
    /// making; inside it the server would do nothing, so the call is
    /// noise.
    static let minimumInterval: TimeInterval = 60 * 60

    struct Record: Codable, Equatable {
        var fingerprint: String
        var declaredAt: Date
    }

    /// The bias here is deliberate: WHEN IN DOUBT, DECLARE. A call that
    /// turns out to be unnecessary costs one small request the server
    /// answers with a no-op. A declaration wrongly skipped is a row that
    /// never gets created and a user the Control Center never counts —
    /// and nothing in the data would ever reveal the gap.
    static func shouldDeclare(fingerprint: String, lastRecord: Record?, now: Date) -> Bool {
        guard let lastRecord else { return true }

        // A new build must appear in the version distribution the day it
        // ships, not an hour after the first user opens it.
        if lastRecord.fingerprint != fingerprint { return true }

        // The clock moved backwards (a timezone, a manual change). Waiting
        // for it to catch up could lock declarations out for hours.
        if lastRecord.declaredAt > now { return true }

        return now.timeIntervalSince(lastRecord.declaredAt) >= Self.minimumInterval
    }
}

/// Where the throttle's memory lives. `UserDefaults` and not the keychain:
/// losing it costs one redundant declaration, which is the harmless
/// direction. One slot, overwritten each time — so the only account
/// referenced here is the one that last declared, the same one whose
/// session is already on the device.
enum MobilePresenceThrottleStore {
    private static let key = "mobilePresence.lastDeclaration"

    static func load(from defaults: UserDefaults) -> MobilePresenceThrottle.Record? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(MobilePresenceThrottle.Record.self, from: data)
    }

    static func save(_ record: MobilePresenceThrottle.Record, to defaults: UserDefaults) {
        guard let data = try? JSONEncoder().encode(record) else { return }
        defaults.set(data, forKey: key)
    }
}
