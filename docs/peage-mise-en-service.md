# Le péage : ce qui change, et ce que vous devez lancer

Jusqu'ici, un compte qui créait une entreprise avait tout le logiciel,
gratuitement, pour toujours. Ce n'était pas un réglage mal mis : la
barrière n'existait pas. Sur les 435 règles de sécurité de la base,
**aucune** ne savait ce qu'était un abonnement.

Ce document dit trois choses, dans cet ordre :

1. ce qu'un client neuf verra maintenant, écran par écran ;
2. ce qui se passe le jour où l'essai finit, et celui où un prélèvement
   échoue ;
3. **ce que vous devez lancer de vos mains**, dans l'ordre.

Le point 3 n'est pas facultatif. Tant qu'il n'est pas fait, le péage est
posé mais **il ne se ferme sur personne**.

---

## 1. Le parcours d'un client neuf, écran par écran

### Il crée son compte — `/login`

Rien ne change. Adresse e-mail, mot de passe, c'est tout. **On ne lui
demande pas un centime à ce stade** : créer un compte et souscrire sont
deux gestes distincts, et le second vient après.

### Il arrive dans le logiciel… et on l'envoie au contrat — `/inscription`

C'est **le changement principal**. Avant, un compte sans entreprise
partait sur l'installation du logiciel (le logo, les mentions légales,
l'équipe) et se retrouvait dans l'application sans que personne ne lui
ait jamais parlé d'argent. C'est exactement ce que vous aviez constaté :
« ça propose pas l'abonnement ».

Il passe maintenant par le tunnel, en trois temps :

- **Sa société.** Dénomination, forme juridique, SIRET, TVA, adresse.
  Les identifiants sont vérifiés pour de bon — clé du SIRET, clé de la
  TVA intracommunautaire — et le numéro de TVA part en validation.
- **Son offre.** La grille lue en base, mensuel ou annuel, les modules
  en option à leur prix réel. L'essai d'un mois est proposé, **carte
  obligatoire**, comme vous l'avez demandé. Enterprise n'affiche pas de
  bouton : c'est une demande de devis.
- **Le paiement**, chez Stripe.

### Il revient de chez Stripe — et l'écran lui parle enfin

Avant, on revenait sur une page qui **ignorait totalement** qu'un
paiement venait d'avoir lieu : on payait, et l'écran affichait
exactement ce qu'il affichait avant. Il y a désormais un écran de
confirmation qui dit ce qui a été souscrit, la date de fin d'essai, la
date de la première facture, et ce qui suit.

### Il installe son espace — `/bienvenue`

Logo, mentions légales, effectif, modules du menu, invitation de
l'équipe. **Rien n'y est obligatoire**, et il peut le faire plus tard :
un bandeau discret le lui rappelle tant qu'il ne l'a pas terminé ou
qu'il n'a pas dit ne pas en vouloir.

### Il travaille

Et maintenant, s'il ne paie plus, il ne peut plus créer.

---

## 2. Ce qui se passe quand l'argent n'arrive pas

### La règle, en une phrase

**On ne ferme que sur une facture qu'on a envoyée, dont la date
d'échéance est passée, et qui n'a pas été réglée.**

Pas sur une date de calendrier. C'est important, et voici pourquoi.

- **Si l'on fermait sur la date de fin de période**, le mauvais payeur
  serait resté ouvert pour toujours : la tâche de nuit repousse cette
  date d'un mois à chaque renouvellement, sans jamais regarder si
  l'argent est arrivé.
- **Et le bon payeur serait tombé le premier** : quand notre propre
  facturation est à l'arrêt, cette date se fige, et l'on aurait coupé un
  client parfaitement à jour pour une panne de notre côté.

### Trois états, et ce qu'ils ferment

| | Créer, modifier, envoyer un devis à un client | Faire entrer un collègue |
|---|---|---|
| **Tout va bien** | oui | oui |
| **Un règlement manque depuis moins de 30 jours** | **oui** | non |
| **Un règlement manque depuis plus de 30 jours** | non | non |
| **Aucun abonnement souscrit** | non | non |

