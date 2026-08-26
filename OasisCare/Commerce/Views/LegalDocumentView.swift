import SwiftUI

struct LegalDocumentView: View {
    var document: LegalDocument

    @Environment(\.dismiss) private var dismiss

    private var text: String {
        switch document {
        case .terms: return LegalContent.termsOfUse
        case .privacy: return LegalContent.privacyPolicy
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(text)
                    .font(.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .navigationTitle(document.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
    }
}
