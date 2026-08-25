import SwiftData
import SwiftUI

/// Enhancement "BIBLIOTHÈQUE DE COMPOSÉS." A compound with no entry
/// here is never a blocker elsewhere — every recipe ingredient stays
/// free-text-first, `compoundId` is only set when the user explicitly
/// picks from this catalog (see MediumComponentAmount's own comment).
struct LabCompoundListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \LabCompound.name) private var compounds: [LabCompound]
    @State private var compoundSheet: CompoundSheet?
    @State private var compoundPendingDeletion: LabCompound?
    @State private var showHidden = false

    private var visibleCompounds: [LabCompound] {
        showHidden ? compounds : compounds.filter { !$0.isHidden }
    }

    var body: some View {
        Group {
            if compounds.isEmpty {
                EmptyStateView(
                    icon: "atom",
                    title: "Aucun composé",
                    message: "Ajoutez les composés que vous utilisez régulièrement pour les retrouver dans vos recettes et suivre leur coût."
                )
            } else {
                List {
                    ForEach(LabCompoundCategory.allCases) { category in
                        let categoryCompounds = visibleCompounds.filter { $0.category == category }
                        if !categoryCompounds.isEmpty {
                            Section(category.label) {
                                ForEach(categoryCompounds) { compound in
                                    row(for: compound)
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Composés")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { compoundSheet = .add } label: { Label("Ajouter", systemImage: "plus") }
            }
            ToolbarItem(placement: .topBarLeading) {
                Button(showHidden ? "Masquer archivés" : "Voir masqués") { showHidden.toggle() }
                    .font(.caption)
            }
        }
        .sheet(item: $compoundSheet) { sheet in
            switch sheet {
            case .add: LabCompoundFormView(compound: nil)
            case .edit(let compound): LabCompoundFormView(compound: compound)
            }
        }
        .confirmationDialog(
            "Supprimer \(compoundPendingDeletion?.name ?? "ce composé") ?",
            isPresented: Binding(get: { compoundPendingDeletion != nil }, set: { if !$0 { compoundPendingDeletion = nil } }),
            titleVisibility: .visible
        ) {
            Button("Supprimer", role: .destructive) {
                if let compoundPendingDeletion { DeletionService.delete(compoundPendingDeletion, in: modelContext) }
                compoundPendingDeletion = nil
            }
            Button("Annuler", role: .cancel) { compoundPendingDeletion = nil }
        } message: {
            Text("Si ce composé est référencé par des recettes existantes, préférez le masquer du catalogue plutôt que le supprimer. Cette action est irréversible.")
        }
    }

    private func row(for compound: LabCompound) -> some View {
        Button {
            compoundSheet = .edit(compound)
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(compound.name).foregroundStyle(compound.isHidden ? .secondary : .primary)
                    if !compound.shortName.isEmpty {
                        Text(compound.shortName).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if compound.isHidden {
                    Text("Masqué").font(.caption2).foregroundStyle(.orange)
                }
            }
        }
        .buttonStyle(.plain)
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                compoundPendingDeletion = compound
            } label: {
                Label("Supprimer", systemImage: "trash")
            }
            Button {
                compound.isHidden.toggle()
                compound.markDirty()
            } label: {
                Label(compound.isHidden ? "Réafficher" : "Masquer", systemImage: compound.isHidden ? "eye" : "eye.slash")
            }
            .tint(.orange)
        }
    }
}

private enum CompoundSheet: Identifiable {
    case add
    case edit(LabCompound)

    var id: String {
        switch self {
        case .add: return "add"
        case .edit(let compound): return compound.id.uuidString
        }
    }
}

struct LabCompoundFormView: View {
    var compound: LabCompound?

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var shortName = ""
    @State private var category: LabCompoundCategory = .other
    @State private var molecularWeightText = ""
    @State private var defaultUnit: ConcentrationUnit = .gramsPerLiter
    @State private var supplier = ""
    @State private var catalogNumber = ""
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nom (ex. Benzylaminopurine)", text: $name)
                    TextField("Nom court (ex. BAP)", text: $shortName)
                    Picker("Catégorie", selection: $category) {
                        ForEach(LabCompoundCategory.allCases) { category in
                            Text(category.label).tag(category)
                        }
                    }
                }
                Section {
                    HStack {
                        Text("Masse molaire")
                        Spacer()
                        TextField("optionnel", text: $molecularWeightText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 90)
                        Text("g/mol").foregroundStyle(.secondary)
                    }
                    Picker("Unité par défaut", selection: $defaultUnit) {
                        ForEach(ConcentrationUnit.allCases) { unit in
                            Text(unit.label).tag(unit)
                        }
                    }
                } footer: {
                    Text("La masse molaire n'est nécessaire que pour convertir une concentration en µM/mM/M vers une masse à peser.")
                }
                Section("Fournisseur") {
                    TextField("Fournisseur (optionnel)", text: $supplier)
                    TextField("Référence catalogue (optionnel)", text: $catalogNumber)
                }
                Section("Notes") {
                    TextField("Notes (optionnel)", text: $notes, axis: .vertical)
                        .lineLimit(2...4)
                }
            }
            .navigationTitle(compound == nil ? "Nouveau composé" : "Modifier le composé")
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
            .onAppear(perform: loadExisting)
        }
    }

    private func loadExisting() {
        guard let compound else { return }
        name = compound.name
        shortName = compound.shortName
        category = compound.category
        molecularWeightText = compound.molecularWeight.map { String($0) } ?? ""
        defaultUnit = compound.defaultUnit
        supplier = compound.supplier ?? ""
        catalogNumber = compound.catalogNumber ?? ""
        notes = compound.notes
    }

    private func save() {
        let molecularWeight = Double(molecularWeightText.replacingOccurrences(of: ",", with: "."))
        if let compound {
            compound.name = name
            compound.shortName = shortName
            compound.category = category
            compound.molecularWeight = molecularWeight
            compound.defaultUnit = defaultUnit
            compound.supplier = supplier.isEmpty ? nil : supplier
            compound.catalogNumber = catalogNumber.isEmpty ? nil : catalogNumber
            compound.notes = notes
            compound.markDirty()
        } else {
            let newCompound = LabCompound(
                name: name, shortName: shortName, category: category, molecularWeight: molecularWeight,
                defaultUnit: defaultUnit, supplier: supplier.isEmpty ? nil : supplier,
                catalogNumber: catalogNumber.isEmpty ? nil : catalogNumber, notes: notes
            )
            modelContext.insert(newCompound)
        }
        try? modelContext.save()
        dismiss()
    }
}
