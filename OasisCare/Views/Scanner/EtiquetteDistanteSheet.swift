import SwiftUI

/// §15 — CE QUE L'APPLICATION MONTRE QUAND LA RÉPONSE VIENT DU SERVEUR.
///
/// ══════════════════════════════════════════════════════════════════
/// POURQUOI UN ÉCRAN DE PLUS, ET PAS UN CAS DE PLUS DANS L'AUTRE
/// ══════════════════════════════════════════════════════════════════
///
/// `SmartTagScanResultSheet` montre un OBJET LOCAL : il peut proposer
/// « Ouvrir », parce qu'il a une fiche SwiftData sous la main. Ici il
/// n'y en a pas — l'objet vit sur le web, ou dans l'espace de travail
/// d'une autre équipe, ou nulle part sur cet appareil. Fusionner les
/// deux écrans donnerait un bouton « Ouvrir » qui, une fois sur deux,
/// n'ouvrirait rien.
///
/// ══════════════════════════════════════════════════════════════════
/// LES QUATRE ISSUES, LES MÊMES QUE SUR LA PAGE WEB /x
/// ══════════════════════════════════════════════════════════════════
///
///   • REFUS — inconnue, révoquée, orpheline ou interdite. LA MÊME
///     PAGE et la MÊME PHRASE dans les quatre cas, et la phrase vient
///     du serveur. Deux messages différents formeraient un oracle : en
///     essayant des jetons, on apprendrait lesquels sont vrais.
///   • ÉTIQUETTE VIERGE (§ 19) — programmée, pas encore associée.
///   • FICHE PUBLIÉE — trois champs botaniques, pour un porteur qui n'a
///     pas de droit sur l'objet. C'est le cas du passant dans un
///     jardin.
///   • RECONNUE — l'objet existe et le porteur y a droit, mais cet
///     appareil ne l'a pas. On donne son nom et sa famille : l'identité,
///     jamais le contenu.
///
/// AUCUN BOUTON D'ACTION. Il n'y a rien à faire d'ici, et fabriquer une
/// action qui échouerait serait pire que de n'en proposer aucune.
struct EtiquetteDistanteSheet: View {
    var etiquette: EtiquetteResolue

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Image(systemName: icone)
                    .font(.system(size: 48))
                    .foregroundStyle(.white)
                    .frame(width: 88, height: 88)
                    .background(pastille.gradient, in: Circle())
                    .padding(.top, 24)

                VStack(spacing: 4) {
                    Text(titre)
                        .font(.title3.weight(.semibold))
                        .multilineTextAlignment(.center)
                    if let sousTitre {
                        Text(sousTitre)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, 32)

                Text(explication)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)

