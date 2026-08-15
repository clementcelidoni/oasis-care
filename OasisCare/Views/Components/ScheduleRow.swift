import SwiftUI

struct ScheduleRow: View {
    var schedule: CareSchedule
    var plant: Plant

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: schedule.type.icon)
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(Color.accentColor.gradient, in: Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(plant.customName)
                    .font(.body.weight(.medium))
                Text(schedule.type.displayName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text(dueLabel)
                .font(.caption.weight(.medium))
                .foregroundStyle(schedule.isOverdue ? .red : .secondary)
        }
        .padding(.vertical, 4)
    }

    private var dueLabel: String {
        guard let nextDueDate = schedule.nextDueDate else { return "À démarrer" }
        return DateFormatting.relativeDayLabel(for: nextDueDate)
    }
}
