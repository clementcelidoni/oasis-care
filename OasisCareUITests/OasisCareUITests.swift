import XCTest

/// Automates the Phase 1 success criteria from the spec (section 38):
/// create a garden, a zone, a plant, set a watering frequency, water it,
/// see the schedule update, see it in history, then the same for fertilizing.
final class OasisCareUITests: XCTestCase {

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testGardenZonePlantWateringFertilizingGoldenPath() throws {
        let app = XCUIApplication()
        app.launch()

        let suffix = UUID().uuidString.prefix(6)
        let gardenName = "Jardin Test \(suffix)"
        let zoneName = "Zone Test \(suffix)"
        let plantName = "Plante Test \(suffix)"

        XCTAssertTrue(app.tabBars.buttons["Jardins"].waitForExistence(timeout: 10))

        XCTContext.runActivity(named: "Créer un jardin") { _ in
            app.tabBars.buttons["Jardins"].tap()
            app.buttons["addGardenButton"].tap()

            let nameField = app.textFields["Nom du jardin"]
            XCTAssertTrue(nameField.waitForExistence(timeout: 10))
            nameField.tap()
            nameField.typeText(gardenName)

            app.buttons["Enregistrer"].tap()

            XCTAssertTrue(app.buttons[gardenName].waitForExistence(timeout: 10))
        }

        XCTContext.runActivity(named: "Créer une zone dans ce jardin") { _ in
            app.buttons[gardenName].tap()
            app.buttons["addZoneButton"].tap()

            let zoneField = app.textFields["Nom de la zone"]
            XCTAssertTrue(zoneField.waitForExistence(timeout: 10))
            zoneField.tap()
            zoneField.typeText(zoneName)

            app.buttons["Enregistrer"].tap()

            XCTAssertTrue(app.buttons[zoneName].waitForExistence(timeout: 10))
        }

        XCTContext.runActivity(named: "Ajouter un végétal dans ce jardin et cette zone") { _ in
            app.tabBars.buttons["Végétaux"].tap()
            app.buttons["addPlantButton"].tap()

            let customNameField = app.textFields["Nom personnalisé"]
            XCTAssertTrue(customNameField.waitForExistence(timeout: 10))
            customNameField.tap()
            customNameField.typeText(plantName)

            app.buttons["gardenPicker"].tap()
            app.buttons[gardenName].tap()

            app.buttons["zonePicker"].tap()
            app.buttons[zoneName].tap()

            app.buttons["Enregistrer"].tap()

            XCTAssertTrue(app.buttons[plantName].waitForExistence(timeout: 10))
        }

        XCTContext.runActivity(named: "Vérifier que le bouton Modifier ouvre bien une feuille") { _ in
            app.buttons[plantName].tap()

            let modifierButton = app.buttons["Modifier"]
            XCTAssertTrue(modifierButton.waitForExistence(timeout: 10))
            modifierButton.tap()

            let cancelButton = app.buttons["Annuler"]
            if !cancelButton.waitForExistence(timeout: 10) {
                print("=== DEBUG: accessibility tree after tapping Modifier ===")
                print(app.debugDescription)
                print("=== END DEBUG (Modifier) ===")
            }
            XCTAssertTrue(cancelButton.exists, "Le bouton Modifier n'a pas ouvert de feuille")
            cancelButton.tap()
        }

        XCTContext.runActivity(named: "Ouvrir la fiche et définir la fréquence d'arrosage") { _ in
            let wateringRow = app.buttons["scheduleRow-watering"]
            XCTAssertTrue(wateringRow.waitForExistence(timeout: 10))
            wateringRow.tap()

            let saveScheduleButton = app.buttons["Enregistrer"]
            if !saveScheduleButton.waitForExistence(timeout: 10) {
                print("=== DEBUG: accessibility tree after tapping scheduleRow-watering ===")
                print(app.debugDescription)
                print("=== END DEBUG ===")
            }
            XCTAssertTrue(saveScheduleButton.exists)
            saveScheduleButton.tap()

            // "À démarrer" is folded into the row button's combined accessibility
            // label (icon + name + status), not a standalone staticText, so poll
            // the button's own label rather than a one-shot read - the button
            // always exists regardless of schedule state, so waitForExistence
            // alone wouldn't wait for the label content itself to update.
            let becameConfigured = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "label CONTAINS[c] %@", "À démarrer"),
                object: wateringRow
            )
            XCTAssertEqual(
                XCTWaiter().wait(for: [becameConfigured], timeout: 10),
                .completed,
                "Label was: \(wateringRow.label)"
            )
        }

        XCTContext.runActivity(named: "Arroser et vérifier la mise à jour de l'échéance") { _ in
            let wateringRow = app.buttons["scheduleRow-watering"]
            app.buttons["actionWater"].tap()

            let expectation = XCTNSPredicateExpectation(
                predicate: NSPredicate(format: "NOT (label CONTAINS[c] %@)", "À démarrer"),
                object: wateringRow
            )
            XCTAssertEqual(XCTWaiter().wait(for: [expectation], timeout: 10), .completed)

            XCTAssertFalse(app.staticTexts["Aucune intervention enregistrée."].exists)
        }

        XCTContext.runActivity(named: "Donner de l'engrais et vérifier l'historique") { _ in
            app.buttons["actionFertilize"].tap()

            XCTAssertTrue(app.staticTexts["Engrais"].firstMatch.waitForExistence(timeout: 10))
            XCTAssertFalse(app.staticTexts["Aucune intervention enregistrée."].exists)
        }

        XCTContext.runActivity(named: "Vérifier que le bouton Photo propose la photothèque") { _ in
            // PHPicker runs out-of-process and isn't reliably drivable from
            // XCUITest in CI, so this only checks the dialog wiring, not an
            // actual photo selection.
            let photoButton = app.buttons["actionPhoto"]
            XCTAssertTrue(photoButton.waitForExistence(timeout: 10))
            photoButton.tap()

            let libraryOption = app.buttons["Choisir dans la photothèque"]
            XCTAssertTrue(libraryOption.waitForExistence(timeout: 10))
        }
    }
}
