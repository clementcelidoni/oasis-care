import SwiftUI
import UIKit

struct ScheduleRow: View {
    var schedule: CareSchedule
    var plant: Plant

    var body: some View {
        HStack(spacing: 12) {
            thumbnail

            VStack(alignment: .leading, spacing: 2) {
                Text(plant.customName)
                    .font(.body.weight(.medium))
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                CareStatusBadge(status: schedule.status, style: .iconOnly)
                Text(dueLabel)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(schedule.isOverdue ? .red : .secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private var subtitle: String {
        let location = [plant.garden?.name, plant.zone?.name].compactMap { $0 }.joined(separator: " · ")
        return location.isEmpty ? schedule.type.displayName : "\(schedule.type.displayName) · \(location)"
    }

    private var dueLabel: String {
        guard let nextDueDate = schedule.nextDueDate else { return "À démarrer" }
        return DateFormatting.relativeDayLabel(for: nextDueDate)
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let photoData = plant.thumbnailData ?? plant.photoData, let uiImage = UIImage(data: photoData) {
            Image(uiImage: uiImage)
                .resizable()
                .scaledToFill()
                .frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        } else {
            Image(systemName: schedule.type.icon)
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(Color.accentColor.gradient, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }
}
