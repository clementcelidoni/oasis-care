import Foundation
import SwiftData

/// Spec Phase 7B.
enum CultureBatchService {
    /// "CODE LOT... permettre génération automatique configurable. Ne
    /// jamais dépendre uniquement d'un numéro séquentiel non sécurisé
    /// côté cloud." A locally-counted sequence is a convenience
    /// default, not a cloud-guaranteed-unique identifier — it's always
    /// just the batchCode text field, editable before saving, so two
    /// offline devices producing the same suggested code is a cosmetic
    /// collision the user can fix, never a data-integrity problem
    /// (batches are identified by `id`, not `batchCode`).
    static func suggestedBatchCode(speciesName: String, existingBatches: [CultureBatch], year: Int = Calendar.current.component(.year, from: .now)) -> String {
        let initials = speciesName
            .split(separator: " ")
            .prefix(2)
            .compactMap { $0.first.map { String($0).uppercased() } }
            .joined()
        let prefix = initials.isEmpty ? "LOT" : initials
        let sameYearCount = existingBatches.filter { $0.batchCode.hasPrefix("\(prefix)-\(year)") }.count
        let sequence = String(format: "%03d", sameYearCount + 1)
        return "\(prefix)-\(year)-\(sequence)"
    }

    /// "SPLIT DE LOT... conserver le lien parent/enfant." The parent's
    /// own initialExplantCount/currentCount stay exactly as they were —
    /// a true historical record of what this batch was before
    /// dividing, not zeroed out — only its status changes to `.split`
    /// so it reads as no longer independently active.
    static func split(_ parent: CultureBatch, into counts: [Int], performedBy: String? = nil, context: ModelContext) -> [CultureBatch] {
        guard !counts.isEmpty else { return [] }
        let children = counts.enumerated().map { index, count -> CultureBatch in
            let child = CultureBatch(
                batchCode: "\(parent.batchCode)-\(childSuffix(for: index))",
                speciesName: parent.speciesName,
                cultureStage: parent.cultureStage,
                initialExplantCount: count,
                motherPlant: parent.motherPlant,
                parentBatch: parent,
                speciesProfile: parent.speciesProfile
            )
            context.insert(child)
            return child
        }
        parent.status = .split
        parent.markDirty()
        BioLabAuditService.log(
            entityType: "culture_batches", entityId: parent.id, action: BioLabAuditAction.split,
            detail: "Divisé en \(children.count) lot(s) : \(children.map(\.batchCode).joined(separator: ", "))",
            performedBy: performedBy, context: context
        )
        try? context.save()
        return children
    }

    private static func childSuffix(for index: Int) -> String {
        // A, B, C... matching spec's own "Lot A1 / Lot A2" style closely
        // enough while staying readable past 26 children (falls back to
        // a number, which should never realistically happen for a lab
        // split).
        let letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        if index < letters.count {
            return String(letters[letters.index(letters.startIndex, offsetBy: index)])
        }
        return "\(index + 1)"
    }

    static func discard(_ batch: CultureBatch, reason: String) {
        batch.status = .discarded
        batch.cultureStage = .discarded
        if !reason.isEmpty {
            batch.notes += batch.notes.isEmpty ? reason : "\n\(reason)"
        }
        batch.markDirty()
    }
}
