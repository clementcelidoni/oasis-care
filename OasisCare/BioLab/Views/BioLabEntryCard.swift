import SwiftUI

/// Spec Phase 7A — the Home-screen entry point into the new "espace
/// principal." A compact summary, not the full stat grid (that's
/// BioLabDashboardView itself, one tap away) — Home already has many
/// cards competing for space, so this one stays to a single line plus
/// an alert count when there's something to see.
struct BioLabEntryCard: View {
    var summary: BioLabDashboardSummary

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "testtube.2")
                .font(.title2)
                .foregroundStyle(.teal)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text("Oasis BioLab")
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(summaryLine)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if summary.alertCount > 0 {
                Text("\(summary.alertCount)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(.red, in: Capsule())
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var summaryLine: String {
        if summary.activeBioreactorCount == 0 && summary.multiplicationBatchCount == 0 {
            return "Culture in vitro et bioréacteurs"
        }
        return "\(summary.activeBioreactorCount) bioréacteur\(summary.activeBioreactorCount > 1 ? "s" : "") actif\(summary.activeBioreactorCount > 1 ? "s" : "") · \(summary.multiplicationBatchCount) lot\(summary.multiplicationBatchCount > 1 ? "s" : "") en multiplication"
    }
}
