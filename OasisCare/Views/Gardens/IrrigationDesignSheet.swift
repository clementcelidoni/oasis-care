import SwiftData
import SwiftUI

/// Spec Phase 6D — "Concevoir l'arrosage : l'utilisateur sélectionne
/// une zone [already done, by reaching this sheet from that zone's row
/// in GardenAreasSheet]. Oasis AI reçoit forme/dimensions/type/
/// végétation/débit disponible si connu. Il peut PROPOSER nombre
/// d'asperseurs/positions/rayons/types. L'utilisateur doit confirmer."
/// Requires a real account, same reasoning as every other AI entry
/// point in this app (Phase 3D) — this call costs real money.
struct IrrigationDesignSheet: View {
    var zone: GardenArea
    @ObservedObject var engine: GardenMapEngine

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var authState = AuthState.shared

    @State private var flowRateText = ""
    @State private var isLoading = false
    @State private var proposal: IrrigationProposal?
    @State private var errorMessage: String?
    @State private var isSignInPresented = false

    var body: some View {
        NavigationStack {
            Group {
                if case .authenticated = authState.status {
                    form
                } else {
                    signInPrompt
                }
            }
            .navigationTitle("Concevoir l'arrosage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
            .sheet(isPresented: $isSignInPresented) {
                EmailSignInView()
            }
        }
    }

    private var form: some View {
        Form {
            Section("Zone sélectionnée") {
                LabeledContent("Type", value: zone.areaType.label)
                LabeledContent("Surface", value: String(format: "%.1f m²", zone.areaSquareMeters))
            }

            Section {
                HStack {
                    Text("Débit disponible")
                    Spacer()
                    TextField("optionnel", text: $flowRateText)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 80)
                    Text("L/h").foregroundStyle(.secondary)
                }
            } footer: {
                Text("Si vous ne connaissez pas votre débit, laissez ce champ vide — Oasis AI proposera des rayons usuels.")
            }

            if let errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }

            if let proposal {
                proposalSection(proposal)
            }

            Section {
                Button {
                    Task { await generateProposal() }
                } label: {
                    if isLoading {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text(proposal == nil ? "Générer une proposition" : "Régénérer")
                            .frame(maxWidth: .infinity)
                    }
                }
                .disabled(isLoading || zone.points.count < 3)
            }
        }
    }

    @ViewBuilder
    private func proposalSection(_ proposal: IrrigationProposal) -> some View {
        if proposal.canPropose, !proposal.sprinklers.isEmpty {
            Section("Proposition") {
                Text(proposal.summary).font(.subheadline.weight(.medium))
                Text(proposal.explanation).font(.caption).foregroundStyle(.secondary)
                ForEach(Array(proposal.sprinklers.enumerated()), id: \.offset) { _, sprinkler in
                    HStack {
                        Image(systemName: "sprinkler.fill").foregroundStyle(.blue)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(sprinkler.kind)
                            Text("Rayon \(String(format: "%.1f", sprinkler.radiusMeters)) m · \(Int(sprinkler.startAngleDegrees))°–\(Int(sprinkler.endAngleDegrees))°")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section {
                Button {
                    IrrigationAIService.createSprinklers(from: proposal, garden: engine.garden, engine: engine, context: modelContext)
                    dismiss()
                } label: {
                    Text("Créer ces \(proposal.sprinklers.count) asperseur\(proposal.sprinklers.count > 1 ? "s" : "")")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            } footer: {
                Text("Suggestion générée par IA, à vérifier sur place — ceci n'est pas une étude hydraulique professionnelle certifiée.")
            }
        } else {
            Section {
                Text(proposal.explanation).foregroundStyle(.secondary)
            }
        }
    }

    private var signInPrompt: some View {
        VStack(spacing: 16) {
            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Conception d'arrosage par IA")
                .font(.title3.weight(.semibold))
            Text("Connectez-vous pour utiliser l'assistant de conception d'arrosage. Vous pouvez continuer à dessiner votre plan sans compte pour tout le reste.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Button("Se connecter") { isSignInPresented = true }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func generateProposal() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            proposal = try await IrrigationAIService.propose(
                zone: zone, garden: engine.garden,
                availableFlowRateLitersPerHour: Double(flowRateText)
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
