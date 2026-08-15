import SwiftUI

struct HealthStatusBadge: View {
    var status: HealthStatus

    var body: some View {
        Label(status.displayName, systemImage: "circle.fill")
            .labelStyle(.titleAndIcon)
            .font(.caption.weight(.medium))
            .foregroundStyle(status.color)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(status.color.opacity(0.15), in: Capsule())
    }
}
