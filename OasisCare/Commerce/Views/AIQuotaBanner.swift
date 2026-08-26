import SwiftUI

/// Phase 12 §12H — "À 80 % : avertissement. À 100 % : bloquer uniquement
/// la fonctionnalité IA concernée ... pas le reste de l'app."
///
/// Advisory only. The real enforcement is server-side inside each AI
/// Edge Function (a client-side check alone could be bypassed by
/// reinstalling), so this never blocks anything itself — it just means
/// a user isn't surprised by a 429 they had no warning about.
///
/// Renders nothing at all below 80%, and nothing if the status can't be
/// fetched: an unreachable quota endpoint must not put a scary empty
/// banner on top of a feature that still works.
struct AIQuotaBanner: View {
    var feature: AIFeature

    @State private var status: AIQuotaService.Status?

    var body: some View {
        Group {
            if let status, status.isNearLimit {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: status.isAtLimit ? "exclamationmark.circle.fill" : "gauge.with.dots.needle.67percent")
                        .foregroundStyle(status.isAtLimit ? Color.red : Color.orange)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(status.isAtLimit ? "Quota IA atteint" : "Quota IA bientôt atteint")
                            .font(.subheadline.weight(.semibold))
                        Text("\(status.used) / \(status.limit) ce mois-ci.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
                .padding(12)
                .background(
                    (status.isAtLimit ? Color.red : Color.orange).opacity(0.12),
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
                .padding(.horizontal)
            }
        }
        .task {
            status = try? await AIQuotaService.status(for: feature)
        }
    }
}
