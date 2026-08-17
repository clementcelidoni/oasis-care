import SwiftUI
import SwiftData

/// Spec §25-32 — entry point for the automation builder, reachable from
/// Maison connectée.
struct AutomationRulesListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \AutomationRule.name) private var rules: [AutomationRule]

    @State private var editingRule: AutomationRule?
    @State private var isCreatingRule = false
    @State private var isProposingRule = false

    var body: some View {
        List {
            if rules.isEmpty {
                ContentUnavailableView(
                    "Aucune automatisation",
                    systemImage: "wand.and.stars",
                    description: Text("Créez une règle pour qu'Oasis observe, recommande, ou agisse selon vos capteurs.")
                )
            } else {
                ForEach(rules) { rule in
                    Button {
                        editingRule = rule
                    } label: {
                        AutomationRuleRow(rule: rule)
                    }
                    .buttonStyle(.plain)
                }
                .onDelete(perform: delete)
            }
        }
        .navigationTitle("Automatisations")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { isCreatingRule = true } label: {
                        Label("Créer manuellement", systemImage: "slider.horizontal.3")
                    }
                    Button { isProposingRule = true } label: {
                        Label("Proposer avec Oasis AI", systemImage: "sparkles")
                    }
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(item: $editingRule) { rule in
            AutomationRuleFormView(rule: rule)
        }
        .sheet(isPresented: $isCreatingRule) {
            AutomationRuleFormView(rule: nil)
        }
        .sheet(isPresented: $isProposingRule) {
            AutomationProposalSheet()
        }
    }

    private func delete(at offsets: IndexSet) {
        for index in offsets {
            DeletionService.delete(rules[index], in: modelContext)
        }
        try? modelContext.save()
    }
}

private struct AutomationRuleRow: View {
    var rule: AutomationRule

    private var scopeLabel: String {
        rule.scopePlant?.customName ?? rule.scopeZone?.name ?? rule.scopeGarden?.name ?? "Non défini"
    }

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(rule.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                HStack(spacing: 6) {
                    Text(rule.mode.displayName)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(modeTint.opacity(0.15), in: Capsule())
                        .foregroundStyle(modeTint)
                    Text(scopeLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if !rule.enabled {
                Text("Désactivée")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var modeTint: Color {
        switch rule.mode {
        case .manual: return .secondary
        case .assisted: return .orange
        case .automatic: return .green
        }
    }
}
