import SwiftUI
import SwiftData
import PhotosUI
import UIKit

struct PlantDetailView: View {
    private enum ActiveSheet: Identifiable, Equatable {
        case edit
        case addEvent
        case configureSchedule(CareEventType)
        case assistant
        case diagnosis
        case placeOnMap
        case qrCode(SmartTag)
        case nfcAssociate
        case addMeasurement
        case measurementCharts
        case addInspection
        case editInspection(TreeInspection)
        case photoComparison
        case addSensor
        case sensorDetail(Sensor)

        var id: String {
            switch self {
            case .edit: return "edit"
            case .addEvent: return "addEvent"
            case .configureSchedule(let type): return "configureSchedule-\(type.rawValue)"
            case .assistant: return "assistant"
            case .diagnosis: return "diagnosis"
            case .placeOnMap: return "placeOnMap"
            case .qrCode(let tag): return "qrCode-\(tag.id.uuidString)"
            case .nfcAssociate: return "nfcAssociate"
            case .addMeasurement: return "addMeasurement"
            case .measurementCharts: return "measurementCharts"
            case .addInspection: return "addInspection"
            case .editInspection(let inspection): return "editInspection-\(inspection.id.uuidString)"
            case .photoComparison: return "photoComparison"
            case .addSensor: return "addSensor"
            case .sensorDetail(let sensor): return "sensorDetail-\(sensor.id.uuidString)"
            }
        }
    }

