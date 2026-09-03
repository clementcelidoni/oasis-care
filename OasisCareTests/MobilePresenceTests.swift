import XCTest
@testable import OasisCare

/// A stand-in for the keychain. The rules worth testing here are all about
/// what happens the *second* time — and a test that wrote to the real
/// keychain would carry its answer over into the next run, which is the
/// one thing that would make these assertions meaningless.
private final class InMemoryIdentifierStorage: InstallationIdentifierStorage {
    var stored: String?
    var writeSucceeds: Bool
    private(set) var writeAttempts = 0

    init(stored: String? = nil, writeSucceeds: Bool = true) {
        self.stored = stored
        self.writeSucceeds = writeSucceeds
    }

    func readIdentifier() -> String? { stored }

    func writeIdentifier(_ identifier: String) -> Bool {
        writeAttempts += 1
        guard writeSucceeds else { return false }
        stored = identifier
        return true
    }
}

/// Covers the three things the phone can get wrong on its own, without a
/// server or a network: the identifier it reports itself under, the build
/// numbers it reads, and how often it decides to speak. Everything past
/// that point is `declare_mobile_presence` (migration 0077), which has its
/// own tests in `supabase/tests/presence_applicative.sql`.
final class MobilePresenceTests: XCTestCase {

    // MARK: - Installation identifier: stability

    func testFirstLaunchDrawsAnIdentifierAndKeepsIt() throws {
        let storage = InMemoryIdentifierStorage()

        let identifier = try XCTUnwrap(
            InstallationIdentifier.resolve(storage: storage, vendorIdentifier: nil)
        )

        XCTAssertTrue(InstallationIdentifier.isValid(identifier))
        XCTAssertEqual(
            storage.stored,
            identifier,
            "A drawn identifier that is not persisted is a new device at every launch."
        )
    }

    func testLaterLaunchesReturnTheSameIdentifierWithoutRedrawing() throws {
        let storage = InMemoryIdentifierStorage()

        let first = try XCTUnwrap(InstallationIdentifier.resolve(storage: storage, vendorIdentifier: nil))
        let second = try XCTUnwrap(InstallationIdentifier.resolve(storage: storage, vendorIdentifier: nil))
        let third = try XCTUnwrap(InstallationIdentifier.resolve(storage: storage, vendorIdentifier: nil))

        XCTAssertEqual(first, second)
        XCTAssertEqual(second, third)
        XCTAssertEqual(storage.writeAttempts, 1, "Only the very first launch should ever write.")
    }

    func testAnUnusableStoredValueIsRedrawnRatherThanSent() throws {
        // Whatever produced this, the server would refuse it. Better to
        // notice here than to spend a request finding out.
        let storage = InMemoryIdentifierStorage(stored: "abc")

        let identifier = try XCTUnwrap(
            InstallationIdentifier.resolve(storage: storage, vendorIdentifier: nil)
        )

        XCTAssertNotEqual(identifier, "abc")
        XCTAssertTrue(InstallationIdentifier.isValid(identifier))
        XCTAssertEqual(storage.stored, identifier)
    }

    func testWhenNothingCanBePersistedTheVendorIdentifierTakesOverAndStaysStable() {
        let storage = InMemoryIdentifierStorage(writeSucceeds: false)
        let vendor = UUID().uuidString

        let first = InstallationIdentifier.resolve(storage: storage, vendorIdentifier: vendor)
        let second = InstallationIdentifier.resolve(storage: storage, vendorIdentifier: vendor)

        XCTAssertEqual(first, vendor)
        XCTAssertEqual(
            second,
            vendor,
            "The fallback has to be stable too, or it inflates the device count all by itself."
        )
    }

    func testWithNothingStableToSayItSaysNothing() {
        let storage = InMemoryIdentifierStorage(writeSucceeds: false)

        XCTAssertNil(
            InstallationIdentifier.resolve(storage: storage, vendorIdentifier: nil),
            "Declaring under a made-up identifier would add a device that never existed."
        )
    }

    // MARK: - Installation identifier: the shape the server accepts

