import Foundation

/// Spec §40. Two independent tags can exist for the same plant — one
/// physical QR sticker, one physical NFC chip — each with its own token,
/// so losing/replacing one never invalidates the other.
enum SmartTagType: String, Codable, CaseIterable, Identifiable {
    case qr
    case nfc

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .qr: return "QR Code"
        case .nfc: return "NFC"
        }
    }
}
