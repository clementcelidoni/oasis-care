import Foundation

/// Phase 12 §"Entitlements" — "Créer des droits granulaires." A feature
/// checks `entitlementService.has(.digitalTwin)`, never `plan ==
/// .premium` (spec's own example, §"Configuration des plans") — see
/// FeatureGateService. The exact list spec gives verbatim.
enum Entitlement: String, Codable, CaseIterable, Identifiable {
    case plantManagement
    case unlimitedPlants
    case multipleGardens
    case cloudSync
    case advancedPhotos
    case aiIdentification
    case aiAssistant
    case aiDiagnosis
    case digitalTwin
    case advancedMapLayers
    case smartIrrigation
    case sensorHistory
    case connectedGarden
    case matterHomeKit
    case greenhouseAdvanced
    case pondAdvanced
    case advancedAnalytics
    case qrNfc
    case biolab
    case bioreactors
    case smartMedia
    case biolabAI
    case biolabAnalytics
    case biolabExperiments
    case dataExport

    var id: String { rawValue }
}
