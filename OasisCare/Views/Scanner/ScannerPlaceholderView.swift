import SwiftUI

struct ScannerPlaceholderView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "camera.viewfinder")
                    .font(.system(size: 56))
                    .foregroundStyle(.secondary)
                Text("Scanner")
                    .font(.title2.weight(.semibold))
                Text("L'identification de plantes par photo et le scan de QR code arrivent dans une prochaine version.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("Scanner")
        }
    }
}
