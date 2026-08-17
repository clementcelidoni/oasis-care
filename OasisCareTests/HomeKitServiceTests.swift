import XCTest
import HomeKit
@testable import OasisCare

/// Spec §10/§26's "toujours détecter dynamiquement" requirement means
/// this mapping is the one place a wrong constant would silently make
/// Oasis under- or mis-report what an accessory can do — worth locking
/// down against the real HMServiceType constants rather than hand-typed
/// UUID strings.
final class HomeKitServiceTests: XCTestCase {
    func testValveServiceMapsToValveCapability() {
        XCTAssertEqual(HomeKitService.capabilities(forServiceType: HMServiceTypeValve), [.valve])
    }

    func testFaucetServiceMapsToValveCapability() {
        XCTAssertEqual(HomeKitService.capabilities(forServiceType: HMServiceTypeFaucet), [.valve])
    }

    func testIrrigationSystemMapsToValveAndPump() {
        XCTAssertEqual(HomeKitService.capabilities(forServiceType: HMServiceTypeIrrigationSystem), [.valve, .pump])
    }

    func testTemperatureSensorMapsToTemperatureSensorCapability() {
        XCTAssertEqual(HomeKitService.capabilities(forServiceType: HMServiceTypeTemperatureSensor), [.temperatureSensor])
    }

    func testHumiditySensorMapsToHumiditySensorCapability() {
        XCTAssertEqual(HomeKitService.capabilities(forServiceType: HMServiceTypeHumiditySensor), [.humiditySensor])
    }

    func testLightbulbMapsToLightCapability() {
        XCTAssertEqual(HomeKitService.capabilities(forServiceType: HMServiceTypeLightbulb), [.light])
    }

    func testSwitchAndOutletBothMapToSwitchDevice() {
        XCTAssertEqual(HomeKitService.capabilities(forServiceType: HMServiceTypeSwitch), [.switchDevice])
        XCTAssertEqual(HomeKitService.capabilities(forServiceType: HMServiceTypeOutlet), [.switchDevice])
    }

    /// The precise "don't invent" case: HomeKit's standard catalog has
    /// no soil-moisture service, so an unrecognized/garden-specific
    /// service type must return no capability rather than guessing one.
    func testUnknownServiceTypeReturnsNoCapabilities() {
        XCTAssertEqual(HomeKitService.capabilities(forServiceType: "not-a-real-service-type"), [])
    }

    func testAccessoryInformationServiceReturnsNoCapabilities() {
        XCTAssertEqual(HomeKitService.capabilities(forServiceType: HMServiceTypeAccessoryInformation), [])
    }
}
