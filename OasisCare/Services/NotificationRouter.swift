import Combine
import Foundation
import UserNotifications

/// Bridges a tapped local notification back into the SwiftUI navigation
/// layer. UNUserNotificationCenterDelegate callbacks arrive outside
/// SwiftUI's view graph, so this is the hand-off point: the delegate sets
/// `pendingPlantID`, and RootTabView observes it to present that plant.
final class NotificationRouter: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationRouter()

    @Published var pendingPlantID: UUID?

    private override init() {}

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if let idString = response.notification.request.content.userInfo["plantID"] as? String,
           let id = UUID(uuidString: idString) {
            pendingPlantID = id
        }
        completionHandler()
    }
}
