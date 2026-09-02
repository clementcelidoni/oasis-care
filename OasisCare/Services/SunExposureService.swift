import Foundation

/// Spec Phase 6F — "SunExposureService: coordonnées, orientation, date,
/// heure, trajectoire solaire." A deliberately simplified, approximate
/// solar position model — Cooper's equation for declination, the
/// standard elevation/azimuth formulas, solar noon treated as clock
/// noon (no equation-of-time or exact longitude correction). Accurate
/// enough for a rough "where's the sun, how long is the shadow" garden
/// simulation, not an astronomical or surveying tool — matching the
/// spec's own repeated framing here ("calculer une approximation,"
/// "simulation estimée").
///
/// Azimuth follows compass convention (0°=north, 90°=east, clockwise) —
/// OasisPlanView's own drawShadows converts to GardenCoordinate's
/// math convention (0°=east, counter-clockwise) at the point of use.
///
/// CORRECTION (unification de l'azimut) — ce commentaire affirmait
/// jusqu'ici que c'était « la même conversion que pour tous les autres
/// angles de ce fichier ». C'était FAUX, et c'est très exactement le
/// mécanisme qui a produit la divergence de rotation entre les deux
/// applications : un commentaire qui décrit une cohérence inexistante
/// dispense le lecteur suivant de vérifier. La conversion « 90 −
/// azimut » n'a lieu qu'aux DEUX endroits qui parlent du SOLEIL
/// (`isShadowed` ci-dessous et OasisPlanView.drawShadows) ; le plan
/// importé et les objets, eux, sont orientés en espace écran sans
/// aucune conversion — et ils sont désormais en AZIMUT eux aussi
/// (0 = nord, horaire), voir
/// `GardenMapCamera.screenRotationRadians(forAzimuthRadians:)`.
///
/// À savoir aussi : le soleil et la rotation des objets ne se
/// rencontrent JAMAIS dans un calcul. `drawShadows` et `isShadowed` ne
/// lisent que position, hauteur et largeur, jamais `rotationRadians` —
/// un mur tourné projette donc la même ombre qu'un mur droit.
enum SunExposureService {
    struct SunPosition {
        var elevationDegrees: Double
        var azimuthDegrees: Double
        var isAboveHorizon: Bool
    }

    static func sunPosition(latitude: Double, date: Date, hour: Double) -> SunPosition {
        let dayOfYear = Double(Calendar.current.ordinality(of: .day, in: .year, for: date) ?? 172)
        let declinationRadians = 23.45 * .pi / 180 * sin(2 * .pi * (284 + dayOfYear) / 365)
        let hourAngleRadians = (hour - 12) * 15 * .pi / 180
        let latitudeRadians = latitude * .pi / 180

        let sinElevation = cos(latitudeRadians) * cos(declinationRadians) * cos(hourAngleRadians)
            + sin(latitudeRadians) * sin(declinationRadians)
        let elevationRadians = asin(min(max(sinElevation, -1), 1))

        let cosAzimuthDenominator = cos(latitudeRadians) * cos(elevationRadians)
        let azimuthRadians: Double
        if abs(cosAzimuthDenominator) < 0.0001 {
            azimuthRadians = hourAngleRadians > 0 ? .pi : 0
        } else {
            let cosAzimuth = (sin(declinationRadians) - sin(latitudeRadians) * sinElevation) / cosAzimuthDenominator
            let rawAzimuth = acos(min(max(cosAzimuth, -1), 1))
            azimuthRadians = hourAngleRadians > 0 ? (2 * .pi - rawAzimuth) : rawAzimuth
        }

        return SunPosition(
            elevationDegrees: elevationRadians * 180 / .pi,
            azimuthDegrees: azimuthRadians * 180 / .pi,
            isAboveHorizon: elevationRadians > 0
        )
    }

    /// Spec's "sun path: lever, midi, coucher." Solved by sampling
    /// elevation across the day rather than a closed-form sunrise/
    /// sunset formula, so sunPosition(...) stays the single source of
    /// truth for "where's the sun" — no second formula that could
    /// silently drift out of agreement with the first.
    static func sunPath(latitude: Double, date: Date) -> (sunrise: Double?, solarNoon: Double, sunset: Double?) {
        var sunriseHour: Double?
        var sunsetHour: Double?
        var previousElevation: Double?
        var bestNoonHour = 12.0
        var bestNoonElevation = -90.0

        var hour = 0.0
        while hour <= 24 {
            let position = sunPosition(latitude: latitude, date: date, hour: hour)
            if position.elevationDegrees > bestNoonElevation {
                bestNoonElevation = position.elevationDegrees
                bestNoonHour = hour
            }
            if let previousElevation {
                if previousElevation <= 0, position.elevationDegrees > 0, sunriseHour == nil {
                    sunriseHour = hour
                }
                if previousElevation > 0, position.elevationDegrees <= 0, sunsetHour == nil {
                    sunsetHour = hour
                }
            }
            previousElevation = position.elevationDegrees
            hour += 0.25
        }
        return (sunriseHour, bestNoonHour, sunsetHour)
    }

