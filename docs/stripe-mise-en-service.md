# Brancher les paiements — notice de mise en service

**Pour qui :** le dirigeant. Aucune connaissance technique n'est supposée.
**Combien de temps :** comptez deux heures pour le mode Essai, une heure de plus pour la production.
**Ce que vous ne pouvez pas casser :** rien de ce qui suit ne touche vos données clients. En mode Essai, aucun argent ne circule — les cartes sont fictives.

---

## Avant de commencer : les deux règles à ne jamais enfreindre

### Règle 1 — Une clé secrète ne se copie nulle part

Vous allez manipuler des clés. Il y en a deux sortes :

| Sorte | À quoi ça ressemble | Où elle a le droit d'aller |
|---|---|---|
| **Publiable** | commence par `pk_` | Partout. Elle est faite pour être vue. |
| **Secrète** | commence par `sk_`, `rk_` ou `whsec_` | **Uniquement** dans les cases « variables d'environnement » décrites plus bas. |

Une clé secrète **ne doit JAMAIS** être :
- collée dans une conversation (y compris avec moi) ;
- écrite dans un fichier du projet ;
- posée dans une variable dont le nom commence par `NEXT_PUBLIC_`.

Ce dernier point mérite une phrase de plus, parce qu'il est **silencieux**. Le préfixe `NEXT_PUBLIC_` est le mécanisme qui recopie une valeur dans la page web envoyée à **chaque visiteur**. Poser une clé secrète sous ce préfixe la publie sur internet, sans aucun message d'erreur, sans que rien ne change à l'écran. Le code refuse désormais d'encaisser s'il détecte ce cas — mais il ne peut le détecter qu'après coup.

**Si une clé secrète a été exposée, même brièvement : allez la révoquer chez Stripe et créez-en une neuve.** C'est gratuit et ça prend trente secondes.

### Règle 2 — Nos factures sont les factures

Stripe **encaisse**. Oasis Care **facture**.

Stripe sait produire ses propres factures. **Nous ne nous en servons pas**, et il faudra désactiver leur envoi (étape 7). La facture légale française — numérotée sans trou, avec ses mentions obligatoires — est celle que produit notre base de données. Deux factures numérotées différemment pour un seul paiement est une faute comptable : votre client ne saurait pas laquelle remettre à son comptable, et l'administration non plus.

---

## Étape 0 — Ce qui doit être fait AVANT (par un technicien)

Rien de ce qui suit ne fonctionnera tant que la base de données n'a pas reçu la migration `0083`. Elle est écrite et testée, mais **pas encore déployée**.

À faire déployer :

```
supabase/migrations/0083_stripe.sql
```

Vérification que c'est fait : la table `billing_provider_prices` doit exister. Tant qu'elle n'existe pas, l'écran d'abonnement affichera « le paiement n'est pas encore branché » — et c'est le comportement voulu, pas une panne.

---

## Étape 1 — Créer le compte et rester en mode Essai

1. Allez sur **stripe.com** et créez un compte, ou connectez-vous.
2. En haut à droite du tableau de bord, repérez l'interrupteur **« Mode test »** / **« Test mode »**. **Activez-le.** Un bandeau orange doit apparaître.
3. **Ne le désactivez pas** avant l'étape 12.

> Tout ce que vous créez en mode Essai est **invisible** en production, et réciproquement. Ce n'est pas une gêne : c'est ce qui vous permet de vous tromper sans conséquence. Vous referez le même travail en production à l'étape 12, et ce sera rapide parce que vous saurez déjà où cliquer.

---

## Étape 2 — Créer les produits et les tarifs

Menu **Catalogue de produits** (ou *Product catalogue*) → **Ajouter un produit**.

### Le réglage qui compte, sur CHAQUE tarif

Quand vous créez un tarif, Stripe demande si le prix est **hors taxes** ou **toutes taxes comprises**. Choisissez systématiquement :

> **Hors taxes** (en anglais : *Exclusive* — « Tax behaviour: exclusive »)

**Tous nos prix sont hors taxes.** C'est la décision que vous avez prise, et toute la mécanique en dépend. Un tarif enregistré « toutes taxes comprises » ferait payer la TVA française à un client néerlandais qui n'en doit pas.

