import SwiftUI

/// Spec Phase 7D — "SCHÉMA VISUEL... afficher l'état des composants
/// connectés." Culture Vessel / Reservoir are the two anchors of the
/// double-vessel architecture spec describes; every other optional
/// component (spec's own "ne pas imposer que chaque système possède
/// tous ces éléments") shows as a badge only when this bioreactor
/// actually has it. Color always pairs with an icon/label, never alone
/// — the same Digital Twin convention as Phase 6's map.
struct BioreactorSchematicView: View {
    var bioreactor: Bioreactor

    private var hasComponent: (BioreactorComponentType) -> Bool {
        { bioreactor.componentTypes.contains($0) }
    }

    private var isFlowing: Bool {
        bioreactor.status == .immersing || bioreactor.status == .aerating || bioreactor.status == .draining
    }

    var body: some View {
        VStack(spacing: 16) {
            Text(bioreactor.code)
                .font(.headline)

            if hasComponent(.cultureVessel) {
                vesselBox(title: "Bocal de culture", icon: "flask.fill", tint: .teal)
            }

            VStack(spacing: 2) {
                Image(systemName: isFlowing ? "arrow.down.circle.fill" : "arrow.down.circle")
                    .font(.title3)
                    .foregroundStyle(isFlowing ? bioreactor.status.color : .secondary)
                Text(bioreactor.status == .immersing ? "milieu" : bioreactor.status.label)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if hasComponent(.reservoir) {
                vesselBox(title: "Réservoir", icon: "cylinder.fill", tint: .blue, showsLiquid: true)
            }

            let otherComponents = bioreactor.componentTypes.filter { $0 != .cultureVessel && $0 != .reservoir }
            if !otherComponents.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 90))], spacing: 8) {
                    ForEach(otherComponents.sorted { $0.label < $1.label }) { component in
                        VStack(spacing: 4) {
                            Image(systemName: component.icon)
                                .foregroundStyle(.secondary)
                            Text(component.label)
                                .font(.caption2)
                                .multilineTextAlignment(.center)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(8)
                        .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                .padding(.top, 4)
            }

            HStack(spacing: 6) {
                Image(systemName: bioreactor.status.icon)
                Text(bioreactor.status.label)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(bioreactor.status.color)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(bioreactor.status.color.opacity(0.15), in: Capsule())
        }
        .padding()
    }

    private func vesselBox(title: String, icon: String, tint: Color, showsLiquid: Bool = false) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.largeTitle)
                .foregroundStyle(tint)
            Text(title)
                .font(.caption.weight(.medium))
            if showsLiquid {
                Image(systemName: "water.waves")
                    .font(.caption)
                    .foregroundStyle(tint.opacity(0.6))
            }
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(tint.opacity(0.3), lineWidth: 1))
    }
}
