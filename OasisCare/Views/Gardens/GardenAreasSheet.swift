import SwiftData
import SwiftUI

/// Spec Phase 6C/6D — zones list: add, delete, resume drawing an
/// existing zone's points, or (6D) launch the AI irrigation design
/// assistant for one. Managed via a list rather than on-canvas
/// tap-to-select, so picking a zone never competes with the boundary/
/// object tap gestures already on the canvas (see OasisPlanView's tap
/// dispatch for why that competition is worth avoiding).
struct GardenAreasSheet: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var activeSheet: ActiveSheet?

    /// One enum + one `.sheet(item:)` rather than two separate `.sheet`
    /// modifiers chained on this view — the established fix for the
    /// multi-sheet bug class this codebase already hit once (Phase 1),
    /// same as OasisPlanView and GardenObjectInspectorSheet.
    private enum ActiveSheet: Identifiable {
        case typePicker
        case design(GardenArea)
        case microclimate(GardenArea)
        case zoneActions(GardenArea)

        var id: String {
            switch self {
            case .typePicker: return "typePicker"
            case .design(let area): return "design-\(area.id)"
            case .microclimate(let area): return "microclimate-\(area.id)"
            case .zoneActions(let area): return "zoneActions-\(area.id)"
            }
        }
    }

    private var areas: [GardenArea] {
        engine.garden.areas.sorted { $0.createdAt < $1.createdAt }
    }

    /// Spec Phase 6F — "pour chaque zone : 7h30 de soleil ou plein
    /// soleil/mi-ombre/ombre," for today's actual date. nil when the
    /// garden has no location set (SunExposureService needs latitude)
    /// or the zone isn't a closed shape yet.
    private func sunExposureLabel(for area: GardenArea) -> String? {
        guard let latitude = engine.garden.latitude, area.points.count >= 3 else { return nil }
        let casters = engine.garden.mapObjects
            .filter { $0.objectType.castsShadow }
            .compactMap { object -> (position: GardenCoordinate, heightMeters: Double, widthMeters: Double)? in
                guard let height = object.structureHeightMeters else { return nil }
                return (object.position, height, object.widthMeters)
            }
        let exposure = SunExposureService.dailySunExposure(
            zoneCentroid: GardenGeometry.centroid(of: area.points), shadowCasters: casters, latitude: latitude, date: .now
        )
        let hours = Int(exposure.litHours)
        let minutes = Int((exposure.litHours - Double(hours)) * 60)
        return "\(exposure.level.label) (\(hours) h \(String(format: "%02d", minutes)) aujourd'hui, estimé)"
    }

    var body: some View {
        NavigationStack {
            List {
                if areas.isEmpty {
                    ContentUnavailableView(
                        "Aucune zone",
                        systemImage: "square.dashed",
                        description: Text("Ajoutez une pelouse, un massif, une zone interdite...")
                    )
                } else {
                    ForEach(areas) { area in
                        Button {
                            engine.editingAreaID = area.id
                            dismiss()
                        } label: {
                            HStack {
                                Image(systemName: area.areaType.icon)
                                    .foregroundStyle(area.areaType.color)
                                    .frame(width: 28)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(area.name.isEmpty ? area.areaType.label : area.name)
                                        .foregroundStyle(.primary)
                                    Text("\(area.points.count) point\(area.points.count > 1 ? "s" : "") · \(String(format: "%.1f m²", area.areaSquareMeters))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    if let exposureLabel = sunExposureLabel(for: area) {
                                        Text(exposureLabel)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer()
                                if area.areaType.isNoGo {
                                    Image(systemName: "xmark.octagon.fill")
                                        .foregroundStyle(.red)
                                        .accessibilityLabel("Zone interdite")
                                }
                            }
                        }
                        .swipeActions(edge: .leading) {
                            Button {
                                activeSheet = .design(area)
                            } label: {
                                Label("Arrosage", systemImage: "sparkles")
                            }
                            .tint(.blue)
                            .disabled(area.points.count < 3)

                            Button {
                                activeSheet = .microclimate(area)
                            } label: {
                                Label("Microclimat", systemImage: "thermometer.sun")
                            }
                            .tint(.orange)

                            Button {
                                activeSheet = .zoneActions(area)
                            } label: {
                                Label("Actions groupées", systemImage: "checklist")
                            }
                            .tint(.green)
                        }
                    }
                    .onDelete { offsets in
                        for index in offsets {
                            engine.removeArea(areas[index], context: modelContext)
                        }
                    }
                }
            }
            .navigationTitle("Zones du jardin")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        activeSheet = .typePicker
                    } label: {
                        Label("Ajouter", systemImage: "plus")
                    }
                }
            }
            .sheet(item: $activeSheet) { sheet in
                switch sheet {
                case .typePicker:
                    GardenAreaTypePickerSheet { type in
                        let area = engine.addArea(type: type, context: modelContext)
                        engine.editingAreaID = area.id
                        activeSheet = nil
                        dismiss()
                    }
                case .design(let area):
                    IrrigationDesignSheet(zone: area, engine: engine)
                case .microclimate(let area):
                    MicroclimateEditSheet(engine: engine, area: area)
                case .zoneActions(let area):
                    GardenZoneActionsSheet(area: area, engine: engine)
                }
            }
        }
    }
}

/// A simple list picker, separate from GardenObjectPickerSheet's grid
/// since GardenAreaType has far fewer cases and reads better with each
/// type's tint visible next to its label.
private struct GardenAreaTypePickerSheet: View {
    var onPick: (GardenAreaType) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(GardenAreaType.allCases) { type in
                Button {
                    onPick(type)
                } label: {
                    Label(type.label, systemImage: type.icon)
                        .foregroundStyle(type.color)
                }
            }
            .navigationTitle("Type de zone")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
