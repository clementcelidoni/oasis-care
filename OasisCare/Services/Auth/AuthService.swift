import Foundation
import Supabase

enum AuthServiceError: LocalizedError {
    case notConfigured(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured(let feature):
            return "\(feature) n'est pas encore configuré."
        }
    }
}

/// Single entry point for every Supabase Auth call — views never talk to
/// SupabaseClient directly (mirrors CareScheduleEngine's "one path in" shape
/// from earlier phases). Google sign-in is stubbed until its Google Cloud
/// OAuth client exists; Apple sign-in works today but needs the Sign in
/// with Apple capability enabled on the App ID (and the provisioning
/// profile regenerated) before a Release archive can use it.
enum AuthService {
    static let client = SupabaseClient(supabaseURL: SupabaseConfig.url, supabaseKey: SupabaseConfig.publishableKey)

    static func sendEmailCode(to email: String) async throws {
        try await client.auth.signInWithOTP(email: email)
    }

    static func verifyEmailCode(email: String, code: String) async throws {
        try await client.auth.verifyOTP(email: email, token: code, type: .email)
    }

    static func signInWithApple(idToken: String, nonce: String) async throws {
        try await client.auth.signInWithIdToken(
            credentials: OpenIDConnectCredentials(provider: .apple, idToken: idToken, nonce: nonce)
        )
    }

    static func signInWithGoogle() async throws {
        throw AuthServiceError.notConfigured("La connexion Google")
    }

    static func signOut() async throws {
        try await client.auth.signOut()
    }

    static var authStateChanges: AsyncStream<(event: AuthChangeEvent, session: Session?)> {
        get async {
            await client.auth.authStateChanges
        }
    }
}
