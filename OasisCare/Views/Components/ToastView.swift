import SwiftUI

struct ToastView: View {
    var message: ToastMessage
    var onUndo: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(message.title)
                    .font(.subheadline.weight(.semibold))
                if let subtitle = message.subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if message.undoAction != nil {
                Button("Annuler", action: onUndo)
                    .font(.subheadline.weight(.medium))
            }
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .shadow(color: .black.opacity(0.15), radius: 8, y: 2)
        .padding(.horizontal)
    }
}
