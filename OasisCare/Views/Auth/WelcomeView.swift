import AuthenticationServices
import SwiftUI

struct WelcomeView: View {
    var onContinueAsGuest: () -> Void

    @State private var isEmailFlowPresented = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 8) {
                Image(systemName: "leaf.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Color.accentColor)
                Text("Oasis Care")
                    .font(.largeTitle.weight(.bold))
                Text("Prenez soin de tout votre univers végétal.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Spacer()

            VStack(spacing: 12) {
                AppleSignInButton(
                    onSuccess: { errorMessage = nil },
                    onError: { errorMessage = $0 }
                )
                .frame(height: 50)
                .accessibilityIdentifier("appleSignInButton")

                Button {
                    Task { await signInWithGoogle() }
                } label: {
                    Label("Continuer avec Google", systemImage: "globe")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .accessibilityIdentifier("googleSignInButton")

                HStack(spacing: 8) {
                    VStack { Divider() }
                    Text("ou")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    VStack { Divider() }
                }

                Button {
                    isEmailFlowPresented = true
                } label: {
                    Label("Continuer avec e-mail", systemImage: "envelope")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .accessibilityIdentifier("continueWithEmailButton")

                Button("Continuer sans compte", action: onContinueAsGuest)
                    .font(.subheadline)
                    .padding(.top, 4)
                    .accessibilityIdentifier("continueAsGuestButton")
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
        }
        .padding()
        .sheet(isPresented: $isEmailFlowPresented) {
            EmailSignInView()
        }
    }

    private func signInWithGoogle() async {
        do {
            try await AuthService.signInWithGoogle()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct AppleSignInButton: View {
    var onSuccess: () -> Void
    var onError: (String) -> Void

    @State private var currentNonce: String?

    var body: some View {
        SignInWithAppleButton(.continue) { request in
            let nonce = AppleSignInNonce.random()
            currentNonce = nonce
            request.requestedScopes = [.fullName, .email]
            request.nonce = AppleSignInNonce.sha256(nonce)
        } onCompletion: { result in
            Task { await handle(result) }
        }
        .signInWithAppleButtonStyle(.black)
    }

    private func handle(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .success(let authorization):
            guard
                let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                let identityTokenData = credential.identityToken,
                let identityToken = String(data: identityTokenData, encoding: .utf8),
                let nonce = currentNonce
            else {
                onError("Réponse Apple invalide.")
                return
            }
            do {
                try await AuthService.signInWithApple(idToken: identityToken, nonce: nonce)
                onSuccess()
            } catch {
                onError(error.localizedDescription)
            }
        case .failure(let error):
            let nsError = error as NSError
            if nsError.domain == ASAuthorizationError.errorDomain, nsError.code == ASAuthorizationError.canceled.rawValue {
                return
            }
            onError(error.localizedDescription)
        }
    }
}
