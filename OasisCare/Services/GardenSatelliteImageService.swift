import MapKit
import UIKit

/// Spec Phase 6A — "1. GeographicMap: fond géographique." Captured once
/// for the garden's real-world extent, cached to disk, and drawn as
/// OasisPlanView's bottom-most layer instead of a second live map view
/// that would need continuous camera sync with the vector plan.
///
/// Deliberately not synced/stored in SwiftData — same reasoning as
/// GardenPlanImage (Phase 6K) and WeatherCache (Phase 4B): large
/// binary data that's trivially re-fetchable, not a record of real
/// garden state. A plain on-disk file cache is enough.
///
/// WHY THIS IS NOT MAPKIT ANY MORE
/// ------------------------------
/// It was, and that was the bug behind "sur le téléphone le périmètre
/// dépasse du terrain". The geometry was never wrong: both apps convert
/// local meters to WGS84 with the same tangent-plane approximation,
/// from the same origin, with the same 111320 × cos(latitude) factor —
/// all five of those were checked against each other before touching
/// anything here.
///
/// What differed was the PHOTOGRAPH. The web shows IGN orthophotos,
/// orthorectified to the French national reference; MKMapSnapshotter
/// shows Apple's imagery, which is a different survey with its own
/// georeferencing. A few meters between two consumer basemaps is
/// ordinary — but a boundary traced on one of them, over a 34 m garden,
/// visibly overhangs the other. The user drew on IGN; the phone
/// re-laid it on Apple.
///
/// So the phone now fetches the SAME tiles as `web-pro/lib/twin/
/// tiles.ts`, from the same provider, and places them by their true
/// geographic corners — the same thing `useTileLayer` does. MapKit
/// stays as the fallback for a garden outside IGN's coverage, where an
/// approximately-placed photo still beats a bare grid.
enum GardenSatelliteImageService {
    enum SatelliteError: LocalizedError {
        case noImage
        case outOfCoverage
        var errorDescription: String? {
            "Image satellite indisponible pour le moment."
        }
    }

    // MARK: - Orthophotos (the same imagery the web shows)

    /// A plain lat/lon box. Small enough that Mercator maps it to a
    /// rectangle for all practical purposes, which is what lets the
    /// stitched image be cropped with a rectangle below.
    struct GeoBounds {
        var minLatitude: Double
        var maxLatitude: Double
        var minLongitude: Double
        var maxLongitude: Double
    }

    /// Identical to `IGN_ORTHO` in web-pro/lib/twin/tiles.ts, on
    /// purpose: the whole point is that both apps draw on the same
    /// pixels. If that file's provider changes, this must follow.
    private static let orthoURLTemplate =
        "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
        "&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM" +
        "&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
    private static let orthoMaxZoom = 19
    private static let tileSize = 256.0

    /// Standard XYZ/Web-Mercator tile maths, matching the web's
    /// `lonToTileX` / `latToTileY` term for term.
    static func tileX(longitude: Double, zoom: Int) -> Double {
        ((longitude + 180) / 360) * pow(2, Double(zoom))
    }

    static func tileY(latitude: Double, zoom: Int) -> Double {
        let rad = latitude * .pi / 180
        return ((1 - log(tan(rad) + 1 / cos(rad)) / .pi) / 2) * pow(2, Double(zoom))
    }

