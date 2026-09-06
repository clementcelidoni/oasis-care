import Foundation
import Supabase

/// La lecture des espaces, derrière un protocole pour une seule raison :
/// les règles de résolution de `WorkspaceContextService` (quel espace est
/// le personnel, quel espace est actif) sont ce qu'il y a à tester, et
/// elles ne doivent pas exiger un réseau pour l'être. Même motif que
/// `InstallationIdentifierStorage` pour la présence mobile.
///
/// Volontairement PAS `Sendable` : l'annuaire n'est détenu que par
/// `WorkspaceContextService`, isolé sur l'acteur principal, donc rien ne
/// traverse jamais de frontière d'acteur. L'exiger obligerait en
/// revanche un double de test portant une erreur factice à être
/// `Sendable` alors qu'`Error` ne l'est pas — une contrainte payée pour
/// rien.
protocol WorkspaceDirectory {
    func fetchContexts() async throws -> [WorkspaceContext]
}

/// Lit les espaces du compte connecté, sous RLS.
///
/// DEUX REQUÊTES ET PAS UNE JOINTURE. PostgREST sait imbriquer
/// `business_organizations` dans `workspaces` grâce à la clé étrangère,
/// mais la forme du résultat (objet ou tableau) dépend de la façon dont
/// il interprète le `unique (workspace_id)` de la table — donc de sa
/// version. Deux `select` séparés et une fusion en Swift n'ont aucune
/// ambiguïté de ce genre.
///
/// LA SECONDE EST « AU MIEUX ». Son seul apport est le nom lisible d'une
/// entreprise ; si elle échoue, on garde `workspaces.name`. Une
/// synchronisation qui échouerait parce qu'un libellé d'affichage n'a pas
/// pu être lu serait une panne inventée de toutes pièces.
///
/// CE QUE RLS GARANTIT ICI : `workspaces` n'est lisible que par
/// `is_workspace_member(id)` (0001) et `business_organizations` que par
/// `is_organization_member(id)` (0043). La liste rendue est donc, par
/// construction, celle des espaces auxquels ce compte appartient
/// réellement — le téléphone n'a rien à filtrer lui-même, et surtout
/// rien à décider sur la foi de ce qu'il croit savoir.
struct SupabaseWorkspaceDirectory: WorkspaceDirectory {
    private struct WorkspaceRow: Decodable {
        var id: UUID
        var name: String
        var isPersonal: Bool
        var createdAt: Date

        enum CodingKeys: String, CodingKey {
            case id, name
            case isPersonal = "is_personal"
            case createdAt = "created_at"
        }
    }

    private struct OrganizationRow: Decodable {
        var id: UUID
        var name: String
        var workspaceId: UUID

        enum CodingKeys: String, CodingKey {
            case id, name
            case workspaceId = "workspace_id"
        }
    }

    func fetchContexts() async throws -> [WorkspaceContext] {
        let workspaces: [WorkspaceRow] = try await AuthService.client
            .from("workspaces")
            .select("id,name,is_personal,created_at")
            .order("created_at", ascending: true)
            .execute()
            .value

        var organizations: [OrganizationRow] = []
        do {
            let rows: [OrganizationRow] = try await AuthService.client
                .from("business_organizations")
                .select("id,name,workspace_id")
                .execute()
                .value
            organizations = rows
        } catch {
            // Volontairement avalé : voir le commentaire de la classe.
            // Le libellé reste `workspaces.name`, et rien d'autre ne
            // dépend de cette requête.
            OasisLog.sync.debug("Contexte de travail : nom d'entreprise indisponible, libellé technique conservé.")
        }

        var organizationByWorkspace: [UUID: OrganizationRow] = [:]
        for row in organizations where organizationByWorkspace[row.workspaceId] == nil {
            organizationByWorkspace[row.workspaceId] = row
        }

        return workspaces.map { row in
            let organization = organizationByWorkspace[row.id]
            return WorkspaceContext(
                id: row.id,
                name: row.name,
                isPersonal: row.isPersonal,
                createdAt: row.createdAt,
                organizationID: organization?.id,
                organizationName: organization?.name
            )
        }
    }
}
