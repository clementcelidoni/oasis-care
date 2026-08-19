import SwiftUI

/// Spec Phase 6I — "GardenRoutePlanner... commencer le check-up." A
/// one-shot position check (LocationService, already built for "use my
/// location" in Phase 4B) seeds the route's starting point when the
/// garden has coordinates; the route itself, and confirming each step,
/// need no continuous tracking. Spec's own wording for NFC/QR is
/// "l'utilisateur PEUT scanner" (may scan) — optional — so manual
/// confirmation alone, with a pointer to the existing Scanner tab for
/// anyone who wants it, is already spec-compliant rather than a
/// shortcut.
struct GardenRouteSheet: View {
    @ObservedObject var engine: GardenMapEngine
    @Environment(\.dismiss) private var dismiss

    @State private var isLocating = false
    @State private var locationNotice: String?

    var body: some View {
        NavigationStack {
            Group {
                if let route = engine.activeRoute {
                    routeContent(route)
                } else {
                    startContent
                }
            }
            .navigationTitle("Parcours d'inspection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
                if engine.activeRoute != nil {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Terminer", role: .destructive) { engine.endRoute() }
                    }
                }
            }
        }
    }

    private var startContent: some View {
        VStack(spacing: 16) {
            Image(systemName: "figure.walk")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("Commencer le check-up")
                .font(.title3.weight(.semibold))
            Text("Oasis génère un parcours raisonnable à travers les végétaux, serres et bassins du jardin. Ce n'est pas une géolocalisation centimétrique — vérifiez toujours visuellement.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            if let locationNotice {
                Text(locationNotice)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            Button {
                Task { await beginRoute() }
            } label: {
                if isLocating {
                    ProgressView()
                } else {
                    Text("Commencer le check-up")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isLocating || engine.garden.mapObjects.isEmpty)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func beginRoute() async {
        isLocating = true
        locationNotice = nil
        defer { isLocating = false }

        var startPosition = GardenCoordinate.zero
        if let coordinateSystem = engine.coordinateSystem {
            do {
                let userCoordinate = try await LocationService.shared.requestCurrentLocation()
                startPosition = coordinateSystem.local(from: userCoordinate)
            } catch {
                locationNotice = "Position indisponible — parcours généré depuis l'origine du plan."
            }
        } else {
            locationNotice = "Position du jardin non renseignée — parcours généré depuis l'origine du plan."
        }
        engine.startRoute(from: startPosition)
    }

    private func routeContent(_ route: [GardenRoutePlanner.Stop]) -> some View {
        List {
            Section {
                Text("Pas de géolocalisation centimétrique — confirmez visuellement chaque étape.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(Array(route.enumerated()), id: \.offset) { index, stop in
                HStack {
                    Image(systemName: stepIcon(index))
                        .foregroundStyle(stepColor(index))
                    Text("\(index + 1). \(stop.label)")
                        .fontWeight(index == engine.activeRouteStepIndex ? .semibold : .regular)
                    Spacer()
                }
                .opacity(index < engine.activeRouteStepIndex ? 0.5 : 1)
            }

            if engine.activeRouteStepIndex < route.count {
                Section {
                    Button("Confirmer : \(route[engine.activeRouteStepIndex].label)") {
                        engine.confirmCurrentRouteStep()
                    }
                    .buttonStyle(.borderedProminent)
                } footer: {
                    Text("Vous pouvez aussi scanner le QR/NFC du végétal depuis l'onglet Scanner pour une confirmation plus fiable.")
                }
            } else {
                Section {
                    Label("Parcours terminé", systemImage: "checkmark.seal.fill")
                        .foregroundStyle(.green)
                }
            }
        }
    }

    private func stepIcon(_ index: Int) -> String {
        if index < engine.activeRouteStepIndex { return "checkmark.circle.fill" }
        if index == engine.activeRouteStepIndex { return "arrow.right.circle.fill" }
        return "circle"
    }

    private func stepColor(_ index: Int) -> Color {
        if index < engine.activeRouteStepIndex { return .green }
        if index == engine.activeRouteStepIndex { return .blue }
        return .secondary
    }
}
