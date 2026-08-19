import SwiftData
import SwiftUI

/// Spec Phase 6D — "l'utilisateur sélectionne : Ajouter tuyau, puis
/// dessine." Same list-to-manage / canvas-to-draw split as
/// GardenAreasSheet (6C), for the same reason: picking a pipe from a
/// list never competes with the boundary/area/object tap gestures
/// already on the canvas.
struct IrrigationPipesSheet: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var isPickingLineType = false

    private var pipes: [IrrigationPipe] {
        engine.garden.irrigationPipes.sorted { $0.createdAt < $1.createdAt }
    }

    var body: some View {
        NavigationStack {
            List {
                if pipes.isEmpty {
                    ContentUnavailableView(
                        "Aucun tuyau",
                        systemImage: "point.topleft.down.curvedto.point.bottomright.up",
                        description: Text("Ajoutez une alimentation principale, une ligne secondaire ou une ligne goutte-à-goutte.")
                    )
                } else {
                    if pipes.count > 1 {
                        LabeledContent("Longueur totale du réseau", value: String(format: "%.1f m", GardenMeasurementTool.totalIrrigationLengthMeters(pipes)))
                            .font(.subheadline)
                    }
                    ForEach(pipes) { pipe in
                        Button {
                            engine.editingPipeID = pipe.id
                            dismiss()
                        } label: {
                            HStack {
                                Rectangle()
                                    .fill(pipe.lineType.color)
                                    .frame(width: 4, height: 28)
                                    .clipShape(Capsule())
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(pipe.lineType.label)
                                        .foregroundStyle(.primary)
                                    Text("\(pipe.material.label) Ø\(Int(pipe.diameterMM)) mm · \(String(format: "%.1f m", pipe.totalLengthMeters))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                            }
                        }
                    }
                    .onDelete { offsets in
                        for index in offsets {
                            engine.removePipe(pipes[index], context: modelContext)
                        }
                    }
                }
            }
            .navigationTitle("Réseau d'irrigation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        isPickingLineType = true
                    } label: {
                        Label("Ajouter tuyau", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $isPickingLineType) {
                NavigationStack {
                    List(PipeLineType.allCases) { lineType in
                        Button {
                            let pipe = engine.addPipe(lineType: lineType, context: modelContext)
                            engine.editingPipeID = pipe.id
                            isPickingLineType = false
                            dismiss()
                        } label: {
                            Label(lineType.label, systemImage: "line.diagonal")
                                .foregroundStyle(lineType.color)
                        }
                    }
                    .navigationTitle("Type de ligne")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Annuler") { isPickingLineType = false }
                        }
                    }
                }
                .presentationDetents([.medium])
            }
        }
    }
}
