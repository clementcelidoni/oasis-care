import SwiftUI
import SwiftData

/// Reusable "Capteurs" section (spec §14/§15/§17) — used both on
/// PlantDetailView (a plant's own sensors) and on a garden zone's
/// detail (Phase 5C+). Spec §16: a zone with several divergent sensors
/// of the same type shows min/max/avg rather than collapsing to one
/// number.
struct SensorSectionView: View {
    var sensors: [Sensor]
    var onAdd: () -> Void
    var onSelect: (Sensor) -> Void

    private var grouped: [(type: SensorType, sensors: [Sensor])] {
        Dictionary(grouping: sensors, by: \.type)
            .sorted { $0.key.displayName < $1.key.displayName }
            .map { (type: $0.key, sensors: $0.value) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Capteurs")
                    .font(.headline)
                Spacer()
                Button(action: onAdd) {
                    Image(systemName: "plus.circle.fill")
                }
            }

            if sensors.isEmpty {
                Text("Aucun capteur associé. Ajoutez-en un pour suivre l'humidité, la température ou la luminosité réelles.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(grouped.enumerated()), id: \.element.type) { index, group in
                        SensorGroupRow(type: group.type, sensors: group.sensors, onSelect: onSelect)
                        if index < grouped.count - 1 {
                            Divider()
                        }
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct SensorGroupRow: View {
    var type: SensorType
    var sensors: [Sensor]
    var onSelect: (Sensor) -> Void

    private var values: [Double] {
        sensors.compactMap { $0.latestReading?.value }
    }

    /// Spec §16: don't collapse a diverging group to one number.
    private var divergesSignificantly: Bool {
        guard let min = values.min(), let max = values.max(), min != 0 || max != 0 else { return false }
        let reference = Swift.max(abs(min), abs(max), 1)
        return (max - min) / reference > 0.25
    }

    var body: some View {
        if sensors.count == 1, let sensor = sensors.first {
            SensorRow(sensor: sensor, onSelect: { onSelect(sensor) })
        } else {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Image(systemName: type.icon)
                        .foregroundStyle(.secondary)
                        .frame(width: 20)
                    Text(type.displayName)
                        .font(.subheadline.weight(.medium))
                    Spacer()
                    if let summary = aggregateSummary {
                        Text(summary)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                if divergesSignificantly {
                    Text("Valeurs très différentes entre les \(sensors.count) capteurs — voir le détail.")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
                ForEach(sensors) { sensor in
                    Button { onSelect(sensor) } label: {
                        HStack {
                            Text(sensor.name)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text(valueLabel(for: sensor))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 6)
        }
    }

    private var aggregateSummary: String? {
        guard !values.isEmpty else { return nil }
        let min = values.min()!
        let max = values.max()!
        let avg = values.reduce(0, +) / Double(values.count)
        if divergesSignificantly {
            return "\(formatted(min))–\(formatted(max)) \(type.defaultUnit)"
        }
        return "\(formatted(avg)) \(type.defaultUnit) (moy.)"
    }

    private func valueLabel(for sensor: Sensor) -> String {
        guard let reading = sensor.latestReading else { return "—" }
        return "\(formatted(reading.value)) \(sensor.unit)"
    }

    private func formatted(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(format: "%.1f", value)
    }
}

private struct SensorRow: View {
    var sensor: Sensor
    var onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 10) {
                Image(systemName: sensor.type.icon)
                    .foregroundStyle(.secondary)
                    .frame(width: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text(sensor.name)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                    if sensor.isStale {
                        Label(staleLabel, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    } else if let reading = sensor.latestReading {
                        Text("Mis à jour \(reading.timestamp.formatted(.relative(presentation: .named)))")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if let reading = sensor.latestReading {
                    Text("\(formatted(reading.value)) \(sensor.unit)")
                        .font(.subheadline.weight(.medium))
                } else {
                    Text("Aucune donnée")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .buttonStyle(.plain)
        .padding(.vertical, 6)
    }

    private var staleLabel: String {
        guard let reading = sensor.latestReading else { return "Aucune donnée" }
        return "Dernière mesure \(reading.timestamp.formatted(.relative(presentation: .named)))"
    }

    private func formatted(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(format: "%.1f", value)
    }
}
