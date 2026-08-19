import Foundation

/// Spec Phase 6H — "Où planter ? Utiliser soleil, ombre, température,
/// humidité, capteurs sol, espace, taille adulte, irrigation, proximité
/// bâtiments, autres plantes, informations SpeciesProfile. Afficher :
/// Très adapté / Adapté / Possible / Déconseillé."
///
/// A transparent, rule-based score rather than another AI call: every
/// input here is already a real, computed signal this app owns (sun
/// exposure from Phase 6F, geometry from GardenGeometry, real sensor
/// readings) — scoring them with an explainable formula that always
/// lists its reasons is more honest than routing through an LLM for a
/// result the user can't audit, and needs no new Edge Function.
enum SiteSuitabilityService {
    enum SuitabilityLevel: Int, Comparable {
        case notRecommended = 0
        case possible = 1
        case suitable = 2
        case verySuitable = 3

        static func < (lhs: SuitabilityLevel, rhs: SuitabilityLevel) -> Bool { lhs.rawValue < rhs.rawValue }

        var label: String {
            switch self {
            case .notRecommended: return "Déconseillé"
            case .possible: return "Possible"
            case .suitable: return "Adapté"
            case .verySuitable: return "Très adapté"
            }
        }
    }

    enum SunPreference: String {
        case fullSun, partialShade, shade

        var label: String {
            switch self {
            case .fullSun: return "plein soleil"
            case .partialShade: return "mi-ombre"
            case .shade: return "ombre"
            }
        }

        /// Position on the shade↔sun spectrum, so two preferences can be
        /// compared by distance (0 = exact match, 1 = adjacent/partial,
        /// 2 = opposite extremes) instead of by equality alone.
        var spectrumPosition: Int {
            switch self {
            case .shade: return 0
            case .partialShade: return 1
            case .fullSun: return 2
            }
        }

        /// Spec §36's own SpeciesProfile.exposure.sunlight is free text
        /// from an AI response ("every leaf is optional... a missing/
        /// unrecognized field should degrade gracefully" per that
        /// payload's own doc comment) — this is a best-effort keyword
        /// match, not a guaranteed-correct parse, and returns nil
        /// (unknown) rather than guessing when nothing matches.
        static func parse(_ text: String?) -> SunPreference? {
            guard let text = text?.lowercased() else { return nil }
            if text.contains("mi-ombre") || text.contains("mi ombre") || text.contains("partial") { return .partialShade }
            if text.contains("ombre") || text.contains("shade") { return .shade }
            if text.contains("soleil") || text.contains("sun") { return .fullSun }
            return nil
        }
    }

    struct PlantRequirements {
        var sunPreference: SunPreference?
        var adultCanopyDiameterMeters: Double?
    }

    struct Result {
        var area: GardenArea
        var level: SuitabilityLevel
        var reasons: [String]
    }

    static func evaluate(area: GardenArea, requirements: PlantRequirements, garden: Garden) -> Result {
        guard area.points.count >= 3 else {
            return Result(area: area, level: .possible, reasons: ["Zone pas encore complètement dessinée."])
        }

        var score = 0.0
        var maxScore = 0.0
        var reasons: [String] = []

        // Sun exposure (Phase 6F).
        if let latitude = garden.latitude {
            let casters = garden.mapObjects
                .filter { $0.objectType.castsShadow }
                .compactMap { object -> (position: GardenCoordinate, heightMeters: Double, widthMeters: Double)? in
                    guard let height = object.structureHeightMeters else { return nil }
                    return (object.position, height, object.widthMeters)
                }
            let exposure = SunExposureService.dailySunExposure(
                zoneCentroid: GardenGeometry.centroid(of: area.points), shadowCasters: casters, latitude: latitude, date: .now
            )
            maxScore += 2
            if let sunPreference = requirements.sunPreference {
                let exposureAsPreference: SunPreference = exposure.level == .fullSun ? .fullSun : exposure.level == .shade ? .shade : .partialShade
                // Distance on the shade↔sun spectrum: 0 = exact match,
                // 1 = adjacent (one of the two is mi-ombre), 2 = the two
                // opposite extremes (plein soleil vs. ombre).
                let distance = abs(exposureAsPreference.spectrumPosition - sunPreference.spectrumPosition)
                switch distance {
                case 0:
                    score += 2
                    reasons.append("Ensoleillement (\(exposure.level.label)) correspond à la préférence de l'espèce (\(sunPreference.label)).")
                case 1:
                    score += 1
                    reasons.append("Ensoleillement (\(exposure.level.label)) partiellement adapté à la préférence (\(sunPreference.label)).")
                default:
                    reasons.append("Ensoleillement (\(exposure.level.label)) ne correspond pas à la préférence (\(sunPreference.label)).")
                }
            } else {
                score += 1
                reasons.append("Ensoleillement estimé de la zone : \(exposure.level.label).")
            }
        }

        // Space vs. adult size.
        if let adultDiameter = requirements.adultCanopyDiameterMeters {
            let boundingSize = GardenGeometry.boundingSize(of: area.points)
            let smallestDimension = min(boundingSize.widthMeters, boundingSize.heightMeters)
            maxScore += 2
            if smallestDimension >= adultDiameter * 1.5 {
                score += 2
                reasons.append("Espace largement suffisant pour la taille adulte estimée (\(String(format: "%.1f", adultDiameter)) m).")
            } else if smallestDimension >= adultDiameter {
                score += 1
                reasons.append("Espace suffisant mais limité pour la taille adulte estimée.")
            } else {
                reasons.append("Zone probablement trop petite pour la taille adulte estimée (\(String(format: "%.1f", adultDiameter)) m).")
            }
        }

        // Existing vegetation already in the zone (crowding).
        let existingVegetation = garden.mapObjects.filter {
            $0.objectType.isVegetation && GardenGeometry.contains($0.position, polygon: area.points)
        }
        maxScore += 1
        if existingVegetation.isEmpty {
            score += 1
            reasons.append("Aucun autre végétal déjà présent dans cette zone.")
        } else {
            let noun = existingVegetation.count > 1 ? "végétaux" : "végétal"
            reasons.append("\(existingVegetation.count) \(noun) déjà présent\(existingVegetation.count > 1 ? "s" : "") dans cette zone.")
        }

        // Proximity to structures.
        let structures = garden.mapObjects.filter { $0.objectType == .house || $0.objectType == .wall || $0.objectType == .greenhouse }
        let nearbyStructures = structures.filter { GardenGeometry.centroid(of: area.points).distance(to: $0.position) < 3 }
        maxScore += 1
        if nearbyStructures.isEmpty {
            score += 1
        } else {
            reasons.append("Une construction se trouve à proximité de cette zone.")
        }

        // No-go zones are never suitable, regardless of the rest.
        if area.areaType.isNoGo {
            return Result(area: area, level: .notRecommended, reasons: ["Zone marquée comme interdite."] + reasons)
        }

        let ratio = maxScore > 0 ? score / maxScore : 0.5
        let level: SuitabilityLevel
        if ratio >= 0.85 { level = .verySuitable } else if ratio >= 0.6 { level = .suitable } else if ratio >= 0.3 { level = .possible } else { level = .notRecommended }
        return Result(area: area, level: level, reasons: reasons)
    }
}
