import Foundation

/// À QUI APPARTIENT LA COPIE LOCALE.
///
/// ══════════════════════════════════════════════════════════════════
/// POURQUOI CE FICHIER EXISTE
/// ══════════════════════════════════════════════════════════════════
///
/// Un dirigeant s'est connecté sur son téléphone avec un second compte
/// et y a retrouvé les vingt-cinq végétaux du premier. La base n'y était
/// pour rien : interrogée sous le second compte, elle rend zéro végétal
/// et zéro jardin. Ce qu'il voyait était la copie locale, laissée là par
/// le compte précédent.
///
/// LA CAUSE EST QUE PERSONNE NE SAVAIT À QUI CETTE COPIE APPARTENAIT.
/// Aucun modèle local ne porte d'espace de travail — l'appartenance
/// n'est décidée qu'à l'envoi, au moment de la synchronisation. Une
/// plante restée sur l'appareil est donc rigoureusement indiscernable
/// d'une plante légitime : ni l'écran, ni la synchronisation, ni le
/// nettoyage ne pouvaient faire la différence.
///
/// Ce fichier écrit sur le disque le compte propriétaire de la copie
/// locale. Une seule information, mais c'est celle qui manquait, et
/// deux protections s'appuient dessus :
///
///   1. AU CHANGEMENT DE COMPTE, la copie locale est effacée. Comparer
///      en mémoire ne suffisait pas : quelqu'un qui force la fermeture
///      de l'application entre les deux connexions repart d'une mémoire
///      vide, et le changement passait inaperçu. Le disque, lui, se
///      souvient.
///   2. LA SYNCHRONISATION REFUSE DE PARTIR quand la copie locale
///      appartient à un autre compte, au lieu de ré-estampiller ses
///      lignes au nom du compte courant — ce qui aurait recopié pour de
///      vrai les végétaux d'une personne chez une autre, photos
///      comprises.
///
/// ══════════════════════════════════════════════════════════════════
/// CE QUI N'EST PAS UN CHANGEMENT DE COMPTE
/// ══════════════════════════════════════════════════════════════════
///
/// Le premier lancement, et toute restauration de session ordinaire, ne
/// doivent RIEN effacer. C'est le piège de ce mécanisme : le flux
/// d'authentification émet un événement au démarrage, et un « avant »
/// vide comparé à un « après » plein ressemble à s'y méprendre à un
/// changement de compte. Une comparaison naïve viderait l'appareil à
/// chaque ouverture.
///
/// D'où la règle, et elle tient en une phrase : ON N'EFFACE QUE SI UN
/// PROPRIÉTAIRE ÉTAIT DÉJÀ INSCRIT ET QU'IL EST DIFFÉRENT. Absence de
/// propriétaire veut dire « on ne sait pas », jamais « quelqu'un
/// d'autre ».
enum IdentiteLocale {

    /// Le nom est stable : le changer ferait oublier le propriétaire à
    /// tous les appareils déjà installés, et le premier lancement après
    /// mise à jour ressemblerait à une première ouverture.
    static let cle = "oasis.identiteLocale.proprietaire"

    /// Ce qu'on décide en comparant le propriétaire inscrit au compte
    /// qui vient d'ouvrir une session.
    enum Verdict: Equatable {
        /// Aucun propriétaire inscrit : on adopte celui-ci sans rien
        /// effacer. C'est le premier lancement, ou la première ouverture
        /// après la mise à jour qui introduit ce mécanisme.
        case adoption
        /// Le même compte qu'avant. Rien à faire.
        case memeCompte
        /// Un AUTRE compte. La copie locale ne lui appartient pas.
        case changementDeCompte
    }

    private static var stockage: UserDefaults { .standard }

    /// Le compte propriétaire de la copie locale, s'il est connu.
    static var proprietaire: UUID? {
        guard let brut = stockage.string(forKey: cle) else { return nil }
        return UUID(uuidString: brut)
    }

    /// Compare SANS rien écrire. Séparé de l'enregistrement à dessein :
    /// l'appelant doit pouvoir effacer la copie locale AVANT d'inscrire
    /// le nouveau propriétaire. Faire les deux d'un coup laisserait, si
    /// l'effacement échoue, un appareil qui affiche les données de
    /// quelqu'un et prétend appartenir à quelqu'un d'autre — c'est-à-dire
    /// pire qu'avant, parce que plus personne ne s'en apercevrait.
    static func comparer(a compte: UUID) -> Verdict {
        guard let inscrit = proprietaire else { return .adoption }
        return inscrit == compte ? .memeCompte : .changementDeCompte
    }

    /// Inscrit le propriétaire. À n'appeler qu'une fois la copie locale
    /// réellement en accord avec ce compte.
    static func inscrire(_ compte: UUID) {
        stockage.set(compte.uuidString, forKey: cle)
    }

    /// Efface le propriétaire — à la déconnexion, et seulement une fois
    /// la copie locale effacée.
    static func oublier() {
        stockage.removeObject(forKey: cle)
    }
}
