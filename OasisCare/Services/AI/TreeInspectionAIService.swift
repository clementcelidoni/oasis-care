import Foundation

/// Calls the analyze-tree-inspection and compare-tree-photos Edge
/// Functions — spec §59-60.
enum TreeInspectionAIService {
    static let maxImages = 4

    /// `images` are raw JPEG bytes, as produced by CameraCaptureView.
    static func analyzeInspectionPhotos(images: [Data], context: TreeInspectionAIContext) async throws -> TreeInspectionAnalysis {
        let encoded = encode(images, limit: maxImages)
        guard !encoded.isEmpty else { throw AIServiceError.noUsablePhoto }

        struct RequestBody: Encodable {
            var images: [String]
            var context: TreeInspectionAIContext
        }
        return try await AIBackend.invoke(
            "analyze-tree-inspection",
            body: RequestBody(images: encoded, context: context)
        )
    }

    static func comparePhotos(before: Data, after: Data, context: TreeInspectionAIContext) async throws -> TreePhotoComparison {
        guard
            let beforeEncoded = encode([before], limit: 1).first,
            let afterEncoded = encode([after], limit: 1).first
        else {
            throw AIServiceError.noUsablePhoto
        }

        struct RequestBody: Encodable {
            var beforeImage: String
            var afterImage: String
            var context: TreeInspectionAIContext
        }
        return try await AIBackend.invoke(
            "compare-tree-photos",
            body: RequestBody(beforeImage: beforeEncoded, afterImage: afterEncoded, context: context)
        )
    }

    private static func encode(_ images: [Data], limit: Int) -> [String] {
        var encoded: [String] = []
        for imageData in images.prefix(limit) {
            guard let processed = ImageProcessing.prepareForStorage(imageData) else { continue }
            encoded.append(processed.detailData.base64EncodedString())
        }
        return encoded
    }
}

/// Spec §59: "Oasis AI reçoit uniquement les informations pertinentes"
/// — species/type and, when available, the most recent measurements,
/// never the plant's full history.
struct TreeInspectionAIContext: Encodable {
    var scientificName: String?
    var commonName: String?
    var plantType: String?
    var latestHeight: Double?
    var latestTrunkCircumference: Double?
    var latestCanopyDiameter: Double?
    var estimatedAge: Int?

    static func build(for plant: Plant) -> TreeInspectionAIContext {
        let latest = plant.sortedMeasurements.first
        return TreeInspectionAIContext(
            scientificName: plant.scientificName,
            commonName: plant.commonName,
            plantType: plant.type.displayName,
            latestHeight: latest?.height,
            latestTrunkCircumference: latest?.trunkCircumference,
            latestCanopyDiameter: latest?.canopyDiameter,
            estimatedAge: latest?.estimatedAge
        )
    }
}
