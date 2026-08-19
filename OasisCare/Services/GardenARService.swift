import ARKit
import CoreLocation

/// Spec Phase 6J — "Cette fonction doit être optionnelle." Gated on
/// ARWorldTrackingConfiguration.isSupported and never assumed available
/// (older iPhones, and every Simulator, report false).
///
/// Contextual info is deliberately NOT placed as 3D RealityKit anchors
/// at GPS-derived world positions: that would need converting a real
/// lat/long delta into ARKit's own local tracking space, and this app
/// has no way to verify that conversion's axis conventions on a real
/// device (no Mac, no simulator support for ARKit, no iPhone in this
/// workflow). Instead this service exposes plain heading + location,
/// and GardenMapEngine.arTargets() + sightings(of:from:...) below do
/// the "what's roughly in front of the phone right now" filtering in
/// 2D compass math — a flat SwiftUI HUD over the camera feed, not true
/// 3D-anchored labels. Spec's own repeated "position approximative" /
/// "ne pas prétendre connaître précisément" language already asks for
/// exactly this level of honesty, so the simplification costs nothing
/// spec actually requires.
///
/// A second, separate CLLocationManager from LocationService's — that
/// one is a one-shot continuation-based wrapper (see its own doc
/// comment) and would conflict with this class's continuous
/// startUpdatingLocation/Heading use of the delegate callbacks.
@MainActor
final class GardenARService: NSObject, ObservableObject, CLLocationManagerDelegate {
    static var isSupported: Bool { ARWorldTrackingConfiguration.isSupported }

    @Published private(set) var userLocation: CLLocationCoordinate2D?
    @Published private(set) var headingDegrees: Double?
    @Published private(set) var authorizationDenied = false

    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.headingFilter = 2
    }

    func start() {
        switch manager.authorizationStatus {
        case .denied, .restricted:
            authorizationDenied = true
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.startUpdatingLocation()
            manager.startUpdatingHeading()
        @unknown default:
            manager.startUpdatingLocation()
            manager.startUpdatingHeading()
        }
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.stopUpdatingHeading()
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            switch status {
            case .authorizedWhenInUse, .authorizedAlways:
                self.manager.startUpdatingLocation()
                self.manager.startUpdatingHeading()
            case .denied, .restricted:
                self.authorizationDenied = true
            default:
                break
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coordinate = locations.last?.coordinate else { return }
        Task { @MainActor in self.userLocation = coordinate }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard newHeading.headingAccuracy >= 0 else { return }
        let heading = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
        Task { @MainActor in self.headingDegrees = heading }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}

    /// Standard "initial bearing" spherical trigonometry, in degrees
    /// clockwise from true north — the same convention as
    /// CLHeading.trueHeading, so the two compare directly.
    static func bearingDegrees(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) -> Double {
        let lat1 = from.latitude * .pi / 180
        let lat2 = to.latitude * .pi / 180
        let deltaLon = (to.longitude - from.longitude) * .pi / 180
        let y = sin(deltaLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(deltaLon)
        let bearing = atan2(y, x) * 180 / .pi
        return (bearing + 360).truncatingRemainder(dividingBy: 360)
    }

    /// "What's roughly in front of the phone right now": targets within
    /// `fieldOfViewDegrees` of the current heading, garden-scale
    /// distance only (0.5–100 m — far enough to skip standing right on
    /// top of a marker, near enough that this stays a garden tool and
    /// not a general compass), nearest first.
    static func sightings(of targets: [ARTarget], from userLocation: CLLocationCoordinate2D, headingDegrees: Double, fieldOfViewDegrees: Double = 45) -> [ARSighting] {
        let userCLLocation = CLLocation(latitude: userLocation.latitude, longitude: userLocation.longitude)
        return targets.compactMap { target -> ARSighting? in
            let targetLocation = CLLocation(latitude: target.coordinate.latitude, longitude: target.coordinate.longitude)
            let distance = userCLLocation.distance(from: targetLocation)
            guard distance >= 0.5, distance <= 100 else { return nil }

            let bearing = bearingDegrees(from: userLocation, to: target.coordinate)
            let delta = (bearing - headingDegrees + 540).truncatingRemainder(dividingBy: 360) - 180
            guard abs(delta) <= fieldOfViewDegrees / 2 else { return nil }

            return ARSighting(target: target, distanceMeters: distance, bearingDegrees: bearing)
        }
        .sorted { $0.distanceMeters < $1.distanceMeters }
    }
}

/// One object with a real garden-plan position, ready to convert to a
/// live AR sighting. Built by GardenMapEngine.arTargets() from the same
/// GardenMapObject/GardenCoordinateSystem data as the rest of Phase 6.
struct ARTarget: Identifiable {
    var id: UUID
    var coordinate: CLLocationCoordinate2D
    var label: String
    var infoLines: [String]
    var systemImage: String
}

/// An ARTarget currently within the phone's heading window, with its
/// live distance/bearing — what the AR HUD actually renders.
struct ARSighting: Identifiable {
    var id: UUID { target.id }
    var target: ARTarget
    var distanceMeters: Double
    var bearingDegrees: Double
}
