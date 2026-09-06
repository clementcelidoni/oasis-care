import Foundation

/// UN ESPACE DE TRAVAIL AUQUEL LE COMPTE CONNECTÉ APPARTIENT.
///
/// Depuis la Phase 11, un même compte peut appartenir à DEUX mondes :
/// son espace personnel (`workspaces.is_personal = true`, créé par le
/// déclencheur `on_auth_user_created`) et celui d'une entreprise (créé
/// par `create_professional_organization`). Le téléphone, lui, n'en
/// connaissait qu'un seul : `SyncEngine.fetchWorkspaceID()` prenait le
/// premier espace PERSONNEL et estampillait tout avec.
///
/// Cette structure est la première fois que l'application sait dire
/// « voici les espaces auxquels ce compte appartient », au lieu de
/// deviner. Elle ne décide rien : elle décrit. Ce qui décide est
/// `WorkspaceContextService`.
///
/// Volontairement une valeur (`struct`) et pas un `@Model` : rien ici
/// n'a besoin de survivre hors ligne au-delà d'un simple identifiant
/// dans `UserDefaults`, et la famille à laquelle ce mécanisme
/// appartient — `EntitlementService` et son `EntitlementSnapshot` —
/// fonctionne exactement ainsi. Un `@Model` neuf aurait aussi imposé
/// une inscription au `Schema([...])` de `SharedModelContainer`, la
/// règle qui a coûté une perte de données en Phase 4.
struct WorkspaceContext: Codable, Identifiable, Equatable, Hashable, Sendable {
    /// `workspaces.id` — la valeur qui part dans la colonne
    /// `workspace_id` de tout ce que le téléphone envoie.
    var id: UUID

    /// `workspaces.name`. Pour un espace personnel, c'est le nom que le
    /// déclencheur de création de compte a posé.
    var name: String

    /// `workspaces.is_personal`.
    var isPersonal: Bool

    /// `workspaces.created_at`. Conservé pour une seule raison : c'est
    /// le critère de tri qui rend le choix de l'espace personnel
    /// REPRODUCTIBLE. `fetchWorkspaceID()` triait déjà là-dessus ; s'en
    /// passer ici rendrait le résultat dépendant de l'ordre physique des
    /// lignes, exactement le défaut corrigé dans `SyncEngine` et encore
    /// présent dans certaines fonctions SQL.
    var createdAt: Date

    /// `business_organizations.id`, quand une organisation est portée
    /// par cet espace (la table a un `unique (workspace_id)`, donc au
    /// plus une). Nul pour un espace personnel.
    var organizationID: UUID?

    /// `business_organizations.name`. Nul si l'organisation n'a pas pu
    /// être lue — la lecture est délibérément « au mieux » (voir
    /// `SupabaseWorkspaceDirectory`), parce qu'un nom manquant ne doit
    /// jamais empêcher une synchronisation.
    var organizationName: String?

    /// Ce que l'utilisateur lit à l'écran. Le nom de l'entreprise
    /// d'abord quand il existe : c'est celui qu'il reconnaît, alors que
    /// `workspaces.name` d'un espace professionnel est un libellé
    /// technique posé à la création.
    var displayName: String {
        if isPersonal { return name }
        if let organizationName, !organizationName.isEmpty { return organizationName }
        return name
    }

    /// Le sous-titre de la même ligne. Court exprès : la phrase longue
    /// appartient au pied de section, pas à la ligne.
    var kindLabel: String {
        isPersonal ? "Espace personnel" : "Entreprise"
    }

    var isProfessional: Bool { !isPersonal }
}
