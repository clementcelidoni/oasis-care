import SwiftUI
import SwiftData

struct GardenFormView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    var garden: Garden?

    @State private var name: String
    @State private var address: String
    @State private var notes: String

    init(garden: Garden?) {
        self.garden = garden
        _name = State(initialValue: garden?.name ?? "")
        _address = State(initialValue: garden?.address ?? "")
        _notes = State(initialValue: garden?.notes ?? "")
    }

    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Identité") {
                    TextField("Nom du jardin", text: $name)
                    TextField("Adresse (facultatif)", text: $address)
                }
                Section("Notes") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle(garden == nil ? "Nouveau jardin" : "Modifier")
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

        if let garden {
            garden.name = trimmedName
            garden.address = address.isEmpty ? nil : address
            garden.notes = notes
            garden.markDirty()
        } else {
            let newGarden = Garden(name: trimmedName, address: address.isEmpty ? nil : address, notes: notes)
            modelContext.insert(newGarden)
        }

        dismiss()
    }
}