    func testIdentifierValidityMirrorsTheServerGuard() {
        XCTAssertTrue(InstallationIdentifier.isValid(UUID().uuidString))
        // A UUID with the dashes stripped, which is what a web client
        // draws when `crypto.randomUUID` is unavailable.
        XCTAssertTrue(InstallationIdentifier.isValid(
            UUID().uuidString.replacingOccurrences(of: "-", with: "")
        ))

        // The guard exists for exactly this: a device name is a person's
        // name, and it must never reach the column.
        XCTAssertFalse(InstallationIdentifier.isValid("iPhone de Clement"))
        XCTAssertFalse(InstallationIdentifier.isValid("iPhone\nde\tClement"))

        // AND THIS IS THE ONE THE FIRST VERSION LET THROUGH. Rejecting
        // whitespace kept nothing out: replace the spaces with dashes and
        // a full name walks straight into the column. An e-mail address
        // has no spaces either. The rule is an allow list now.
        XCTAssertFalse(InstallationIdentifier.isValid("iPhone-de-Clement-Celidoni"))
        XCTAssertFalse(InstallationIdentifier.isValid("clement.celidoni@gmail.com"))

        XCTAssertFalse(InstallationIdentifier.isValid("abcdef7"))
        XCTAssertTrue(InstallationIdentifier.isValid("abcdef78"))
        XCTAssertTrue(InstallationIdentifier.isValid(String(repeating: "a", count: 64)))
        XCTAssertFalse(InstallationIdentifier.isValid(String(repeating: "a", count: 65)))
    }

    // MARK: - Reading the running build

    func testOSMajorKeepsOnlyTheMajor() {
        XCTAssertEqual(MobilePresenceEnvironment.osMajor(fromSystemVersion: "26.3.1"), 26)
        XCTAssertEqual(MobilePresenceEnvironment.osMajor(fromSystemVersion: "26.0"), 26)
        XCTAssertEqual(MobilePresenceEnvironment.osMajor(fromSystemVersion: "26"), 26)
        XCTAssertEqual(MobilePresenceEnvironment.osMajor(fromSystemVersion: "17.4.1"), 17)
        XCTAssertEqual(MobilePresenceEnvironment.osMajor(fromSystemVersion: " 18.2 "), 18)
    }

    func testOSMajorRefusesWhatItCannotRead() {
        XCTAssertNil(MobilePresenceEnvironment.osMajor(fromSystemVersion: ""))
        XCTAssertNil(MobilePresenceEnvironment.osMajor(fromSystemVersion: ".3"))
        XCTAssertNil(MobilePresenceEnvironment.osMajor(fromSystemVersion: "iOS 26"))
        XCTAssertNil(MobilePresenceEnvironment.osMajor(fromSystemVersion: "0.1"), "0077 refuses anything below 1.")
        XCTAssertNil(MobilePresenceEnvironment.osMajor(fromSystemVersion: "1000.0"), "0077 refuses anything above 999.")
    }

    func testVersionAndBuildAreReadFromTheKeysTheBundleActuallyUses() {
        let info: [String: Any] = [
            "CFBundleShortVersionString": "0.1.0",
            "CFBundleVersion": "31",
        ]

        XCTAssertEqual(MobilePresenceEnvironment.appVersion(from: info), "0.1.0")
        XCTAssertEqual(MobilePresenceEnvironment.appBuild(from: info), "31")
    }

    func testVersionAndBuildRefuseAnythingUnusable() {
        XCTAssertNil(MobilePresenceEnvironment.appVersion(from: nil))
        XCTAssertNil(MobilePresenceEnvironment.appVersion(from: [:]))
        XCTAssertNil(MobilePresenceEnvironment.appVersion(from: ["CFBundleShortVersionString": ""]))
        XCTAssertNil(MobilePresenceEnvironment.appVersion(from: ["CFBundleShortVersionString": "   "]))
        XCTAssertNil(
            MobilePresenceEnvironment.appBuild(from: ["CFBundleVersion": 31]),
            "A non-string value is not a build number."
        )

        XCTAssertNil(MobilePresenceEnvironment.appBuild(from: ["CFBundleVersion": String(repeating: "9", count: 33)]))
        XCTAssertEqual(
            MobilePresenceEnvironment.appBuild(from: ["CFBundleVersion": String(repeating: "9", count: 32)]),
            String(repeating: "9", count: 32)
        )
    }

