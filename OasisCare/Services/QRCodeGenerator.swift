import CoreImage.CIFilterBuiltins
import UIKit

/// Spec §42 — generate/view/share/export a QR for a plant's smart tag.
enum QRCodeGenerator {
    /// CIQRCodeGenerator outputs a tiny (~30px) image; nearest-neighbor
    /// scaling keeps every module a crisp hard edge instead of a blur.
    static func image(for string: String, pointSize: CGFloat = 240) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"

        guard let outputImage = filter.outputImage else { return nil }
        let scale = pointSize / outputImage.extent.width
        let scaledImage = outputImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

        let context = CIContext()
        guard let cgImage = context.createCGImage(scaledImage, from: scaledImage.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}
