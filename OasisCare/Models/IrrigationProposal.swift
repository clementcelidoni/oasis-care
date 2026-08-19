import Foundation

/// Spec Phase 6D's structured response from propose-irrigation — an
/// ephemeral suggestion the user reviews and either discards or turns
/// into real GardenMapObject sprinklers (see IrrigationAIService);
/// never persisted itself. Positions/angles are absolute, in the same
/// garden-local meter frame as the zone points sent in the request —
/// the client places them with no coordinate transform.
struct IrrigationSprinklerProposal: Decodable {
    var xMeters: Double
    var yMeters: Double
    var radiusMeters: Double
    var startAngleDegrees: Double
    var endAngleDegrees: Double
    var kind: String
}

struct IrrigationProposal: Decodable {
    var canPropose: Bool
    var explanation: String
    var sprinklers: [IrrigationSprinklerProposal]
    var summary: String
}