    /// The returned image covers `bounds` EXACTLY — no whole-tile
    /// overhang. That matters: the caller draws it into a rectangle of
    /// known width and height in meters, so an image covering more
    /// ground than it claims would be squeezed, and every distance read
    /// off the plan would be wrong by that ratio. This is the same
    /// mistake the old MapKit path made whenever a small garden hit its
    /// minimum-span floor.
    static func fetchOrthophoto(bounds: GeoBounds, maxPixelsPerSide: Double = 2048) async throws -> UIImage {
        var zoom = orthoMaxZoom
        while zoom > 1 {
            let width = (tileX(longitude: bounds.maxLongitude, zoom: zoom)
                - tileX(longitude: bounds.minLongitude, zoom: zoom)) * tileSize
            let height = (tileY(latitude: bounds.minLatitude, zoom: zoom)
                - tileY(latitude: bounds.maxLatitude, zoom: zoom)) * tileSize
            if max(width, height) <= maxPixelsPerSide { break }
            zoom -= 1
        }

        // Global Mercator pixel coordinates of the requested box. North
        // is the SMALLER y, which is why maxLatitude gives the origin.
        let cropX = tileX(longitude: bounds.minLongitude, zoom: zoom) * tileSize
        let cropY = tileY(latitude: bounds.maxLatitude, zoom: zoom) * tileSize
        let cropWidth = tileX(longitude: bounds.maxLongitude, zoom: zoom) * tileSize - cropX
        let cropHeight = tileY(latitude: bounds.minLatitude, zoom: zoom) * tileSize - cropY
        guard cropWidth > 1, cropHeight > 1 else { throw SatelliteError.noImage }

        let minTileX = Int(floor(cropX / tileSize))
        let maxTileX = Int(floor((cropX + cropWidth - 0.001) / tileSize))
        let minTileY = Int(floor(cropY / tileSize))
        let maxTileY = Int(floor((cropY + cropHeight - 0.001) / tileSize))

        // The zoom loop above already caps each side at
        // `maxPixelsPerSide`, so a side can never span more than
        // ceil(2048 / 256) + 1 = 9 tiles however wide the garden gets:
        // 81 in the worst case, whether that is 400 m at IGN's finest
        // zoom or a kilometre at a coarser one. The guard is therefore
        // not a budget but an alarm — reaching it means the extent
        // arrived wrong, and firing off hundreds of requests would be
        // the visible symptom of a bug elsewhere.
        let tileCount = (maxTileX - minTileX + 1) * (maxTileY - minTileY + 1)
        guard tileCount > 0, tileCount <= 100 else { throw SatelliteError.noImage }

        var tiles: [TileKey: UIImage] = [:]
        try await withThrowingTaskGroup(of: (TileKey, UIImage).self) { group in
            for x in minTileX...maxTileX {
                for y in minTileY...maxTileY {
                    group.addTask {
                        let image = try await fetchTile(x: x, y: y, zoom: zoom)
                        return (TileKey(x: x, y: y), image)
                    }
                }
            }
            for try await (key, image) in group { tiles[key] = image }
        }

        // scale = 1: the image is georeferenced, so its pixel grid must
        // stay the Mercator pixel grid. Letting the renderer apply the
        // device scale would silently double the size and break the
        // crop offsets computed above.
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: cropWidth, height: cropHeight),
            format: format
        )
        return renderer.image { _ in
            for x in minTileX...maxTileX {
                for y in minTileY...maxTileY {
                    guard let image = tiles[TileKey(x: x, y: y)] else { continue }
                    image.draw(in: CGRect(
                        x: Double(x) * tileSize - cropX,
                        y: Double(y) * tileSize - cropY,
                        width: tileSize,
                        height: tileSize
                    ))
                }
            }
        }
    }

    private struct TileKey: Hashable {
        var x: Int
        var y: Int
    }

    /// Outside IGN's coverage the WMTS answers with an exception
    /// document, not an image. Checking the MIME type rather than only
    /// the status code is what turns that into a clean fallback to
    /// MapKit instead of a garden painted with an error message.
    private static func fetchTile(x: Int, y: Int, zoom: Int) async throws -> UIImage {
        let address = orthoURLTemplate
            .replacingOccurrences(of: "{x}", with: String(x))
            .replacingOccurrences(of: "{y}", with: String(y))
            .replacingOccurrences(of: "{z}", with: String(zoom))
        guard let url = URL(string: address) else { throw SatelliteError.noImage }

        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              (http.mimeType ?? "").hasPrefix("image/"),
              let image = UIImage(data: data)
        else { throw SatelliteError.outOfCoverage }
        return image
    }

    // MARK: - MapKit fallback

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

    // MARK: - Disk cache

    private static func cacheDirectory() -> URL? {
        guard let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let directory = base.appendingPathComponent("GardenSatelliteImages", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    /// The `-ortho` suffix is not decoration: it invalidates every
    /// MapKit snapshot cached by an earlier build. Without it a user
    /// who already opened the plan once would keep seeing the misplaced
    /// Apple imagery, and the fix would look like it had done nothing.
    private static func cacheFileURL(for gardenID: UUID) -> URL? {
        cacheDirectory()?.appendingPathComponent("\(gardenID.uuidString)-ortho.jpg")
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
