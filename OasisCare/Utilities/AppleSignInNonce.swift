import CryptoKit
import Foundation

/// Standard Sign in with Apple nonce pattern: a random nonce is generated
/// locally, its SHA256 hash is sent to Apple in the authorization request,
/// and the original (unhashed) nonce is later sent to Supabase alongside
/// Apple's identity token so it can verify the hash matches — proving the
/// token was issued for this exact request, not replayed.
enum AppleSignInNonce {
    static func random(length: Int = 32) -> String {
        precondition(length > 0)
        var randomBytes = [UInt8](repeating: 0, count: length)
        let status = SecRandomCopyBytes(kSecRandomDefault, randomBytes.count, &randomBytes)
        if status != errSecSuccess {
            fatalError("Impossible de générer un nonce sécurisé : \(status)")
        }
        let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        return String(randomBytes.map { charset[Int($0) % charset.count] })
    }

    static func sha256(_ input: String) -> String {
        let hashed = SHA256.hash(data: Data(input.utf8))
        return hashed.compactMap { String(format: "%02x", $0) }.joined()
    }
}
