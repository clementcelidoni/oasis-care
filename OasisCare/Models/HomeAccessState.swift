import Foundation

/// Spec §4 — human-readable HomeKit authorization state, independent of
/// HomeKit's own HMHomeManagerAuthorizationStatus so the rest of the app
/// never needs to import HomeKit just to check this.
enum HomeAccessState: Equatable {
    case unknown
    case authorized
    case denied
    case restricted
    case unavailable

    var message: String {
        switch self {
        case .unknown:
            return "Vérification de l'accès à Maison…"
        case .authorized:
            return "Accès à Maison autorisé."
        case .denied:
            return "L'accès à Maison a été refusé. Activez-le dans Réglages iPhone pour voir vos équipements connectés."
        case .restricted:
            return "L'accès à Maison est restreint sur cet appareil (contrôle parental ou gestion d'appareil)."
        case .unavailable:
            return "Maison n'est pas disponible sur cet appareil."
        }
    }

    var canRequestAccess: Bool {
        self == .unknown
    }
}
