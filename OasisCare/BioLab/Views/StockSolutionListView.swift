import SwiftData
import SwiftUI

/// Enhancement "SOLUTIONS STOCK."
struct StockSolutionListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \StockSolution.name) private var solutions: [StockSolution]
    @Query(sort: \LabCompound.name) private var compounds: [LabCompound]
    @State private var solutionSheet: SolutionSheet?
    @State private var solutionPendingDeletion: StockSolution?

    var body: some View {
        Group {
            if solutions.isEmpty {
                EmptyStateView(
                    icon: "eyedropper",
                    title: "Aucune solution stock",
                    message: "Préparez une solution stock concentrée pour qu'Oasis calcule automatiquement le volume à prélever dans vos recettes."
                )
            } else {
                List {
                    ForEach(solutions) { solution in
                        Button {
                            solutionSheet = .edit(solution)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(solution.name).foregroundStyle(.primary)
                                    Text("\(String(format: "%.2f", solution.concentration)) \(solution.concentrationUnit.label) · \(String(format: "%.0f mL", solution.remainingVolumeLiters * 1000)) restant")
                                        .font(.caption2)
                                        .foregroundStyle(solution.isExpired ? .red : .secondary)
                                }
                                Spacer()
                                if solution.isExpired {
                                    Text("Expirée").font(.caption2).foregroundStyle(.red)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                solutionPendingDeletion = solution
                            } label: {
                                Label("Supprimer", systemImage: "trash")
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Solutions stock")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { solutionSheet = .add } label: { Label("Ajouter", systemImage: "plus") }
            }
        }
        .sheet(item: $solutionSheet) { sheet in
            switch sheet {
            case .add: StockSolutionFormView(solution: nil, compounds: compounds)
            case .edit(let solution): StockSolutionFormView(solution: solution, compounds: compounds)
            }
        }
        .confirmationDialog(
            "Supprimer \(solutionPendingDeletion?.name ?? "cette solution") ?",
            isPresented: Binding(get: { solutionPendingDeletion != nil }, set: { if !$0 { solutionPendingDeletion = nil } }),
            titleVisibility: .visible
        ) {
            Button("Supprimer", role: .destructive) {
                if let solutionPendingDeletion { DeletionService.delete(solutionPendingDeletion, in: modelContext) }
                solutionPendingDeletion = nil
            }
            Button("Annuler", role: .cancel) { solutionPendingDeletion = nil }
        } message: {
            Text("Cette action est irréversible.")
        }
    }
}

private enum SolutionSheet: Identifiable {
    case add
    case edit(StockSolution)

    var id: String {
        switch self {
        case .add: return "add"
        case .edit(let solution): return solution.id.uuidString
        }
    }
}

struct StockSolutionFormView: View {
    var solution: StockSolution?
    var compounds: [LabCompound]

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var compound: LabCompound?
    @State private var concentrationText = ""
    @State private var concentrationUnit: ConcentrationUnit = .milligramsPerLiter
    @State private var preparedVolumeText = "0.1"
    @State private var storageLocation = ""
    @State private var lotNumber = ""
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nom (ex. BAP stock)", text: $name)
                    Picker("Composé (optionnel)", selection: $compound) {
                        Text("Aucun").tag(LabCompound?.none)
                        ForEach(compounds) { compound in
                            Text(compound.name).tag(Optional(compound))
                        }
                    }
                }
                Section("Concentration") {
                    HStack {
                        TextField("Valeur", text: $concentrationText)
                            .keyboardType(.decimalPad)
                        Picker("Unité", selection: $concentrationUnit) {
                            ForEach(ConcentrationUnit.allCases) { unit in
                                Text(unit.label).tag(unit)
                            }
                        }
                        .pickerStyle(.menu)
                    }
                    HStack {
                        Text("Volume préparé")
                        Spacer()
                        TextField("", text: $preparedVolumeText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 70)
                        Text("L").foregroundStyle(.secondary)
                    }
                }
                Section {
                    TextField("Emplacement (optionnel)", text: $storageLocation)
                    TextField("N° de lot (optionnel)", text: $lotNumber)
                }
                Section("Notes") {
                    TextField("Notes (optionnel)", text: $notes, axis: .vertical)
                        .lineLimit(2...4)
                }
            }
            .navigationTitle(solution == nil ? "Nouvelle solution stock" : "Modifier la solution")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || Double(concentrationText.replacingOccurrences(of: ",", with: ".")) == nil)
                }
            }
            .onAppear(perform: loadExisting)
        }
    }

    private func loadExisting() {
        guard let solution else { return }
        name = solution.name
        compound = solution.compound
        concentrationText = String(solution.concentration)
        concentrationUnit = solution.concentrationUnit
        preparedVolumeText = String(solution.preparedVolumeLiters)
        storageLocation = solution.storageLocation
        lotNumber = solution.lotNumber ?? ""
        notes = solution.notes
    }

    private func save() {
        let concentration = Double(concentrationText.replacingOccurrences(of: ",", with: ".")) ?? 0
        let preparedVolume = Double(preparedVolumeText.replacingOccurrences(of: ",", with: ".")) ?? 0
        if let solution {
            solution.name = name
            solution.compound = compound
            solution.concentration = concentration
            solution.concentrationUnit = concentrationUnit
            solution.storageLocation = storageLocation
            solution.lotNumber = lotNumber.isEmpty ? nil : lotNumber
            solution.notes = notes
            solution.markDirty()
        } else {
            let newSolution = StockSolution(
                compound: compound, name: name, concentration: concentration, concentrationUnit: concentrationUnit,
                preparedVolumeLiters: preparedVolume, storageLocation: storageLocation,
                lotNumber: lotNumber.isEmpty ? nil : lotNumber, notes: notes
            )
            modelContext.insert(newSolution)
        }
        try? modelContext.save()
        dismiss()
    }
}
