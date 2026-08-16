import UIKit

/// Calls the identify-plant Edge Function (Pl@ntNet) — spec §30-31.
enum PlantIdentificationService {
    static let maxImages = 5

    enum Organ: String {
        case auto, leaf, flower, fruit, bark
    }

    struct CapturedPhoto {
        var image: UIImage
        var organ: Organ
    }

    static func identify(_ photos: [CapturedPhoto]) async throws -> [PlantIdentificationResult] {
        var images: [String] = []
        var organs: [String] = []
        for photo in photos.prefix(maxImages) {
            guard
                let jpegData = photo.image.jpegData(compressionQuality: 0.9),
                let processed = ImageProcessing.prepareForStorage(jpegData)
            else { continue }
            images.append(processed.detailData.base64EncodedString())
            organs.append(photo.organ.rawValue)
        }
        guard !images.isEmpty else { throw AIServiceError.noUsablePhoto }

        struct RequestBody: Encodable {
            var images: [String]
            var organs: [String]
        }
        struct ResponseBody: Decodable {
            var results: [PlantIdentificationResult]
        }
        let response: ResponseBody = try await AIBackend.invoke(
            "identify-plant",
            body: RequestBody(images: images, organs: organs)
        )
        return response.results
    }
}
