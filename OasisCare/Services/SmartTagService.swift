import Foundation
import SwiftData

/// Jeton → entité, et cycle de vie des étiquettes (spec §40-52, § 15).
///
/// LA BASE LOCALE EST TOUJOURS INTERROGÉE EN PREMIER — c'est plus
/// rapide, et c'est le seul chemin qui marche hors ligne, ce qui compte
/// dans un jardin. Le serveur n'est qu'un REPLI.
///
/// CE QUI A CHANGÉ AVEC 0090, ET C'EST STRUCTURANT : le repli ne passe
/// plus par la RLS ordinaire de `smart_tags`. Il appelle
/// `etiquette_resoudre`, une fonction « security definer » qui contourne
/// la RLS et décide elle-même, d'après `auth.uid()`, ce que le porteur a
/// le droit de voir. C'est ce qui rend enfin possible ce que le § 15
/// demande : qu'un client, un salarié d'une autre équipe ou un passant
/// puissent scanner — chacun recevant une réponse différente, et la
/// bonne.
enum SmartTagService {
    /// Fetch-or-create: a plant keeps at most one *active* tag per type
    /// (spec §42's two buttons, "Afficher QR" / "Associer NFC", each
    /// operate on their own tag).
    static func tag(for plant: Plant, type: SmartTagType, in context: ModelContext) -> SmartTag {
        if let existing = plant.smartTags.first(where: { $0.type == type && $0.active }) {
            return existing
        }
        let tag = SmartTag(plant: plant, type: type)
        context.insert(tag)
        plant.smartTags.append(tag)
        return tag
    }

