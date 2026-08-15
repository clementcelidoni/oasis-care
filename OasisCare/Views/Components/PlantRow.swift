import SwiftUI

struct PlantRow: View {
    var plant: Plant

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: plant.type.icon)
                .font(.title3)
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(plant.healthStatus.color.gradient, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(plant.customName)
                    .font(.body.weight(.medium))
                if let subtitle = plant.commonName ?? plant.scientificName {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let locationText {
                    Text(locationText)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            HealthStatusBadge(status: plant.healthStatus)
        }
        .padding(.vertical, 4)
    }

    private var locationText: String? {
        let parts = [plant.garden?.name, plant.zone?.name].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
