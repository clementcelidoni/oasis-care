import XCTest
@testable import OasisCare

/// Un annuaire qui ne parle à personne. Ce qui mérite d'être testé ici,
/// ce sont les RÈGLES — quel espace est le personnel, lequel est actif,
/// quelle préférence a le droit d'être restituée — et aucune d'elles n'a
/// besoin d'un réseau. Même parti pris que `InMemoryIdentifierStorage`
/// pour la présence mobile.
private struct StubWorkspaceDirectory: WorkspaceDirectory {
    var contexts: [WorkspaceContext] = []
    var failure: Error?

    func fetchContexts() async throws -> [WorkspaceContext] {
        if let failure = failure { throw failure }
        return contexts
    }
}

private struct StubError: Error {}

/// Un rangement qui vit et meurt avec le test. Écrire dans les vrais
/// `UserDefaults` emporterait la réponse dans l'exécution suivante, et
/// c'est précisément ce qui se passe à la DEUXIÈME lecture qui est
/// intéressant ici.
private final class InMemoryWorkspaceContextStorage: WorkspaceContextStorage {
    private var preference: WorkspaceContextPreference?

    init(preference: WorkspaceContextPreference? = nil) {
        self.preference = preference
    }

    func loadPreference() -> WorkspaceContextPreference? { preference }
    func savePreference(_ preference: WorkspaceContextPreference) { self.preference = preference }
    func clearPreference() { preference = nil }
}

/// Couvre les trois choses que le téléphone peut se tromper tout seul,
/// sans serveur : quel espace il désigne comme personnel, quel contexte
/// il considère actif, et ce qu'il retient d'un lancement à l'autre.
///
/// LA GARANTIE DE CE LOT est testée ici et nommée comme telle :
/// `writeWorkspaceID` rend l'espace personnel même quand un contexte
/// d'entreprise est actif. C'est ce qui rend le socle inoffensif tant que
/// l'estampille par enregistrement n'est pas posée sur les 41 types
/// `@Model` concernés.
@MainActor
final class WorkspaceContextServiceTests: XCTestCase {

    // MARK: - Fabriques

    private let reference = Date(timeIntervalSince1970: 1_700_000_000)

    private func personal(
        _ id: UUID = UUID(),
        name: String = "Mon espace",
        createdOffset: TimeInterval = 0
    ) -> WorkspaceContext {
        WorkspaceContext(
            id: id, name: name, isPersonal: true,
            createdAt: reference.addingTimeInterval(createdOffset),
            organizationID: nil, organizationName: nil
        )
    }

    private func professional(
        _ id: UUID = UUID(),
        name: String = "workspace-pro",
        organizationName: String? = "Jardins du Sud",
        createdOffset: TimeInterval = 100
    ) -> WorkspaceContext {
        WorkspaceContext(
            id: id, name: name, isPersonal: false,
            createdAt: reference.addingTimeInterval(createdOffset),
            organizationID: UUID(), organizationName: organizationName
        )
    }

    private func makeService(
        contexts: [WorkspaceContext],
        storage: InMemoryWorkspaceContextStorage = InMemoryWorkspaceContextStorage()
    ) -> WorkspaceContextService {
        WorkspaceContextService(
            directory: StubWorkspaceDirectory(contexts: contexts),
            storage: storage
        )
    }

    // MARK: - L'espace personnel : la règle d'avant, à l'identique

    func testLEspacePersonnelEstLePlusAncienDesPersonnels() {
        let ancien = personal(name: "Le premier", createdOffset: 0)
        let recent = personal(name: "Le second", createdOffset: 60)

        // L'ordre d'arrivée ne doit rien changer : c'est `created_at`
        // qui tranche, comme dans la requête d'origine.
        XCTAssertEqual(
            WorkspaceContextService.personalWorkspace(in: [recent, ancien])?.name,
            "Le premier"
        )
        XCTAssertEqual(
            WorkspaceContextService.personalWorkspace(in: [ancien, recent])?.name,
            "Le premier"
        )
    }

    func testLEspaceProfessionnelNEstJamaisPrisPourLePersonnel() {
        // Le défaut d'origine : `limit(1)` sans filtre rendait l'un ou
        // l'autre, et l'espace de l'entreprise pouvait sortir.
        let pro = professional(createdOffset: -1_000)
        let perso = personal(name: "Mon espace")

        XCTAssertEqual(
            WorkspaceContextService.personalWorkspace(in: [pro, perso])?.id,
            perso.id
        )
    }