**Lire, exporter, supprimer et payer ne se ferment JAMAIS**, dans aucun
de ces états. Un dirigeant suspendu voit toujours ses clients, ses
devis, ses factures ; il les exporte ; il corrige sa fiche société ; et
surtout il peut payer pour rouvrir. Un logiciel de gestion détient la
mémoire d'une entreprise — la prendre en otage pour trente-neuf euros
détruirait l'entreprise, pas l'abonnement.

Deux choses continuent pendant les trente jours de sursis, et c'est
délibéré :

- **Il envoie encore ses devis et ses factures à SES clients.** Un
  paysagiste dont la carte a été refusée a besoin d'être payé — et c'est
  avec cet argent-là qu'il nous paiera. Lui couper l'envoi serait lui
  retirer les moyens de nous régler.
- **Mais il n'ajoute plus de collaborateur.** Un siège de plus, c'est de
  l'argent dû de plus. On ne laisse pas commander davantage celui qui ne
  règle pas la note.

### Le jour où l'essai finit

La nuit qui suit, la machine émet la première facture et bascule
l'abonnement en « actif ». Stripe prélève. Si le prélèvement passe, le
client ne voit rien : c'est le fonctionnement normal.

### Le jour où un prélèvement échoue

1. **Rien ne se ferme tout de suite.** La facture a une échéance
   imprimée dessus, et on ne suspend personne avant cette date-là.
2. **À partir de l'échéance**, un bandeau apparaît dans le logiciel :
   « Un règlement nous manque », avec la date et le montant de la
   facture, et un bouton qui mène droit à l'écran d'abonnement. Le
   client continue de travailler.
3. **Trente jours plus tard**, la création s'arrête. Le bandeau devient
   « Votre abonnement est arrivé à échéance », et il dit — parce que
   c'est vrai — que les données sont intactes.
4. **Il paie, et tout rouvre**, y compris s'il avait résilié. Le
   réabonnement reprend le dossier existant au lieu de buter dessus, ce
   qui n'était pas possible avant.

> **Combien de temps ça fait, en tout.** Vos conditions de paiement sont
> à **30 jours**, et la facture les porte. Un prélèvement raté le 1er
> mars donne : facture émise le 1er mars, exigible le 31 mars, sursis
> jusqu'au 30 avril, création arrêtée le 1er mai. **Deux mois.**
>
> C'est volontaire : on ne suspend pas un client avant la date écrite
> sur la facture qu'on lui a envoyée. Pour resserrer, il y a un seul
> nombre à changer — les conditions de paiement de l'émetteur — et c'est
> une décision commerciale, pas un réglage technique.

### Ce qu'un client ne peut plus faire

**Refaire un mois d'essai en fondant une société de plus.** Rien ne
l'empêchait : le même dirigeant pouvait créer une deuxième entreprise et
repartir pour un mois gratuit avec la même carte, autant de fois qu'il
voulait. L'essai se compte désormais **par dirigeant**. Fonder une
seconde entreprise reste permis ; c'est le second mois gratuit qui ne
l'est plus — l'abonnement payant, lui, passe normalement.

---

## 3. Ce que vous devez lancer, dans l'ordre

### Le contrôle qui résume tous les autres

Dans l'éditeur SQL de Supabase, après avoir lancé la migration :

```sql
select * from public.peage_sante();
```

**Elle doit ne rien rendre.** Chaque ligne qu'elle rend est une chose
qui empêche le péage de fonctionner, écrite en français, avec le geste
qui la corrige. Le jour de la mise en service elle rendra les points 2
et 3 ci-dessous.

---

### Étape 1 — Lancer la migration

Le fichier est `supabase/migrations/0092_peage.sql`. **Je ne l'ai pas
lancée**, et c'est volontaire : c'est vous qui lancez les migrations. Elle
a été jouée sur la vraie base à l'intérieur d'une transaction annulée
aussitôt — rien n'y a été laissé, ce qui a été vérifié après coup : zéro
fonction, zéro politique, zéro compte d'essai.

