# App Store — métadonnées préparées (Phase 12 §12R)

> ⚠️ **BROUILLON À VALIDER — RIEN N'A ÉTÉ PUBLIÉ.**
> Le prompt Phase 12 impose : « NE PAS publier automatiquement la description
> sans la présenter dans le rapport final. » Ces textes sont donc préparés ici
> pour relecture, et doivent être copiés manuellement dans App Store Connect
> après validation. Aucun accès App Store Connect n'a été utilisé.

## Identité de l'app — audit

| Élément | Valeur actuelle | Statut |
|---|---|---|
| Bundle ID | `com.oasisrarecare.app` | ✅ **inchangé** (règle : ne jamais le changer) |
| Display name | `Oasis Care` | ✅ conforme au branding |
| `PRODUCT_NAME` | `OasisCare` | ✅ inchangé |
| Marketing version | `0.1.0` | ⚠️ voir note ci-dessous |
| Build number | `github.run_number` (CI) | ✅ auto-incrémenté, jamais en conflit |
| Icône | 1024×1024, `Format24bppRgb`, **sans canal alpha** | ✅ conforme (vérifié) |
| Langue de développement | `fr` | ✅ |

**Note version** : `0.1.0` est cohérent pour TestFlight, mais une première mise
en vente publique s'annonce habituellement en `1.0.0`. Ce n'est pas un blocage
technique et cela reste une décision produit — non modifié unilatéralement.
Pour changer : `MARKETING_VERSION` dans `project.yml`.

---

## Subtitle (max 30 caractères)

```
Jardin, plantes et BioLab
```
*(25 caractères)*

## Promotional text (max 170 caractères, modifiable sans re-soumettre)

```
Suivez chaque plante, pilotez votre jardin connecté et gérez vos cultures in vitro. Oasis AI vous accompagne à chaque étape.
```
*(123 caractères)*

## Keywords (max 100 caractères au total, séparés par des virgules, sans espaces)

```
plante,jardin,arrosage,botanique,serre,bassin,capteur,irrigation,invitro,bouture,entretien
```
*(90 caractères)*

Volontairement sans « Oasis » ni « Care » : le nom de l'app est déjà indexé
séparément par Apple, les répéter gaspillerait des caractères.

## Description (max 4000 caractères)

```
Oasis Care réunit dans une seule application tout ce qui vit dans votre univers végétal : vos plantes d'intérieur, votre jardin, votre serre, votre bassin — et, pour ceux qui vont plus loin, votre laboratoire de culture in vitro.

VOS PLANTES
Créez une fiche par végétal : espèce, photos, emplacement, historique. Programmez arrosage, engrais et rotation, et recevez des rappels. Suivez l'évolution dans le temps grâce aux photos datées et aux mesures (hauteur, circonférence, couronne).

VOTRE JARDIN
Organisez vos végétaux par jardins et par zones. Visualisez l'ensemble sur une carte, suivez la consommation d'eau par zone d'irrigation, et effectuez des tours d'inspection guidés pour mettre à jour l'état de santé de chaque plante.

OASIS AI
Identifiez une plante à partir de photos. Obtenez une fiche d'espèce détaillée. Posez vos questions à un assistant qui connaît le contexte de votre jardin. Analysez un problème à partir d'une photo — les réponses restent prudentes et n'affirment jamais un diagnostic certain.

JARDIN CONNECTÉ
Reliez vos capteurs et équipements compatibles HomeKit et Matter. Suivez température, humidité et arrosage, et pilotez serre et bassin depuis l'application.

OASIS BIOLAB
Pour la culture in vitro : lots de culture, bioréacteurs, recettes de milieux, protocoles, inspections et traçabilité complète des opérations.

FONCTIONNE SANS COMPTE
L'essentiel fonctionne hors ligne et sans création de compte. Un compte sert uniquement à synchroniser vos données entre appareils et à utiliser les fonctions IA.

VOS DONNÉES VOUS APPARTIENNENT
Exportez vos données à tout moment. Supprimez votre compte depuis l'application. Aucun SDK publicitaire, aucun pistage.

ABONNEMENTS
Oasis Care s'utilise gratuitement, avec un nombre limité de plantes, un jardin et un quota mensuel de requêtes IA.
Oasis Care Premium débloque les plantes et jardins illimités, le Digital Twin, les capteurs et le jardin connecté, l'irrigation intelligente, la serre et le bassin, le QR/NFC, et un quota IA élargi.
Oasis Care BioLab ajoute l'ensemble du module de culture in vitro.

Les abonnements se renouvellent automatiquement sauf annulation au moins 24 h avant la fin de la période. La gestion et l'annulation se font dans les réglages de votre compte Apple.
```

