import Foundation
import SwiftData

/// `performedBy` is the caller's responsibility to supply (typically
/// `AuthState.shared.session?.user.email` read from SwiftUI view code,
/// already on the main actor) rather than read here — keeps this
/// service, and everything that calls it, free of any actor-isolation
/// requirement.
enum BioLabAuditService {
    static func log(entityType: String, entityId: UUID, action: String, detail: String, performedBy: String?, context: ModelContext) {
        let entry = BioLabAuditEntry(entityType: entityType, entityId: entityId, action: action, detail: detail, performedBy: performedBy)
        context.insert(entry)
    }
}
