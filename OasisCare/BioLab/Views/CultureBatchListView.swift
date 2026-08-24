import SwiftData
import SwiftUI

/// Spec Phase 7B.
struct CultureBatchListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \CultureBatch.createdAt, order: .reverse) private var batches: [CultureBatch]

    @State private var isShowingNewBatch = false

    var body: some View {
        Group {
            if batches.isEmpty {
                EmptyStateView(
                    icon: "flask",
                    title: "Aucun lot",
                    message: "Créez votre premier lot de culture in vitro à partir d'une plante mère ou d'un explant."
                )
            } else {
                List {
                    ForEach(batches) { batch in
                        NavigationLink {
                            CultureBatchDetailView(batch: batch)
                        } label: {
                            CultureBatchRow(batch: batch)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Lots de culture")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    isShowingNewBatch = true
                } label: {
                    Label("Ajouter", systemImage: "plus")
                }
            }
        }
        .sheet(isPresented: $isShowingNewBatch) {
            CultureBatchFormView(existingBatches: batches)
        }
    }
}

private struct CultureBatchRow: View {
    var batch: CultureBatch

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: batch.cultureStage.icon)
                .font(.title3)
                .foregroundStyle(.teal)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(batch.batchCode)
                    .font(.headline)
                Text("\(batch.speciesName) · \(batch.cultureStage.label) · \(batch.currentCount) explants")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if batch.status != .active {
                Text(batch.status.label)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color(.tertiarySystemFill), in: Capsule())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
