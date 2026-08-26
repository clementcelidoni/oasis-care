import Foundation

/// See `LegalDocument.swift` — DRAFT, not reviewed by a lawyer.
enum LegalContent {
    static let lastUpdated = "26 août 2026"

    static let privacyPolicy = """
    Politique de confidentialité — Oasis Care

    Dernière mise à jour : \(lastUpdated)

    Ce document décrit, aussi précisément que possible à partir du fonctionnement réel de l'application, quelles données Oasis Care collecte et pourquoi. Il s'agit d'un brouillon technique qui doit être relu (et idéalement validé par un professionnel du droit) avant toute publication publique.

    1. Données de compte
    Si vous créez un compte (Apple, Google ou e-mail), nous conservons votre adresse e-mail et un identifiant de compte. Sans compte, l'application fonctionne en mode invité et vos données restent uniquement sur votre appareil.

    2. Données que vous créez dans l'application
    Plantes, jardins, zones, historique de soins, mesures, notes, photos que vous ajoutez, ainsi que les données du module BioLab (lots de culture, recettes, inventaire de laboratoire) si vous l'utilisez. Si vous êtes connecté, ces données sont synchronisées sur nos serveurs (Supabase) pour être disponibles sur vos autres appareils.

    3. Localisation
    Si vous choisissez d'indiquer la position de votre jardin ou d'une plante sur la carte, cette position (coordonnées GPS) est enregistrée. Ce n'est jamais automatique : elle n'est demandée que lorsque vous utilisez une fonction qui en a besoin.

    4. Photos
    Les photos que vous ajoutez (plantes, inspections d'arbres, BioLab) sont stockées de façon privée, accessibles uniquement à vous et aux membres de votre espace de travail.

    5. Fonctions d'intelligence artificielle
    Certaines fonctions optionnelles (identification de plante, assistant IA, diagnostic, recommandations BioLab) envoient les photos ou informations que vous soumettez à des prestataires tiers spécialisés (Pl@ntNet pour l'identification, OpenAI pour les autres analyses) uniquement au moment où vous utilisez ces fonctions. Ces prestataires traitent la requête pour vous répondre ; consultez leurs propres politiques de confidentialité pour savoir comment ils traitent ces données de leur côté.

    6. Appareils connectés
    Si vous connectez des capteurs ou des accessoires Matter/HomeKit, les données de mesure (température, humidité, etc.) qu'ils produisent sont enregistrées pour l'historique et les automatisations que vous configurez.

    7. Abonnements et paiement
    Les achats et abonnements sont gérés entièrement par Apple (App Store). Oasis Care ne voit et ne stocke jamais votre numéro de carte bancaire ou vos informations de paiement — nous recevons seulement une confirmation technique (identifiant de transaction, produit acheté, statut) permettant de débloquer les fonctions correspondantes sur votre compte.

    8. Mesure d'usage (analytics)
    Nous mesurons certains événements techniques anonymisés (par exemple : un onboarding terminé, un achat effectué) pour comprendre l'usage général de l'application et l'améliorer. Ces événements ne contiennent jamais le contenu de vos plantes, notes, photos ou données BioLab, et ne servent à aucune publicité — l'application n'intègre aucun SDK publicitaire ni outil de suivi publicitaire.

    9. Vos droits
    Vous pouvez à tout moment exporter vos données (Réglages → Exporter mes données) ou supprimer votre compte et les données associées (Réglages → Supprimer mon compte). La suppression de compte ne résilie pas automatiquement un abonnement Apple actif — gérez-le séparément depuis les réglages de votre abonnement Apple.

    10. Contact
    Pour toute question sur cette politique, utilisez la fonction Aide & Support de l'application.
    """

    static let termsOfUse = """
    Conditions d'utilisation — Oasis Care

    Dernière mise à jour : \(lastUpdated)

    Ce document est un brouillon technique décrivant le fonctionnement réel du service ; il doit être relu et validé (idéalement par un professionnel du droit) avant toute publication publique.

    1. Le service
    Oasis Care est une application de gestion de plantes, jardins et (en option) de culture in vitro (BioLab). Certaines fonctions sont disponibles gratuitement (offre Free), d'autres nécessitent un abonnement (Premium, BioLab).

    2. Abonnements
    Les abonnements sont facturés et gérés par Apple via l'App Store, aux prix affichés dans l'application au moment de l'achat. Ils se renouvellent automatiquement sauf annulation, gérée directement depuis les réglages de votre identifiant Apple. Le prix exact, la périodicité et les conditions de tout essai éventuel sont ceux indiqués par l'App Store au moment de l'achat.

    3. Vos données
    Vos plantes, jardins, photos et données BioLab restent les vôtres. Si vous cessez un abonnement payant, vos données existantes restent consultables — seules certaines fonctions de création ou fonctions avancées peuvent redevenir limitées selon l'offre Free.

    4. Utilisation raisonnable
    Les fonctions d'intelligence artificielle sont soumises à des quotas d'usage raisonnables selon votre offre, destinés à éviter les abus plutôt qu'à limiter un usage normal.

    5. Résiliation
    Vous pouvez supprimer votre compte à tout moment depuis les réglages. Cela ne résilie pas automatiquement un abonnement Apple actif.

    6. Contact
    Pour toute question, utilisez la fonction Aide & Support de l'application.
    """
}
