# Tester les abonnements en local (Phase 12 §12V)

`OasisCare.storekit` permet de tester les achats **sans App Store Connect**,
directement dans le simulateur ou sur un iPhone en debug.

## ⚠️ Les prix de ce fichier ne sont PAS des prix recommandés

Xcode exige un prix pour chaque produit dans un fichier `.storekit`, sinon il
refuse de charger la configuration. Les montants présents ici (4,99 / 49,99 /
12,99 / 129,99 €) sont donc des **valeurs de test arbitraires**, choisies
uniquement pour que l'écran d'achat affiche quelque chose de plausible pendant
les tests.

Le prompt Phase 12 dit explicitement : « NE PAS inventer les prix définitifs ».
Ces nombres ne sont pas une recommandation tarifaire et ne partent d'aucune
étude de marché. Les vrais prix se définissent dans App Store Connect ; ils
n'ont pas besoin d'être reportés ici, et l'application ne les lit jamais
depuis ce fichier en production (elle affiche toujours `Product.displayPrice`
fourni par StoreKit).

## Activer la configuration dans Xcode

Le fichier est déjà référencé par le schéma via `project.yml`
(`schemes.OasisCare.run.storeKitConfiguration`), donc après un
`xcodegen generate` il est actif automatiquement en mode Run.

Pour le vérifier ou le changer à la main :
Product → Scheme → Edit Scheme → Run → Options → **StoreKit Configuration**.

## Groupe d'abonnement

Les 4 produits sont dans **un seul** groupe d'abonnement (`Oasis Care`), ce qui
est ce que demande le prompt : « Premium et BioLab doivent pouvoir supporter
upgrade/downgrade/mensuel/annuel sans double abonnement incohérent ». Dans un
même groupe, Apple garantit qu'un utilisateur n'a qu'un abonnement actif à la
fois et gère lui-même le passage de l'un à l'autre.

`groupNumber` est le niveau de service : **1 = le plus élevé**. BioLab est donc
en niveau 1 et Premium en niveau 2, ce qui fait que Premium → BioLab est traité
par Apple comme une montée en gamme (facturation immédiate au prorata) et
BioLab → Premium comme une descente (appliquée à la fin de la période).

La même structure doit être reproduite manuellement dans App Store Connect —
ce fichier ne configure que le test local.

## Scénarios à tester (liste du prompt §12V)

Dans Xcode, avec l'app lancée : Debug → StoreKit → **Manage Transactions**
permet de rembourser, faire expirer, ou forcer un renouvellement.

- [ ] Premium mensuel
- [ ] Premium annuel
- [ ] BioLab
- [ ] upgrade Premium → BioLab
- [ ] downgrade BioLab → Premium
- [ ] annulation
- [ ] renouvellement
- [ ] expiration
- [ ] refund / révocation simulée
- [ ] restaurer les achats
- [ ] mode avion (l'abonné doit garder Premium — cf. `EntitlementSnapshot`)
- [ ] réinstallation de l'app
- [ ] nouvel iPhone
- [ ] logout / login
- [ ] changement de compte
- [ ] problème de facturation (`_billingIssuesEnabled` dans le fichier)

Les réglages `settings` du fichier permettent aussi de simuler « Demander à
acheter » (`_askToBuyEnabled`) et les échecs de transaction
(`_failTransactionsEnabled`).

**Ces scénarios n'ont pas encore été exécutés** : ils demandent un Mac avec
Xcode, ce dont la session de développement ne disposait pas. Ils restent à
faire avant toute mise en vente réelle.