                Spacer()
            }
            .navigationTitle("Étiquette")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Fermer") { dismiss() }
                }
            }
        }
    }

    // MARK: - Ce qui s'affiche

    private var titre: String {
        if !etiquette.ok { return "Cette étiquette ne mène à rien" }
        if etiquette.estVierge { return "Étiquette pas encore associée" }
        if let propre = etiquette.titre?.trimmingCharacters(in: .whitespacesAndNewlines),
           !propre.isEmpty {
            return propre
        }
        return "Étiquette reconnue"
    }

    private var sousTitre: String? {
        if !etiquette.ok { return nil }
        if etiquette.estVierge { return nil }
        if etiquette.estPublique {
            // La fiche botanique : le nom scientifique s'il diffère du
            // titre, sinon le type. Rien d'autre n'existe dans ce type.
            if let latin = etiquette.details?.nomScientifique, latin != etiquette.titre {
                return latin
            }
            return etiquette.details?.libelleType
        }
        return Self.famille(etiquette.entiteType)
    }

    private var explication: String {
        if !etiquette.ok {
            // LA PHRASE VIENT DU SERVEUR. La recopier ici la ferait
            // diverger, et deux phrases pour un même refus rouvriraient
            // l'oracle qu'on vient de fermer.
            return etiquette.message ?? SmartTagService.phraseRefus
        }
        if etiquette.estVierge {
            // ON NE NOMME QUE DES FICHES QUI EXISTENT SUR CET APPAREIL.
            // La phrase citait « le lot ou le matériel » : ni l'un ni
            // l'autre n'a d'écran sur iPhone. Les seuls écrans qui
            // portent un bouton d'association sont ceux d'une plante,
            // d'un lot de culture, d'un bioréacteur, d'une recette de
            // milieu, d'une acclimatation et d'un rack.
            return "Elle appartient bien à votre entreprise, mais aucun objet ne lui a encore été "
                + "attribué. Associez-la depuis la fiche de la plante ou du lot de culture ; "
                + "pour un lot de pépinière ou du matériel, cela se fait depuis Oasis Care Pro "
                + "sur le web."
        }
        if etiquette.estPublique {
            return "Cette fiche est publiée par le propriétaire de ce végétal. Elle ne dit rien de "
                + "plus : ni où il se trouve, ni à qui il appartient."
        }
        // TROIS FAMILLES NE DESCENDRONT JAMAIS SUR CE TÉLÉPHONE, et
        // promettre une synchronisation qui n'arrivera pas est pire que
        // ne rien promettre : la personne attend, revient, et
        // recommence. Vérifié dans SyncEngine : ni `nursery_lots`, ni
        // `nursery_locations`, ni `equipment` n'y figurent — ces trois
        // mondes vivent sur le web, et c'est un choix, pas un oubli.
        if Self.vitSurLeWebSeulement(etiquette.entiteType) {
            return "Cet élément vit dans Oasis Care Pro, sur le web. Il ne descend pas sur "
                + "l'iPhone : ouvrez-le depuis un navigateur."
        }
        return "Cet élément n'est pas encore sur cet appareil. Il apparaîtra après la prochaine "
            + "synchronisation, ou depuis Oasis Care Pro sur le web."
    }

    /// Les familles que la synchronisation ne descend pas, et ne
    /// descendra pas : elles n'ont pas d'écran sur iPhone.
    private static func vitSurLeWebSeulement(_ genre: String?) -> Bool {
        switch genre {
        case "nurseryLot", "nurseryLocation", "equipment": return true
        default: return false
        }
    }

    private var icone: String {
        if !etiquette.ok { return "questionmark.circle" }
        if etiquette.estVierge { return "tag" }
        return Self.icone(etiquette.entiteType)
    }

    private var pastille: Color {
        etiquette.ok ? Color.accentColor : .secondary
    }

    // MARK: - Le vocabulaire des familles
    //
    // `entity_kind` (0090 § 1.c) emploie le vocabulaire de l'application,
    // en camelCase. Montrer « nurseryLocation » à un pépiniériste, ce
    // serait lui montrer notre code source : un mot inconnu retombe sur
    // un libellé générique plutôt que de s'afficher tel quel.

    private static func famille(_ genre: String?) -> String? {
        switch genre {
        case "plant": return "Plante"
        case "garden": return "Jardin"
        case "gardenZone": return "Zone de jardin"
        case "gardenArea": return "Massif"
        case "irrigationZone": return "Zone d'arrosage"
        case "pond": return "Bassin"
        case "sensor": return "Capteur"
        case "connectedDevice": return "Équipement connecté"
        case "equipment": return "Matériel"
        case "nurseryLot": return "Lot de pépinière"
        case "nurseryLocation": return "Emplacement de pépinière"
        case "cultureBatch": return "Lot de culture"
        case "bioreactor": return "Incubateur"
        case "mediumRecipeVersion": return "Recette de milieu"
        case "acclimatizationBatch": return "Acclimatation"
        case "rack": return "Rack"
        default: return nil
        }
    }

    private static func icone(_ genre: String?) -> String {
        switch genre {
        case "plant": return "leaf.fill"
        case "garden", "gardenZone", "gardenArea": return "map.fill"
        case "irrigationZone": return "drop.fill"
        case "pond": return "water.waves"
        case "sensor": return "sensor.fill"
        case "connectedDevice", "equipment": return "wrench.and.screwdriver.fill"
        case "nurseryLot", "cultureBatch": return "flask"
        case "nurseryLocation": return "square.grid.3x3"
        case "bioreactor", "mediumRecipeVersion": return "testtube.2"
        case "acclimatizationBatch": return "sun.max.fill"
        case "rack": return "shippingbox"
        default: return "tag"
        }
    }
}
