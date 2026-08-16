import Foundation

/// Calls the plant-ai-assistant Edge Function — the per-plant "✨
/// Assistant IA" (spec §41-42).
enum PlantAIService {
    static func ask(_ question: String, about plant: Plant) async throws -> String {
        struct RequestBody: Encodable {
            var question: String
            var context: PlantAIContext
        }
        struct ResponseBody: Decodable {
            var answer: String
        }
        let response: ResponseBody = try await AIBackend.invoke(
            "plant-ai-assistant",
            body: RequestBody(question: question, context: PlantAIContext.build(for: plant))
        )
        return response.answer
    }
}
