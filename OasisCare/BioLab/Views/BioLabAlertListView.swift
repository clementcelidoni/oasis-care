import SwiftData
import SwiftUI

/// Spec's "ALERTES" section — the first real UI for BioLabAlert, which
/// existed as a data model + raise mechanism since Phase 7E but had
/// never been shown anywhere until this dashboard/list landed.
struct BioLabAlertListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \BioLabAlert.createdAt, order: .reverse) private var alerts: [BioLabAlert]

    private var activeAlerts: [BioLabAlert] {
        alerts.filter(\.isActive).sorted { $0.priority > $1.priority }
    }
    private var resolvedAlerts: [BioLabAlert] {
        alerts.filter { !$0.isActive }
    }

    var body: some View {
        List {
            if activeAlerts.isEmpty {
                Section {
                    Text("Aucune alerte active.")
                        .foregroundStyle(.secondary)
                }
            } else {
                Section("Actives") {
                    ForEach(activeAlerts) { alert in
                        row(alert)
                    }
                }
            }
            if !resolvedAlerts.isEmpty {
                Section("Résolues") {
                    ForEach(resolvedAlerts.prefix(30)) { alert in
                        row(alert)
                    }
                }
            }
        }
        .navigationTitle("Alertes")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ alert: BioLabAlert) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(alert.message)
                    .font(.subheadline)
                    .strikethrough(!alert.isActive)
                    .foregroundStyle(alert.isActive ? .primary : .secondary)
                HStack(spacing: 6) {
                    Text(alert.priority.label)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(priorityColor(alert.priority))
                    Text(alert.alertType.label)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(DateFormatting.shortDate(alert.createdAt))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if alert.isActive {
                Button("Résoudre") {
                    BioLabAlertService.resolve(alert)
                    try? modelContext.save()
                }
                .font(.caption)
                .buttonStyle(.bordered)
            }
        }
        .padding(.vertical, 2)
    }

    private func priorityColor(_ priority: BioLabAlertPriority) -> Color {
        switch priority {
        case .info: return .blue
        case .warning: return .yellow
        case .important: return .orange
        case .critical: return .red
        }
    }
}
