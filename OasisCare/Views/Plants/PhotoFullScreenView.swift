import SwiftUI
import UIKit

struct PhotoFullScreenView: View {
    var photo: PlantPhoto

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.ignoresSafeArea()

            if let uiImage = UIImage(data: photo.imageData) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
            }

            captionOverlay

            closeButton
        }
    }

    private var closeButton: some View {
        VStack {
            HStack {
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.white, .black.opacity(0.4))
                }
                .padding()
                .accessibilityIdentifier("closePhotoViewer")
            }
            Spacer()
        }
    }

    private var captionOverlay: some View {
        VStack(spacing: 4) {
            Text(DateFormatting.shortDate(photo.date))
                .font(.subheadline.weight(.medium))
            if !photo.notes.isEmpty {
                Text(photo.notes)
                    .font(.caption)
            }
        }
        .foregroundStyle(.white)
        .padding()
        .frame(maxWidth: .infinity)
        .background(.black.opacity(0.6))
    }
}
