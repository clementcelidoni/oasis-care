import UIKit

/// Calls the diagnose-plant-problem Edge Function — spec §43-45.
enum PlantHealthService {
    static let maxImages = 4

    static func diagnose(images: [UIImage], context: PlantAIContext) async throws -> PlantDiagnosis {
        var encoded: [String] = []
        for image in images.prefix(maxImages) {
            guard
                let jpegData = image.jpegData(compressionQuality: 0.9),
                let processed = ImageProcessing.prepareForStorage(jpegData)
            else { continue }
            encoded.append(processed.detailData.base64EncodedString())
        }
        guard !encoded.isEmpty else { throw AIServiceError.noUsablePhoto }

        struct RequestBody: Encodable {
            var images: [String]
            var context: PlantAIContext
        }
        return try await AIBackend.invoke(
            "diagnose-plant-problem",
            body: RequestBody(images: encoded, context: context)
        )
    }
}
