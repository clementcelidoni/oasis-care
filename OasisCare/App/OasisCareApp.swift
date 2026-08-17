import SwiftUI
import SwiftData
import UserNotifications

@main
struct OasisCareApp: App {
    init() {
        UNUserNotificationCenter.current().delegate = NotificationRouter.shared
    }

    var body: some Scene {
        WindowGroup {
            RootContainerView()
        }
        .modelContainer(SharedModelContainer.shared)
    }
}
