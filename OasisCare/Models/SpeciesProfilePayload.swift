import Foundation

/// The AI-generated botanical profile for a SPECIES (spec §34-36) — never
/// anything about one user's specific exemplar. Mirrors the JSON schema
/// the plant-info Edge Function's "complete" mode returns.
///
/// Every leaf is optional, including the ones the server schema marks as
/// enums, on purpose: this is decoded from a server AI response this
/// project's CI can never exercise, so a missing/unrecognized field
/// should degrade gracefully (that one value shows as unknown) rather
/// than fail the whole profile decode.
struct SpeciesProfilePayload: Codable {
    var scientificName: String?
    var commonName: String?
    var otherCommonNames: [String]?
    var family: String?
    var genus: String?
    var species: String?
    var cultivar: String?
    var variety: String?
    var geographicOrigin: String?
    var plantType: String?
    var exposure: Exposure?
    var watering: Watering?
    var humidity: Humidity?
    var temperature: Temperature?
    var hardiness: Hardiness?
    var soil: Soil?
    var fertilizing: Fertilizing?
    var growth: Growth?
    var maintenance: Maintenance?
    var health: Health?
    var toxicity: Toxicity?
    var propagation: Propagation?
    var suggestedCareProgram: SuggestedCareProgram?
    var confidence: Confidence?

    struct Exposure: Codable {
        var sunlight: String?
        var recommendations: String?
    }

    struct Watering: Codable {
        var needLevel: String?
        var frequencyIndicative: String?
        var letDrySoilBetweenWaterings: Bool?
        var overwateringSensitivity: String?
        var seasonalAdvice: String?
    }

    struct Humidity: Codable {
        var idealPercentRange: String?
        var dryAirTolerance: String?
    }

    struct Temperature: Codable {
        var minimumCelsius: Double?
        var idealMinCelsius: Double?
        var idealMaxCelsius: Double?
        var maximumIndicativeCelsius: Double?
        var frostSensitive: Bool?
    }

    struct Hardiness: Codable {
        var indicative: String?
        var minimumTemperatureCelsius: Double?
        var outdoorIndoorByClimate: String?
    }

    struct Soil: Codable {
        var recommendedType: String?
        var phIndicative: String?
        var drainage: String?
        var suggestedComposition: String?
    }

    struct Fertilizing: Codable {
        var needLevel: String?
        var frequencyIndicative: String?
        var period: String?
        var fertilizerType: String?
    }

    struct Growth: Codable {
        var speed: String?
        var habit: String?
        var adultHeight: String?
        var adultWidth: String?
    }

    struct Maintenance: Codable {
        var pruning: String?
        var repotting: String?
        var staking: String?
        var cleaning: String?
        var restPeriod: String?
        var dormancy: String?
    }

    struct Health: Codable {
        var commonPests: [String]?
        var commonDiseases: [String]?
        var overwateringSymptoms: String?
        var underwateringSymptoms: String?
    }

    struct Toxicity: Codable {
        var humanToxicity: String?
        var petToxicity: String?
    }

    struct Propagation: Codable {
        var cutting: Bool?
        var division: Bool?
        var seed: Bool?
        var otherTechniques: String?
    }

    struct SuggestedCareProgram: Codable {
        var wateringFrequencyDays: Int?
        var fertilizingFrequencyDays: Int?
        var rotationFrequencyDays: Int?
    }

    struct Confidence: Codable {
        var taxonomy: String?
        var type: String?
        var exposure: String?
        var watering: String?
        var humidity: String?
        var temperature: String?
        var hardiness: String?
        var soil: String?
        var fertilizing: String?
        var growth: String?
        var maintenance: String?
        var health: String?
        var toxicity: String?
        var propagation: String?
    }
}
