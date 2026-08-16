import Foundation

/// Calls the diagnose-plant-problem Edge Function — spec §43-45.
enum PlantHealthService {
    static let maxImages = 4

    /// `images` are raw JPEG bytes, as produced by CameraCaptureView.
    static func diagnose(images: [Data], context: PlantAIContext) async throws -> PlantDiagnosis {
        var encoded: [String] = []
        for imageData in images.prefix(maxImages) {
            guard let processed = ImageProcessing.prepareForStorage(imageData) else { continue }
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
