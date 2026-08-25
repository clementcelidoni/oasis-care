import SwiftData
import SwiftUI

/// Spec Phase 7D.
struct BioreactorListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Bioreactor.code) private var bioreactors: [Bioreactor]

    @State private var isShowingNew = false
    @State private var bioreactorPendingDeletion: Bioreactor?

    var body: some View {
        Group {
            if bioreactors.isEmpty {
                EmptyStateView(
                    icon: "testtube.2",
                    title: "Aucun bioréacteur",
                    message: "Ajoutez votre premier bioréacteur pour commencer à lui affecter des lots."
                )
            } else {
                List {
                    ForEach(bioreactors) { bioreactor in
                        NavigationLink {
                            BioreactorDetailView(bioreactor: bioreactor)
                        } label: {
                            BioreactorRow(bioreactor: bioreactor)
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                bioreactorPendingDeletion = bioreactor
                            } label: {
                                Label("Supprimer", systemImage: "trash")
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Bioréacteurs")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { isShowingNew = true } label: { Label("Ajouter", systemImage: "plus") }
            }
        }
        .sheet(isPresented: $isShowingNew) {
            BioreactorFormView()
        }
        .confirmationDialog(
            "Supprimer \(bioreactorPendingDeletion?.code ?? "ce bioréacteur") ?",
            isPresented: Binding(get: { bioreactorPendingDeletion != nil }, set: { if !$0 { bioreactorPendingDeletion = nil } }),
            titleVisibility: .visible
        ) {
            Button("Supprimer", role: .destructive) {
                if let bioreactorPendingDeletion { DeletionService.delete(bioreactorPendingDeletion, in: modelContext) }
                bioreactorPendingDeletion = nil
            }
            Button("Annuler", role: .cancel) { bioreactorPendingDeletion = nil }
        } message: {
            Text("L'historique de maintenance, les capteurs et les étiquettes associés seront aussi supprimés. Les lots qui y étaient affectés seront conservés, sans bioréacteur associé. Cette action est irréversible.")
        }
    }
}

private struct BioreactorRow: View {
    var bioreactor: Bioreactor

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: bioreactor.status.icon)
                .font(.title3)
                .foregroundStyle(bioreactor.status.color)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(bioreactor.code) — \(bioreactor.name)").font(.headline)
                Text("\(bioreactor.bioreactorType.label) · \(bioreactor.status.label)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let batch = bioreactor.currentBatch {
                Text(batch.batchCode)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.teal.opacity(0.15), in: Capsule())
                    .foregroundStyle(.teal)
            }
        }
        .padding(.vertical, 2)
    }
}

struct BioreactorFormView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var code = ""
    @State private var bioreactorType: BioreactorType = .temporaryImmersionTwinVessel
    @State private var totalVolumeText = "1"
    @State private var workingVolumeText = "0.5"
    @State private var location = ""
    @State private var selectedComponents: Set<BioreactorComponentType> = []

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Code (ex. BR04)", text: $code)
                    TextField("Nom", text: $name)
                    Picker("Type", selection: $bioreactorType) {
                        ForEach(BioreactorType.allCases) { type in
                            Text(type.label).tag(type)
                        }
                    }
                    TextField("Emplacement (optionnel)", text: $location)
                }

                Section("Volumes") {
                    HStack {
                        Text("Volume total")
                        Spacer()
                        TextField("", text: $totalVolumeText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 60)
                        Text("L").foregroundStyle(.secondary)
                    }
                    HStack {
                        Text("Volume utile")
                        Spacer()
                        TextField("", text: $workingVolumeText)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 60)
                        Text("L").foregroundStyle(.secondary)
                    }
                }

                Section {
                    ForEach(BioreactorComponentType.allCases) { component in
                        Toggle(isOn: Binding(
                            get: { selectedComponents.contains(component) },
                            set: { isOn in
                                if isOn { selectedComponents.insert(component) } else { selectedComponents.remove(component) }
                            }
                        )) {
                            Label(component.label, systemImage: component.icon)
                        }
                    }
                } header: {
                    Text("Composants")
                } footer: {
                    Text("Cochez uniquement les éléments physiquement présents sur ce système.")
                }
            }
            .navigationTitle("Nouveau bioréacteur")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Créer") { createBioreactor() }
                        .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func createBioreactor() {
        let total = Double(totalVolumeText.replacingOccurrences(of: ",", with: ".")) ?? 1
        let working = Double(workingVolumeText.replacingOccurrences(of: ",", with: ".")) ?? total
        let bioreactor = Bioreactor(
            name: name, code: code, bioreactorType: bioreactorType, totalVolumeLiters: total, workingVolumeLiters: working,
            componentTypes: Array(selectedComponents), location: location
        )
        modelContext.insert(bioreactor)
        try? modelContext.save()
        dismiss()
    }
}
