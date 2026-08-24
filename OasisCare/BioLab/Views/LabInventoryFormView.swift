import SwiftData
import SwiftUI

struct LabInventoryFormView: View {
    var item: LabInventoryItem?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var category: LabInventoryCategory
    @State private var currentQuantity: String
    @State private var minimumThreshold: String
    @State private var unit: String
    @State private var supplier: String
    @State private var lotNumber: String
    @State private var hasExpiryDate: Bool
    @State private var expiryDate: Date
    @State private var notes: String

    init(item: LabInventoryItem?) {
        self.item = item
        _name = State(initialValue: item?.name ?? "")
        _category = State(initialValue: item?.category ?? .consumables)
        _currentQuantity = State(initialValue: item.map { String($0.currentQuantity) } ?? "")
        _minimumThreshold = State(initialValue: item?.minimumThreshold.map { String($0) } ?? "")
        _unit = State(initialValue: item?.unit ?? "")
        _supplier = State(initialValue: item?.supplier ?? "")
        _lotNumber = State(initialValue: item?.lotNumber ?? "")
        _hasExpiryDate = State(initialValue: item?.expiryDate != nil)
        _expiryDate = State(initialValue: item?.expiryDate ?? .now)
        _notes = State(initialValue: item?.notes ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nom", text: $name)
                    Picker("Catégorie", selection: $category) {
                        ForEach(LabInventoryCategory.allCases) { category in
                            Text(category.label).tag(category)
                        }
                    }
                }

                Section {
                    HStack {
                        Text("Quantité actuelle")
                        Spacer()
                        TextField("0", text: $currentQuantity)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                    }
                    TextField("Unité (ex. pièces, mL)", text: $unit)
                    HStack {
                        Text("Seuil minimum")
                        Spacer()
                        TextField("Facultatif", text: $minimumThreshold)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 80)
                    }
                } footer: {
                    Text("Un seuil défini fait apparaître l'article dans « Stock bas » dès que la quantité l'atteint ou passe en dessous.")
                }

                Section {
                    TextField("Fournisseur (facultatif)", text: $supplier)
                    TextField("Numéro de lot (facultatif)", text: $lotNumber)
                    Toggle("Date de péremption", isOn: $hasExpiryDate)
                    if hasExpiryDate {
                        DatePicker("Péremption", selection: $expiryDate, displayedComponents: .date)
                    }
                } header: {
                    Text("Lot produit")
                } footer: {
                    Text("Pour les composants importants, à renseigner si vous le souhaitez.")
                }

                Section("Notes") {
                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }

                if item != nil {
                    Section {
                        Button("Supprimer cet article", role: .destructive) { deleteItem() }
                    }
                }
            }
            .navigationTitle(item == nil ? "Nouvel article" : "Modifier l'article")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func save() {
        let quantity = Int(currentQuantity) ?? 0
        let threshold = Int(minimumThreshold)
        let resolvedExpiryDate = hasExpiryDate ? expiryDate : nil
        let resolvedSupplier = supplier.isEmpty ? nil : supplier
        let resolvedLotNumber = lotNumber.isEmpty ? nil : lotNumber

        if let item {
            item.name = name
            item.category = category
            item.currentQuantity = quantity
            item.minimumThreshold = threshold
            item.unit = unit
            item.supplier = resolvedSupplier
            item.lotNumber = resolvedLotNumber
            item.expiryDate = resolvedExpiryDate
            item.notes = notes
            item.markDirty()
        } else {
            let newItem = LabInventoryItem(
                name: name, category: category, currentQuantity: quantity, minimumThreshold: threshold,
                unit: unit, supplier: resolvedSupplier, lotNumber: resolvedLotNumber, expiryDate: resolvedExpiryDate, notes: notes
            )
            modelContext.insert(newItem)
        }
        try? modelContext.save()
        dismiss()
    }

    private func deleteItem() {
        guard let item else { return }
        DeletionService.delete(item, in: modelContext)
        try? modelContext.save()
        dismiss()
    }
}
