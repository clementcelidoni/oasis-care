import Foundation

/// Le choix de contexte, tel qu'il est retenu d'un lancement à l'autre.
///
/// LE COMPTE EST DANS LA VALEUR, PAS SEULEMENT DANS LA CLÉ. Un iPhone
/// peut servir à deux comptes l'un après l'autre. Une préférence rangée
/// sous une clé anonyme serait relue par le second compte, qui se
/// retrouverait à travailler dans le contexte du premier — la fuite
/// d'un monde vers l'autre que ce chantier existe pour empêcher. En
/// portant le compte dans la valeur, la relecture peut la refuser.
struct WorkspaceContextPreference: Codable, Equatable, Sendable {
    var accountID: UUID
    var workspaceID: UUID
}

/// Derrière un protocole, comme `InstallationIdentifierStorage` : ce qui
/// mérite un test ici, c'est le comportement à la DEUXIÈME lecture, et un
/// test qui écrirait dans les vrais `UserDefaults` emporterait sa réponse
/// dans l'exécution suivante.
protocol WorkspaceContextStorage: AnyObject {
    func loadPreference() -> WorkspaceContextPreference?
    func savePreference(_ preference: WorkspaceContextPreference)
    func clearPreference()
}

/// `UserDefaults`, et pas le trousseau : contrairement à l'identifiant
/// d'installation, ce choix DOIT disparaître avec l'application. Le
/// retenir au-delà d'une réinstallation ferait rouvrir l'app dans le
/// contexte d'une entreprise que l'utilisateur a peut-être quittée
/// entre-temps.
///
/// Une seule clé, une seule préférence : le dernier choix fait sur cet
/// appareil, avec le compte qui l'a fait. Pas un dictionnaire par
/// compte — rien ne justifie de garder la trace des comptes précédents
/// sur un appareil partagé.
final class UserDefaultsWorkspaceContextStorage: WorkspaceContextStorage {
    static let storageKey = "com.oasiscare.workspaceContextPreference"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func loadPreference() -> WorkspaceContextPreference? {
        guard let data = defaults.data(forKey: Self.storageKey) else { return nil }
        return try? JSONDecoder().decode(WorkspaceContextPreference.self, from: data)
    }

    func savePreference(_ preference: WorkspaceContextPreference) {
        guard let data = try? JSONEncoder().encode(preference) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }

    func clearPreference() {
        defaults.removeObject(forKey: Self.storageKey)
    }
}
