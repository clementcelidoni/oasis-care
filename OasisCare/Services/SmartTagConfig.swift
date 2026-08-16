import Foundation

/// PLACEHOLDER — Universal Links (spec §41, §50) need a real domain the
/// user owns, with an apple-app-site-association file hosted at its
/// `.well-known/` path and the Associated Domains capability enabled in
/// the Apple Developer Portal (see the Phase 4 report for exact steps).
/// `.example` is the IANA-reserved placeholder TLD (RFC 2606) — it can
/// never resolve to a real site by accident. Replace `domain` once a
/// real one is available; every tag's URL is computed from the token,
/// not stored, so this is the only place that needs to change.
enum SmartTagConfig {
    static let domain = "oasis-care.example"

    static func url(forToken token: String) -> String {
        "https://\(domain)/p/\(token)"
    }

    /// `https://<domain>/p/<token>` → host is the domain, `p`/`token`
    /// are path components. `com.oasisrarecare.app://p/<token>` (the
    /// app's existing custom scheme, already registered — no
    /// Associated Domains entitlement needed) → `p` parses as the host
    /// instead, since there's no domain before it. Both are accepted,
    /// from a Universal Link, a manually-typed test URL, or a tag
    /// physically written with either form.
    static func token(from url: URL) -> String? {
        if url.scheme == "https" || url.scheme == "http" {
            let parts = url.pathComponents.filter { $0 != "/" }
            guard parts.count >= 2, parts[0] == "p" else { return nil }
            return parts[1]
        }
        guard url.host == "p" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        return parts.first
    }
}
