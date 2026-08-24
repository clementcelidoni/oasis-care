import SwiftData
import SwiftUI

/// Spec Phase 7N "DIGITAL TWIN DU LAB" — "réutiliser le moteur Digital
/// Twin Phase 6 si possible."
///
/// Deliberately NOT built on GardenMapEngine/OasisPlanView: that engine
/// (~2300 lines across both files) exists to support a garden's
/// arbitrary, user-drawn, free-form shape — pan/zoom camera, satellite
/// imagery, 23 catalogued object types, free positioning. A lab floor
/// plan is the opposite: spec's own mockup is a small, fixed grid (a
/// hood, six bioreactors, an incubator, an acclimatization zone) that
/// never needs panning, zooming, or a coordinate system at all. Forcing
/// that engine onto a fixed grid would be the same mistake as building
/// a database migration system for a config file. What genuinely is
/// reused: the exact same "couleur + symbole, jamais la couleur seule"
/// rule (BioreactorStatus.icon/.color already exist for this from Phase
/// 7D) and the exact same "tap opens the real fiche" idea
/// GardenMapObject's own linkedEntity pattern established.
///
/// Only bioreactors and the acclimatization zone are real, clickable
/// Oasis objects — no Incubator/Hood model exists anywhere in this
/// app (nothing in Phases 7A-7M ever asked to create one), so those two
/// render as plain labeled zones for the mockup's spatial layout rather
/// than inventing an entity and fake live data to back them.
struct LabDigitalTwinView: View {
    @Query private var bioreactors: [Bioreactor]
    @Query private var acclimatizationBatches: [AcclimatizationBatch]
    @State private var isShowingAcclimatization = false

    private var sortedBioreactors: [Bioreactor] {
        bioreactors.sorted { $0.code < $1.code }
    }
    private var activeAcclimatizationBatches: [AcclimatizationBatch] {
        acclimatizationBatches.filter { $0.status == .active }
    }
    private var totalAcclimatizingCount: Int {
        activeAcclimatizationBatches.reduce(0) { $0 + $1.currentSurvivorCount }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Text("LAB OASIS")
                    .font(.title2.weight(.bold))

                zoneLabel("Hotte", icon: "wind.circle")

                if bioreactors.isEmpty {
                    Text("Aucun bioréacteur enregistré.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .padding()
                } else {
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        ForEach(sortedBioreactors) { bioreactor in
                            NavigationLink {
                                BioreactorDetailView(bioreactor: bioreactor)
                            } label: {
                                bioreactorTile(bioreactor)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                HStack(spacing: 12) {
                    zoneLabel("Incubateur", icon: "thermometer.medium")
                    Button {
                        isShowingAcclimatization = true
                    } label: {
                        VStack(spacing: 6) {
                            Image(systemName: "sun.max.fill")
                                .font(.title2)
                                .foregroundStyle(.orange)
                            Text("Acclimatation")
                                .font(.caption.weight(.medium))
                            Text("\(totalAcclimatizingCount) plante(s)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }

                Text("Seuls les bioréacteurs et la zone d'acclimatation sont reliés à de vraies données — la hotte et l'incubateur sont affichés pour le plan uniquement.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            .padding()
        }
        .navigationTitle("Plan du laboratoire")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $isShowingAcclimatization) {
            NavigationStack {
                List {
                    if activeAcclimatizationBatches.isEmpty {
                        Text("Aucune acclimatation en cours.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(activeAcclimatizationBatches) { batch in
                            NavigationLink {
                                AcclimatizationBatchDetailView(batch: batch)
                            } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(batch.cultureBatch?.batchCode ?? "?").font(.headline)
                                    Text("\(batch.currentSurvivorCount) / \(batch.initialPlantletCount) survivants")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                .navigationTitle("Acclimatation")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Fermer") { isShowingAcclimatization = false }
                    }
                }
            }
        }
    }

    private func bioreactorTile(_ bioreactor: Bioreactor) -> some View {
        VStack(spacing: 6) {
            Image(systemName: bioreactor.status.icon)
                .font(.title2)
                .foregroundStyle(bioreactor.status.color)
            Text(bioreactor.code)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.primary)
            Text(bioreactor.status.label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(bioreactor.status.color.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func zoneLabel(_ title: String, icon: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
