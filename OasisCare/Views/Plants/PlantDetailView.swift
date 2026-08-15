import SwiftUI
import SwiftData

struct PlantDetailView: View {
    private enum ActiveSheet: Identifiable, Equatable {
        case edit
        case addEvent
        case configureSchedule(CareEventType)

        var id: String {
            switch self {
            case .edit: return "edit"
            case .addEvent: return "addEvent"
            case .configureSchedule(let type): return "configureSchedule-\(type.rawValue)"
            }
        }
    }

    var plant: Plant

    @Environment(\.modelContext) private var modelContext

    @State private var activeSheet: ActiveSheet?
    @State private var historyFilter: CareEventType?

    private var filteredHistory: [CareEvent] {
        let events = plant.sortedCareEvents
        guard let historyFilter else { return events }
        return events.filter { $0.type == historyFilter }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                quickActions
                upcomingCare
                if !plant.notes.isEmpty {
                    notesSection
                }
                historySection
            }
            .padding()
        }
        .navigationTitle(plant.customName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Modifier") { activeSheet = .edit }
            }
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .edit:
                PlantFormView(plant: plant)
            case .addEvent:
                AddCareEventSheet(plant: plant)
            case .configureSchedule(let type):
                ConfigureScheduleSheet(plant: plant, type: type)
            }
        }
        .onChange(of: activeSheet) { oldValue, newValue in
            print("DEBUG: onChange activeSheet \(String(describing: oldValue)) -> \(String(describing: newValue))")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Image(systemName: plant.type.icon)
                    .font(.title2)
                    .foregroundStyle(.white)
                    .frame(width: 52, height: 52)
                    .background(plant.healthStatus.color.gradient, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                VStack(alignment: .leading, spacing: 2) {
                    if let commonName = plant.commonName, !commonName.isEmpty {
                        Text(commonName)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if let scientificName = plant.scientificName, !scientificName.isEmpty {
                        Text(scientificName)
                            .font(.caption)
                            .italic()
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()
            }

            HStack(spacing: 8) {
                Menu {
                    ForEach(HealthStatus.allCases) { status in
                        Button {
                            plant.healthStatus = status
                        } label: {
                            Label(status.displayName, systemImage: "circle.fill")
                        }
                    }
                } label: {
                    HealthStatusBadge(status: plant.healthStatus)
                }

                Label(plant.type.displayName, systemImage: plant.type.icon)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)

                Label(plant.isIndoor ? "Intérieur" : "Extérieur", systemImage: plant.isIndoor ? "house.fill" : "sun.max.fill")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }

            if plant.garden != nil || plant.zone != nil {
                Label(locationText, systemImage: "map.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var locationText: String {
        [plant.garden?.name, plant.zone?.name].compactMap { $0 }.joined(separator: " · ")
    }

    private var quickActions: some View {
        HStack(spacing: 12) {
            ActionButton(title: "Arroser", icon: "drop.fill", tint: .blue, identifier: "actionWater") {
                CareScheduleEngine.recordCare(.watering, for: plant, in: modelContext)
            }
            ActionButton(title: "Engrais", icon: "sparkles", tint: .green, identifier: "actionFertilize") {
                CareScheduleEngine.recordCare(.fertilizing, for: plant, in: modelContext)
            }
            ActionButton(title: "Plus", icon: "plus", tint: .gray, identifier: "actionMore") {
                activeSheet = .addEvent
            }
        }
    }

    private var upcomingCare: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Prochains soins")
                .font(.headline)

            VStack(spacing: 0) {
                ForEach(Array(CareEventType.schedulable.enumerated()), id: \.element) { index, type in
                    scheduleRow(for: type)
                    if index < CareEventType.schedulable.count - 1 {
                        Divider()
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func scheduleRow(for type: CareEventType) -> some View {
        Button {
            print("DEBUG: scheduleRow tapped for \(type.rawValue)")
            activeSheet = .configureSchedule(type)
            print("DEBUG: activeSheet is now \(String(describing: activeSheet))")
        } label: {
            HStack {
                Image(systemName: type.icon)
                    .foregroundStyle(.secondary)
                    .frame(width: 24)

                Text(type.displayName)
                    .foregroundStyle(.primary)

                Spacer()

                if let schedule = plant.schedule(for: type), schedule.isActive {
                    Text(scheduleLabel(schedule))
                        .foregroundStyle(schedule.isOverdue ? .red : .secondary)
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                } else {
                    Text("Configurer")
                        .foregroundStyle(Color.accentColor)
                }
            }
            .font(.subheadline)
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("scheduleRow-\(type.rawValue)")
    }

    private func scheduleLabel(_ schedule: CareSchedule) -> String {
        guard let nextDueDate = schedule.nextDueDate else { return "À démarrer" }
        return DateFormatting.relativeDayLabel(for: nextDueDate)
    }

    private var notesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Notes")
                .font(.headline)
            Text(plant.notes)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private var historySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Historique")
                    .font(.headline)
                Spacer()
                Menu {
                    Button("Tout") { historyFilter = nil }
                    Divider()
                    ForEach(CareEventType.allCases) { type in
                        Button(type.displayName) { historyFilter = type }
                    }
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
            }

            if filteredHistory.isEmpty {
                Text("Aucune intervention enregistrée.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(filteredHistory.enumerated()), id: \.element.id) { index, event in
                        HistoryRow(event: event)
                        if index < filteredHistory.count - 1 {
                            Divider()
                        }
                    }
                }
            }
        }
    }
}

private struct ActionButton: View {
    var title: String
    var icon: String
    var tint: Color
    var identifier: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.title3)
                Text(title)
                    .font(.caption)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .foregroundStyle(tint)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }
}

private struct HistoryRow: View {
    var event: CareEvent

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: event.type.icon)
                .foregroundStyle(.secondary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(event.type.displayName)
                    .font(.subheadline.weight(.medium))
                if !event.notes.isEmpty {
                    Text(event.notes)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Text(DateFormatting.shortDate(event.date))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
    }
}
