import SwiftData
import SwiftUI

/// Spec Phase 7C.
struct MediumRecipeDetailView: View {
    var recipe: MediumRecipe
    @Environment(\.modelContext) private var modelContext
    @Query private var allBatches: [CultureBatch]
    @Query private var allAcclimatizationBatches: [AcclimatizationBatch]

    @State private var isShowingNewVersion = false
    @State private var isShowingComparison = false
    @State private var versionPendingDeletion: MediumRecipeVersion?

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
                                if let parent = version.parentVersion {
                                    Text("Basée sur V\(parent.versionNumber)")
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                versionPendingDeletion = version
                            } label: {
                                Label("Supprimer", systemImage: "trash")
                            }
                        }
                    }
                }
                Button("Nouvelle version") { isShowingNewVersion = true }
                if sortedVersions.count > 1 {
                    Button("Comparer les versions") { isShowingComparison = true }
                }
            }
        }
        .navigationTitle(recipe.name)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isShowingNewVersion) {
            MediumRecipeVersionFormView(recipe: recipe)
        }
        .sheet(isPresented: $isShowingComparison) {
            RecipeVersionComparisonSheet(versions: sortedVersions, batches: allBatches, acclimatizationBatches: allAcclimatizationBatches)
        }
        .confirmationDialog(
            "Supprimer la version \(versionPendingDeletion?.versionNumber.description ?? "") ?",
            isPresented: Binding(get: { versionPendingDeletion != nil }, set: { if !$0 { versionPendingDeletion = nil } }),
            titleVisibility: .visible
        ) {
            Button("Supprimer", role: .destructive) {
                if let versionPendingDeletion { DeletionService.delete(versionPendingDeletion, in: modelContext) }
                versionPendingDeletion = nil
            }
            Button("Annuler", role: .cancel) { versionPendingDeletion = nil }
        } message: {
            Text("Les lots et préparations qui utilisaient cette version perdront cette référence. Cette action est irréversible.")
        }
    }
}

struct MediumRecipeVersionDetailView: View {
    var version: MediumRecipeVersion
    @Environment(\.modelContext) private var modelContext
    @Query private var allBatches: [CultureBatch]
    @Query private var allAcclimatizationBatches: [AcclimatizationBatch]
    @State private var isShowingQR = false
    @State private var isShowingNFC = false
    @State private var isShowingGuidedPreparation = false

    private var subjectName: String {
        "\(version.recipe?.name ?? "Recette") V\(version.versionNumber)"
    }

    private var performance: RecipeVersionPerformance? {
        BioLabKnowledgeEngine.performance(for: [version], batches: allBatches, acclimatizationBatches: allAcclimatizationBatches).first
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Version", value: "\(version.versionNumber)")
                LabeledContent("pH cible", value: String(format: "%.2f", version.targetPH))
                if let measuredPH = version.measuredPH {
                    LabeledContent("pH mesuré", value: String(format: "%.2f", measuredPH))
                }
                LabeledContent("Créée le", value: DateFormatting.shortDate(version.createdAt))
                if let parent = version.parentVersion {
                    LabeledContent("Basée sur", value: "Version \(parent.versionNumber)")
                }
                if !version.changeReason.isEmpty {
                    LabeledContent("Raison du changement", value: version.changeReason)
                }
            }

            if let performance {
                Section {
                    LabeledContent("Multiplication moyenne", value: performance.averageMultiplicationRate.map { "x\(String(format: "%.1f", $0))" } ?? "Non disponible")
                    LabeledContent("Contamination", value: percentText(performance.contaminationRate))
                    LabeledContent("Hyperhydricité", value: percentText(performance.hyperhydricityRate))
                    LabeledContent("Enracinement", value: percentText(performance.rootingRate))
                    LabeledContent("Survie acclimatation", value: percentText(performance.survivalRate))
                } header: {
                    Text("Performances")
                } footer: {
                    Text("Basé sur \(performance.batchCount) lot(s) de ce laboratoire.")
                }
            }

            Section {
                SmartTagSectionView(
                    subjectName: subjectName, existingTags: version.smartTags,
                    onShowQR: { isShowingQR = true }, onAssociateNFC: { isShowingNFC = true }
                )
            } footer: {
                Text("L'étiquette imprimée pointe vers cette version exacte — elle ne changera jamais, même si la recette évolue plus tard.")
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

            Section {
                Button("Préparer ce milieu") { isShowingGuidedPreparation = true }
            }
        }
        .navigationTitle("Version \(version.versionNumber)")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isShowingQR) {
            QRCodeSheet(subjectName: subjectName, tag: SmartTagService.tag(for: version, type: .qr, in: modelContext))
        }
        .sheet(isPresented: $isShowingNFC) {
            NFCAssociationSheet(
                subjectName: subjectName, subjectID: version.id, existingTags: version.smartTags,
                createTag: { context in SmartTagService.tag(for: version, type: .nfc, in: context) },
                reassignTag: { tag, context in SmartTagService.reassign(tag, to: version, in: context) }
            )
        }
        .sheet(isPresented: $isShowingGuidedPreparation) {
            GuidedMediaPreparationView(version: version)
        }
    }

    private func formattedAmount(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0 ? String(format: "%.0f", value) : String(format: "%.2f", value)
    }

    private func percentText(_ value: Double?) -> String {
        guard let value else { return "Non disponible" }
        return "\(String(format: "%.0f", value * 100)) %"
    }
}
