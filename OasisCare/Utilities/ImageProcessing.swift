import UIKit

/// Downsizing and compression for photos before they're stored as SwiftData
/// `Data` — full-resolution camera/library photos are too large to keep
/// inline on every plant and in every history entry. Produces two sizes so
/// lists/grids never have to decode and downscale a full-size image just to
/// show a thumbnail.
enum ImageProcessing {
    private static let detailMaxDimension: CGFloat = 1600
    private static let thumbnailMaxDimension: CGFloat = 300
    private static let compressionQuality: CGFloat = 0.7

    struct ProcessedImage {
        var detailData: Data
        var thumbnailData: Data
    }

    /// Returns JPEG data at both a detail size (for the plant header / photo
    /// viewer) and a thumbnail size (for lists and grids), or nil if the
    /// input can't be decoded as an image.
    static func prepareForStorage(_ data: Data) -> ProcessedImage? {
        guard let image = UIImage(data: data) else { return nil }
        guard
            let detailData = resized(image, maxDimension: detailMaxDimension).jpegData(compressionQuality: compressionQuality),
            let thumbnailData = resized(image, maxDimension: thumbnailMaxDimension).jpegData(compressionQuality: compressionQuality)
        else {
            return nil
        }
        return ProcessedImage(detailData: detailData, thumbnailData: thumbnailData)
    }

    private static func resized(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let longestSide = max(image.size.width, image.size.height)
        guard longestSide > maxDimension else { return image }

        let scale = maxDimension / longestSide
        let newSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)

        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
