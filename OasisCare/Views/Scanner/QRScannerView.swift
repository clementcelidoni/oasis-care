import SwiftUI
import VisionKit

/// Thin UIViewControllerRepresentable wrapper around VisionKit's live
/// QR scanner (spec §43). `isSupported` MUST be checked before this is
/// ever instantiated — DataScannerViewController isn't available in
/// Simulator or on some older devices, and creating one where it isn't
/// supported crashes rather than failing gracefully.
struct QRScannerView: UIViewControllerRepresentable {
    var onScan: (String) -> Void

    static var isSupported: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighlightingEnabled: true
        )
        controller.delegate = context.coordinator
        try? controller.startScanning()
        return controller
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan)
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onScan: (String) -> Void
        private var hasScanned = false

        init(onScan: @escaping (String) -> Void) {
            self.onScan = onScan
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !hasScanned, let first = addedItems.first else { return }
            guard case .barcode(let barcode) = first, let payload = barcode.payloadStringValue else { return }
            hasScanned = true
            onScan(payload)
        }
    }
}
