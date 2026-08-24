import SwiftData
import SwiftUI

/// Spec Phase 7C.
struct MediumRecipeDetailView: View {
    var recipe: MediumRecipe
    @Environment(\.modelContext) private var modelContext

    @State private var isShowingNewVersion = false

    private var sortedVersions: [MediumRecipeVersion] {
        recipe.versions.sorted { $0.versionNumber > $1.versionNumber }
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Nom", value: recipe.name)
                if !recipe.speciesName.isEmpty {
                    LabeledContent("Espèce", value: recipe.speciesName)
                }
            }

            Section("Versions") {
                if sortedVersions.isEmpty {
                    Text("Aucune version pour le moment.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(sortedVersions) { version in
                        NavigationLink {
                            MediumRecipeVersionDetailView(version: version)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text("Version \(version.versionNumber)").font(.headline)
                                    if version.id == recipe.latestVersion?.id {
                                        Text("actuelle").font(.caption2).foregroundStyle(.teal)
                                    }
                                }
                                Text("pH cible \(String(format: "%.2f", version.targetPH)) · \(version.components.count) composant\(version.components.count > 1 ? "s" : "")")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Button("Nouvelle version") { isShowingNewVersion = true }
            }
        }
        .navigationTitle(recipe.name)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isShowingNewVersion) {
            MediumRecipeVersionFormView(recipe: recipe)
        }
    }
}

struct MediumRecipeVersionDetailView: View {
    var version: MediumRecipeVersion

    var body: some View {
        Form {
            Section {
                LabeledContent("Version", value: "\(version.versionNumber)")
                LabeledContent("pH cible", value: String(format: "%.2f", version.targetPH))
                if let measuredPH = version.measuredPH {
                    LabeledContent("pH mesuré", value: String(format: "%.2f", measuredPH))
                }
                LabeledContent("Créée le", value: DateFormatting.shortDate(version.createdAt))
            }

            Section("Composants") {
                ForEach(version.components) { component in
                    HStack {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(component.name).fontWeight(.medium)
                            Text(component.type.label).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("\(formattedAmount(component.amount)) \(component.unit.label)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !version.notes.isEmpty {
                Section("Notes") {
                    Text(version.notes)
                }
            }
        }
        .navigationTitle("Version \(version.versionNumber)")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func formattedAmount(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0 ? String(format: "%.0f", value) : String(format: "%.2f", value)
    }
}
