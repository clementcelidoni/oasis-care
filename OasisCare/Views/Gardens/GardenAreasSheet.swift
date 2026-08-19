import SwiftData
import SwiftUI

/// Spec Phase 6C — zones list: add, delete, or resume drawing an
/// existing zone's points. Managed via a list rather than on-canvas
/// tap-to-select, so picking a zone never competes with the boundary/
/// object tap gestures already on the canvas (see OasisPlanView's tap
/// dispatch for why that competition is worth avoiding).
struct GardenAreasSheet: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var isPickingType = false

    private var areas: [GardenArea] {
        engine.garden.areas.sorted { $0.createdAt < $1.createdAt }
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
                                    Text("\(area.points.count) point\(area.points.count > 1 ? "s" : "")")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if area.areaType.isNoGo {
                                    Image(systemName: "xmark.octagon.fill")
                                        .foregroundStyle(.red)
                                        .accessibilityLabel("Zone interdite")
                                }
                            }
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
                        isPickingType = true
                    } label: {
                        Label("Ajouter", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $isPickingType) {
                GardenAreaTypePickerSheet { type in
                    let area = engine.addArea(type: type, context: modelContext)
                    engine.editingAreaID = area.id
                    isPickingType = false
                    dismiss()
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
