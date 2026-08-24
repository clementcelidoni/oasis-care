import SwiftData
import SwiftUI

/// Spec Phase 7E.
struct BioreactorProgramListView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \BioreactorProgram.name) private var programs: [BioreactorProgram]

    @State private var isShowingNewProgram = false
    @State private var newProgramName = ""

    var body: some View {
        Group {
            if programs.isEmpty {
                EmptyStateView(
                    icon: "timer",
                    title: "Aucun programme",
                    message: "Créez un programme d'immersion/aération réutilisable et versionné."
                )
            } else {
                List(programs) { program in
                    NavigationLink {
                        BioreactorProgramDetailView(program: program)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(program.name).font(.headline)
                            if let version = program.latestVersion {
                                Text("Version \(version.versionNumber) · immersion \(version.immersionDurationSeconds / 60) min / \(version.immersionIntervalMinutes / 60) h")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle("Programmes")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { isShowingNewProgram = true } label: { Label("Ajouter", systemImage: "plus") }
            }
        }
        .alert("Nouveau programme", isPresented: $isShowingNewProgram) {
            TextField("Nom (ex. Multiplication A)", text: $newProgramName)
            Button("Créer") {
                guard !newProgramName.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                let program = BioreactorProgram(name: newProgramName)
                modelContext.insert(program)
                try? modelContext.save()
                newProgramName = ""
            }
            Button("Annuler", role: .cancel) { newProgramName = "" }
        }
    }
}

struct BioreactorProgramDetailView: View {
    var program: BioreactorProgram
    @State private var isShowingNewVersion = false

    private var sortedVersions: [BioreactorProgramVersion] {
        program.versions.sorted { $0.versionNumber > $1.versionNumber }
    }

    var body: some View {
        Form {
            Section("Versions") {
                if sortedVersions.isEmpty {
                    Text("Aucune version pour le moment.").foregroundStyle(.secondary)
                } else {
                    ForEach(sortedVersions) { version in
                        NavigationLink {
                            BioreactorProgramVersionDetailView(version: version)
                        } label: {
                            HStack {
                                Text("Version \(version.versionNumber)")
                                if version.id == program.latestVersion?.id {
                                    Text("actuelle").font(.caption2).foregroundStyle(.teal)
                                }
                            }
                        }
                    }
                }
                Button("Nouvelle version") { isShowingNewVersion = true }
            }
        }
        .navigationTitle(program.name)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isShowingNewVersion) {
            BioreactorProgramVersionFormView(program: program)
        }
    }
}

struct BioreactorProgramVersionDetailView: View {
    var version: BioreactorProgramVersion

    var body: some View {
        Form {
            Section("Immersion") {
                LabeledContent("Activée", value: version.immersionEnabled ? "Oui" : "Non")
                if version.immersionEnabled {
                    LabeledContent("Durée", value: "\(version.immersionDurationSeconds) s")
                    LabeledContent("Intervalle", value: "\(version.immersionIntervalMinutes) min")
                }
            }
            Section("Aération") {
                LabeledContent("Activée", value: version.aerationEnabled ? "Oui" : "Non")
                if version.aerationEnabled {
                    LabeledContent("Durée", value: "\(version.aerationDurationSeconds) s")
                    LabeledContent("Intervalle", value: "\(version.aerationIntervalMinutes) min")
                }
            }
            if let temp = version.targetTemperature {
                Section("Température") {
                    LabeledContent("Cible", value: "\(String(format: "%.1f", temp)) °C")
                }
            }
            Section {
                LabeledContent("Immersion max", value: "\(version.maxImmersionDurationSeconds) s")
                LabeledContent("Aération max", value: "\(version.maxAerationDurationSeconds) s")
            } header: {
                Text("Sécurités")
            } footer: {
                Text("Ces limites sont une sécurité logicielle qui n'agit que lorsque l'application est ouverte — voir la recommandation d'un contrôleur matériel local dans le rapport de phase.")
            }
            if !version.notes.isEmpty {
                Section("Notes") { Text(version.notes) }
            }
        }
        .navigationTitle("Version \(version.versionNumber)")
        .navigationBarTitleDisplayMode(.inline)
    }
}