    func testDeuxEspacesPersonnelsCreesAuMemeInstantSeDepartagentQuandMeme() {
        // Sans départage, le résultat dépendrait de l'ordre physique des
        // lignes — le défaut que le tri était venu corriger, réintroduit
        // par la porte de derrière.
        let identifiantBas = UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
        let identifiantHaut = UUID(uuidString: "ffffffff-0000-0000-0000-000000000001")!
        let a = personal(identifiantBas, name: "A", createdOffset: 0)
        let b = personal(identifiantHaut, name: "B", createdOffset: 0)

        XCTAssertEqual(WorkspaceContextService.personalWorkspace(in: [a, b])?.id, identifiantBas)
        XCTAssertEqual(WorkspaceContextService.personalWorkspace(in: [b, a])?.id, identifiantBas)
    }

    func testAucunEspacePersonnelRendNil() {
        XCTAssertNil(WorkspaceContextService.personalWorkspace(in: [professional()]))
        XCTAssertNil(WorkspaceContextService.personalWorkspace(in: []))
    }

    // MARK: - Le contexte actif

    func testSansChoixLeContexteActifEstLePersonnel() {
        let perso = personal()
        let pro = professional()

        XCTAssertEqual(
            WorkspaceContextService.resolveActive(in: [pro, perso], preferredID: nil)?.id,
            perso.id
        )
    }

    func testUnChoixValideEstRespecte() {
        let perso = personal()
        let pro = professional()

        XCTAssertEqual(
            WorkspaceContextService.resolveActive(in: [perso, pro], preferredID: pro.id)?.id,
            pro.id
        )
    }

    func testUnChoixQuiNeDesignePlusUnEspaceAccessibleRetombeSurLePersonnel() {
        // Le salarié retiré de son entreprise : sa préférence survit sur
        // le téléphone, mais RLS ne rend plus cet espace.
        let perso = personal()
        let espaceDisparu = UUID()

        XCTAssertEqual(
            WorkspaceContextService.resolveActive(in: [perso], preferredID: espaceDisparu)?.id,
            perso.id
        )
    }

    // MARK: - LA GARANTIE DE CE LOT

    func testLEnvoiResteDansLEspacePersonnelMemeQuandUnContexteEntrepriseEstActif() async throws {
        let compte = UUID()
        let perso = personal(name: "Mon espace")
        let pro = professional(organizationName: "Jardins du Sud")
        let service = makeService(contexts: [perso, pro])

        try await service.load(accountID: compte)
        XCTAssertTrue(service.select(pro, accountID: compte))

        XCTAssertEqual(service.active?.id, pro.id, "Le contexte choisi doit bien être l'actif.")
        XCTAssertEqual(
            service.writeWorkspaceID,
            perso.id,
            """
            Tant que les 41 types @Model ne portent pas leur espace serveur, \
            basculer l'écriture déplacerait des données déjà synchronisées \
            sans le dire. L'envoi doit rester dans l'espace personnel.
            """
        )
        XCTAssertFalse(
            service.activeContextReceivesWrites,
            "L'écran doit pouvoir dire à l'utilisateur que l'envoi ne suit pas encore son choix."
        )
    }

    func testUnCompteSansEntrepriseNeVoitAucuneDifference() async throws {
        // La promesse faite au dirigeant : « un compte sans entreprise ne
        // doit voir AUCUNE différence ».
        let compte = UUID()
        let perso = personal(name: "Mon espace")
        let service = makeService(contexts: [perso])

        try await service.load(accountID: compte)

        XCTAssertEqual(service.writeWorkspaceID, perso.id)
        XCTAssertEqual(service.active?.id, perso.id)
        XCTAssertTrue(service.activeContextReceivesWrites)
        XCTAssertFalse(service.hasProfessionalContext)
    }

    // MARK: - Ce qui est retenu, et ce qui ne l'est pas

    func testLaPreferenceDuMemeCompteEstRestituee() async throws {
        let compte = UUID()
        let perso = personal()
        let pro = professional()
        let rangement = InMemoryWorkspaceContextStorage(
            preference: WorkspaceContextPreference(accountID: compte, workspaceID: pro.id)
        )
        let service = makeService(contexts: [perso, pro], storage: rangement)

        try await service.load(accountID: compte)

        XCTAssertEqual(service.preferredID, pro.id)
        XCTAssertEqual(service.active?.id, pro.id)
    }

