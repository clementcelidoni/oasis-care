import SwiftData
import SwiftUI

/// Spec Phase 7D.
struct BioreactorDetailView: View {
    var bioreactor: Bioreactor
    @Environment(\.modelContext) private var modelContext

    // Filtered in plain Swift, not #Predicate: comparing a rawValue-backed
    // enum property inside the #Predicate macro is a known rough edge on
    // early SwiftData versions — fetching the (small, workspace-scale)
    // full list and filtering here sidesteps that entirely.
    @Query private var allBatches: [CultureBatch]
    @Query private var allPrograms: [BioreactorProgram]
    @Query private var allExecutions: [BioreactorCycleExecution]
    @State private var isShowingMaintenanceForm = false

    private var activeBatches: [CultureBatch] {
        allBatches.filter { $0.status == .active }
    }

    private var recentExecutions: [BioreactorCycleExecution] {
        allExecutions.filter { $0.bioreactor?.id == bioreactor.id }.sorted { $0.plannedStart > $1.plannedStart }
    }

    var body: some View {
        Form {
            Section {
                BioreactorSchematicView(bioreactor: bioreactor)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            }

            Section {
                LabeledContent("Type", value: bioreactor.bioreactorType.label)
                LabeledContent("Volumes", value: "\(formatted(bioreactor.workingVolumeLiters)) L utile / \(formatted(bioreactor.totalVolumeLiters)) L total")
                if !bioreactor.location.isEmpty {
                    LabeledContent("Emplacement", value: bioreactor.location)
                }
                Picker("Statut", selection: Binding(
                    get: { bioreactor.status },
                    set: { bioreactor.status = $0; bioreactor.markDirty() }
                )) {
                    ForEach(BioreactorStatus.allCases) { status in
                        Label(status.label, systemImage: status.icon).tag(status)
                    }
                }
            }

            Section("Lot actuel") {
                Picker("Lot", selection: Binding(
                    get: { bioreactor.currentBatch },
                    set: { bioreactor.currentBatch = $0; bioreactor.markDirty() }
                )) {
                    Text("Aucun").tag(CultureBatch?.none)
                    ForEach(activeBatches) { batch in
                        Text(batch.batchCode).tag(Optional(batch))
                    }
                }
                if let batch = bioreactor.currentBatch {
                    NavigationLink("Ouvrir le lot \(batch.batchCode)") {
                        CultureBatchDetailView(batch: batch)
                    }
                }
            }

            Section("Programme") {
                Picker("Programme actif", selection: Binding(
                    get: { bioreactor.activeProgramVersion },
                    set: { bioreactor.activeProgramVersion = $0; bioreactor.markDirty() }
                )) {
                    Text("Aucun").tag(BioreactorProgramVersion?.none)
                    ForEach(allPrograms) { program in
                        if let version = program.latestVersion {
                            Text("\(program.name) (V\(version.versionNumber))").tag(Optional(version))
                        }
                    }
                }
                if let program = bioreactor.activeProgramVersion {
                    if program.immersionEnabled, let next = nextCycleDate(type: .immersion, program: program) {
                        LabeledContent("Prochaine immersion", value: next.formatted(date: .omitted, time: .shortened))
                    }
                    if program.aerationEnabled, let next = nextCycleDate(type: .aeration, program: program) {
                        LabeledContent("Prochaine aération", value: next.formatted(date: .omitted, time: .shortened))
                    }
                }
            }

            if !recentExecutions.isEmpty {
                Section("Cycles récents") {
                    ForEach(recentExecutions.prefix(10)) { execution in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(execution.cycleType.label).fontWeight(.medium)
                                Text(execution.plannedStart.formatted(date: .abbreviated, time: .shortened))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                if let reason = execution.failureReason {
                                    Text(reason).font(.caption2).foregroundStyle(.orange)
                                }
                            }
                            Spacer()
                            Text(execution.status.label)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(statusColor(execution.status))
                        }
                    }
                }
            }

            Section {
                if bioreactor.maintenanceEvents.isEmpty {
                    Text("Aucun événement de maintenance.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(bioreactor.maintenanceEvents.sorted { $0.date > $1.date }) { event in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.eventType.label).fontWeight(.medium)
                            Text(DateFormatting.shortDate(event.date))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if !event.notes.isEmpty {
                                Text(event.notes).font(.caption)
                            }
                        }
                    }
                }
                Button("Ajouter un événement de maintenance") { isShowingMaintenanceForm = true }
            } header: {
                Text("Maintenance")
            }
        }
        .navigationTitle("\(bioreactor.code)")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isShowingMaintenanceForm) {
            BioreactorMaintenanceFormView(bioreactor: bioreactor)
        }
    }

    private func formatted(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0 ? String(format: "%.0f", value) : String(format: "%.2f", value)
    }

    /// Spec Phase 7E — "NEXT CYCLE." Same anchor rule as
    /// BioreactorCycleScheduler itself (plannedStart, not actualStart)
    /// so this display always agrees with what the scheduler will
    /// actually do on its next tick.
    private func nextCycleDate(type: BioreactorCycleType, program: BioreactorProgramVersion) -> Date? {
        let sameType = recentExecutions.filter { $0.cycleType == type }
        let lastStart = sameType.map(\.plannedStart).max() ?? bioreactor.createdAt
        return BioreactorCycleScheduler.nextCycleDate(type: type, program: program, lastCycleStart: lastStart)
    }

    private func statusColor(_ status: CycleExecutionStatus) -> Color {
        switch status {
        case .scheduled: return .secondary
        case .running: return .blue
        case .completed: return .green
        case .failed: return .orange
        case .cancelled: return .secondary
        case .timeout: return .red
        }
    }
}

private struct BioreactorMaintenanceFormView: View {
    var bioreactor: Bioreactor
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var eventType: MaintenanceEventType = .cleaning
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Picker("Type", selection: $eventType) {
                    ForEach(MaintenanceEventType.allCases) { type in
                        Text(type.label).tag(type)
                    }
                }
                TextField("Notes (optionnel)", text: $notes, axis: .vertical)
                    .lineLimit(2...5)
            }
            .navigationTitle("Maintenance")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") {
                        let event = BioreactorMaintenanceEvent(bioreactor: bioreactor, eventType: eventType, notes: notes)
                        modelContext.insert(event)
                        bioreactor.maintenanceEvents.append(event)
                        try? modelContext.save()
                        dismiss()
                    }
                }
            }
        }
    }
}
