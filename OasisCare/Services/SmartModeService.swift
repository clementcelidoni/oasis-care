import Foundation
import SwiftData

/// Spec §72-76. Fetch-or-create mirrors DashboardService.preferences —
/// one settings row per workspace, created on first access.
enum SmartModeService {
    static func settings(in context: ModelContext) -> SmartModeSettings {
        if let existing = try? context.fetch(FetchDescriptor<SmartModeSettings>()).first {
            return existing
        }
        let created = SmartModeSettings()
        context.insert(created)
        return created
    }
}
