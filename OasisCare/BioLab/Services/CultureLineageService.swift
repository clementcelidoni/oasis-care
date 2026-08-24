import Foundation

/// Spec Phase 7B — "GÉNÉALOGIE... pouvoir afficher cela comme un arbre
/// généalogique." Walks the direct motherPlant/parentBatch/childBatches
/// relationships already on CultureBatch (see that model's own doc
/// comment for why there's no separate CultureLineage join model) into
/// a plain tree structure a SwiftUI OutlineGroup can render directly.
enum CultureLineageService {
    struct LineageNode: Identifiable {
        var id: UUID
        var title: String
        var subtitle: String
        var children: [LineageNode]?
    }

    static func tree(for batch: CultureBatch) -> LineageNode {
        // Walk up to the root of this split lineage first, so the tree
        // shown always starts from the true origin, not wherever the
        // user happened to open a batch from.
        var root = batch
        while let parent = root.parentBatch {
            root = parent
        }
        return node(for: root)
    }

    private static func node(for batch: CultureBatch) -> LineageNode {
        let children = batch.childBatches.sorted { $0.batchCode < $1.batchCode }.map { node(for: $0) }
        return LineageNode(
            id: batch.id,
            title: batch.batchCode,
            subtitle: "\(batch.cultureStage.label) · \(batch.currentCount) explants",
            children: children.isEmpty ? nil : children
        )
    }

    /// The mother plant sits above the whole batch tree, shown as its
    /// own root row rather than folded into LineageNode — a Plant and
    /// a CultureBatch are different kinds of things with different
    /// detail screens, not interchangeable tree nodes.
    static func motherPlant(for batch: CultureBatch) -> Plant? {
        var current = batch
        while true {
            if let mother = current.motherPlant { return mother }
            guard let parent = current.parentBatch else { return nil }
            current = parent
        }
    }
}
