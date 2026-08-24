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
    @Query private var allDevices: [ConnectedDevice]
    @State private var isShowingMaintenanceForm = false
    @State private var sensorSheet: SensorSheet?

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
                    set: { newStatus in
                        // Spec Phase 7G "REPRISE" — leaving .paused is
                        // this bioreactor's resume moment, so the
                        // scheduler's due-date anchor floors there
                        // instead of wherever the schedule was left
                        // before the pause.
                        if bioreactor.status == .paused, newStatus != .paused {
                            bioreactor.scheduleResumedAt = .now
                        }
                        bioreactor.status = newStatus
                        bioreactor.markDirty()
                    }
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
                    // Spec Phase 7G — "l'utilisateur doit activer
                    // explicitement" l'automatisation ; tant que ce
                    // n'est pas fait (ou que le programme est en pause),
                    // BioreactorCycleScheduler ne planifie aucun cycle —
                    // afficher une prochaine date ici serait une valeur
                    // qui ne se produira pas réellement.
                    Toggle("Automatisation active", isOn: Binding(
                        get: { bioreactor.automationEnabled },
                        set: { newValue in
                            if newValue, !bioreactor.automationEnabled {
                                bioreactor.scheduleResumedAt = .now
                            }
                            bioreactor.automationEnabled = newValue
                            bioreactor.markDirty()
                        }
                    ))
                    if !bioreactor.automationEnabled {
                        Text("L'application ne pilotera aucun équipement tant que l'automatisation n'est pas activée. Les cycles restent visibles ici à titre indicatif.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else if bioreactor.status == .paused {
                        Label("Programme en pause — changez le statut ci-dessus pour reprendre.", systemImage: "pause.circle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        if program.immersionEnabled, let next = nextCycleDate(type: .immersion, program: program) {
                            LabeledContent("Prochaine immersion", value: next.formatted(date: .omitted, time: .shortened))
                        }
                        if program.aerationEnabled, let next = nextCycleDate(type: .aeration, program: program) {
                            LabeledContent("Prochaine aération", value: next.formatted(date: .omitted, time: .shortened))
                        }
                    }
                }
            }

            Section {
                ForEach(BioreactorDeviceRole.allCases) { role in
                    Picker(role.label, selection: Binding(
                        get: { bioreactor.deviceBindings.first { $0.role == role }?.device },
                        set: { setBinding(role: role, device: $0) }
                    )) {
                        Text("Non configuré").tag(ConnectedDevice?.none)
                        ForEach(matchingDevices(for: role)) { device in
                            Text(device.name).tag(ConnectedDevice?.some(device))
                        }
                    }
                }
            } header: {
                Text("Équipements")
            } footer: {
                Text("Associez chaque rôle à l'équipement connecté qui l'assure réellement sur ce bioréacteur. Un rôle non configuré reste simplement indisponible — aucune fonction n'est supposée présente.")
            }

            if bioreactor.deviceBindings.contains(where: { $0.device != nil }) {
                Section {
                    ForEach(BioreactorDeviceRole.allCases.filter { role in bioreactor.deviceBindings.contains { $0.role == role && $0.device != nil } }) { role in
                        HardwareTestRow(role: role, bioreactor: bioreactor)
                    }
                } header: {
                    Text("Tests manuels")
                } footer: {
                    Text("Déclenche l'équipement réel pendant une durée courte et strictement limitée, quel que soit le statut d'automatisation — utile pour vérifier un branchement.")
                }
            }

            Section {
                SensorSectionView(
                    sensors: bioreactor.sensors,
                    onAdd: { sensorSheet = .add },
                    onSelect: { sensor in sensorSheet = .detail(sensor) }
                )
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
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
        .sheet(item: $sensorSheet) { sheet in
            switch sheet {
            case .add:
                SensorFormSheet(bioreactor: bioreactor)
            case .detail(let sensor):
                SensorDetailSheet(sensor: sensor)
            }
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

    private func matchingDevices(for role: BioreactorDeviceRole) -> [ConnectedDevice] {
        allDevices.filter { $0.hasCapability(role.matchingCapability) }
    }

    /// No BioLab model has ever needed hard deletion before this (batches
    /// are discarded via a status flag, recipes/programs are append-only
    /// versioned) — DeletionService has no tombstone-tracked overload for
    /// BioreactorDeviceBinding, and adding one for this one small,
    /// low-stakes config row isn't worth extending that machinery for.
    /// Clearing a role just nils its device instead of removing the row;
    /// every reader (BioreactorController.device(for:on:), the sections
    /// below) already treats a nil device as "not configured" regardless
    /// of whether the row itself exists.
    private func setBinding(role: BioreactorDeviceRole, device: ConnectedDevice?) {
        if let existing = bioreactor.deviceBindings.first(where: { $0.role == role }) {
            existing.device = device
            existing.markDirty()
        } else if let device {
            let binding = BioreactorDeviceBinding(bioreactor: bioreactor, role: role, device: device)
            modelContext.insert(binding)
            bioreactor.deviceBindings.append(binding)
        }
        try? modelContext.save()
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

private enum SensorSheet: Identifiable {
    case add
    case detail(Sensor)

    var id: String {
        switch self {
        case .add: return "add"
        case .detail(let sensor): return sensor.id.uuidString
        }
    }
}

/// Spec Phase 7G — "COMMANDES MANUELLES... Test pompe air, 5 sec avec
/// limites strictes." Runs regardless of automationEnabled/pause — a
/// manual test is a deliberate, one-off, user-initiated action, not the
/// automatic scheduler, so it isn't gated the same way. The Stepper's
/// range (1...60) is this app's own strict limit on top of whatever
/// DeviceCommandService itself enforces (e.g. the valve's own hard
/// ceiling).
private struct HardwareTestRow: View {
    var role: BioreactorDeviceRole
    var bioreactor: Bioreactor

    @Environment(\.modelContext) private var modelContext
    @State private var durationSeconds = 5
    @State private var isRunning = false
    @State private var lastError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(role.label, systemImage: role.icon)
                Spacer()
                Stepper("\(durationSeconds) s", value: $durationSeconds, in: 1...60)
            }
            Button(isRunning ? "Test en cours…" : "Tester") {
                Task { await runTest() }
            }
            .disabled(isRunning)
            if let lastError {
                Text(lastError).font(.caption2).foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 4)
    }

    private func runTest() async {
        isRunning = true
        lastError = nil
        defer { isRunning = false }

        let result: Result<Void, DeviceCommandError>?
        if role == .valve {
            result = await BioreactorController.openValve(on: bioreactor, durationSeconds: TimeInterval(durationSeconds), context: modelContext)
        } else {
            result = await BioreactorController.setActuator(role, on: bioreactor, action: .start, context: modelContext)
            if case .success = result {
                try? await Task.sleep(nanoseconds: UInt64(durationSeconds) * 1_000_000_000)
                _ = await BioreactorController.setActuator(role, on: bioreactor, action: .stop, context: modelContext)
            }
        }
        if case .failure(let error) = result {
            lastError = error.localizedDescription
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
