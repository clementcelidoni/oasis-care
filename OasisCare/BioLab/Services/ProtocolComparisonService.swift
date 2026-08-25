import Foundation

/// Enhancement "COMPARAISONS INTELLIGENTES" — a plain, local,
/// deterministic diff (no AI call): every field compared here already
/// exists as real structured data (recipe version composition/pH,
/// `BioLabKnowledgeEngine` performance), so a arithmetic comparison is
/// both cheaper and more honest than an AI restating numbers it didn't
/// need to guess at. §29 "ne pas conclure automatiquement à une
/// causalité" — this only ever reports what differs, never why.
enum ProtocolComparisonService {
    struct FieldRow: Identifiable {
        var id: String { field }
        var field: String
        /// Formatted display value per version, in the same order as
        /// the versions passed to `compare`.
        var values: [String]
        var isDifferent: Bool
    }

    struct Comparison {
        var versionLabels: [String]
        var rows: [FieldRow]
        /// §29 "Ces protocoles diffèrent principalement sur : ..." —
        /// just the field names where `isDifferent` is true, in the
        /// same order as `rows`.
        var differingFieldNames: [String]
    }

    static func compare(versions: [MediumRecipeVersion], performances: [UUID: RecipeVersionPerformance]) -> Comparison {
        let labels = versions.map { "V\($0.versionNumber)" }

        var rows: [FieldRow] = []
        rows.append(row("pH cible", versions.map { formatted($0.targetPH) }))
        rows.append(row("Milieu de base", versions.map { basalMediumSummary($0) }))
        rows.append(row("Composants", versions.map { "\($0.components.count)" }))

        let performanceList = versions.map { performances[$0.id] }
        rows.append(row("Basé sur", performanceList.map { $0.map { "\($0.batchCount) lot(s)" } ?? "Aucune donnée" }))
        rows.append(row("Multiplication moyenne", performanceList.map { formatted($0?.averageMultiplicationRate, suffix: "x") }))
        rows.append(row("Contamination", performanceList.map { formattedPercent($0?.contaminationRate) }))
        rows.append(row("Hyperhydricité", performanceList.map { formattedPercent($0?.hyperhydricityRate) }))
        rows.append(row("Enracinement", performanceList.map { formattedPercent($0?.rootingRate) }))
        rows.append(row("Survie acclimatation", performanceList.map { formattedPercent($0?.survivalRate) }))

        return Comparison(versionLabels: labels, rows: rows, differingFieldNames: rows.filter(\.isDifferent).map(\.field))
    }

    private static func row(_ field: String, _ values: [String]) -> FieldRow {
        FieldRow(field: field, values: values, isDifferent: Set(values).count > 1)
    }

    private static func basalMediumSummary(_ version: MediumRecipeVersion) -> String {
        let basalNames = version.components.filter { $0.type == .basalMedium }.map(\.name)
        return basalNames.isEmpty ? "—" : basalNames.joined(separator: ", ")
    }

    private static func formatted(_ value: Double?, suffix: String = "") -> String {
        guard let value else { return "—" }
        return "\(String(format: "%.2f", value))\(suffix)"
    }

    private static func formattedPercent(_ value: Double?) -> String {
        guard let value else { return "Non disponible" }
        return "\(String(format: "%.0f", value * 100)) %"
    }
}