Réglez aussi chaque tarif en **récurrent** (*Recurring*), avec la période indiquée ci-dessous, en **euros**.

### La liste exacte à créer

Ces montants sont ceux que contient la base aujourd'hui. **Ils doivent correspondre au centime près** : si un montant diffère, le système refusera d'encaisser plutôt que de facturer le mauvais prix (c'est voulu).

**Produit 1 — « Oasis Care Pro Solo »**

| Tarif | Montant | Période |
|---|---|---|
| Mensuel | 39,90 € | tous les mois |
| Annuel | 399,00 € | tous les ans |

**Produit 2 — « Oasis Care Pro »**

| Tarif | Montant | Période |
|---|---|---|
| Mensuel | 79,90 € | tous les mois |
| Annuel | 799,00 € | tous les ans |

**Produit 3 — « Oasis Care Pro Business »**

| Tarif | Montant | Période |
|---|---|---|
| Mensuel | 139,90 € | tous les mois |
| Annuel | 1 399,00 € | tous les ans |

**Produit 4 — « Siège supplémentaire »**

| Tarif | Montant | Période |
|---|---|---|
| Mensuel | 9,90 € | tous les mois |

> **Pas de tarif annuel pour le siège.** Personne n'a tranché s'il vaut dix ou douze mois. Tant que ce n'est pas décidé, une souscription annuelle **avec** sièges supplémentaires sera refusée avec un message clair. L'annuel **sans** siège supplémentaire fonctionne normalement.

**Produit 5 — « Module BioLab »**

| Tarif | Montant | Période |
|---|---|---|
| Mensuel | 20,00 € | tous les mois |
| Annuel | 200,00 € | tous les ans |

**Produit 6 — « Module Pépinière »**

| Tarif | Montant | Période |
|---|---|---|
| Mensuel | 20,00 € | tous les mois |
| Annuel | 200,00 € | tous les ans |

> Ces deux modules ne se facturent **que sur l'offre Pro**. Ils sont **compris** dans Pro Business : un client Business qui les active ne paie rien de plus, automatiquement.

**Produit 7 — « Tarif fondateur »**

| Tarif | Montant | Période |
|---|---|---|
| Mensuel | 49,90 € | tous les mois |

> Réservé à l'offre **Pro**, pendant **12 mois**, **avec engagement**, puis retour à 79,90 €. Il ne se vend **qu'au mois** : la version annuelle est refusée tant que personne n'a tranché entre 12 × 49,90 (598,80 €) et 10 × 49,90 (499 €).

**Ce qu'il ne faut PAS créer :** aucun tarif pour **Enterprise**. Cette offre se construit sur devis, à partir de 249 € HT, et ne se souscrit jamais en ligne.

### Notez les identifiants

Pour chaque tarif créé, Stripe affiche un identifiant qui ressemble à `price_1AbCdEfGh…`. **Notez-les tous** dans un fichier à part, en face du nom du tarif. Vous en aurez besoin à l'étape 8.

Ces identifiants ne sont **pas secrets** — vous pouvez les écrire où vous voulez.

---

## Étape 3 — Créer le taux de TVA

Menu **Plus** → **Taux de taxe** (*Tax rates*) → **Créer un taux**.

| Champ | Valeur |
|---|---|
| Nom affiché | TVA |
| Pourcentage | **20** |
| Type | **Exclusif** (le taux s'ajoute au prix) |
| Pays | France |
| Description | TVA française, taux normal |

Notez l'identifiant obtenu — il ressemble à `txr_1AbCdEf…`.

> **Un seul taux, et c'est normal.** Un client français paie 20 % ; une entreprise européenne avec numéro de TVA validé paie 0 % (autoliquidation) ; hors Union, 0 % également. Les deux derniers cas n'ont besoin d'aucun objet chez Stripe — il n'y a rien à ajouter.
>
> **N'activez PAS « Stripe Tax »** (le calcul automatique de taxes). C'est notre base qui calcule la TVA, et elle sait **refuser** quand elle ne sait pas. Stripe Tax, lui, calcule zéro sans un mot quand une immatriculation manque — et on croit collecter alors qu'on ne collecte rien. Deux calculateurs de taxe sur la même transaction, ce sont deux vérités et un jour un écart.

---

## Étape 4 — Récupérer la clé secrète

Menu **Développeurs** → **Clés d'API**.

Créez de préférence une **clé restreinte** (*Restricted key*) plutôt que la clé secrète standard : elle ne peut faire que ce qu'on l'autorise à faire, donc elle fait moins de dégâts si elle fuit. Donnez-lui le droit d'**écriture** sur *Checkout Sessions* et la **lecture** sur *Products*, *Prices*, *Customers*.

Vous obtenez une clé qui commence par `rk_test_` (ou `sk_test_`).

**Ne la collez nulle part pour l'instant.** Gardez la fenêtre ouverte, ou copiez-la dans un gestionnaire de mots de passe. Elle va à l'étape 5, et à aucun autre endroit.

---

## Étape 5 — Poser les variables du site

Ce sont des cases à remplir chez l'hébergeur du site (Vercel, ou l'équivalent) : cherchez **Settings → Environment Variables**. Si vous travaillez aussi en local, les mêmes lignes vont dans le fichier `web-pro/.env.local`.

| Nom de la variable | Valeur à mettre | Nature |
|---|---|---|
| `STRIPE_SECRET_KEY` | la clé de l'étape 4 | **SECRÈTE** |
| `STRIPE_MODE` | `test` | publique |
| `NEXT_PUBLIC_SITE_URL` | l'adresse publique du site, par exemple `https://pro.oasiscare.fr` | publique |

Trois précisions qui évitent trois pannes :

- **`STRIPE_MODE` se saisit à la main**, il n'est pas deviné à partir de la clé. C'est volontaire : une déduction se trompe une fois, et cette fois-là on envoie des tarifs d'essai à l'API de production.
- **`NEXT_PUBLIC_SITE_URL` est obligatoire.** Sans elle, la caisse reste fermée. C'est l'adresse vers laquelle le client revient après avoir payé, et elle ne peut pas venir du navigateur — sinon n'importe qui pourrait faire rediriger vos clients ailleurs au sortir d'une page de paiement.
- **Aucune de ces trois n'est `NEXT_PUBLIC_STRIPE_SECRET_KEY`.** Si vous voyez ce nom quelque part, c'est une fuite : révoquez la clé chez Stripe et reposez-la sous le bon nom.

La variable `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` existe déjà et n'est **pas utilisée** aujourd'hui — le tunnel de paiement est une page hébergée par Stripe. Ne la retirez pas, mais ne vous étonnez pas de ne pas la voir servir.

Après avoir posé ces variables, **redéployez le site** : elles ne sont lues qu'au démarrage.

---

## Étape 6 — Déployer et déclarer le webhook

Le « webhook » est le message que Stripe envoie à Oasis Care pour dire « ce client a payé ». **C'est la seule chose qui ouvre un droit.** Le retour du navigateur après paiement ne compte pas : n'importe qui peut taper l'adresse de la page « merci ».

### 6.a — Déployer la fonction

Un technicien lance cette commande, **exactement** ainsi :

```
npx supabase functions deploy stripe-webhook --no-verify-jwt
```

> **Le drapeau `--no-verify-jwt` n'est pas optionnel.** Stripe ne présente aucun jeton Supabase. Sans ce drapeau, la fonction répond « accès refusé » à chaque message, Stripe marque le point de terminaison en échec, puis **le désactive au bout de trois jours**. Plus aucun paiement ne serait constaté — silencieusement.
>
> Cela n'ouvre aucune porte : la fonction vérifie elle-même la signature de chaque message et rejette tout ce qui n'est pas signé par Stripe.

### 6.b — Déclarer l'adresse chez Stripe

Menu **Développeurs** → **Webhooks** → **Ajouter un point de terminaison**.

**Adresse à déclarer :**

```
https://<référence-du-projet>.supabase.co/functions/v1/stripe-webhook
```

(La référence du projet est visible dans le tableau de bord Supabase.)

**Événements à cocher** — ceux-là et pas d'autres :

- `checkout.session.completed`
- `invoice.paid`
- `invoice.payment_failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

### 6.c — Récupérer le secret de signature

Stripe affiche alors un secret qui commence par `whsec_`. **C'est une clé secrète.**

Elle ne va **pas** chez l'hébergeur du site : elle appartient à Supabase. Un technicien la pose ainsi :

```
npx supabase secrets set STRIPE_WEBHOOK_SECRET=...
npx supabase secrets set STRIPE_MODE=test
```

---

## Étape 7 — LE RÉGLAGE À NE PAS OUBLIER : couper les factures de Stripe

**C'est l'étape qu'on oublie, et elle a des conséquences comptables.**

Menu **Paramètres** → **Facturation** → **E-mails aux clients** (*Customer emails*).

**Décochez tout ce qui concerne l'envoi de factures et de reçus** :
- « Envoyer les factures finalisées »
- « Envoyer les reçus de paiement réussi »

Pourquoi : si Stripe envoie sa facture **et** que nous envoyons la nôtre, votre client reçoit **deux documents numérotés différemment pour un seul achat**. Il ne sait pas lequel donner à son comptable, et vous avez deux séries de numéros pour la même vente. C'est une faute comptable, et elle se répare mal après coup.

Laissez en revanche actifs les messages qui ne sont pas des factures : échec de paiement, carte bientôt expirée. Ceux-là vous rendent service.

---

## Étape 8 — Relier nos tarifs à ceux de Stripe

Les identifiants notés à l'étape 2 doivent maintenant être enregistrés dans la base. Sans cela, le système ne sait pas quel tarif Stripe correspond à quelle offre, et il **refuse d'encaisser** plutôt que de deviner.

Un technicien exécute, pour chaque ligne, un appel de cette forme (les valeurs entre chevrons sont à remplacer par les identifiants notés) :

```sql
select public.admin_set_provider_price(
  'stripe', 'test',
  'plan',            -- nature : plan | seat | module | discount
  'team',            -- l'offre
  'monthly',         -- le rythme
  null,              -- le module (pour la nature « module » seulement)
  null,              -- le code de remise (pour la nature « discount »)
  '<price_…>',       -- l'identifiant du tarif chez Stripe
  null,              -- l'identifiant du produit, facultatif
  7990,              -- le montant EN CENTIMES, hors taxes
  'Mise en service.' -- le motif, obligatoire
);
```

Les quatorze lignes à créer :

| Nature | Offre | Rythme | Module / code | Centimes |
|---|---|---|---|---|
| `plan` | `solo` | `monthly` | — | 3990 |
| `plan` | `solo` | `yearly` | — | 39900 |
| `plan` | `team` | `monthly` | — | 7990 |
| `plan` | `team` | `yearly` | — | 79900 |
| `plan` | `business` | `monthly` | — | 13990 |
| `plan` | `business` | `yearly` | — | 139900 |
| `seat` | `solo` | `monthly` | — | 990 |
| `seat` | `team` | `monthly` | — | 990 |
| `seat` | `business` | `monthly` | — | 990 |
| `module` | `team` | `monthly` | `biolab` | 2000 |
| `module` | `team` | `yearly` | `biolab` | 20000 |
| `module` | `team` | `monthly` | `nursery` | 2000 |
| `module` | `team` | `yearly` | `nursery` | 20000 |
| `discount` | `team` | `monthly` | `FONDATEUR` | 4990 |

Et le taux de TVA de l'étape 3 :

```sql
select public.admin_set_provider_tax_rate(
  'stripe', 'test', 'FR', 20.00, '<txr_…>', 'Mise en service.'
);
```

> **Ces appels vérifient ce que vous saisissez.** Si vous annoncez 6990 alors que la grille dit 7990, l'enregistrement est **refusé** avec un message qui donne les deux chiffres. Le système préfère ne pas vendre plutôt que vendre au mauvais prix.
>
> **Il faut être administrateur de la plateforme avec double authentification active** pour exécuter ces appels.

---

## Étape 9 — Essayer, pour de vrai

Toujours en mode Essai. Prenez un compte professionnel de test dont la fiche société est **complète** : dénomination sociale, SIRET, adresse, code postal, ville. Sans ces informations, le système refuse d'encaisser — parce qu'il ne pourrait pas émettre la facture ensuite, et un paiement sans facture est pire qu'une vente perdue.

1. Allez sur l'écran **Abonnement**, cliquez **Choisir une offre**.
2. Choisissez **Pro**, au mois. Vérifiez le récapitulatif :
   - **79,90 € HT** de total,
   - **15,98 €** de TVA,
   - **95,88 € TTC** en montant prélevé.
   Si le montant prélevé affiche 79,90 €, la TVA n'est pas branchée : reprenez les étapes 3 et 8.
3. Cliquez **Payer**. Vous arrivez sur la page de Stripe.
4. Payez avec la carte de test : **4242 4242 4242 4242**, une date future quelconque, n'importe quel code à trois chiffres.

### Ce qu'il faut vérifier ensuite

| Où | Ce qui doit apparaître |
|---|---|
| Stripe → Développeurs → Webhooks | Vos événements, en **vert** (réponse 200). Pas de rouge. |
| Stripe → Paiements | Un paiement de **95,88 €**, pas de 79,90 €. |
| Base → `billing_provider_events` | Une ligne par événement, avec `outcome = applied` ou `ignored`. |
| Boîte mail du client de test | **Aucune facture Stripe.** Si vous en recevez une, l'étape 7 n'est pas faite. |

**Si un événement est rouge**, ouvrez-le : Stripe affiche la réponse reçue. Une réponse « 401 » signifie que le drapeau `--no-verify-jwt` manque (étape 6.a).

### Essayez aussi ce qui doit échouer

Un système qui n'accepte jamais de refuser finit par accepter n'importe quoi. Vérifiez que :

- une entreprise **sans SIRET** ne peut pas payer, et que le message dit ce qui manque ;
- l'offre **Enterprise** ne propose pas de bouton « Payer », mais une prise de contact ;
- une entreprise **déjà abonnée** ne peut pas souscrire une seconde fois.

---

## Étape 10 — Le tarif fondateur, si vous le vendez

Deux limites à connaître **avant** de le promettre à un client :

1. **Il n'est pas encore vendable en libre-service.** La remise doit être posée à la main par un administrateur sur l'abonnement du client. Le tunnel sait ensuite l'appliquer et l'annoncer.
2. **L'engagement de douze mois est vérifié par le serveur.** Si le texte contractuel n'est pas publié en base, ou si la preuve d'acceptation ne peut pas être enregistrée, le paiement est **refusé**. C'est volontaire : encaisser douze mois qu'on ne saurait pas démontrer expose à tout rembourser à la première contestation.

Tant que ces deux points ne sont pas levés, vendez le tarif fondateur **à la main**, en accompagnant le client.

---

## Étape 11 — Ce qui reste manuel, et qu'il faut savoir

Trois choses ne se font pas toutes seules aujourd'hui. Aucune n'empêche d'encaisser ; toutes méritent d'être connues.

**a. L'abonnement ne s'ouvre pas automatiquement après paiement.**
Le paiement est bien enregistré et rattaché à la facture. Mais la ligne d'abonnement elle-même (l'offre en cours de l'entreprise) doit être créée par un administrateur. C'est un choix de sécurité assumé : aucune machine n'a le droit d'ouvrir un abonnement. **À faire suivre après chaque première souscription.**

**b. Les entreprises européennes hors France ne peuvent pas s'abonner seules.**
Leur numéro de TVA intracommunautaire doit être **validé** en base avant que la souscription soit possible. Sans validation, le système refuse — il ne devine ni 0 %, ni 20 %. Un client néerlandais qui s'inscrit un dimanche soir devra attendre. C'est plus strict que nécessaire, mais l'inverse — facturer 0 % à un non-assujetti — laisse Oasis Care redevable de la TVA.

**c. Les sièges supplémentaires ne se recomptent pas tout seuls.**
Une entreprise qui souscrit à trois comptes puis en ouvre vingt-cinq continue de payer pour trois. Une fonction existe maintenant pour voir l'écart :

```sql
select * from public.subscription_seat_drift();
```

**À regarder une fois par mois.** Corriger le comptage automatiquement demande de modifier le moteur de facturation, ce qui mérite son propre chantier.

---

## Étape 12 — Passer en production

À ne faire **qu'après** avoir vu l'étape 9 fonctionner de bout en bout.

1. Chez Stripe, **désactivez le mode Essai**. Le bandeau orange disparaît.
2. **Recréez tout** en production : les sept produits et leurs tarifs (étape 2), le taux de TVA (étape 3). **Rien ne se recopie automatiquement d'un mode à l'autre.** Les identifiants seront **différents**.
3. Créez une nouvelle clé secrète (étape 4) — elle commencera par `rk_live_` ou `sk_live_`.
4. Chez l'hébergeur, remplacez `STRIPE_SECRET_KEY` par la nouvelle et passez **`STRIPE_MODE` à `live`**. Redéployez.
5. Déclarez un **nouveau** webhook (étape 6.b) avec les mêmes événements, récupérez son secret `whsec_` de production et posez-le côté Supabase, avec `STRIPE_MODE=live`.
6. **Refaites l'étape 7** : les réglages d'e-mails ne se recopient pas non plus. Vérifiez que l'envoi de factures est bien coupé en production.
7. Refaites l'étape 8 avec les **nouveaux** identifiants, en remplaçant `'test'` par `'live'` dans chaque appel.
8. Faites un vrai paiement, avec une vraie carte, sur une offre au mois. Vérifiez le montant TTC. Remboursez-le depuis Stripe si vous le souhaitez.

> **Le mode fait partie de l'identité de chaque tarif enregistré.** Une correspondance créée en Essai ne vaut rien en production, et le système le sait : il refusera d'encaisser plutôt que d'employer un tarif d'essai avec une clé de production.

---

## Récapitulatif des clés — à garder sous la main

| Variable | Où la poser | Nature | Où l'obtenir |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Hébergeur du site | **SECRÈTE** | Stripe → Développeurs → Clés d'API |
| `STRIPE_MODE` | Hébergeur **et** Supabase | publique | `test` ou `live`, à la main |
| `NEXT_PUBLIC_SITE_URL` | Hébergeur du site | publique | l'adresse de votre site |
| `STRIPE_WEBHOOK_SECRET` | **Supabase uniquement** | **SECRÈTE** | Stripe → Webhooks, à la création |

Les deux variables marquées **SECRÈTE** ne doivent jamais apparaître ailleurs que dans ces cases — ni dans une conversation, ni dans un fichier du projet, ni sous un nom commençant par `NEXT_PUBLIC_`.

---

## En cas de problème

| Symptôme | Cause la plus probable |
|---|---|
| « Le paiement en ligne n'est pas encore branché » | `STRIPE_SECRET_KEY` absente, ou site non redéployé après l'avoir posée. |
| « Le mode du prestataire n'est pas déclaré » | `STRIPE_MODE` absente ou mal orthographiée. Elle vaut exactement `test` ou `live`. |
| « L'adresse publique du site n'est pas déclarée » | `NEXT_PUBLIC_SITE_URL` absente. |
| « Aucun tarif ne correspond à cette ligne » | Étape 8 incomplète pour cette offre ou ce rythme. |
| « Le montant enregistré chez le prestataire ne correspond plus à notre grille » | Un prix a changé d'un côté seulement. Créez le nouveau tarif chez Stripe, puis refaites l'étape 8. |
| « La TVA applicable à votre pays n'est pas encore reliée » | Étape 3 ou le second appel de l'étape 8 manquant. |
| « Votre régime de TVA n'est pas déterminé » | Client européen hors France sans numéro de TVA validé (voir étape 11.b). |
| Les webhooks sont rouges avec un code 401 | Le drapeau `--no-verify-jwt` manque au déploiement (étape 6.a). |
| Le client reçoit deux factures | Étape 7 non faite, ou non refaite en production. |
| Le montant prélevé vaut 79,90 € au lieu de 95,88 € | La TVA n'est pas reliée : étapes 3 et 8. |
