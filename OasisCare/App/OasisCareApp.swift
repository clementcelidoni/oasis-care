import SwiftUI
import SwiftData
import UserNotifications

@main
struct OasisCareApp: App {
    init() {
        #if DEBUG
        // Before RootContainerView reads its @AppStorage flags.
        UITestSupport.applyLaunchOverridesIfNeeded()
        #endif
        UNUserNotificationCenter.current().delegate = NotificationRouter.shared
    }

    var body: some Scene {
        WindowGroup {
            RootContainerView()
        }
        .modelContainer(SharedModelContainer.shared)
    }
}
