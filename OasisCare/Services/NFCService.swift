import CoreNFC
import Foundation

enum NFCServiceError: LocalizedError {
    case unavailable
    case busy
    case notWritable
    case notNDEF
    case cancelled
    case underlying(String)

    var errorDescription: String? {
        switch self {
        case .unavailable: return "La lecture NFC n'est pas disponible sur cet appareil."
        case .busy: return "Une session NFC est déjà en cours."
        case .notWritable: return "Ce tag NFC ne peut pas être écrit. Utilisez un tag NFC compatible et réinscriptible."
        case .notNDEF: return "Ce tag n'est pas compatible NDEF."
        case .cancelled: return "Lecture NFC annulée."
        case .underlying(let message): return message
        }
    }
}

/// Wraps Core NFC end to end (spec §44) — callers only ever see `read()`/
/// `write(url:)` returning plain Swift values or throwing
/// `NFCServiceError`; no NFCNDEFReaderSession/NFCNDEFTag type crosses
/// into the UI layer. `read()` uses the auto-invalidating
/// `didDetectNDEFs` callback (simplest path for "what's on this tag,
/// if anything"); `write()` needs the lower-level `didDetect tags:`
/// callback so it can inspect NDEF status before committing anything.
@MainActor
final class NFCService: NSObject {
    static let shared = NFCService()

    private override init() {}

    private var session: NFCNDEFReaderSession?
    private var readContinuation: CheckedContinuation<URL, Error>?
    private var writeContinuation: CheckedContinuation<Void, Error>?
    private var urlToWrite: URL?

    var isAvailable: Bool { NFCNDEFReaderSession.readingAvailable }

    /// Reads the first URI record found. Used both for spec §49 (scan an
    /// Oasis tag to open its plant) and, internally, to check a tag's
    /// existing content before writing (spec §47's conflict check).
    func read(alertMessage: String) async throws -> URL {
        guard isAvailable else { throw NFCServiceError.unavailable }
        guard session == nil else { throw NFCServiceError.busy }
        return try await withCheckedThrowingContinuation { continuation in
            readContinuation = continuation
            urlToWrite = nil
            let session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: true)
            session.alertMessage = alertMessage
            self.session = session
            session.begin()
        }
    }

    /// Writes `url` as a single NDEF URI record (spec §45). Throws
    /// `.notWritable` if the tag reports read-only/unsupported status.
    func write(url: URL, alertMessage: String) async throws {
        guard isAvailable else { throw NFCServiceError.unavailable }
        guard session == nil else { throw NFCServiceError.busy }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            writeContinuation = continuation
            urlToWrite = url
            let session = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: false)
            session.alertMessage = alertMessage
            self.session = session
            session.begin()
        }
    }

    private func finishWrite(_ result: Result<Void, NFCServiceError>) {
        switch result {
        case .success: writeContinuation?.resume()
        case .failure(let error): writeContinuation?.resume(throwing: error)
        }
        writeContinuation = nil
    }
}

extension NFCService: NFCNDEFReaderSessionDelegate {
    nonisolated func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        Task { @MainActor in
            let nsError = error as NSError
            let wasCancelled = nsError.domain == NFCReaderError.errorDomain
                && nsError.code == NFCReaderError.readerSessionInvalidationErrorUserCanceled.rawValue
            let failure: Error = wasCancelled ? NFCServiceError.cancelled : NFCServiceError.underlying(error.localizedDescription)
            self.readContinuation?.resume(throwing: failure)
            self.readContinuation = nil
            self.writeContinuation?.resume(throwing: failure)
            self.writeContinuation = nil
            self.session = nil
        }
    }

    nonisolated func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {
        Task { @MainActor in
            guard let url = Self.firstURI(in: messages) else {
                self.readContinuation?.resume(throwing: NFCServiceError.notNDEF)
                self.readContinuation = nil
                self.session = nil
                return
            }
            self.readContinuation?.resume(returning: url)
            self.readContinuation = nil
            self.session = nil
        }
    }

    nonisolated func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard let tag = tags.first else {
            session.invalidate(errorMessage: "Tag NFC non reconnu.")
            return
        }
        session.connect(to: tag) { connectError in
            if let connectError {
                session.invalidate(errorMessage: "Connexion au tag impossible.")
                Task { @MainActor in self.finishWrite(.failure(.underlying(connectError.localizedDescription))) }
                return
            }
            tag.queryNDEFStatus { status, _, statusError in
                if let statusError {
                    session.invalidate(errorMessage: "Impossible de lire le statut du tag.")
                    Task { @MainActor in self.finishWrite(.failure(.underlying(statusError.localizedDescription))) }
                    return
                }
                switch status {
                case .readOnly, .notSupported:
                    session.invalidate(errorMessage: "Ce tag NFC ne peut pas être écrit.")
                    Task { @MainActor in self.finishWrite(.failure(.notWritable)) }
                case .readWrite:
                    Task { @MainActor in self.writeNDEF(to: tag, session: session) }
                @unknown default:
                    session.invalidate(errorMessage: "Statut du tag NFC inconnu.")
                    Task { @MainActor in self.finishWrite(.failure(.notWritable)) }
                }
            }
        }
    }

    @MainActor
    private func writeNDEF(to tag: NFCNDEFTag, session: NFCNDEFReaderSession) {
        guard let urlToWrite, let payload = NFCNDEFPayload.wellKnownTypeURIPayload(url: urlToWrite) else {
            session.invalidate(errorMessage: "URL invalide.")
            finishWrite(.failure(.underlying("URL invalide.")))
            return
        }
        let message = NFCNDEFMessage(records: [payload])
        tag.writeNDEF(message) { writeError in
            Task { @MainActor in
                if let writeError {
                    session.invalidate(errorMessage: "Écriture impossible.")
                    self.finishWrite(.failure(.underlying(writeError.localizedDescription)))
                } else {
                    session.alertMessage = "✓ Tag NFC associé"
                    session.invalidate()
                    self.finishWrite(.success(()))
                }
            }
        }
    }

    private static func firstURI(in messages: [NFCNDEFMessage]) -> URL? {
        for message in messages {
            for record in message.records {
                if let url = record.wellKnownTypeURIPayload() {
                    return url
                }
            }
        }
        return nil
    }
}
