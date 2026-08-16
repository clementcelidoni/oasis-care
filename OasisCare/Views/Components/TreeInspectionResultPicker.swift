import SwiftUI

/// The four-color result row from spec §58 (tree inspections) and
/// §62 (garden check-up — same four options, same visual). Shared here
/// since both flows need the exact same tappable-button layout.
struct TreeInspectionResultPicker: View {
    @Binding var selection: TreeInspectionResult

    var body: some View {
        HStack(spacing: 8) {
            ForEach(TreeInspectionResult.allCases) { level in
                Button {
                    selection = level
                } label: {
                    Label(level.displayName, systemImage: level.icon)
                        .labelStyle(.titleAndIcon)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(selection == level ? .white : level.color)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity)
                        .background(
                            selection == level ? AnyShapeStyle(level.color) : AnyShapeStyle(level.color.opacity(0.15)),
                            in: Capsule()
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}
