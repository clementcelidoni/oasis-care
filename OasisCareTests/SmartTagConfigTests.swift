import XCTest
@testable import OasisCare

/// SmartTagConfig.token(from:) has to correctly parse two structurally
/// different URL shapes (spec §41's real https Universal Link, and the
/// app's own custom-scheme fallback used for testing before Associated
/// Domains is configured) — exactly the kind of easy-to-get-subtly-wrong
/// parsing logic worth locking down with a test.
final class SmartTagConfigTests: XCTestCase {
    func testTokenFromHTTPSUniversalLink() {
        let url = URL(string: "https://oasis-care.example/p/abc123")!
        XCTAssertEqual(SmartTagConfig.token(from: url), "abc123")
    }

    func testTokenFromCustomSchemeLink() {
        let url = URL(string: "com.oasisrarecare.app://p/abc123")!
        XCTAssertEqual(SmartTagConfig.token(from: url), "abc123")
    }

    func testTokenFromHTTPSMissingTokenSegmentReturnsNil() {
        let url = URL(string: "https://oasis-care.example/p/")!
        XCTAssertNil(SmartTagConfig.token(from: url))
    }

    func testTokenFromUnrelatedPathReturnsNil() {
        let url = URL(string: "https://oasis-care.example/other/abc123")!
        XCTAssertNil(SmartTagConfig.token(from: url))
    }

    func testTokenFromUnrelatedCustomSchemeHostReturnsNil() {
        let url = URL(string: "com.oasisrarecare.app://other/abc123")!
        XCTAssertNil(SmartTagConfig.token(from: url))
    }

    func testGeneratedURLRoundTripsThroughTokenParsing() {
        let token = "deadbeef1234"
        let url = URL(string: SmartTagConfig.url(forToken: token))!
        XCTAssertEqual(SmartTagConfig.token(from: url), token)
    }
}
