import Foundation

/// What the biolab-ai-assistant Edge Function knows when answering a
/// lab-wide question (spec Phase 7I: espèce/cultivar/stade/recette/
/// programme/inspections/capteurs/performances historiques) — same
/// "summarize, never dump the whole database" discipline as
/// GardenAIContext, so questions like "Pourquoi BR04 multiplie moins
/// vite que BR03 ?" or "Quels lots ont montré le plus d'hyperhydricité ?"
/// have real, but bounded, data to answer from.
struct BioLabAIContext: Encodable {
    var batchCount: Int
    var bioreactorCount: Int
    var batchSummaries: [String]
    var bioreactorSummaries: [String]
    var recentFindings: [String]

    static func build(batches: [CultureBatch], bioreactors: [Bioreactor]) -> BioLabAIContext {
        let batchSummaries = batches.prefix(25).map { batch -> String in
            var parts = ["\(batch.batchCode) (\(batch.speciesName))", "stade \(batch.cultureStage.label)"]
            if batch.initialExplantCount > 0 {
                let multiplication = Double(batch.currentCount) / Double(batch.initialExplantCount)
                parts.append("multiplication x\(String(format: "%.1f", multiplication))")
            }
            if let version = batch.mediumRecipeVersion {
                parts.append("recette V\(version.versionNumber)")
            }
            return parts.joined(separator: ", ")
        }

        let bioreactorSummaries = bioreactors.prefix(25).map { reactor -> String in
            var parts = ["\(reactor.code) (\(reactor.bioreactorType.label))"]
            if let program = reactor.activeProgramVersion {
                if program.immersionEnabled {
                    parts.append("immersion \(program.immersionDurationSeconds)s toutes les \(program.immersionIntervalMinutes)min")
                }
                if program.aerationEnabled {
                    parts.append("aération \(program.aerationDurationSeconds)s toutes les \(program.aerationIntervalMinutes)min")
                }
            }
            if let batch = reactor.currentBatch {
                parts.append("lot actuel \(batch.batchCode)")
            }
            let temperatures = reactor.sensors
                .filter { $0.type == .mediumTemperature || $0.type == .airTemperature }
                .compactMap { $0.latestReading?.value }
            if !temperatures.isEmpty {
                let average = temperatures.reduce(0, +) / Double(temperatures.count)
                parts.append("température moyenne \(String(format: "%.1f", average))°C")
            }
            return parts.joined(separator: ", ")
        }

        // Most safety-relevant findings across every batch, most recent
        // first — the concrete data behind "quels lots ont montré le
        // plus d'hyperhydricité" / "montre-moi les lots avec suspicion
        // de contamination" without ever sending the model every
        // inspection ever recorded.
        let recentFindings = batches
            .flatMap { batch -> [(Date, String)] in
                batch.inspections
                    .filter { $0.contaminationStatus != .noneObserved || ($0.hyperhydricityStatus != .none && $0.hyperhydricityStatus != .unknown) }
                    .map { inspection in
                        var note = "\(batch.batchCode) (\(DateFormatting.shortDate(inspection.date)))"
                        if inspection.contaminationStatus != .noneObserved {
                            note += " — contamination \(inspection.contaminationStatus.label.lowercased())"
                        }
                        if inspection.hyperhydricityStatus != .none, inspection.hyperhydricityStatus != .unknown {
                            note += " — hyperhydricité \(inspection.hyperhydricityStatus.label.lowercased())"
                        }
                        return (inspection.date, note)
                    }
            }
            .sorted { $0.0 > $1.0 }
            .prefix(20)
            .map(\.1)

        return BioLabAIContext(
            batchCount: batches.count, bioreactorCount: bioreactors.count,
            batchSummaries: Array(batchSummaries), bioreactorSummaries: Array(bioreactorSummaries),
            recentFindings: Array(recentFindings)
        )
    }
}
