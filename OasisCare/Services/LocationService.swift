import CoreLocation

/// One-shot "use my location" for a garden (spec §16: "Ne demander la
/// localisation iPhone que lorsque nécessaire" — only requested when
/// the user explicitly taps for it, never on launch). Delegate callbacks
/// are nonisolated (CoreLocation delivers them off the main actor) and
/// hop back to the main actor to resume the waiting continuation.
@MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    static let shared = LocationService()

    enum LocationError: LocalizedError {
        case denied
        case unavailable

        var errorDescription: String? {
            switch self {
            case .denied: return "Localisation refusée. Autorisez-la dans Réglages iPhone, ou saisissez les coordonnées manuellement."
            case .unavailable: return "Localisation indisponible pour le moment."
            }
        }
    }

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D, Error>?
    private var isWaitingForAuthorization = false

    private override init() {
        super.init()
        manager.delegate = self
    }

    func requestCurrentLocation() async throws -> CLLocationCoordinate2D {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            switch manager.authorizationStatus {
            case .denied, .restricted:
                continuation.resume(throwing: LocationError.denied)
                self.continuation = nil
            case .notDetermined:
                isWaitingForAuthorization = true
                manager.requestWhenInUseAuthorization()
            case .authorizedWhenInUse, .authorizedAlways:
                manager.requestLocation()
            @unknown default:
                manager.requestLocation()
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            guard self.isWaitingForAuthorization else { return }
            self.isWaitingForAuthorization = false
            switch status {
            case .authorizedWhenInUse, .authorizedAlways:
                self.manager.requestLocation()
            case .denied, .restricted:
                self.continuation?.resume(throwing: LocationError.denied)
                self.continuation = nil
            default:
                break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coordinate = locations.first?.coordinate else { return }
        Task { @MainActor in
            self.continuation?.resume(returning: coordinate)
            self.continuation = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.continuation?.resume(throwing: LocationError.unavailable)
            self.continuation = nil
        }
    }
}