    /// The tag row already claiming `token`, regardless of which plant it
    /// currently points to — used to detect the "tag already used"
    /// conflict (spec §47) before overwriting a physical tag.
    static func existingTag(forToken token: String, in context: ModelContext) -> SmartTag? {
        var descriptor = FetchDescriptor<SmartTag>(predicate: #Predicate { $0.publicToken == token && $0.active })
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    static func markScanned(_ tag: SmartTag) {
        tag.lastScannedAt = .now
        tag.markDirty()
    }

    /// Spec §47's "Réassigner": moves an existing physical tag onto a
    /// different plant rather than creating a second row for the same
    /// token. A plant keeps at most one active tag per type, so if
    /// `plant` already has one, it's superseded (dissociated) rather
    /// than left as a second, never-reachable-from-the-UI orphan.
    static func reassign(_ tag: SmartTag, to plant: Plant, in context: ModelContext) {
        if let priorSameType = plant.smartTags.first(where: { $0.type == tag.type && $0.active && $0.id != tag.id }) {
            dissociate(priorSameType, in: context)
        }
        clearLink(of: tag)
        tag.plant = plant
        plant.smartTags.append(tag)
        tag.lastScannedAt = .now
        tag.markDirty()
    }

    /// Spec §52 — the plant never depends on the tag, so dissociating
    /// just removes the tag row; the plant itself is untouched.
    static func dissociate(_ tag: SmartTag, in context: ModelContext) {
        DeletionService.delete(tag, in: context)
    }

    // MARK: - BioLab entities (spec's "QR / NFC" section)
    //
    // Same fetch-or-create / reassign shape as the Plant functions above,
    // one overload per entity type rather than a generic function over a
    // shared protocol — this codebase's own established convention for
    // "the same behavior across several unrelated model types"
    // (DeletionService is the precedent: one delete(_:in:) overload per
    // type, not a generic one).

    static func tag(for bioreactor: Bioreactor, type: SmartTagType, in context: ModelContext) -> SmartTag {
        if let existing = bioreactor.smartTags.first(where: { $0.type == type && $0.active }) {
            return existing
        }
        let tag = SmartTag(type: type, bioreactor: bioreactor)
        context.insert(tag)
        bioreactor.smartTags.append(tag)
        return tag
    }

    static func reassign(_ tag: SmartTag, to bioreactor: Bioreactor, in context: ModelContext) {
        if let priorSameType = bioreactor.smartTags.first(where: { $0.type == tag.type && $0.active && $0.id != tag.id }) {
            dissociate(priorSameType, in: context)
        }
        clearLink(of: tag)
        tag.bioreactor = bioreactor
        bioreactor.smartTags.append(tag)
        tag.lastScannedAt = .now
        tag.markDirty()
    }

    static func tag(for batch: CultureBatch, type: SmartTagType, in context: ModelContext) -> SmartTag {
        if let existing = batch.smartTags.first(where: { $0.type == type && $0.active }) {
            return existing
        }
        let tag = SmartTag(type: type, cultureBatch: batch)
        context.insert(tag)
        batch.smartTags.append(tag)
        return tag
    }

    static func reassign(_ tag: SmartTag, to batch: CultureBatch, in context: ModelContext) {
        if let priorSameType = batch.smartTags.first(where: { $0.type == tag.type && $0.active && $0.id != tag.id }) {
            dissociate(priorSameType, in: context)
        }
        clearLink(of: tag)
        tag.cultureBatch = batch
        batch.smartTags.append(tag)
        tag.lastScannedAt = .now
        tag.markDirty()
    }

    static func tag(for version: MediumRecipeVersion, type: SmartTagType, in context: ModelContext) -> SmartTag {
        if let existing = version.smartTags.first(where: { $0.type == type && $0.active }) {
            return existing
        }
        let tag = SmartTag(type: type, mediumRecipeVersion: version)
        context.insert(tag)
        version.smartTags.append(tag)
        return tag
    }

    static func reassign(_ tag: SmartTag, to version: MediumRecipeVersion, in context: ModelContext) {
        if let priorSameType = version.smartTags.first(where: { $0.type == tag.type && $0.active && $0.id != tag.id }) {
            dissociate(priorSameType, in: context)
        }
        clearLink(of: tag)
        tag.mediumRecipeVersion = version
        version.smartTags.append(tag)
        tag.lastScannedAt = .now
        tag.markDirty()
    }

    static func tag(for accBatch: AcclimatizationBatch, type: SmartTagType, in context: ModelContext) -> SmartTag {
        if let existing = accBatch.smartTags.first(where: { $0.type == type && $0.active }) {
            return existing
        }
        let tag = SmartTag(type: type, acclimatizationBatch: accBatch)
        context.insert(tag)
        accBatch.smartTags.append(tag)
        return tag
    }

    static func reassign(_ tag: SmartTag, to accBatch: AcclimatizationBatch, in context: ModelContext) {
        if let priorSameType = accBatch.smartTags.first(where: { $0.type == tag.type && $0.active && $0.id != tag.id }) {
            dissociate(priorSameType, in: context)
        }
        clearLink(of: tag)
        tag.acclimatizationBatch = accBatch
        accBatch.smartTags.append(tag)
        tag.lastScannedAt = .now
        tag.markDirty()
    }

    /// "Rack" has no backing entity (see SmartTag's own doc comment) —
    /// just a free-text label, created fresh every time rather than
    /// fetch-or-created, since there's no owning record to search for an
    /// existing tag on.
    static func rackTag(label: String, type: SmartTagType, in context: ModelContext) -> SmartTag {
        let tag = SmartTag(type: type, rackLabel: label)
        context.insert(tag)
        return tag
    }

    /// Removes `tag` from whichever entity's own `smartTags` array
    /// currently holds it, before `reassign` points it somewhere else —
    /// every entity type's inverse relationship needs this same cleanup.
    private static func clearLink(of tag: SmartTag) {
        tag.plant?.smartTags.removeAll { $0.id == tag.id }
        tag.bioreactor?.smartTags.removeAll { $0.id == tag.id }
        tag.cultureBatch?.smartTags.removeAll { $0.id == tag.id }
        tag.mediumRecipeVersion?.smartTags.removeAll { $0.id == tag.id }
        tag.acclimatizationBatch?.smartTags.removeAll { $0.id == tag.id }
        tag.plant = nil
        tag.bioreactor = nil
        tag.cultureBatch = nil
        tag.mediumRecipeVersion = nil
        tag.acclimatizationBatch = nil
    }

    /// What a scanned tag actually points to — the single place both
    /// QRScannerSheet and ScannerView's NFC path resolve a tag to
    /// "what do I show now," so a token resolving to e.g. a bioreactor
    /// gets the same handling regardless of which scan method found it.
    static func scanResult(for tag: SmartTag) -> SmartTagScanResult? {
        if let plant = tag.plant { return .plant(plant) }
        if let bioreactor = tag.bioreactor { return .bioreactor(bioreactor) }
        if let batch = tag.cultureBatch { return .cultureBatch(batch) }
        if let version = tag.mediumRecipeVersion { return .mediumRecipeVersion(version) }
        if let accBatch = tag.acclimatizationBatch { return .acclimatizationBatch(accBatch) }
        if let rackLabel = tag.rackLabel { return .rack(rackLabel) }
        return nil
    }

    // MARK: - §15 — LA RÉSOLUTION, LOCALE D'ABORD, SERVEUR ENSUITE
    //
    // ══════════════════════════════════════════════════════════════
    // CE QUI ÉTAIT CASSÉ, MESURÉ
    // ══════════════════════════════════════════════════════════════
    //
    // Scanner ne marchait QUE si ce téléphone possédait déjà la donnée :
    // les deux scanners (QR et NFC) s'arrêtaient à `existingTag`, sans
    // aucun repli réseau, et affichaient « Ce QR code n'est associé à
    // aucun élément sur cet appareil ». Un salarié d'une autre équipe,
    // un client, un contrôleur : rien, jamais.
    //
    // Le seul chemin qui parlait au réseau — le lien profond — appelait
    // `select("plant_id")` à travers la RLS ordinaire. Trois défauts, et
    // ils étaient mesurables : il ne rendait QUE des plantes (sur les
    // cinq étiquettes de production, 3 rendaient NULL, même à leur
    // propriétaire) ; il exigeait d'être membre de l'espace de travail ;
    // et son échec était silencieux, si bien que l'utilisateur voyait un
    // lien qui ne faisait rien.
    //
    // ══════════════════════════════════════════════════════════════
    // L'ORDRE DES DEUX CHEMINS N'EST PAS UN DÉTAIL DE PERFORMANCE
    // ══════════════════════════════════════════════════════════════
    //
    // LE LOCAL RESTE LE RACCOURCI, ET IL PASSE EN PREMIER. Un jardin
    // n'a pas toujours de réseau — c'est même le lieu où il en manque le
    // plus souvent. Un scanner qui exigerait le serveur serait une
    // régression pour l'usage principal du produit : le paysagiste,
    // accroupi devant sa plante, hors couverture.
    //
    // LE RÉSEAU N'EST QU'UN REPLI, et il n'est tenté que si le jeton a
    // la bonne forme. Un QR d'une autre marque ne doit provoquer aucun
    // aller-retour.

    /// Ce qu'un scan a donné. Quatre issues, exactement celles de la
    /// route web `/x` — même vocabulaire des deux côtés.
    enum ResolutionEtiquette {
        /// L'objet est ici, dans la base locale. Le cas normal, et le
        /// seul qui marche hors ligne.
        case locale(SmartTagScanResult)
        /// Le serveur a reconnu l'étiquette, mais cet appareil n'a pas
        /// l'objet. On montre ce qu'il en dit, et rien de plus.
        case distante(EtiquetteResolue)
        /// Inconnue, révoquée, orpheline ou interdite : LA MÊME RÉPONSE
        /// dans les quatre cas. La phrase vient du serveur.
        case refusee(String)
        /// Ni en local, ni joignable. Ce n'est pas un refus, et le dire
        /// comme tel ferait renoncer quelqu'un dont l'étiquette est
        /// bonne.
        case injoignable
    }

    /// La phrase employée quand on refuse SANS avoir pu demander au
    /// serveur — un jeton qui n'a pas la forme d'un jeton Oasis. Elle
    /// est la même que celle de la base (0090 § 6) : deux phrases
    /// différentes selon l'endroit du refus apprendraient au porteur
    /// lesquelles de ses tentatives ont atteint le serveur.
    static let phraseRefus =
        "Cette étiquette ne mène à rien. Si elle vient de votre entreprise, connectez-vous puis scannez-la de nouveau."

    /// Ce qu'on dit quand le serveur n'a pas répondu.
    static let phraseInjoignable =
        "Cette étiquette n'est pas encore sur cet appareil, et le serveur n'a pas répondu. "
        + "Réessayez une fois connecté à Internet."

    @MainActor
    static func resoudre(jeton: String, in context: ModelContext) async -> ResolutionEtiquette {
        // ---- 1. LE RACCOURCI LOCAL ------------------------------
        if let tag = existingTag(forToken: jeton, in: context),
           let resultat = scanResult(for: tag) {
            markScanned(tag)
            return .locale(resultat)
        }

        // ---- 2. LA FORME, AVANT DE DÉRANGER LE RÉSEAU -----------
        guard SmartTagConfig.jetonPlausible(jeton) else { return .refusee(phraseRefus) }

        // ---- 3. LE REPLI RÉSEAU ---------------------------------
        let ligne: EtiquetteResolue?
        do {
            ligne = try await resoudreADistance(jeton: jeton)
        } catch {
            // L'ÉCHEC N'EST PLUS SILENCIEUX. L'ancien code écrivait
            // `try?` et laissait l'écran immobile : l'utilisateur voyait
            // un scan qui ne faisait rien, sans savoir pourquoi.
            OasisLog.sync.debug("Étiquette : le résolveur n'a pas répondu.")
            return .injoignable
        }

        guard let ligne, ligne.ok else {
            return .refusee(ligne?.message ?? phraseRefus)
        }

        // ---- 4. LE SERVEUR A DIT OUI : L'OBJET EST-IL ICI ? -----
        //
        // Il arrive que l'ÉTIQUETTE n'ait pas été synchronisée alors que
        // l'OBJET l'a été — les deux descendent dans la même passe, mais
        // pas forcément dans le même ordre, et une association faite
        // depuis un autre téléphone arrive toujours après. Dans ce cas
        // on ouvre la vraie fiche locale plutôt qu'une carte en lecture
        // seule : c'est exactement la même plante.
        if let locale = resultatLocal(pour: ligne, in: context) {
            return .locale(locale)
        }

        return .distante(ligne)
    }

    private struct ParametresResolution: Encodable, Sendable {
        let pToken: String
        enum CodingKeys: String, CodingKey { case pToken = "p_token" }
    }

    /// LE PORTEUR VIENT DE LA SESSION, JAMAIS D'UN PARAMÈTRE.
    ///
    /// La fonction ne prend que le jeton : c'est elle qui lit
    /// `auth.uid()`, côté serveur. Un résolveur auquel on pourrait dire
    /// « et je suis untel » serait une faille béante, et aucune ligne
    /// d'ici ne pourrait la rattraper. Le client Supabase joint le jeton
    /// de session tout seul quand il y en a un — et n'en joint aucun
    /// quand l'utilisateur n'est pas connecté, ce qui donne exactement
    /// la réponse d'un passant.
    static func resoudreADistance(jeton: String) async throws -> EtiquetteResolue? {
        let lignes: [EtiquetteResolue] = try await AuthService.client
            .rpc("etiquette_resoudre", params: ParametresResolution(pToken: jeton))
            .execute()
            .value
        return lignes.first
    }

    /// L'objet local que le serveur vient de désigner, s'il est ici.
    ///
    /// Écrit en cas explicites plutôt qu'en fonction générique : c'est la
    /// convention de ce fichier et celle de `DeletionService`, et une
    /// abstraction sur cinq types SwiftData coûterait plus de lignes
    /// qu'elle n'en économise.
    ///
    /// Les familles PROFESSIONNELLES — jardin client, zone d'arrosage,
    /// matériel, lot de pépinière, emplacement — n'ont volontairement
    /// aucune branche : elles n'existent pas dans la base locale de
    /// l'iPhone, elles vivent sur le web. Le serveur les décrit, et
    /// c'est tout ce que cet appareil peut en montrer.
    @MainActor
    private static func resultatLocal(
        pour ligne: EtiquetteResolue,
        in context: ModelContext
    ) -> SmartTagScanResult? {
        guard let identifiant = ligne.entiteId else {
            // Un rack n'a aucune ligne derrière lui : son libellé EST la
            // donnée, et le serveur vient de nous le rendre.
            if ligne.entiteType == "rack", let titre = ligne.titre, !titre.isEmpty {
                return .rack(titre)
            }
            return nil
        }

        // Déballé avant le `switch` plutôt que filtré case par case sur
        // un optionnel : ce fichier ne peut pas être compilé sur la
        // machine où il est écrit, et une comparaison de motif sur un
        // `String?` est exactement le genre de subtilité qu'on ne relit
        // pas deux fois.
        switch ligne.entiteType ?? "" {
        case "plant":
            if let objet = premier(FetchDescriptor<Plant>(predicate: #Predicate { $0.id == identifiant }), in: context) {
                return .plant(objet)
            }
        case "bioreactor":
            if let objet = premier(FetchDescriptor<Bioreactor>(predicate: #Predicate { $0.id == identifiant }), in: context) {
                return .bioreactor(objet)
            }
        case "cultureBatch":
            if let objet = premier(FetchDescriptor<CultureBatch>(predicate: #Predicate { $0.id == identifiant }), in: context) {
                return .cultureBatch(objet)
            }
        case "mediumRecipeVersion":
            if let objet = premier(FetchDescriptor<MediumRecipeVersion>(predicate: #Predicate { $0.id == identifiant }), in: context) {
                return .mediumRecipeVersion(objet)
            }
        case "acclimatizationBatch":
            if let objet = premier(FetchDescriptor<AcclimatizationBatch>(predicate: #Predicate { $0.id == identifiant }), in: context) {
                return .acclimatizationBatch(objet)
            }
        default:
            return nil
        }
        return nil
    }

    @MainActor
    private static func premier<T: PersistentModel>(
        _ descripteur: FetchDescriptor<T>,
        in context: ModelContext
    ) -> T? {
        var limite = descripteur
        limite.fetchLimit = 1
        return try? context.fetch(limite).first
    }
}
