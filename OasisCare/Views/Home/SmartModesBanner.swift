import SwiftUI

/// Spec §72/§75/§76 — a compact status strip when a standing smart mode
/// is on, so it stays visible without a dedicated settings visit.
/// Canicule/Gel aren't shown here — those are forecast-driven, not a
/// toggle, and already have their own banners on WeatherCard.
struct SmartModesBanner: View {
    var settings: SmartModeSettings

    private var activeLines: [(icon: String, text: String)] {
        var items: [(String, String)] = []
        if settings.isVacationActiveNow() {
            items.append(("airplane", "Mode Vacances actif — seules les alertes importantes sont envoyées."))
        }
        if settings.winterModeEnabled {
            items.append(("snowflake", "Mode Hiver — pensez à adapter arrosage, engrais et chauffage."))
        }
        if settings.waterSavingModeEnabled {
            items.append(("drop.degreesign", "Économie d'eau — report d'arrosage proposé dès une pluie plus faible."))
        }
        return items
    }

    var body: some View {
        if !activeLines.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(activeLines.enumerated()), id: \.offset) { _, line in
                    Label(line.text, systemImage: line.icon)
                        .font(.caption.weight(.medium))
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }
}
