import Foundation

/// §15 — CE QUE LE SERVEUR RÉPOND QUAND ON LUI TEND UN JETON.
///
/// ══════════════════════════════════════════════════════════════════
/// CE N'EST PAS UN @Model, ET C'EST DÉLIBÉRÉ
/// ══════════════════════════════════════════════════════════════════
///
/// Rien de ceci n'est persisté : c'est la réponse d'un appel, vivante le
/// temps d'un écran. Aucun `Schema([...])` n'est donc à modifier, et la
/// règle apprise en Phase 4 — « tout nouveau type @Model s'enregistre
/// dans le Schema » — ne s'applique pas ici. La règle jumelle non plus :
/// aucune propriété n'est ajoutée à un modèle persisté par ce fichier.
///
/// ══════════════════════════════════════════════════════════════════
/// NEUF COLONNES, ET UNE SEULE EST LUE EN PROFONDEUR
/// ══════════════════════════════════════════════════════════════════
///
/// `etiquette_resoudre` (0090 § 6) rend : ok, message, portee,
/// entite_type, entite_id, ecran, chemin, titre, details.
///
/// `details` est un objet JSON dont le contenu DIFFÈRE selon la portée :
/// pour un porteur habilité il porte l'identité de l'objet (nom, code,
/// statut, quantité) ; pour un passant il ne porte que trois champs
/// botaniques. On ne décode QUE ces trois-là, nommés un par un.
///
/// La discipline vaut la peine d'être écrite, parce qu'elle a déjà servi
/// ailleurs dans ce projet : une porte publique qui laisse passer
/// l'objet entier tel que la base l'a rendu fuit le jour — pas
/// aujourd'hui, le jour — où quelqu'un élargit la fonction SQL sans
/// relire le client. Un champ qu'on ne décode pas est un champ qui ne
/// peut pas s'afficher par accident.
struct EtiquetteResolue: Decodable, Identifiable, Sendable, Equatable {
    /// Faux pour un jeton inconnu, révoqué, orphelin OU interdit. Le
    /// serveur rend la MÊME chose dans les quatre cas, et l'application
    /// ne doit surtout pas chercher à les distinguer : deux messages
    /// différents formeraient l'oracle qui rend une énumération
    /// intéressante.
    var ok: Bool

    /// La phrase de refus, écrite par la base. On l'affiche telle
    /// quelle : c'est elle qui décide de ce qu'on révèle.
    var message: String? = nil

    /// « complet » quand le porteur a le droit, « publique » quand
    /// l'étiquette a été publiée et qu'on n'a que la fiche botanique.
    var portee: String? = nil

    /// La famille de l'objet, dans le vocabulaire de l'application
    /// (`plant`, `nurseryLot`, `cultureBatch`…).
    var entiteType: String? = nil

    /// L'identifiant de l'objet. NUL en portée publique — un passant
    /// n'a pas à repartir avec une clé primaire — et nul aussi pour un
    /// rack, qui n'a aucune ligne derrière lui.
    var entiteId: UUID? = nil

    /// La clé d'écran, commune à l'iPhone et au web.
    var ecran: String? = nil

    /// Le chemin web. L'application ne s'en sert pas — elle ouvre ses
    /// propres écrans — mais on le décode pour ne pas avoir à changer ce
    /// type le jour où un partage renverra vers le site.
    var chemin: String? = nil

    /// Un nom, un code : l'identité, jamais le contenu.
    var titre: String? = nil

    /// Les trois champs botaniques, et rien d'autre. Voir l'en-tête.
    var details: FicheBotanique? = nil

    enum CodingKeys: String, CodingKey {
        case ok
        case message
        case portee
        case entiteType = "entite_type"
        case entiteId = "entite_id"
        case ecran
        case chemin
        case titre
        case details
    }

    /// Pour `.sheet(item:)`. Ce n'est pas une identité de domaine, juste
    /// de quoi distinguer deux réponses successives à l'écran.
    var id: String {
        if let entiteId { return entiteId.uuidString }
        return [portee, ecran, titre].compactMap { $0 }.joined(separator: "-")
    }

    /// L'écran que 0090 nomme pour une étiquette imprimée ou programmée
    /// mais pas encore associée (§ 19).
    static let ecranVierge = "etiquette.vierge"

    var estVierge: Bool { ok && ecran == Self.ecranVierge }
    var estPublique: Bool { ok && portee == "publique" }
    var estComplete: Bool { ok && portee == "complet" }
}

/// LES TROIS SEULS CHAMPS QU'UN INCONNU PEUT VOIR.
///
/// Pas de nom d'usage — « le palmier de Mamie » est une donnée
/// personnelle, et elle désigne souvent quelqu'un. Pas de coordonnées
/// GPS — elles situent le jardin d'un client. Pas d'état sanitaire, pas
/// de note, pas de date de plantation.
///
/// Ce type n'a que trois propriétés : il ne PEUT donc pas en afficher
/// une quatrième, même si la base en rendait une.
struct FicheBotanique: Decodable, Sendable, Equatable {
    var nomCommun: String?
    var nomScientifique: String?
    var type: String?

    enum CodingKeys: String, CodingKey {
        case nomCommun = "common_name"
        case nomScientifique = "scientific_name"
        case type
    }

    /// Vraie quand il n'y a rigoureusement rien à montrer. Un passant
    /// devant trois lignes vides repart en croyant l'étiquette cassée :
    /// mieux vaut le lui dire.
    var estVide: Bool {
        [nomCommun, nomScientifique, type]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .allSatisfy(\.isEmpty)
    }

    /// Le type de végétal en français. Le vocabulaire stocké est celui
    /// de `PlantType` ; un mot inconnu — parce qu'un jour quelqu'un
    /// ajoutera un cas — ne s'affiche PAS tel quel. « flowerBed » sur
    /// un écran a l'air d'une fuite de code, ce qui est pire que rien.
    var libelleType: String? {
        guard let type, let connu = PlantType(rawValue: type) else { return nil }
        return connu.displayName
    }
}
