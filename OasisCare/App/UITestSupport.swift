#if DEBUG
import Foundation

/// Launch-argument overrides so UI tests control their own starting
/// state instead of inheriting whatever a previous test left behind.
///
/// Why this exists: the golden-path UI test started failing once Phase
/// 12 added Free-tier limits, because `DemoData` seeds exactly one
/// garden — which is exactly the Free limit — so "add a garden"
/// correctly showed the locked screen. The test was depending on
/// fixture data it never asked for. Tests now opt out of the demo
/// fixture and reset the onboarding flags explicitly.
///
/// DEBUG-only in its entirety, so none of this can affect a release
/// build even if an argument were somehow passed.
///
/// iOS folds `-key value` launch arguments into UserDefaults'
/// NSArgumentDomain, which outranks the persistent domain — so a plain
/// `bool(forKey:)` reads them. Note that shadowing works for READS
/// only: a key passed this way can't then be changed by the app at
/// runtime, which is why the onboarding flags are cleared outright
/// below rather than being forced to `NO`.
enum UITestSupport {
    private static let resetOnboardingKey = "uiTestResetOnboarding"
    private static let skipDemoDataKey = "uiTestSkipDemoData"

    static var skipsDemoData: Bool {
        UserDefaults.standard.bool(forKey: skipDemoDataKey)
    }

    /// Call before any view reads the corresponding `@AppStorage`.
    static func applyLaunchOverridesIfNeeded() {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: resetOnboardingKey) else { return }
        defaults.removeObject(forKey: "hasSeenWelcome")
        defaults.removeObject(forKey: "hasCompletedOnboarding")
    }
}
#endif
