import SwiftUI

struct EmailSignInView: View {
    @Environment(\.dismiss) private var dismiss

    private enum Step {
        case enterEmail
        case enterCode
    }

    @State private var step: Step = .enterEmail
    @State private var email = ""
    @State private var code = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var resendAvailableAt: Date = .now

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                switch step {
                case .enterEmail:
                    emailStep
                case .enterCode:
                    codeStep
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Connexion")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
            }
        }
    }

    private var emailStep: some View {
        VStack(spacing: 16) {
            Text("Entrez votre adresse e-mail")
                .font(.headline)

            TextField("email@exemple.com", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("emailField")

            Button {
                Task { await sendCode() }
            } label: {
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Recevoir mon code")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!isValidEmail || isLoading)
            .accessibilityIdentifier("sendCodeButton")
        }
    }

    private var codeStep: some View {
        VStack(spacing: 16) {
            Text("Nous avons envoyé un code à\n\(maskedEmail)")
                .font(.headline)
                .multilineTextAlignment(.center)

            TextField("123456", text: $code)
                .keyboardType(.numberPad)
                .textFieldStyle(.roundedBorder)
                .multilineTextAlignment(.center)
                .font(.title2.monospacedDigit())
                .accessibilityIdentifier("codeField")

            Button {
                Task { await verifyCode() }
            } label: {
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Continuer")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(code.count < 6 || isLoading)
            .accessibilityIdentifier("verifyCodeButton")

            Button("Renvoyer le code") {
                Task { await sendCode() }
            }
            .font(.caption)
            .disabled(resendAvailableAt > .now || isLoading)
        }
    }

    private var isValidEmail: Bool {
        email.contains("@") && email.contains(".")
    }

    private var maskedEmail: String {
        guard let atIndex = email.firstIndex(of: "@"), let first = email.first else { return email }
        return "\(first)*****\(email[atIndex...])"
    }

    private func sendCode() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }
        do {
            try await AuthService.sendEmailCode(to: email)
            step = .enterCode
            resendAvailableAt = Calendar.current.date(byAdding: .second, value: 30, to: .now) ?? .now
        } catch {
            errorMessage = "Impossible d'envoyer le code. Vérifiez votre adresse e-mail et réessayez."
        }
    }

    private func verifyCode() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }
        do {
            try await AuthService.verifyEmailCode(email: email, code: code)
            dismiss()
        } catch {
            errorMessage = "Code invalide ou expiré. Réessayez ou demandez un nouveau code."
        }
    }
}