    func testLaPreferenceDUnAutreCompteEstIgnoreeEtEffacee() async throws {
        // Un iPhone partagé, deux comptes l'un après l'autre. Restituer
        // la préférence du premier ferait travailler le second dans le
        // contexte d'une entreprise qui n'est pas la sienne.
        let premierCompte = UUID()
        let secondCompte = UUID()
        let perso = personal()
        let pro = professional()
        let rangement = InMemoryWorkspaceContextStorage(
            preference: WorkspaceContextPreference(accountID: premierCompte, workspaceID: pro.id)
        )
        let service = makeService(contexts: [perso, pro], storage: rangement)

        try await service.load(accountID: secondCompte)

        XCTAssertNil(service.preferredID)
        XCTAssertEqual(service.active?.id, perso.id)
        XCTAssertNil(
            rangement.loadPreference(),
            "Ignorée ne suffit pas : une préférence morte qu'on garde ressuscite au lancement suivant."
        )
    }

    func testUnePreferenceVersUnEspaceDevenuInaccessibleEstEffacee() async throws {
        let compte = UUID()
        let perso = personal()
        let espaceQuitte = UUID()
        let rangement = InMemoryWorkspaceContextStorage(
            preference: WorkspaceContextPreference(accountID: compte, workspaceID: espaceQuitte)
        )
        let service = makeService(contexts: [perso], storage: rangement)

        try await service.load(accountID: compte)

        XCTAssertNil(service.preferredID)
        XCTAssertNil(rangement.loadPreference())
    }

    func testChoisirEcritLaPreferenceAvecSonCompte() async throws {
        let compte = UUID()
        let perso = personal()
        let pro = professional()
        let rangement = InMemoryWorkspaceContextStorage()
        let service = makeService(contexts: [perso, pro], storage: rangement)

        try await service.load(accountID: compte)
        XCTAssertTrue(service.select(pro, accountID: compte))

        XCTAssertEqual(
            rangement.loadPreference(),
            WorkspaceContextPreference(accountID: compte, workspaceID: pro.id)
        )
    }

    func testChoisirUnEspaceHorsDeLaListeEstRefuse() async throws {
        let compte = UUID()
        let perso = personal()
        let intrus = professional()
        let rangement = InMemoryWorkspaceContextStorage()
        let service = makeService(contexts: [perso], storage: rangement)

        try await service.load(accountID: compte)

        XCTAssertFalse(service.select(intrus, accountID: compte))
        XCTAssertNil(service.preferredID)
        XCTAssertNil(rangement.loadPreference())
    }

    // MARK: - L'oubli

    func testLaDeconnexionEffaceLaMemoireEtLeDisque() async throws {
        let compte = UUID()
        let perso = personal()
        let pro = professional()
        let rangement = InMemoryWorkspaceContextStorage()
        let service = makeService(contexts: [perso, pro], storage: rangement)

        try await service.load(accountID: compte)
        service.select(pro, accountID: compte)

        service.clear()

        XCTAssertTrue(service.available.isEmpty)
        XCTAssertNil(service.preferredID)
        XCTAssertNil(service.loadedAccountID)
        XCTAssertNil(service.writeWorkspaceID)
        XCTAssertNil(
            rangement.loadPreference(),
            "Un appareil déconnecté ne garde rien du compte précédent, pas même son contexte."
        )
    }

    func testLeChangementDeCompteVideLaMemoireMaisPasLeChoix() async throws {
        // La distinction qui évite de faire perdre son choix à
        // l'utilisateur à chaque lancement : le premier événement du flux
        // d'authentification est la restauration de la session, donc un
        // « changement de compte » du point de vue du flux.
        let compte = UUID()
        let perso = personal()
        let pro = professional()
        let rangement = InMemoryWorkspaceContextStorage()
        let service = makeService(contexts: [perso, pro], storage: rangement)

        try await service.load(accountID: compte)
        service.select(pro, accountID: compte)

        service.forgetLoadedAccount()

        XCTAssertTrue(service.available.isEmpty)
        XCTAssertNil(service.loadedAccountID)
        XCTAssertNotNil(rangement.loadPreference())

        // Et à la relecture, le choix revient.
        try await service.load(accountID: compte)
        XCTAssertEqual(service.preferredID, pro.id)
    }

    func testUneLectureQuiEchoueNEffaceRien() async throws {
        let compte = UUID()
        let perso = personal()
        let pro = professional()
        let rangement = InMemoryWorkspaceContextStorage(
            preference: WorkspaceContextPreference(accountID: compte, workspaceID: pro.id)
        )
        let service = WorkspaceContextService(
            directory: StubWorkspaceDirectory(contexts: [perso, pro], failure: StubError()),
            storage: rangement
        )

        do {
            try await service.load(accountID: compte)
            XCTFail("Une lecture impossible doit lever, pas rendre une liste vide.")
        } catch {
            // Attendu. La synchronisation s'arrête plutôt que d'envoyer
            // sans savoir où.
        }

        XCTAssertNotNil(
            rangement.loadPreference(),
            "Une panne de réseau n'est pas une raison d'oublier le choix de l'utilisateur."
        )
    }
}