    /// Spec Phase 6F — "pour chaque zone : 7h30 de soleil, ou plein
    /// soleil/mi-ombre/ombre." Samples the zone's centroid across the
    /// sun's actual path for this date and checks it against each
    /// shadow caster's shadow (itself the same line-segment
    /// approximation OasisPlanView.drawShadows renders) — same
    /// approximation, applied across a day instead of one instant.
    static func dailySunExposure(
        zoneCentroid: GardenCoordinate,
        shadowCasters: [(position: GardenCoordinate, heightMeters: Double, widthMeters: Double)],
        latitude: Double, date: Date
    ) -> (litHours: Double, level: SunExposureLevel) {
        let path = sunPath(latitude: latitude, date: date)
        guard let sunrise = path.sunrise, let sunset = path.sunset, sunset > sunrise else {
            return (0, .shade)
        }

        let stepHours = 0.5
        var litHours = 0.0
        var hour = sunrise
        while hour < sunset {
            let position = sunPosition(latitude: latitude, date: date, hour: hour)
            if position.isAboveHorizon, !isShadowed(zoneCentroid, by: shadowCasters, sun: position) {
                litHours += stepHours
            }
            hour += stepHours
        }

        let level: SunExposureLevel
        if litHours >= 6 { level = .fullSun } else if litHours >= 3 { level = .partialShade } else { level = .shade }
        return (litHours, level)
    }

    /// AZIMUT SOLAIRE → direction de l'OMBRE, en radians, dans le
    /// repère `GardenCoordinate` (x vers l'est, y vers le nord ; angle
    /// mathématique, 0 = est, sens ANTIHORAIRE).
    ///
    /// Deux conversions en une : `90 − azimut` passe du cap boussole
    /// (0 = nord, horaire) à l'angle mathématique, et `+ 180` retourne
    /// la direction — l'ombre part à l'opposé du soleil.
    ///
    /// Cette formule existait DEUX fois, mot pour mot, ici et dans
    /// `OasisPlanView.drawShadows` ; toute évolution devait penser aux
    /// deux. Elle n'a plus qu'un seul porteur.
    ///
    /// À NE PAS confondre avec l'AZIMUT DES OBJETS du plan
    /// (`GardenMapObject.rotationRadians`) : c'est un cap boussole lui
    /// aussi, mais il ne passe jamais par ici — les ombres ne lisent pas
    /// la rotation des objets, seulement leur position, leur hauteur et
    /// leur largeur.
    static func shadowDirectionRadians(sunAzimuthDegrees: Double) -> Double {
        let mathAngleDegrees = 90 - sunAzimuthDegrees
        return (mathAngleDegrees + 180) * .pi / 180
    }

    private static func isShadowed(
        _ point: GardenCoordinate, by casters: [(position: GardenCoordinate, heightMeters: Double, widthMeters: Double)], sun: SunPosition
    ) -> Bool {
        let direction = shadowDirectionRadians(sunAzimuthDegrees: sun.azimuthDegrees)
        let elevationRadians = max(sun.elevationDegrees, 1) * .pi / 180

        for caster in casters {
            let shadowLength = min(caster.heightMeters / tan(elevationRadians), 60)
            let shadowEnd = GardenCoordinate(
                xMeters: caster.position.xMeters + shadowLength * cos(direction),
                yMeters: caster.position.yMeters + shadowLength * sin(direction)
            )
            let distance = GardenGeometry.distanceFromPoint(point, toSegmentFrom: caster.position, to: shadowEnd)
            if distance <= max(caster.widthMeters / 2, 0.5) {
                return true
            }
        }
        return false
    }
}

enum SunExposureLevel: String {
    case fullSun, partialShade, shade

    var label: String {
        switch self {
        case .fullSun: return "Plein soleil"
        case .partialShade: return "Mi-ombre"
        case .shade: return "Ombre"
        }
    }
}

/// Spec Phase 6F — "mode saison: printemps/été/automne/hiver" as an
/// alternative to picking a specific date. Representative dates are the
/// solstices/equinoxes, swapped for the southern hemisphere using the
/// garden's own latitude — a garden below the equator really does have
/// summer in December, and presenting it as if it didn't would be a
/// real, avoidable inaccuracy rather than a hedged approximation.
enum GardenSeason: String, CaseIterable, Identifiable {
    case spring, summer, autumn, winter

    var id: String { rawValue }

    var label: String {
        switch self {
        case .spring: return "Printemps"
        case .summer: return "Été"
        case .autumn: return "Automne"
        case .winter: return "Hiver"
        }
    }

    func representativeDate(latitude: Double, calendar: Calendar = .current) -> Date {
        let isSouthernHemisphere = latitude < 0
        let effectiveSeason: GardenSeason
        if isSouthernHemisphere {
            switch self {
            case .spring: effectiveSeason = .autumn
            case .summer: effectiveSeason = .winter
            case .autumn: effectiveSeason = .spring
            case .winter: effectiveSeason = .summer
            }
        } else {
            effectiveSeason = self
        }

        let (month, day): (Int, Int)
        switch effectiveSeason {
        case .spring: (month, day) = (3, 20)
        case .summer: (month, day) = (6, 21)
        case .autumn: (month, day) = (9, 22)
        case .winter: (month, day) = (12, 21)
        }

        var components = calendar.dateComponents([.year], from: .now)
        components.month = month
        components.day = day
        return calendar.date(from: components) ?? .now
    }
}
