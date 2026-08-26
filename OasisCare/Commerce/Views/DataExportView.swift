import SwiftData
import SwiftUI
import UniformTypeIdentifiers

/// Phase 12 §"12M — EXPORT DES DONNÉES."
struct DataExportView: View {
    @Query private var plants: [Plant]
    @Query private var gardens: [Garden]
    @State private var exportedFile: ExportedFile?
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section {
                LabeledContent("Végétaux", value: "\(plants.count)")
                LabeledContent("Jardins", value: "\(gardens.count)")
            } footer: {
                Text("L'export inclut vos végétaux (avec historique de soins et mesures) et vos jardins, au format JSON. Les données BioLab et des appareils connectés ne sont pas encore incluses dans cet export — contactez le support si vous en avez besoin.")
            }

            Section {
                Button("Générer l'export") { generateExport() }
                if let errorMessage {
                    Text(errorMessage).font(.caption).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Exporter mes données")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $exportedFile) { file in
            ShareLink(item: file.url, preview: SharePreview(file.url.lastPathComponent))
                .padding()
        }
    }

    private func generateExport() {
        errorMessage = nil
        guard let data = DataExportService.buildExport(plants: plants, gardens: gardens) else {
            errorMessage = "L'export n'a pas pu être généré."
            return
        }
        let fileName = "oasis-care-export-\(Int(Date.now.timeIntervalSince1970)).json"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        do {
            try data.write(to: url, options: .atomic)
            exportedFile = ExportedFile(url: url)
        } catch {
            errorMessage = "Le fichier d'export n'a pas pu être écrit."
        }
    }
}

private struct ExportedFile: Identifiable {
    var id: String { url.path }
    var url: URL
}