Elle apporte **114 vérifications** dans `supabase/tests/peage.sql`, à
jouer juste après pour confirmer que tout est en place.

---

### Étape 2 — Remplir notre identité de facturation ⚠ **LE PLUS IMPORTANT**

**Tant que ce n'est pas fait, le péage ne se ferme sur personne.** Ce
n'est pas un détail de confort : c'est ce qui commande tout le reste.

Aujourd'hui, la table `saas_billing_issuer` est **entièrement vide**.
Résultat : la machine refuse d'émettre la moindre facture — « il manque
address_line1, city, iban, late_penalty_terms, legal_name, postal_code,
siret, vat_number ». Aucune facture ne part, donc rien n'est réclamé,
donc **rien ne se ferme jamais**. Le péage tournerait à vide, en
silence, et on le croirait en marche.

Il faut y mettre la dénomination sociale d'Oasis, sa forme juridique,
son SIRET, son numéro de TVA, son adresse complète, son IBAN et la
clause de pénalités de retard.

---

### Étape 3 — Armer les deux tâches de nuit

Elles ont été posées **désactivées** exprès, en attendant une relecture.
Tant qu'elles dorment, aucun essai ne se termine et aucune période ne se
renouvelle.

```sql
select cron.alter_job(161, active => true);   -- facturation, 3 h 15
select cron.alter_job(162, active => true);   -- relances, 6 h 30
```

> **Les armer ne mettra personne dehors par surprise.** C'est le
> changement de fond de ce chantier : le péage ne lit plus les dates de
> période, il lit les factures. Une nuit de rattrapage qui émettrait
> plusieurs périodes d'un coup n'expulse personne — elle envoie des
> factures, et le compte à rebours part de leur échéance à elles.

Le lendemain matin, relancez `select * from public.peage_sante();`.

---

### Étape 4 — Décider du sort des deux entreprises déjà en base

Il y en a **deux**, et **aucune n'a d'abonnement**. Le jour où la
migration passe, elles se retrouvent dans l'état « pas encore
souscrit » : elles gardent absolument tout — lecture, export,
suppression, correction de la fiche société — mais elles ne produisent
plus tant qu'il n'y a pas de contrat.

Deux façons de traiter chacune :

- **La faire passer par le tunnel**, comme un client neuf. C'est le
  parcours qu'on demande à tout le monde, et il marche.
- **Lui poser un contrat à la main**, si c'est un compte à vous ou un
  Enterprise négocié :

```sql
select public.admin_create_subscription(
  p_organization_id => '…'::uuid,
  p_plan            => 'business',
  p_billing_cycle   => 'monthly',
  p_reason          => 'Accès de courtoisie.',
  p_status          => 'active',
  p_trial_days      => null,
  p_negotiated_monthly_price_cents => 0,
  p_negotiated_yearly_price_cents  => 0);
```

> **⚠ Attention à une idée fausse.** L'accès de courtoisie posé par la
> migration 0042 **ne vous protège pas ici**. Il vit sur votre espace
> personnel iPhone, rattaché à aucune entreprise professionnelle. Sans
> le geste ci-dessus, votre propre compte Pro serait le premier que le
> péage fermerait.

---

### Étape 5 — Redéployer le webhook Stripe

`supabase/functions/stripe-webhook` a changé : il sait désormais
**reprendre** un abonnement fermé au lieu de conclure « cette entreprise
a déjà un abonnement, rien à faire » et de laisser le client dehors
après qu'il a payé. Sans ce redéploiement, la porte de sortie n'existe
pas.

---

## En résumé

| | |
|---|---|
| **1.** | Lancer `0092_peage.sql`, puis `supabase/tests/peage.sql` (114 vérifications) |
| **2.** | Remplir `saas_billing_issuer` — **sans quoi rien ne se ferme** |
| **3.** | Armer les tâches 161 et 162 |
| **4.** | Donner un contrat aux deux entreprises existantes |
| **5.** | Redéployer le webhook Stripe |
| **6.** | `select * from public.peage_sante();` doit ne rien rendre |
