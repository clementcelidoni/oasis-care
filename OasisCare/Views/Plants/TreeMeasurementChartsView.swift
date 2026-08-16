import SwiftUI
import Charts

/// Spec §56 — native charts for height, trunk circumference, and
/// canopy diameter over time. trunkDiameter/estimatedAge aren't
/// charted — the spec names exactly these three, and trunk diameter is
/// redundant with circumference (diameter ≈ circumference/π) while
/// estimated age is a single guess, not a repeated-measurement series.
struct TreeMeasurementChartsView: View {
    var plant: Plant

    @Environment(\.dismiss) private var dismiss

    private var chronological: [PlantMeasurement] {
        plant.measurements.sorted { $0.date < $1.date }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if chronological.isEmpty {
                        Text("Aucune mesure enregistrée pour l'instant.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .padding()
                    } else {
                        measurementChart(
                            title: "Hauteur", unit: "m",
                            values: chronological.compactMap { m in m.height.map { (m.date, $0) } },
                            color: .green
                        )
                        measurementChart(
                            title: "Circonférence du tronc", unit: "cm",
                            values: chronological.compactMap { m in m.trunkCircumference.map { (m.date, $0) } },
                            color: .brown
                        )
                        measurementChart(
                            title: "Houppier", unit: "m",
                            values: chronological.compactMap { m in m.canopyDiameter.map { (m.date, $0) } },
                            color: .teal
                        )
                    }
                }
                .padding()
            }
            .navigationTitle("Mesures")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private func measurementChart(title: String, unit: String, values: [(Date, Double)], color: Color) -> some View {
        if !values.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.headline)

                Chart(values, id: \.0) { entry in
                    LineMark(x: .value("Date", entry.0), y: .value(title, entry.1))
                        .foregroundStyle(color)
                    PointMark(x: .value("Date", entry.0), y: .value(title, entry.1))
                        .foregroundStyle(color)
                }
                .frame(height: 160)

                if let last = values.last {
                    Text("Dernière valeur : \(last.1.formatted()) \(unit) — \(DateFormatting.shortDate(last.0))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }
}
