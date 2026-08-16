import Foundation
import Supabase

/// Shared entry point for every AI Edge Function call — mirrors
/// AuthService/DeletionService's "one path in" shape. Every AI feature
/// (identification, profile completion, assistant, diagnosis) routes
/// through here, never calls `client.functions.invoke` directly.
enum AIBackend {
    static func invoke<Body: Encodable, Response: Decodable>(_ function: String, body: Body) async throws -> Response {
        do {
            return try await AuthService.client.functions.invoke(function, options: FunctionInvokeOptions(body: body))
        } catch let error as FunctionsError {
            throw AIServiceError.server(serverMessage(from: error) ?? error.localizedDescription)
        }
    }

    /// Edge Functions reply with `{"error": "message in French"}` on
    /// failure — this pulls that message out instead of surfacing a
    /// generic "the request failed" (spec's own tests explicitly call
    /// for exercising these failure paths: unauthenticated, missing key,
    /// provider timeout, invalid response, oversized file).
    private static func serverMessage(from error: FunctionsError) -> String? {
        guard case .httpError(_, let data) = error else { return nil }
        struct ErrorBody: Decodable { var error: String }
        return try? JSONDecoder().decode(ErrorBody.self, from: data).error
    }
}

enum AIServiceError: LocalizedError {
    case server(String)
    case noUsablePhoto

    var errorDescription: String? {
        switch self {
        case .server(let message): return message
        case .noUsablePhoto: return "Aucune photo valide à analyser."
        }
    }
}
