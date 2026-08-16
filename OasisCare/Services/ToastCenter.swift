import Combine
import Foundation

struct ToastMessage: Identifiable {
    let id = UUID()
    var title: String
    var subtitle: String?
    var undoAction: (() -> Void)?
}

/// A single global toast host, shown as an overlay from RootTabView
/// regardless of which tab triggered it — quick actions and bulk actions
/// can both surface a discreet confirmation this way, wherever they happen.
final class ToastCenter: ObservableObject {
    static let shared = ToastCenter()

    @Published var current: ToastMessage?

    private init() {}

    func show(title: String, subtitle: String? = nil, undoAction: (() -> Void)? = nil) {
        current = ToastMessage(title: title, subtitle: subtitle, undoAction: undoAction)
    }
}