> **À vérifier avant publication** : la mention obligatoire des abonnements
> auto-renouvelables doit être accompagnée, dans la fiche App Store, des liens
> vers les Conditions d'utilisation (EULA) et la Politique de confidentialité.
> Les textes existent dans l'app (`LegalContent.swift`) mais **n'ont pas été
> relus par un juriste** et ne sont pas encore hébergés sur une URL publique,
> ce qu'App Store Connect exige.

## Release notes — première version

```
Première version d'Oasis Care.

- Fiches de végétaux, photos datées et mesures de croissance
- Jardins, zones et carte interactive
- Rappels d'arrosage, d'engrais et de rotation
- Oasis AI : identification, fiche d'espèce, assistant et analyse photo
- Jardin connecté HomeKit et Matter, irrigation, serre et bassin
- Oasis BioLab : lots de culture, bioréacteurs, recettes et traçabilité
- Export de vos données et suppression de compte depuis l'application
```

## Anglais

Le prompt demande l'anglais « si localisation existante ». **Il n'y en a pas** :
l'app est en français uniquement (`DEVELOPMENT_LANGUAGE: fr`, chaînes en dur en
français). Publier une fiche anglaise pour une app francophone dégraderait
l'expérience — à faire en même temps que la localisation réelle de l'app
(§12U, non réalisée).

---

## Screenshots — liste à produire (§12R)

Le prompt fournit les 7 accroches. Chaque écran ci-dessous existe réellement
dans l'app — règle « Ne pas inventer une fonction non disponible » respectée.

| # | Accroche | Écran à capturer | Existe |
|---|---|---|---|
| 1 | Toutes vos plantes, au même endroit. | Onglet Végétaux, liste remplie | ✅ |
| 2 | Un jardin qui devient intelligent. | Accueil (tableau de bord, score de santé, à faire) | ✅ |
| 3 | Visualisez votre jardin avec Digital Twin. | Jardin → Carte → mode Plan Oasis | ✅ |
| 4 | Suivez l'arrosage et vos capteurs. | Jardin → zones d'irrigation + section capteurs | ✅ |
| 5 | Oasis AI vous accompagne. | Assistant IA d'une plante, avec une réponse | ✅ |
| 6 | Connectez serre, bassin et irrigation. | Maison connectée / tableau de bord serre | ✅ |
| 7 | BioLab : maîtrisez vos cultures in vitro. | Tableau de bord BioLab | ✅ |

**Non réalisables dans cette session** : produire les captures demande un
simulateur ou un iPhone réel (aucun Mac disponible). Elles doivent être prises
aux tailles exigées par Apple (6,9" et 6,5" au minimum) avec des données de
démonstration crédibles — et non un compte vide.

---

## Custom Product Pages (§12S) — à préparer après le lancement

Trois audiences, sans bloquer la mise en vente initiale :

1. **Plant Care** — plantes + IA + rappels
2. **Smart Garden** — Digital Twin + irrigation + capteurs
3. **BioLab** — culture in vitro + bioréacteurs

---

## Actions manuelles requises dans App Store Connect

Aucune ne peut être faite depuis cette session.

1. Créer les 4 produits d'abonnement avec **exactement** les identifiants de
   `ProductIdentifiers.swift` (`com.oasiscare.premium.monthly` / `.yearly`,
   `com.oasiscare.biolab.monthly` / `.yearly`) — ou, s'ils existent déjà avec
   d'autres identifiants, modifier ce seul fichier Swift pour correspondre.
2. Les placer **tous les quatre dans un seul groupe d'abonnement**, BioLab au
   niveau de service supérieur (cf. `STOREKIT_TESTING.md`).
3. Fixer les **prix réels** (jamais inventés dans le code).
4. Renseigner la **déclaration de confidentialité** de la fiche, cohérente avec
   `PrivacyInfo.xcprivacy`.
5. Héberger Conditions et Politique de confidentialité sur des **URL publiques**
   et les renseigner dans la fiche.
6. Configurer l'URL du **webhook App Store Server Notifications V2** vers la
   fonction `apple-subscription-webhook` (⚠️ code non testé, voir le rapport).
7. Téléverser les **7 captures d'écran**.
