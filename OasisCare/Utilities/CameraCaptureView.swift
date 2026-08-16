import SwiftUI
import UIKit

/// Bridges `UIImagePickerController`'s camera source into SwiftUI — there is
/// no native SwiftUI camera capture API; `PhotosPicker` only reaches the
/// photo library. Caller should check
/// `UIImagePickerController.isSourceTypeAvailable(.camera)` before
/// presenting this, since it's never available in the Simulator.
///
/// Owns dismissal itself via `isPresented` so both capture and the system
/// Cancel button correctly tear down the enclosing `fullScreenCover` —
/// without wiring Cancel through, the camera UI would have no way back.
struct CameraCaptureView: UIViewControllerRepresentable {
    @Binding var isPresented: Bool
    var onCapture: (Data) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(isPresented: $isPresented, onCapture: onCapture)
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        var isPresented: Binding<Bool>
        var onCapture: (Data) -> Void

        init(isPresented: Binding<Bool>, onCapture: @escaping (Data) -> Void) {
            self.isPresented = isPresented
            self.onCapture = onCapture
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.9) {
                onCapture(data)
            }
            isPresented.wrappedValue = false
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            isPresented.wrappedValue = false
        }
    }
}
