import SwiftUI
import SwiftData

struct GardenZoneFormView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    var garden: Garden
    var zone: GardenZone?

    @State private var name: String
    @State private var notes: String

    init(garden: Garden, zone: GardenZone?) {
        self.garden = garden
        self.zone = zone
        _name = State(initialValue: zone?.name ?? "")
        _notes = State(initialValue: zone?.notes ?? "")
    }

    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Identité") {
                    TextField("Nom de la zone", text: $name)
                }
                Section("Notes") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle(zone == nil ? "Nouvelle zone" : "Modifier")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(!isValid)
                }
            }
        }
    }

    private func save() {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)

        if let zone {
            zone.name = trimmedName
            zone.notes = notes
        } else {
            let newZone = GardenZone(name: trimmedName, notes: notes, garden: garden)
            modelContext.insert(newZone)
            garden.zones.append(newZone)
        }

        dismiss()
    }
}
