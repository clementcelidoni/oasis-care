import SwiftUI

/// Icon-and-text status indicator — never color alone, so status reads
/// correctly for colorblind users and in accessibility contexts.
struct CareStatusBadge: View {
    enum Style { case full, iconOnly }

    var status: CareStatus
    var style: Style = .full

    var body: some View {
        Group {
            if style == .full {
                Label(status.label, systemImage: status.icon)
                    .labelStyle(.titleAndIcon)
            } else {
                Label(status.label, systemImage: status.icon)
                    .labelStyle(.iconOnly)
            }
        }
        .font(.caption.weight(.medium))
        .foregroundStyle(status.color)
    }
}