    // MARK: - How often the phone speaks

    private func declaration(appBuild: String = "31") -> MobilePresenceDeclaration {
        MobilePresenceDeclaration(
            installID: "11111111-2222-3333-4444-555555555555",
            appVersion: "0.1.0",
            appBuild: appBuild,
            osMajor: 26
        )
    }

    func testTheFirstDeclarationEverAlwaysGoesOut() {
        XCTAssertTrue(
            MobilePresenceThrottle.shouldDeclare(fingerprint: "f", lastRecord: nil, now: Date())
        )
    }

    func testNothingIsSentAgainWithinTheHourWhenNothingChanged() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let record = MobilePresenceThrottle.Record(fingerprint: "f", declaredAt: base)

        XCTAssertFalse(
            MobilePresenceThrottle.shouldDeclare(
                fingerprint: "f",
                lastRecord: record,
                now: base.addingTimeInterval(60)
            ),
            "The server would answer this with a no-op; the round trip is pure noise."
        )
    }

    func testPastTheHourTheDeclarationGoesOutAgain() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let record = MobilePresenceThrottle.Record(fingerprint: "f", declaredAt: base)

        XCTAssertTrue(
            MobilePresenceThrottle.shouldDeclare(
                fingerprint: "f",
                lastRecord: record,
                now: base.addingTimeInterval(MobilePresenceThrottle.minimumInterval)
            )
        )
        XCTAssertTrue(
            MobilePresenceThrottle.shouldDeclare(
                fingerprint: "f",
                lastRecord: record,
                now: base.addingTimeInterval(2 * MobilePresenceThrottle.minimumInterval)
            )
        )
    }

    func testANewBuildIsDeclaredImmediatelyAndNotAnHourLater() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let user = UUID()
        let yesterdaysBuild = declaration(appBuild: "31").fingerprint(userID: user)
        let todaysBuild = declaration(appBuild: "32").fingerprint(userID: user)

        XCTAssertNotEqual(yesterdaysBuild, todaysBuild)
        XCTAssertTrue(
            MobilePresenceThrottle.shouldDeclare(
                fingerprint: todaysBuild,
                lastRecord: MobilePresenceThrottle.Record(fingerprint: yesterdaysBuild, declaredAt: base),
                now: base.addingTimeInterval(1)
            ),
            "Release day: the version distribution must not lag an hour behind the rollout."
        )
    }

    func testASecondAccountOnTheSamePhoneIsNotSwallowedByTheThrottle() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let sameInstallation = declaration()
        let first = sameInstallation.fingerprint(userID: UUID())
        let second = sameInstallation.fingerprint(userID: UUID())

        XCTAssertNotEqual(first, second, "Without the account in the fingerprint, the second one is never counted.")
        XCTAssertTrue(
            MobilePresenceThrottle.shouldDeclare(
                fingerprint: second,
                lastRecord: MobilePresenceThrottle.Record(fingerprint: first, declaredAt: base),
                now: base.addingTimeInterval(60)
            )
        )
    }

    func testAClockThatMovedBackwardsDoesNotLockDeclarationsOut() {
        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let record = MobilePresenceThrottle.Record(fingerprint: "f", declaredAt: base)

        XCTAssertTrue(
            MobilePresenceThrottle.shouldDeclare(
                fingerprint: "f",
                lastRecord: record,
                now: base.addingTimeInterval(-86_400)
            )
        )
    }

    // MARK: - The throttle's memory

    func testTheThrottleRecordSurvivesARoundTripThroughUserDefaults() throws {
        let suiteName = "MobilePresenceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertNil(MobilePresenceThrottleStore.load(from: defaults))

        let record = MobilePresenceThrottle.Record(
            fingerprint: declaration().fingerprint(userID: UUID()),
            declaredAt: Date(timeIntervalSince1970: 1_800_000_000)
        )
        MobilePresenceThrottleStore.save(record, to: defaults)

        XCTAssertEqual(MobilePresenceThrottleStore.load(from: defaults), record)
    }
}