    /// Curated groupings for the history filter menu — one entry per raw
    /// CareEventType (now 15 cases) would be an unwieldy menu, so related
    /// types collapse into a single bucket.
    private enum HistoryFilterBucket: String, CaseIterable, Identifiable {
        case watering
        case fertilizing
        case photos
        case pruning
        case treatments
        case other

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .watering: return "Arrosage"
            case .fertilizing: return "Engrais"
            case .photos: return "Photos"
            case .pruning: return "Taille"
            case .treatments: return "Traitements"
            case .other: return "Autres"
            }
        }

        var types: [CareEventType] {
            switch self {
            case .watering: return [.watering]
            case .fertilizing: return [.fertilizing]
            case .photos: return [.photoUpdate]
            case .pruning: return [.pruning, .trimming]
            case .treatments: return [.treatment, .pestObservation, .diseaseObservation]
            case .other: return [.repotting, .inspection, .planting, .misting, .cleaning, .rotating, .custom]
            }
        }
    }

    var plant: Plant

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var activeSheet: ActiveSheet?
    @State private var historyFilter: HistoryFilterBucket?
    @State private var selectedPhotoItem: PhotosPickerItem?
    @State private var isPhotoSourceDialogPresented = false
    @State private var isPhotoLimitLockedSheetPresented = false
    @State private var isPhotosPickerPresented = false
    @State private var isCameraPresented = false
    @State private var selectedPhoto: PlantPhoto?
    @State private var isDeleteConfirmationPresented = false
    @State private var inspectionPendingDeletion: TreeInspection?

    private var filteredHistory: [CareEvent] {
        let events = plant.sortedCareEvents
        guard let historyFilter else { return events }
        return events.filter { historyFilter.types.contains($0.type) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                quickActions
                aiSection
                upcomingCare
                if plant.isTreeOrPalm {
                    treeTrackingSection
                }
                smartTagSection
                SensorSectionView(
                    sensors: plant.sensors,
                    onAdd: { activeSheet = .addSensor },
                    onSelect: { sensor in activeSheet = .sensorDetail(sensor) }
                )
                if !plant.photos.isEmpty {
                    evolutionSection
                }
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
            ToolbarItem(placement: .topBarTrailing) {
                Button(role: .destructive) {
                    isDeleteConfirmationPresented = true
                } label: {
                    Image(systemName: "trash")
                }
                .accessibilityIdentifier("deletePlantButton")
            }
        }
        .confirmationDialog(
            "Supprimer \(plant.customName) ?",
            isPresented: $isDeleteConfirmationPresented,
            titleVisibility: .visible
        ) {
            Button("Supprimer", role: .destructive) {
                DeletionService.delete(plant, in: modelContext)
                dismiss()
            }
            Button("Annuler", role: .cancel) {}
        } message: {
            Text("Cette action supprimera aussi son historique et ses photos. Cette action est irréversible.")
        }
        .confirmationDialog(
            "Supprimer cette inspection ?",
            isPresented: Binding(
                get: { inspectionPendingDeletion != nil },
                set: { if !$0 { inspectionPendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Supprimer", role: .destructive) {
                if let inspection = inspectionPendingDeletion {
                    DeletionService.delete(inspection, in: modelContext)
                }
                inspectionPendingDeletion = nil
            }
            Button("Annuler", role: .cancel) {
                inspectionPendingDeletion = nil
            }
        } message: {
            Text("Les photos associées seront conservées dans l'historique du végétal. Cette action est irréversible.")
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .edit:
                PlantFormView(plant: plant)
            case .addEvent:
                AddCareEventSheet(plants: [plant])
            case .configureSchedule(let type):
                ConfigureScheduleSheet(plant: plant, type: type)
            case .assistant:
                PlantAssistantView(plant: plant)
            case .diagnosis:
                PlantDiagnosisView(plant: plant)
            case .placeOnMap:
                PlacePlantOnMapSheet(plant: plant)
            case .qrCode(let tag):
                QRCodeSheet(subjectName: plant.customName, tag: tag)
            case .nfcAssociate:
                NFCAssociationSheet(
                    subjectName: plant.customName, subjectID: plant.id, existingTags: plant.smartTags,
                    createTag: { context in SmartTagService.tag(for: plant, type: .nfc, in: context) },
                    reassignTag: { tag, context in SmartTagService.reassign(tag, to: plant, in: context) }
                )
            case .addMeasurement:
                TreeMeasurementFormView(plant: plant)
            case .measurementCharts:
                TreeMeasurementChartsView(plant: plant)
            case .addInspection:
                TreeInspectionFormView(plant: plant, inspection: nil)
            case .editInspection(let inspection):
                TreeInspectionFormView(plant: plant, inspection: inspection)
            case .photoComparison:
                PhotoComparisonView(plant: plant)
            case .addSensor:
                SensorFormSheet(plant: plant)
            case .sensorDetail(let sensor):
                SensorDetailSheet(sensor: sensor)
            }
        }
        .onChange(of: selectedPhotoItem) { _, newItem in
            guard let newItem else { return }
            Task {
                if let data = try? await newItem.loadTransferable(type: Data.self) {
                    CareScheduleEngine.addPhoto(imageData: data, for: plant, in: modelContext)
                }
                selectedPhotoItem = nil
            }
        }
        .confirmationDialog("Ajouter une photo", isPresented: $isPhotoSourceDialogPresented, titleVisibility: .visible) {
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Prendre une photo") { isCameraPresented = true }
            }
            Button("Choisir dans la photothèque") { isPhotosPickerPresented = true }
            Button("Annuler", role: .cancel) {}
        }
        .sheet(isPresented: $isPhotoLimitLockedSheetPresented) {
            LockedFeatureSheet(featureName: "Photos supplémentaires")
        }
        .photosPicker(isPresented: $isPhotosPickerPresented, selection: $selectedPhotoItem, matching: .images)
        .fullScreenCover(isPresented: $isCameraPresented) {
            CameraCaptureView(isPresented: $isCameraPresented) { data in
                CareScheduleEngine.addPhoto(imageData: data, for: plant, in: modelContext)
            }
            .ignoresSafeArea()
        }
        .fullScreenCover(item: $selectedPhoto) { photo in
            PhotoFullScreenView(photo: photo)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Button {
                    requestAddPhoto()
                } label: {
                    headerImage
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("plantPhotoPicker")

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
                            plant.markDirty()
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

            Button {
                activeSheet = .placeOnMap
            } label: {
                Label(
                    plant.hasMapPosition ? "Position dans le jardin définie" : "Position dans le jardin",
                    systemImage: plant.hasMapPosition ? "mappin.circle.fill" : "mappin.circle"
                )
                .font(.caption.weight(.medium))
            }
            .buttonStyle(.plain)
            .foregroundStyle(plant.hasMapPosition ? Color.accentColor : .secondary)
        }
    }

    private var locationText: String {
        [plant.garden?.name, plant.zone?.name].compactMap { $0 }.joined(separator: " · ")
    }

    private func confirmQuickAction(_ type: CareEventType) {
        Haptics.success()
        let subtitle = plant.schedule(for: type)?.nextDueDate.map { "Prochain rappel : \(DateFormatting.shortDate($0))" }
        ToastCenter.shared.show(title: "✓ \(type.displayName) — \(plant.customName)", subtitle: subtitle)
    }

    /// Shared by all three "add a photo" entry points (header, quick
    /// action, evolution "+") since they all funnel into the same
    /// CareScheduleEngine.addPhoto call — one count check here covers
    /// all three rather than duplicating it at each button.
    private func requestAddPhoto() {
        let limits = PlanService.shared.configuration(for: EntitlementService.shared.snapshot.plan).usageLimits
        if UsageLimitService.canAddPhoto(currentCountForPlant: plant.photos.count, limits: limits).isWithinLimit {
            isPhotoSourceDialogPresented = true
        } else {
            isPhotoLimitLockedSheetPresented = true
        }
    }

    @ViewBuilder
    private var headerImage: some View {
        if let photoData = plant.photoData, let uiImage = UIImage(data: photoData) {
            Image(uiImage: uiImage)
                .resizable()
                .scaledToFill()
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        } else {
            Image(systemName: plant.type.icon)
                .font(.title2)
                .foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(plant.healthStatus.color.gradient, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private var quickActions: some View {
        HStack(spacing: 12) {
            ActionButton(title: "Arroser", icon: "drop.fill", tint: .blue, identifier: "actionWater") {
                CareScheduleEngine.recordCare(.watering, for: plant, in: modelContext)
                confirmQuickAction(.watering)
            }
            ActionButton(title: "Engrais", icon: "sparkles", tint: .green, identifier: "actionFertilize") {
                CareScheduleEngine.recordCare(.fertilizing, for: plant, in: modelContext)
                confirmQuickAction(.fertilizing)
            }
            Button {
                requestAddPhoto()
            } label: {
                ActionButtonLabel(title: "Photo", icon: "camera.fill", tint: .purple)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("actionPhoto")
            ActionButton(title: "Plus", icon: "plus", tint: .gray, identifier: "actionMore") {
                activeSheet = .addEvent
            }
        }
    }

    private struct PhotoMonthGroup {
        var month: String
        var photos: [PlantPhoto]
    }

    private var groupedPhotos: [PhotoMonthGroup] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: plant.sortedPhotos) { photo in
            calendar.dateComponents([.year, .month], from: photo.date)
        }
        return grouped.keys
            .sorted { lhs, rhs in
                let lhsDate = calendar.date(from: lhs) ?? .distantPast
                let rhsDate = calendar.date(from: rhs) ?? .distantPast
                return lhsDate > rhsDate
            }
            .map { key in
                let date = calendar.date(from: key) ?? .now
                let title = date.formatted(.dateTime.month(.wide).year()).capitalized
                return PhotoMonthGroup(month: title, photos: grouped[key] ?? [])
            }
    }

    private var evolutionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Évolution")
                    .font(.headline)
                Spacer()
                Button {
                    requestAddPhoto()
                } label: {
                    Image(systemName: "plus.circle.fill")
                }
                .accessibilityIdentifier("addEvolutionPhotoButton")
            }

            ForEach(groupedPhotos, id: \.month) { group in
                VStack(alignment: .leading, spacing: 4) {
                    Text(group.month)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)

                    VStack(spacing: 0) {
                        ForEach(Array(group.photos.enumerated()), id: \.element.id) { index, photo in
                            PhotoEntryRow(photo: photo) { selectedPhoto = photo }
                            if index < group.photos.count - 1 {
                                Divider()
                            }
                        }
                    }
                }
            }
        }
    }

    /// Always shown, configured or not, so the two most common reminders
    /// stay one tap away. Every other schedulable type is progressive
    /// disclosure via the "+" menu, since showing all 11 rows unconditionally
    /// would clutter a fresh plant's detail page.
    private var primarySchedulableTypes: [CareEventType] { [.watering, .fertilizing] }

    private var extraConfiguredSchedules: [CareSchedule] {
        plant.careSchedules
            .filter { CareEventType.schedulable.contains($0.type) && !primarySchedulableTypes.contains($0.type) }
            .sorted { ($0.nextDueDate ?? .distantPast) < ($1.nextDueDate ?? .distantPast) }
    }

    private var addableScheduleTypes: [CareEventType] {
        let configuredTypes = Set(plant.careSchedules.map(\.type))
        return CareEventType.schedulable.filter { !primarySchedulableTypes.contains($0) && !configuredTypes.contains($0) }
    }

    private var displayedScheduleRows: [(type: CareEventType, schedule: CareSchedule?)] {
        primarySchedulableTypes.map { (type: $0, schedule: plant.schedule(for: $0)) }
            + extraConfiguredSchedules.map { (type: $0.type, schedule: Optional($0)) }
    }

    private var upcomingCare: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Prochains soins")
                    .font(.headline)
                Spacer()
                if !addableScheduleTypes.isEmpty {
                    Menu {
                        ForEach(addableScheduleTypes) { type in
                            Button {
                                activeSheet = .configureSchedule(type)
                            } label: {
                                Label(type.displayName, systemImage: type.icon)
                            }
                        }
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                    .accessibilityIdentifier("addScheduleButton")
                }
            }

            VStack(spacing: 0) {
                ForEach(Array(displayedScheduleRows.enumerated()), id: \.offset) { index, row in
                    ScheduleRowButton(type: row.type, schedule: row.schedule) {
                        activeSheet = .configureSchedule(row.type)
                    }
                    if index < displayedScheduleRows.count - 1 {
                        Divider()
                    }
                }
            }
        }
    }

    private var sortedAIAnalyses: [AIAnalysis] {
        plant.aiAnalyses.sorted { $0.date > $1.date }
    }

    private var aiSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("✨ Oasis AI")
                .font(.headline)

            HStack(spacing: 12) {
                Button {
                    activeSheet = .assistant
                } label: {
                    ActionButtonLabel(title: "Assistant", icon: "bubble.left.and.bubble.right", tint: .purple)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("actionAssistant")

                Button {
                    activeSheet = .diagnosis
                } label: {
                    ActionButtonLabel(title: "Diagnostiquer", icon: "stethoscope", tint: .orange)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("actionDiagnose")
            }

            if let speciesProfile = plant.speciesProfile, let payload = speciesProfile.decodedPayload() {
                DisclosureGroup("Fiche espèce") {
                    SpeciesProfileSummaryView(payload: payload)
                        .padding(.top, 4)
                }
                .font(.subheadline.weight(.medium))
            }

            if !sortedAIAnalyses.isEmpty {
                DisclosureGroup("Historique IA (\(sortedAIAnalyses.count))") {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(sortedAIAnalyses.prefix(10).enumerated()), id: \.element.id) { index, analysis in
                            AIAnalysisRow(analysis: analysis)
                            if index < min(sortedAIAnalyses.count, 10) - 1 {
                                Divider()
                            }
                        }
                    }
                    .padding(.top, 4)
                }
                .font(.subheadline.weight(.medium))
            }
        }
    }

    private var latestMeasurement: PlantMeasurement? {
        plant.sortedMeasurements.first
    }

    /// Spec §54-60, gated to tree/palm plants only (§54: "Pour
    /// arbres/palmiers"). Groups measurements, charts, inspections, and
    /// before/after comparison — everything this plant type gets that
    /// others don't — into one section rather than scattering them.
    private var treeTrackingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Suivi arboricole")
                .font(.headline)

            if let latest = latestMeasurement {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Dernière mesure — \(DateFormatting.shortDate(latest.date))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack(spacing: 16) {
                        if let height = latest.height {
                            Label("\(height.formatted()) m", systemImage: "arrow.up.and.down")
                        }
                        if let circumference = latest.trunkCircumference {
                            Label("\(circumference.formatted()) cm", systemImage: "circle.dashed")
                        }
                        if let canopy = latest.canopyDiameter {
                            Label("\(canopy.formatted()) m", systemImage: "tree")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            } else {
                Text("Aucune mesure enregistrée pour l'instant.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 12) {
                Button {
                    activeSheet = .addMeasurement
                } label: {
                    ActionButtonLabel(title: "Mesurer", icon: "ruler", tint: .green)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("addMeasurementButton")

                Button {
                    activeSheet = .measurementCharts
                } label: {
                    ActionButtonLabel(title: "Graphiques", icon: "chart.xyaxis.line", tint: .blue)
                }
                .buttonStyle(.plain)
                .disabled(plant.measurements.isEmpty)

                Button {
                    activeSheet = .photoComparison
                } label: {
                    ActionButtonLabel(title: "Comparer", icon: "photo.on.rectangle.angled", tint: .indigo)
                }
                .buttonStyle(.plain)
            }

            if !plant.sortedTreeInspections.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(plant.sortedTreeInspections.enumerated()), id: \.element.id) { index, inspection in
                        TreeInspectionRow(inspection: inspection) {
                            activeSheet = .editInspection(inspection)
                        }
                        .contextMenu {
                            Button {
                                activeSheet = .editInspection(inspection)
                            } label: {
                                Label("Modifier", systemImage: "pencil")
                            }
                            Button(role: .destructive) {
                                inspectionPendingDeletion = inspection
                            } label: {
                                Label("Supprimer", systemImage: "trash")
                            }
                        }
                        if index < plant.sortedTreeInspections.count - 1 {
                            Divider()
                        }
                    }
                }
            }

            Button {
                activeSheet = .addInspection
            } label: {
                Label("Nouvelle inspection", systemImage: "checklist")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("addInspectionButton")
        }
    }

    private var qrTag: SmartTag? {
        plant.smartTags.first { $0.type == .qr && $0.active }
    }

    private var nfcTag: SmartTag? {
        plant.smartTags.first { $0.type == .nfc && $0.active }
    }

    /// Spec §42 — "Étiquette intelligente" with its two independent
    /// entry points. NFC's button label doesn't offer "voir" the way QR
    /// does: there's nothing to display for an NFC tag beyond what's
    /// already implied by its existing/not-existing state, and
    /// dissociating it lives inside NFCAssociationSheet's own flow if
    /// the user re-associates.
    private var smartTagSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Étiquette intelligente")
                .font(.headline)
            HStack(spacing: 12) {
                Button {
                    let tag = SmartTagService.tag(for: plant, type: .qr, in: modelContext)
                    activeSheet = .qrCode(tag)
                } label: {
                    ActionButtonLabel(
                        title: qrTag != nil ? "Voir le QR" : "Afficher QR",
                        icon: "qrcode",
                        tint: .indigo
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("showQRButton")

                Button {
                    activeSheet = .nfcAssociate
                } label: {
                    ActionButtonLabel(
                        title: nfcTag != nil ? "Tag NFC associé" : "Associer NFC",
                        icon: "wave.3.right",
                        tint: .teal
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("associateNFCButton")
            }
        }
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
                    ForEach(HistoryFilterBucket.allCases) { bucket in
                        Button(bucket.displayName) { historyFilter = bucket }
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

private struct ActionButtonLabel: View {
    var title: String
    var icon: String
    var tint: Color

    var body: some View {
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
}

private struct ActionButton: View {
    var title: String
    var icon: String
    var tint: Color
    var identifier: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            ActionButtonLabel(title: title, icon: icon, tint: tint)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }
}

private struct ScheduleRowButton: View {
    var type: CareEventType
    var schedule: CareSchedule?
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                Image(systemName: type.icon)
                    .foregroundStyle(.secondary)
                    .frame(width: 24)

                Text(type.displayName)
                    .foregroundStyle(.primary)

                Spacer()

                if let schedule, schedule.isActive {
                    Text(dueLabel(schedule))
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
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("scheduleRow-\(type.rawValue)")
    }

    private func dueLabel(_ schedule: CareSchedule) -> String {
        guard let nextDueDate = schedule.nextDueDate else { return "À démarrer" }
        return DateFormatting.relativeDayLabel(for: nextDueDate)
    }
}

private struct PhotoEntryRow: View {
    var photo: PlantPhoto
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                if let uiImage = UIImage(data: photo.thumbnailData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 56, height: 56)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(DateFormatting.shortDate(photo.date))
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                    if !photo.notes.isEmpty {
                        Text(photo.notes)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Spacer()
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct AIAnalysisRow: View {
    var analysis: AIAnalysis

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: analysis.type.icon)
                .foregroundStyle(.purple)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(analysis.type.displayName)
                    .font(.caption.weight(.medium))
                Text(analysis.summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }

            Spacer()

            Text(DateFormatting.shortDate(analysis.date))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
    }
}

private struct HistoryRow: View {
    var event: CareEvent

    var body: some View {
        HStack(spacing: 12) {
            thumbnail

            VStack(alignment: .leading, spacing: 2) {
                Text(event.type.displayName)
                    .font(.subheadline.weight(.medium))
                if let product = event.product, !product.isEmpty {
                    Text(productLabel(product))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
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

    private func productLabel(_ product: String) -> String {
        guard let quantity = event.quantity else { return product }
        let quantityText = quantity.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(quantity))
            : String(quantity)
        let unitText = event.unit.map { " \($0)" } ?? ""
        return "\(product) · \(quantityText)\(unitText)"
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let photoData = event.photoData, let uiImage = UIImage(data: photoData) {
            Image(uiImage: uiImage)
                .resizable()
                .scaledToFill()
                .frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        } else {
            Image(systemName: event.type.icon)
                .foregroundStyle(.secondary)
                .frame(width: 24)
        }
    }
}

private struct TreeInspectionRow: View {
    var inspection: TreeInspection
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                Circle()
                    .fill(inspection.result.color)
                    .frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 2) {
                    Text(inspection.result.displayName)
                        .foregroundStyle(.primary)
                    Text(DateFormatting.shortDate(inspection.date))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
