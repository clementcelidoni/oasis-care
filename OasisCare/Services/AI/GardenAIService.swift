import Foundation

/// Calls the garden-ai-assistant Edge Function — the global "✨
/// Demander à Oasis" entry point (spec §12, §68), as opposed to
/// PlantAIService which answers about one plant.
enum GardenAIService {
    static func ask(_ question: String, context: GardenAIContext) async throws -> String {
        struct RequestBody: Encodable {
            var question: String
            var context: GardenAIContext
        }
        struct ResponseBody: Decodable {
            var answer: String
        }
        let response: ResponseBody = try await AIBackend.invoke(
            "garden-ai-assistant",
            body: RequestBody(question: question, context: context)
        )
        return response.answer
    }
}
