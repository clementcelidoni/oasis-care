import MapKit
import UIKit

/// Spec Phase 6A — "1. GeographicMap: fond géographique. Utiliser
/// MapKit pour Standard/Satellite/Hybrid." Never built as an actual
/// background layer behind OasisPlan's own vector drawing (only as
/// three separate, alternative map *modes* — see GardenMapMode). This
/// closes that gap: a real satellite/hybrid MapKit snapshot, captured
/// once for the garden's real-world extent and cached to disk, drawn
/// as OasisPlanView's bottom-most layer instead of a second live map
/// view that would need continuous camera sync with the vector plan.
///
/// Deliberately not synced/stored in SwiftData — same reasoning as
/// GardenPlanImage (Phase 6K) and WeatherCache (Phase 4B): large
/// binary data that's trivially re-fetchable, not a record of real
/// garden state. A plain on-disk file cache is enough.
enum GardenSatelliteImageService {
    enum SatelliteError: LocalizedError {
        case noImage
        var errorDescription: String? {
            "Image satellite indisponible pour le moment."
        }
    }

    /// Wraps MKMapSnapshotter's completion-handler API (there is no
    /// confirmed async overload as of this writing) in a continuation
    /// rather than guessing at one — the snapshotter instance is kept
    /// alive by the closure passed to `start`, standard for this
    /// pattern.
    static func fetchSnapshot(region: MKCoordinateRegion, size: CGSize, mapType: MKMapType) async throws -> UIImage {
        let options = MKMapSnapshotter.Options()
        options.region = region
        options.size = size
        options.mapType = mapType
        options.showsBuildings = true

        let snapshotter = MKMapSnapshotter(options: options)
        return try await withCheckedThrowingContinuation { continuation in
            snapshotter.start { snapshot, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let snapshot {
                    continuation.resume(returning: snapshot.image)
                } else {
                    continuation.resume(throwing: SatelliteError.noImage)
                }
            }
        }
    }

    private static func cacheDirectory() -> URL? {
        guard let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let directory = base.appendingPathComponent("GardenSatelliteImages", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private static func cacheFileURL(for gardenID: UUID) -> URL? {
        cacheDirectory()?.appendingPathComponent("\(gardenID.uuidString).jpg")
    }

    static func loadCached(for gardenID: UUID) -> UIImage? {
        guard let url = cacheFileURL(for: gardenID), let data = try? Data(contentsOf: url) else { return nil }
        return UIImage(data: data)
    }

    static func cache(_ image: UIImage, for gardenID: UUID) {
        guard let url = cacheFileURL(for: gardenID), let data = image.jpegData(compressionQuality: 0.85) else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func clearCache(for gardenID: UUID) {
        guard let url = cacheFileURL(for: gardenID) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
