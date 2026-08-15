import SwiftUI
import SwiftData

struct AddCareEventSheet: View {
    var plant: Plant

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var type: CareEventType = .inspection
    @State private var date = Date.now
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $type) {
                        ForEach(CareEventType.allCases) { type in
                            Label(type.displayName, systemImage: type.icon).tag(type)
                        }
                    }
                    DatePicker("Date", selection: $date, displayedComponents: [.date])
                }

                Section("Notes") {
                    TextField("Notes (facultatif)", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle("Ajouter une intervention")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                }
            }
        }
    }

    private func save() {
        CareScheduleEngine.recordCare(type, for: plant, on: date, notes: notes, in: modelContext)
        dismiss()
    }
}
