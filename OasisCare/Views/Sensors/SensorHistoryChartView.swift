import SwiftUI
import SwiftData
import Charts

/// Spec §58-60 — period-scoped history chart with an optional overlay of
/// correlated real-world events (irrigation/ventilation/heating/misting)
/// superimposed as shaded bands, so e.g. "Humidité du sol" can be read
/// against "Arrosage" on the same timeline.
struct SensorHistoryChartView: View {
    var sensor: Sensor

    @Environment(\.modelContext) private var modelContext
    @State private var period: GraphPeriod = .hours24
    @State private var selectedOverlays: Set<EventOverlayKind> = []

    private var points: [GraphAggregationService.ReadingPoint] {
        GraphAggregationService.points(for: sensor, period: period, context: modelContext)
    }

    private var availableOverlayKinds: [EventOverlayKind] {
        GraphAggregationService.availableOverlayKinds(for: sensor, context: modelContext)
    }

    private var overlays: [GraphAggregationService.Overlay] {
        selectedOverlays.map { GraphAggregationService.overlay(for: $0, sensor: sensor, period: period, context: modelContext) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Période", selection: $period) {
                ForEach(GraphPeriod.allCases) { period in
                    Text(period.displayName).tag(period)
                }
            }
            .pickerStyle(.segmented)

            if !availableOverlayKinds.isEmpty {
                overlayPicker
            }

            if points.isEmpty {
                Text("Aucune donnée sur cette période.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, minHeight: 120)
            } else {
                chart
            }
        }
    }

    private var overlayPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(availableOverlayKinds) { kind in
                    let isSelected = selectedOverlays.contains(kind)
                    Button {
                        if isSelected { selectedOverlays.remove(kind) } else { selectedOverlays.insert(kind) }
                    } label: {
                        Label(kind.displayName, systemImage: kind.icon)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(isSelected ? color(for: kind).opacity(0.2) : Color(.tertiarySystemFill), in: Capsule())
                            .foregroundStyle(isSelected ? color(for: kind) : Color.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var chart: some View {
        Chart {
            ForEach(overlays) { overlay in
                ForEach(overlay.intervals, id: \.self) { interval in
                    RectangleMark(xStart: .value("Début", interval.start), xEnd: .value("Fin", interval.end))
                        .foregroundStyle(color(for: overlay.kind).opacity(0.18))
                }
            }
            ForEach(points) { point in
                LineMark(x: .value("Date", point.date), y: .value(sensor.unit, point.value))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(Color.accentColor)
                if points.count < 60 {
                    PointMark(x: .value("Date", point.date), y: .value(sensor.unit, point.value))
                        .foregroundStyle(Color.accentColor)
                        .symbolSize(20)
                }
            }
            if let minimumExpected = sensor.minimumExpected {
                RuleMark(y: .value("Min", minimumExpected))
                    .foregroundStyle(.orange.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            }
            if let maximumExpected = sensor.maximumExpected {
                RuleMark(y: .value("Max", maximumExpected))
                    .foregroundStyle(.orange.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
            }
        }
        .chartLegend(.hidden)
        .frame(height: 200)
    }

    private func color(for kind: EventOverlayKind) -> Color {
        switch kind {
        case .irrigation: return .blue
        case .ventilation: return .cyan
        case .heating: return .red
        case .misting: return .teal
        }
    }
}
