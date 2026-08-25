import SwiftData
import SwiftUI

/// Spec "INVENTAIRE DE LABORATOIRE — gestion simple, pas comptable."
struct LabInventoryListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \LabInventoryItem.name) private var items: [LabInventoryItem]
    @State private var itemSheet: ItemSheet?
    @State private var itemPendingDeletion: LabInventoryItem?

    private var lowStockItems: [LabInventoryItem] {
        items.filter(\.isLowStock)
    }

    var body: some View {
        Group {
            if items.isEmpty {
                EmptyStateView(
                    icon: "shippingbox",
                    title: "Aucun article",
                    message: "Ajoutez filtres, tubes, bocaux, consommables ou composants pour suivre votre stock de laboratoire."
                )
            } else {
                List {
                    if !lowStockItems.isEmpty {
                        Section("Stock bas") {
                            ForEach(lowStockItems) { item in
                                row(for: item)
                            }
                        }
                    }
                    ForEach(LabInventoryCategory.allCases) { category in
                        let categoryItems = items.filter { $0.category == category }
                        if !categoryItems.isEmpty {
                            Section(category.label) {
                                ForEach(categoryItems) { item in
                                    row(for: item)
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Inventaire")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { itemSheet = .add } label: { Label("Ajouter", systemImage: "plus") }
            }
        }
        .sheet(item: $itemSheet) { sheet in
            switch sheet {
            case .add:
                LabInventoryFormView(item: nil)
            case .edit(let item):
                LabInventoryFormView(item: item)
            }
        }
        .confirmationDialog(
            "Supprimer \(itemPendingDeletion?.name ?? "cet article") ?",
            isPresented: Binding(get: { itemPendingDeletion != nil }, set: { if !$0 { itemPendingDeletion = nil } }),
            titleVisibility: .visible
        ) {
            Button("Supprimer", role: .destructive) {
                if let itemPendingDeletion { DeletionService.delete(itemPendingDeletion, in: modelContext) }
                itemPendingDeletion = nil
            }
            Button("Annuler", role: .cancel) { itemPendingDeletion = nil }
        } message: {
            Text("Cette action est irréversible.")
        }
    }

    private func row(for item: LabInventoryItem) -> some View {
        Button {
            itemSheet = .edit(item)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.name).foregroundStyle(.primary)
                    if item.isLowStock, let threshold = item.minimumThreshold {
                        Text("Seuil : \(threshold)\(item.unit.isEmpty ? "" : " \(item.unit)")")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                }
                Spacer()
                Text("\(item.currentQuantity)\(item.unit.isEmpty ? "" : " \(item.unit)")")
                    .foregroundStyle(item.isLowStock ? .orange : .secondary)
            }
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                itemPendingDeletion = item
            } label: {
                Label("Supprimer", systemImage: "trash")
            }
        }
    }
}

private enum ItemSheet: Identifiable {
    case add
    case edit(LabInventoryItem)

    var id: String {
        switch self {
        case .add: return "add"
        case .edit(let item): return item.id.uuidString
        }
    }
}
