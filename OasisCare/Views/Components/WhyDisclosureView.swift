import SwiftUI

/// Spec §69 — "Pourquoi ?" on a recommendation, revealing the concrete
/// data behind it (spec's own example: "humidité sol : 38 %, pluie
/// prévue : 12 mm, dernier arrosage : hier") instead of asking the user
/// to trust an opaque suggestion.
struct WhyDisclosureView: View {
    var reasons: [String]

    @State private var isExpanded = false

    var body: some View {
        if !reasons.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Button(isExpanded ? "Masquer" : "Pourquoi ?") {
                    withAnimation(.snappy) { isExpanded.toggle() }
                }
                .font(.caption.weight(.medium))

                if isExpanded {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(reasons, id: \.self) { reason in
                            Text("• \(reason)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
    }
}
