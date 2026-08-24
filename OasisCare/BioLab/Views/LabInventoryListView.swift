import SwiftData
import SwiftUI

/// Spec "INVENTAIRE DE LABORATOIRE — gestion simple, pas comptable."
struct LabInventoryListView: View {
    @Query(sort: \LabInventoryItem.name) private var items: [LabInventoryItem]
    @State private var itemSheet: ItemSheet?

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
