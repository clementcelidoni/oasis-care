import Foundation
import SwiftData

/// Spec §27. Every action here funnels through DeviceCommandService
/// when actually executed (AutomationEngine's job) — this model just
/// records *what* the rule wants to happen, never touches hardware
/// itself.
@Model
final class AutomationAction {
    var id: UUID
    var rule: AutomationRule?
    var type: AutomationActionType
    var device: ConnectedDevice?
    /// openValve only — still passes through
    /// DeviceCommandService.hardMaxValveDurationSeconds regardless of
    /// what's stored here.
    var durationSeconds: Double?
    /// sendNotification's message; createCareEvent's note.
    var message: String?
    var order: Int

    init(type: AutomationActionType, device: ConnectedDevice? = nil, durationSeconds: Double? = nil, message: String? = nil, order: Int = 0) {
        self.id = UUID()
        self.type = type
        self.device = device
        self.durationSeconds = durationSeconds
        self.message = message
        self.order = order
    }
}

enum AutomationActionType: String, Codable, CaseIterable, Identifiable, Hashable {
    case openValve
    case closeValve
    case startPump
    case stopPump
    case turnFanOn
    case turnFanOff
    case turnHeaterOn
    case turnHeaterOff
    case turnMisterOn
    case turnMisterOff
    case turnLightOn
    case turnLightOff
    case sendNotification
    case createCareEvent

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .openValve: return "Ouvrir la vanne"
        case .closeValve: return "Fermer la vanne"
        case .startPump: return "Démarrer la pompe"
        case .stopPump: return "Arrêter la pompe"
        case .turnFanOn: return "Activer la ventilation"
        case .turnFanOff: return "Désactiver la ventilation"
        case .turnHeaterOn: return "Activer le chauffage"
        case .turnHeaterOff: return "Désactiver le chauffage"
        case .turnMisterOn: return "Activer la brumisation"
        case .turnMisterOff: return "Désactiver la brumisation"
        case .turnLightOn: return "Allumer l'éclairage"
        case .turnLightOff: return "Éteindre l'éclairage"
        case .sendNotification: return "Envoyer une notification"
        case .createCareEvent: return "Enregistrer une intervention"
        }
    }

    var requiresDevice: Bool {
        switch self {
        case .sendNotification, .createCareEvent: return false
        default: return true
        }
    }

    var requiresDuration: Bool { self == .openValve }
}
