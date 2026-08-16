import Foundation
import Supabase

/// Single entry point for every Supabase Auth call — views never talk to
/// SupabaseClient directly (mirrors CareScheduleEngine's "one path in" shape
/// from earlier phases).
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

    /// Uses Supabase's OAuth flow (ASWebAuthenticationSession under the
    /// hood) rather than the native GoogleSignIn SDK — one fewer
    /// third-party dependency, and Supabase handles the OAuth exchange
    /// server-side. The redirect scheme must also be allow-listed in the
    /// Supabase dashboard under Authentication → URL Configuration.
    static func signInWithGoogle() async throws {
        try await client.auth.signInWithOAuth(
            provider: .google,
            redirectTo: URL(string: "com.oasisrarecare.app://")
        ) { _ in }
    }

    static func signOut() async throws {
        try await client.auth.signOut()
    }

    /// Calls the delete-account Edge Function — real, irreversible deletion
    /// (Storage photos, all workspace data, the auth user itself), never a
    /// soft deactivation. Deleting the auth user needs the service_role
    /// key, which must never be in this app, hence the server-side
    /// function; see supabase/functions/delete-account.
    static func deleteAccount() async throws {
        struct DeleteAccountResponse: Decodable {
            var success: Bool
        }
        let _: DeleteAccountResponse = try await client.functions.invoke("delete-account")
    }

    static var authStateChanges: AsyncStream<(event: AuthChangeEvent, session: Session?)> {
        get async {
            await client.auth.authStateChanges
        }
    }
}
