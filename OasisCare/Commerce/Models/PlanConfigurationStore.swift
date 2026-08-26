import Foundation

/// Phase 12 §"Configuration des plans" + §"IMPORTANT: les nombres
/// exacts (plantes Free, jardins, quotas IA, stockage) doivent rester
/// configurables. NE PAS inventer les prix définitifs."
///
/// The entitlement SETS below are a direct, literal transcription of
/// spec's own "Matrice de lancement" (§12A) — each tier is a strict
/// superset of the previous one, satisfying "BioLab doit hériter des
/// fonctions Premium" as a checkable property (see
/// PlanConfigurationStoreTests).
///
/// The NUMBERS in `defaults` (5 plants, 1 garden, 10 AI requests/month
/// for Free...) are this app's own reasonable launch starting point,
/// not a researched pricing/business decision — spec explicitly
/// forbids inventing definitive prices but does not forbid a sensible
/// default limit to launch with, same "documented adjustable default"
/// treatment as every non-scientific UX threshold elsewhere in this
/// app (e.g. Sensor.isStale's 6-hour window). They are meant to be
/// overridden by `commercial_config` (§12O) without a code change —
/// see CommercialConfigService.
enum PlanConfigurationStore {
    static let defaults: [OasisPlan: PlanConfiguration] = [
        .free: PlanConfiguration(
            planId: .free,
            displayName: "Free",
            entitlements: [.plantManagement, .cloudSync, .aiIdentification, .aiAssistant, .aiDiagnosis, .dataExport],
            usageLimits: UsageLimits(maxPlants: 5, maxGardens: 1, maxPhotosPerPlant: 3, aiRequestsPerMonth: 10),
            isAvailable: true,
            sortOrder: 0
        ),
        .premium: PlanConfiguration(
            planId: .premium,
            displayName: "Premium",
            entitlements: [
                .plantManagement, .cloudSync, .aiIdentification, .aiAssistant, .aiDiagnosis, .dataExport,
                .unlimitedPlants, .multipleGardens, .advancedPhotos, .digitalTwin, .advancedMapLayers,
                .smartIrrigation, .sensorHistory, .connectedGarden, .matterHomeKit, .greenhouseAdvanced,
                .pondAdvanced, .advancedAnalytics, .qrNfc
            ],
            usageLimits: UsageLimits(maxPlants: nil, maxGardens: nil, maxPhotosPerPlant: nil, aiRequestsPerMonth: 200),
            isAvailable: true,
            sortOrder: 1
        ),
        .biolab: PlanConfiguration(
            planId: .biolab,
            displayName: "BioLab",
            entitlements: [
                .plantManagement, .cloudSync, .aiIdentification, .aiAssistant, .aiDiagnosis, .dataExport,
                .unlimitedPlants, .multipleGardens, .advancedPhotos, .digitalTwin, .advancedMapLayers,
                .smartIrrigation, .sensorHistory, .connectedGarden, .matterHomeKit, .greenhouseAdvanced,
                .pondAdvanced, .advancedAnalytics, .qrNfc,
                .biolab, .bioreactors, .smartMedia, .biolabAI, .biolabAnalytics, .biolabExperiments
            ],
            usageLimits: UsageLimits(maxPlants: nil, maxGardens: nil, maxPhotosPerPlant: nil, aiRequestsPerMonth: 400),
            isAvailable: true,
            sortOrder: 2
        ),
        // §"Préparer l'architecture pour ajouter plus tard PRO, mais NE
        // PAS créer les fonctions Pro" — present so the type is total
        // and every dictionary lookup is safe, but unavailable so
        // nothing ever offers or sells it.
        .pro: PlanConfiguration(
            planId: .pro, displayName: "Pro", entitlements: [], usageLimits: .unlimited, isAvailable: false, sortOrder: 3
        )
    ]
}
