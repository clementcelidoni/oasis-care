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

    /// French label for SubscriptionSettingsView's "Fonctions incluses"
    /// list — the raw case name (e.g. "digitalTwin") is a developer
    /// identifier, not something to show a paying customer.
    var displayName: String {
        switch self {
        case .plantManagement: return "Gestion des végétaux"
        case .unlimitedPlants: return "Végétaux illimités"
        case .multipleGardens: return "Plusieurs jardins"
        case .cloudSync: return "Synchronisation cloud"
        case .advancedPhotos: return "Photos illimitées"
        case .aiIdentification: return "Identification par IA"
        case .aiAssistant: return "Assistant Oasis AI"
        case .aiDiagnosis: return "Diagnostic par IA"
        case .digitalTwin: return "Digital Twin"
        case .advancedMapLayers: return "Calques de carte avancés"
        case .smartIrrigation: return "Irrigation intelligente"
        case .sensorHistory: return "Historique des capteurs"
        case .connectedGarden: return "Jardin connecté"
        case .matterHomeKit: return "Maison connectée (Matter/HomeKit)"
        case .greenhouseAdvanced: return "Serre"
        case .pondAdvanced: return "Bassin"
        case .advancedAnalytics: return "Analytics avancés"
        case .qrNfc: return "Scan QR / NFC"
        case .biolab: return "Oasis BioLab"
        case .bioreactors: return "Bioréacteurs"
        case .smartMedia: return "Smart Media"
        case .biolabAI: return "Assistant IA BioLab"
        case .biolabAnalytics: return "Analytics BioLab"
        case .biolabExperiments: return "Expérimentations BioLab"
        case .dataExport: return "Export de données"
        }
    }
}
