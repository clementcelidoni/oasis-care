import SwiftUI

/// Spec Phase 6C — the object palette. Picking a type doesn't place
/// anything itself; it arms GardenMapEngine.placingObjectType so the
/// next tap on the plan places it there (see OasisPlanView's tap
/// dispatch), the same "pick a tool, then act on the canvas" model the
/// boundary editor already uses for points.
struct GardenObjectPickerSheet: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.dismiss) private var dismiss

    private let columns = [GridItem(.adaptive(minimum: 84), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(GardenObjectType.allCases) { type in
                        Button {
                            engine.placingObjectType = type
                            dismiss()
                        } label: {
                            VStack(spacing: 6) {
                                Image(systemName: type.icon)
                                    .font(.title2)
                                    .frame(width: 44, height: 44)
                                    .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                Text(type.label)
                                    .font(.caption2)
                                    .multilineTextAlignment(.center)
                                    .lineLimit(2)
                            }
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.primary)
                    }
                }
                .padding()
            }
            .navigationTitle("Ajouter un objet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
