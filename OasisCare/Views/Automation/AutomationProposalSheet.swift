import SwiftUI
import SwiftData

/// Spec §71 — "Créer cette automatisation ? SI humidité sol < 25 % ET
/// pluie prévue < 5 mm ALORS arroser 8 min." The user describes a goal
/// in French, Oasis AI proposes a structured rule scoped to what's
/// actually available, and nothing is created until they explicitly tap
/// "Créer cette automatisation" below — which still creates it disabled
/// (AutomationAIService.createRule), matching every other automation
/// created in this app.
struct AutomationProposalSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Garden.name) private var gardens: [Garden]

    @State private var goal = ""
    @State private var scopeGarden: Garden?
    @State private var scopeZone: GardenZone?
    @State private var scopePlant: Plant?
    @State private var isLoading = false
    @State private var proposal: AutomationProposal?
    @State private var errorMessage: String?
    @State private var createdRule: AutomationRule?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Ex. Arroser le potager quand le sol est sec et qu'il ne va pas pleuvoir", text: $goal, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Décrivez ce que vous voulez automatiser")
                } footer: {
                    Text("Oasis AI propose une règle à partir des capteurs et équipements réellement présents dans la portée choisie — vous décidez ensuite de la créer ou non.")
                }

                Section("Portée") {
                    Picker("Jardin", selection: $scopeGarden) {
                        Text("Aucun").tag(Garden?.none)
                        ForEach(gardens) { garden in Text(garden.name).tag(Garden?.some(garden)) }
                    }
                    if let scopeGarden {
                        Picker("Zone", selection: $scopeZone) {
                            Text("Aucune").tag(GardenZone?.none)
                            ForEach(scopeGarden.zones) { zone in Text(zone.name).tag(GardenZone?.some(zone)) }
                        }
                        Picker("Végétal", selection: $scopePlant) {
                            Text("Aucun").tag(Plant?.none)
                            ForEach(scopeGarden.plants) { plant in Text(plant.customName).tag(Plant?.some(plant)) }
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                if let proposal {
                    proposalSection(proposal)
                }

                if let createdRule {
                    Section {
                        Label("Règle créée, désactivée : \(createdRule.name)", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        Text("Activez-la depuis Automatisations quand vous êtes prêt.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Proposer avec Oasis AI")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await requestProposal() }
                    } label: {
                        if isLoading { ProgressView() } else { Text("Proposer") }
                    }
                    .disabled(isLoading || goal.trimmingCharacters(in: .whitespaces).isEmpty || createdRule != nil)
                }
            }
        }
    }

    @ViewBuilder
    private func proposalSection(_ proposal: AutomationProposal) -> some View {
        if proposal.canPropose {
            Section {
                Text(proposal.summary)
                    .font(.subheadline.weight(.medium))
                if createdRule == nil {
                    Button("Créer cette automatisation (désactivée)") { create(proposal) }
                        .buttonStyle(.borderedProminent)
                }
            } header: {
                Text("Proposition")
            } footer: {
                Text("La règle sera créée désactivée, en mode manuel — elle ne se déclenchera jamais tant que vous ne l'avez pas activée vous-même.")
            }
        } else {
            Section("Proposition impossible") {
                Text(proposal.explanation)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func requestProposal() async {
        errorMessage = nil
        proposal = nil
        createdRule = nil
        isLoading = true
        defer { isLoading = false }
        do {
            proposal = try await AutomationAIService.propose(goal: goal, garden: scopeGarden, zone: scopeZone, plant: scopePlant)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func create(_ proposal: AutomationProposal) {
        do {
            createdRule = try AutomationAIService.createRule(
                from: proposal, garden: scopeGarden, zone: scopeZone, plant: scopePlant, context: modelContext
            )
            Haptics.success()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
