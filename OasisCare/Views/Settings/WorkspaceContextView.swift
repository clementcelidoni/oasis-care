import SwiftUI

/// « OÙ VONT MES DONNÉES ? » — l'écran qui répond enfin à cette question.
///
/// Avant ce lot, rien dans l'application ne la posait ni n'y répondait :
/// un professionnel utilisant BioLab sur son iPhone déposait ses cultures
/// dans son espace PRIVÉ, ses collègues ne les voyaient jamais, et aucun
/// écran ne lui donnait le moindre moyen de s'en apercevoir.
///
/// L'ÉCRAN DIT LA VÉRITÉ, Y COMPRIS QUAND ELLE EST INCOMPLÈTE. Le choix
/// du contexte est réel — il est retenu, il est lié au compte, il survit
/// au redémarrage — mais les envois, eux, continuent d'aller dans
/// l'espace personnel tant que l'estampille par enregistrement n'est pas
/// posée (voir le commentaire en tête de `WorkspaceContextService`).
/// Plutôt que de masquer cet écart, la section « Envoi depuis cet
/// iPhone » le nomme. Un réglage qui ferait croire à un basculement qui
/// n'a pas lieu serait pire que pas de réglage du tout : l'utilisateur
/// rangerait de bonne foi des cultures d'entreprise dans son espace
/// privé, en croyant le contraire.
struct WorkspaceContextView: View {
    @ObservedObject private var service = WorkspaceContextService.shared
    @ObservedObject private var authState = AuthState.shared

    var body: some View {
        Form {
            if service.available.isEmpty {
                emptySection
            } else {
                writeTargetSection
                spacesSection
            }

            if let error = service.lastRefreshError {
                Section {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Contexte de travail")
        .navigationBarTitleDisplayMode(.inline)
        .task { await service.refresh() }
        .refreshable { await service.refresh() }
    }

    // MARK: - Sections

    @ViewBuilder
    private var emptySection: some View {
        Section {
            if service.isRefreshing {
                HStack {
                    ProgressView()
                    Text("Lecture de vos espaces…")
                        .foregroundStyle(.secondary)
                }
            } else if case .authenticated = authState.status {
                Text("Aucun espace lisible pour ce compte.")
                    .foregroundStyle(.secondary)
            } else {
                Text("Connectez-vous pour voir vos espaces de travail.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    /// La section la plus importante de l'écran, et la première :
    /// l'utilisateur doit lire OÙ ses saisies partent avant de lire ce
    /// qu'il peut choisir.
    @ViewBuilder
    private var writeTargetSection: some View {
        Section {
            if let target = service.available.first(where: { $0.id == service.writeWorkspaceID }) {
                LabeledContent("Envoi depuis cet iPhone", value: target.displayName)
            } else {
                LabeledContent("Envoi depuis cet iPhone", value: "Indéterminé")
            }
        } footer: {
            if service.activeContextReceivesWrites {
                Text("Tout ce que vous saisissez sur cet iPhone est envoyé dans cet espace.")
            } else {
                // Le seul texte de l'écran qui compte vraiment. Il est
                // long parce qu'il doit être compris, et il est ici
                // parce qu'il concerne l'envoi, pas le choix.
                Text("Attention : cet iPhone envoie encore tout dans votre espace personnel, même si un autre contexte est sélectionné ci-dessous. L'envoi vers l'espace d'une entreprise depuis le téléphone n'est pas encore disponible. En attendant, saisissez depuis Oasis Care Pro sur ordinateur ce qui doit appartenir à votre entreprise.")
            }
        }
    }

    @ViewBuilder
    private var spacesSection: some View {
        // `Section(_:content:footer:)` n'existe pas : le titre passe donc
        // par un `header:` explicite, comme le `footer:` juste en dessous.
        Section {
            ForEach(service.available) { context in
                Button {
                    // Le retour dit si le choix a été retenu ; l'écran
                    // n'en a pas besoin, puisqu'un refus ne peut venir
                    // que d'un espace absent de la liste qu'il affiche.
                    _ = service.select(context)
                } label: {
                    row(for: context)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("workspaceContextRow_\(context.id.uuidString)")
            }
        } header: {
            Text("Vos espaces")
        } footer: {
            if service.hasProfessionalContext {
                Text("Le contexte sélectionné indique dans quel cadre vous travaillez. Il est retenu sur cet appareil, pour ce compte uniquement, et il est oublié à la déconnexion.")
            } else {
                Text("Ce compte n'appartient qu'à son espace personnel. Rien à choisir, et rien ne change pour vous.")
            }
        }
    }

    private func row(for context: WorkspaceContext) -> some View {
        let isActive = service.active?.id == context.id
        return HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(context.displayName)
                    .foregroundStyle(.primary)
                Text(context.kindLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if isActive {
                Image(systemName: "checkmark")
                    .foregroundStyle(.tint)
                    .accessibilityLabel("Contexte sélectionné")
            }
        }
        .contentShape(Rectangle())
    }
}
