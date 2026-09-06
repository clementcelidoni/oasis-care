# Mettre le courrier en service

Ce document s'adresse à vous, pas à un développeur. Il décrit, dans
l'ordre, ce qu'il faut faire de vos mains pour qu'Oasis Care commence à
envoyer les devis, les factures et les annonces. Chaque étape dit
pourquoi elle existe et ce qui se passe si on la saute.

Vous travaillez sous Windows. Toutes les commandes se tapent dans
**PowerShell**, ouvert dans le dossier du projet
(`C:\Users\veill\Documents\OASIS CARE`).

**Comptez une heure**, dont la moitié à attendre des vérifications.

---

## Avant tout : la règle sur les clés

Une clé d'API est un mot de passe. Elle ne se colle **jamais** dans une
conversation, ni dans un message, ni dans un fichier du projet. Elle se
pose une seule fois, à l'endroit indiqué ci-dessous, et personne d'autre
que vous ne la voit.

Si une clé a été affichée quelque part par accident : allez la
**révoquer** chez Brevo et créez-en une neuve. Une clé qui a été vue est
une clé perdue, même si vous êtes seul à l'avoir vue.

---

## Étape 1 — Créer la clé chez Brevo

1. Connectez-vous à <https://app.brevo.com>.
2. En haut à droite, cliquez sur le nom de votre compte, puis **SMTP et
   API**.
3. Onglet **Clés d'API** → **Générer une nouvelle clé d'API**.
4. Nommez-la de façon à savoir plus tard d'où elle vient :
   `oasis-care-production`.
5. Brevo affiche la clé **une seule fois**. Copiez-la dans le
   presse-papiers et gardez la fenêtre ouverte jusqu'à l'étape 3.

**Cette clé est SECRÈTE.** Elle permet d'envoyer du courrier au nom de
votre domaine. Traitez-la comme le code de votre carte bancaire.

Sur la même page, notez aussi :

- **Le secret du webhook.** Il n'existe pas encore : vous allez
  l'inventer à l'étape 3. Ce n'est pas une clé de Brevo, c'est un mot de
  passe que vous choisissez et que vous donnerez à Brevo pour qu'il
  prouve que c'est bien lui qui nous parle.

---

## Étape 2 — Confirmer que le domaine est bien authentifié

Le domaine `oasisrarecare.com` **est déjà authentifié**. Vous n'avez
rien à refaire. Ce qu'il faut, c'est le **confirmer** avant le premier
envoi de masse — parce qu'un enregistrement DNS peut avoir été modifié
sans que personne s'en aperçoive, et c'est exactement ce qui est déjà
arrivé une fois sur ce domaine (un `-all` avait bloqué silencieusement
tout le courrier pendant des mois).

### Ce qu'il faut voir chez Brevo

1. Dans Brevo : **Expéditeurs, domaines et IP dédiées** → onglet
   **Domaines**.
2. Trouvez `oasisrarecare.com`.
3. Vous devez voir **trois pastilles vertes** :
   - **SPF** — dit quels serveurs ont le droit d'expédier pour vous ;
   - **DKIM** — signe chaque message ; c'est la signature que les
     messageries vérifient ;
   - **DMARC** — dit aux messageries quoi faire si les deux premiers
     échouent.

Si l'une des trois n'est pas verte, **n'envoyez rien** et faites
corriger l'enregistrement DNS avant d'aller plus loin. Un envoi de masse
sur un domaine mal authentifié abîme la réputation de ce domaine pour
des semaines — et ce domaine porte aussi vos messages de connexion et
vos factures d'abonnement.

### La vérification indépendante, qui vaut mieux que la pastille

La pastille de Brevo dit ce que Brevo croit. Vérifiez vous-même, depuis
PowerShell :

```powershell
Resolve-DnsName -Type TXT oasisrarecare.com | Select-Object -ExpandProperty Strings
Resolve-DnsName -Type TXT _dmarc.oasisrarecare.com | Select-Object -ExpandProperty Strings
```

Ce que vous devez lire :

- une ligne qui commence par `v=spf1` et qui **se termine par `~all`**
  (tilde) et **non par `-all`** (tiret). Le tiret veut dire « rejette
  tout ce qui n'est pas dans cette liste » ; c'est lui qui avait bloqué
  le courrier ;
- une ligne qui commence par `v=DMARC1`.

Si vous lisez `-all`, arrêtez-vous là et faites remplacer le tiret par
un tilde chez votre hébergeur DNS.

### Ce qu'il faut créer, une fois

Il faut une **adresse d'expédition** sur ce domaine. Par exemple
`notifications@oasisrarecare.com`. Elle doit exister réellement — pas
seulement dans un réglage — parce que les gens répondront dessus par
réflexe.

Et il faut une **boîte de retour**, celle qui recevra les avis
d'échec — les adresses de clients qui n'existent pas. Ce peut être la
même. **Quelqu'un doit la lire**, au moins une fois par semaine : les
rebonds reviennent chez Oasis Care, pas chez le paysagiste, parce que
c'est votre domaine qui expédie. Une boîte « ne-pas-repondre » que
personne n'ouvre transforme chaque erreur d'adresse en silence.

---

## Étape 3 — Poser les cinq réglages sur le serveur d'envoi

Ces cinq valeurs vivent dans les **secrets de fonction Supabase**, pas
dans un fichier du projet. C'est le seul endroit où la clé du
transporteur est lue.

Dans PowerShell, dans le dossier du projet, tapez les cinq lignes
suivantes **en remplaçant ce qui est entre chevrons** (et en retirant
les chevrons) :

```powershell
npx supabase secrets set BREVO_API_KEY=<collez ici la clé de l'étape 1>
npx supabase secrets set BREVO_WEBHOOK_SECRET=<inventez un mot de passe long>
npx supabase secrets set OASIS_EMAIL_EXPEDITEUR=<l'adresse d'expédition>
npx supabase secrets set OASIS_EMAIL_RETOUR=<la boîte qui reçoit les échecs>
npx supabase secrets set OASIS_EMAIL_BASE_URL=<l'adresse https du site Pro>
```

Quelques précisions :

- **`BREVO_WEBHOOK_SECRET`** : inventez-le. Trente caractères au hasard,
  lettres et chiffres. Il ne sert qu'à ce que Brevo prouve son identité
  quand il nous annonce un rebond. Gardez-le, vous en aurez besoin à
  l'étape 5.
- **`OASIS_EMAIL_BASE_URL`** doit commencer par `https://` et être
  l'adresse **du site Oasis Care Pro** — celle où vos clients se
  connectent. C'est à partir d'elle qu'est fabriqué le lien de
  désabonnement de chaque annonce. Si elle est fausse, le lien tombe
  dans le vide, et un lien de désabonnement mort finit en plainte pour
  courrier indésirable.

Vérifiez que les cinq sont bien posées :

```powershell
npx supabase secrets list
```

Vous devez voir les cinq noms. Les valeurs, elles, ne s'affichent pas :
c'est normal et c'est voulu.

---

## Étape 4 — Poser l'adresse d'expédition sur la base

**Cette étape est facile à oublier, et sans elle les annonces
commerciales ne partiront pas.**

La base de données a besoin de connaître l'adresse d'expédition, de son
côté. Ce n'est pas un doublon : l'écran d'administration parle à la base
sans passer par le serveur d'envoi, et il doit pouvoir vérifier que tout
est prêt avant de laisser cliquer.

1. Ouvrez <https://supabase.com/dashboard>, choisissez le projet
   Oasis Care.
2. Menu de gauche → **SQL Editor** → **New query**.
3. Collez la ligne suivante en remplaçant l'adresse par la vôtre :

```sql
alter role authenticator set oasis.email_expediteur = 'notifications@oasisrarecare.com';
```

4. Cliquez sur **Run**.

Puis vérifiez, dans une nouvelle requête :

```sql
select current_setting('oasis.email_expediteur', true);
```

Vous devez lire votre adresse. Si vous lisez une case vide, la première
commande n'a pas pris : recommencez en vérifiant les guillemets simples.

**Ce qui se passe si vous sautez cette étape** : au moment d'envoyer une
annonce, l'écran refuse et l'annonce **reste un brouillon**. Rien n'est
perdu, rien ne part, et l'écran vous renvoie ici. C'est volontaire :
dans une version antérieure, l'annonce se marquait « envoyée » sans
partir à personne, et une annonce envoyée ne se rejoue pas.

---

## Étape 5 — Déployer le serveur d'envoi et brancher le retour

### Déployer

```powershell
npx supabase functions deploy envoi-email --no-verify-jwt
```

**`--no-verify-jwt` n'est pas facultatif.** Brevo nous appelle depuis
ses propres serveurs pour annoncer les rebonds, et il ne porte aucun
identifiant Supabase. Sans ce drapeau, chaque avis de rebond recevrait
un refus, Brevo finirait par désactiver le lien, et on perdrait tous les
avis d'échec sans s'en apercevoir. Chaque chemin de la fonction porte sa
propre protection ; ce drapeau ne les enlève pas.

### Brancher le retour d'information

1. Dans Brevo : **Transactionnel** → **Paramètres** → **Webhook**.
2. **Ajouter un nouveau webhook**.
3. URL à saisir — remplacez `<projet>` par l'identifiant de votre projet
   Supabase (celui qui apparaît dans l'adresse du tableau de bord) :

   ```
   https://<projet>.supabase.co/functions/v1/envoi-email/evenements
   ```

4. Cochez les événements : **délivré**, **rebond dur**, **rebond
   souple**, **plainte / marqué comme indésirable**, **bloqué**,
   **désabonné**, **erreur**.
5. Dans la section des **en-têtes personnalisés**, ajoutez :
   - nom : `x-oasis-webhook`
   - valeur : le `BREVO_WEBHOOK_SECRET` que vous avez inventé à
     l'étape 3.

**Le secret doit être dans l'en-tête, pas dans l'adresse.** Une adresse
complète se retrouve dans les journaux de plusieurs machines ; un secret
qui traîne dans un journal n'est plus un secret.

Si le webhook n'est pas branché, tout part quand même — mais personne ne
saura jamais qu'une adresse de client est fausse, et l'écran « Courrier »
de chaque paysagiste restera vide alors qu'il y aurait des choses à
dire.

---

## Étape 6 — Vérifier le réglage de Brevo qui peut couper vos factures

Il y a un piège propre à Brevo, et il faut le désarmer une fois.

Brevo tient **deux** listes de blocage :

- la liste **marketing**, alimentée par les désabonnements ;
- la liste **transactionnelle**, alimentée par les rebonds durs et les
  plaintes — et **celle-là bloque aussi les factures**.

Le danger : si un désabonnement de vos annonces venait alimenter la
liste transactionnelle, un client qui refuse vos nouveautés cesserait
de recevoir ses factures. C'est exactement le défaut que tout ce
chantier existe pour empêcher.

Dans Brevo, **Transactionnel** → **Paramètres**, vérifiez qu'aucune
option du type « ajouter automatiquement les désabonnés à la liste de
blocage transactionnelle » n'est activée. Oasis Care, de son côté,
n'ajoute jamais personne à cette liste : c'est écrit dans le code et
vérifié par un test. Mais ce réglage-là appartient à Brevo, et il n'y a
que vous pour le voir.

---

## Étape 7 — Faire un essai avant la première annonce

### L'essai qui compte le plus : un vrai devis à vous-même

C'est le seul essai qui traverse toute la chaîne.

1. Dans Oasis Care Pro, créez un client dont l'adresse e-mail est
   **la vôtre**.
2. Créez-lui un devis, même vide.
3. Cliquez sur **Marquer comme envoyé**.
4. Regardez votre boîte. Le message doit arriver en moins d'une minute.

Vérifiez, dans le message reçu :

- **le nom affiché** est celui de votre entreprise, pas « Oasis Care » ;
- **le bouton « Répondre »** de votre logiciel de messagerie propose
  bien l'adresse de votre entreprise, et non celle d'Oasis ;
- le pied du message porte vos mentions légales ;
- il n'y a **aucun lien de désabonnement** — un devis n'en a pas, et
  n'en aura jamais.

Puis, dans Oasis Care Pro, allez dans **Ma société → Courrier**. Le
message doit y figurer, avec son état.

### L'essai d'une annonce commerciale

Une annonce ne peut pas être envoyée « pour voir » : elle part à tout le
parc, et elle ne se rejoue pas. Ce qui la remplace :

1. Dans Oasis Admin, **Courrier → Annonces commerciales**, composez
   l'annonce. Rien ne part à cette étape.
2. Ouvrez-la. L'écran vous montre **exactement** qui recevra le message,
   qui est écarté et pourquoi, et **le message rendu sur un vrai
   destinataire**.
3. Lisez le rendu. C'est là qu'on voit un `{{prenom}}` oublié.
4. Le bouton d'envoi vous demande de **retaper le nombre de
   destinataires** et un motif. Ce n'est pas une formalité : le nombre
   est recomparé à l'audience recalculée au moment du clic.

**Avant votre première annonce, il faudra du consentement.** Voir plus
bas, « Ce qui n'est pas automatique ».

---

## Quel palier Brevo prendre

Le calcul, à partir de l'usage réel d'un paysagiste :

| Par entreprise et par mois | Nombre |
|---|---|
| Devis envoyés | ~20 |
| Relances de devis | ~18 |
| Factures émises | ~12 |
| Relances de facture | ~6 |
| Invitations, bienvenue | ~5 |
| Messages d'Oasis vers l'entreprise | ~5 |
| **Total** | **~66, comptons 70** |

Donc :

| Entreprises | Par mois | Par jour en moyenne |
|---|---|---|
| 10 | 700 | ~23 |
| 25 | 1 750 | ~58 |
| 50 | 3 500 | ~117 |
| 100 | 7 000 | ~233 |

**Le chiffre qui décide n'est pas le mensuel, c'est le quotidien.**
L'offre gratuite de Brevo plafonne à **300 messages par jour**. Et les
relances se groupent : le lundi matin fait trois à cinq fois la moyenne.
Le plafond mord donc **vers 20 à 30 entreprises**, bien avant que le
total mensuel n'inquiète.

**Recommandation :**

- **moins de 10 entreprises** : restez sur l'offre gratuite ;
- **dès les premiers clients facturés** : prenez le premier palier
  payant. Le coût est sans commune mesure avec un vendredi où les devis
  ne partent plus ;
- **surveillez la pointe quotidienne**, pas le cumul. Brevo affiche le
  compteur du jour sur son tableau de bord.

Les prix exacts changent : relevez-les sur la grille du jour plutôt que
de vous fier à un chiffre écrit ici il y a six mois.

---

## Ce qui n'est PAS automatique

Il faut le lire en entier. Ce sont les endroits où le produit ne fait
pas ce qu'on pourrait croire.

### 1. Les relances n'ont pas de planificateur

**C'est le manque le plus important de ce jalon, et il est entier.**

Le calcul des relances fonctionne : le produit sait dire quels devis et
quelles factures méritent une relance, à quel rang, et il sait les
envoyer. **Mais rien ne l'appelle tout seul.** Il n'existe aucun
planificateur dans ce projet — ni du côté de la base, ni du côté de
l'hébergeur du site.

Concrètement :

- l'envoi d'un devis marche : il part quand vous cliquez ;
- l'envoi d'une facture marche : il part quand vous l'émettez ;
- **les relances ne partent pas toutes seules.** Même activées pour une
  entreprise, elles attendent qu'on les déclenche.

Ce n'est pas un réglage à trouver : c'est une décision d'infrastructure
à prendre, et trois chemins sont possibles (activer deux extensions sur
la base, planifier la fonction d'envoi, ou un planificateur chez
l'hébergeur du site). Tant que ce n'est pas tranché, **la moitié de ce
que vous avez demandé n'est pas livrée**, et il vaut mieux le savoir que
de le découvrir en constatant qu'aucun client n'a été relancé.

### 2. Le consentement commercial doit être recueilli

Une annonce commerciale exige un consentement **préalable**. Il ne se
présume pas : les entreprises déjà inscrites n'ont jamais rien accepté,
et la base refusera de leur écrire tant que la case n'est pas cochée.

La case existe maintenant : dans Oasis Care Pro, **Ma société →
Courrier**, en bas. Chaque entreprise doit la cocher elle-même.

Tant que personne ne l'a cochée, une annonce partira à **zéro
destinataire** et l'écran vous dira pourquoi, entreprise par entreprise.
Ce n'est pas une panne.

### 3. Trois messages n'ont pas encore de chemin

Le message de **bienvenue**, le message de **changement de paramètre
important** et l'**invitation au portail client** sont écrits, prêts, et
personne ne les déclenche. L'onglet **Courrier → Messages de service**
d'Oasis Admin l'explique plutôt que de vous proposer un bouton mort.

### 4. Aucun document n'est joint

Les messages portent le numéro, le montant et l'échéance dans leur
corps, mais **pas le PDF**. Le produit ne sait pas encore fabriquer un
PDF côté serveur, et il n'y a pas non plus de lien « voir mon devis » :
le portail client exige une connexion, et un lien qui tombe sur un écran
de connexion fait plus de mal que pas de lien du tout.

### 5. L'identité d'Oasis Care doit être renseignée avant la première annonce

Une annonce commerciale doit dire pour le compte de qui elle est émise,
et permettre d'y répondre. Tant que l'adresse de réponse d'Oasis Care
n'est pas enregistrée en base, **aucune annonce ne partira** — et
l'écran vous le dira avant que vous n'écriviez, pas après.

Dans le **SQL Editor** de Supabase :

```sql
update public.email_platform_identity
   set reply_to_email = 'bonjour@oasisrarecare.com',
       legal_name     = 'Oasis Care',
       legal_form     = '<votre forme juridique>',
       siret          = '<votre SIRET>',
       vat_number     = '<votre numéro de TVA, ou laissez NULL>',
       address_line1  = '<votre adresse>',
       postal_code    = '<votre code postal>',
       city           = '<votre ville>',
       phone          = '<votre téléphone>',
       website        = 'https://oasisrarecare.com'
 where id;
```

Ces mentions apparaissent en pied de chaque annonce. Ce sont **les
vôtres**, pas celles du paysagiste qui la reçoit.

### 6. Le contrat de sous-traitance reste à signer

En expédiant les messages d'un paysagiste vers **ses** clients,
Oasis Care traite des données personnelles dont le paysagiste est
responsable. Cela demande un contrat de sous-traitance (article 28 du
RGPD) entre Oasis Care et chaque entreprise cliente, mentionnant Brevo
comme sous-traitant ultérieur. C'est un document juridique, pas du code,
et il conditionne la mise en service.

---

## Si quelque chose ne part pas

Dans l'ordre, du plus fréquent au plus rare.

**« Renseignez l'adresse e-mail de votre entreprise »** — la fiche de
l'entreprise n'a pas d'adresse. Sans elle, les réponses des clients
tomberaient dans une boîte d'Oasis que personne ne lit, donc rien ne
part. Ma société → onglet Société.

**« Renseignez le SIRET de votre entreprise »** — une facture sans SIRET
n'est pas conforme. Ce verrou ne s'applique **qu'aux factures** ; les
devis partent sans.

**« Aucune adresse e-mail pour ce client »** — la fiche client et son
contact principal n'ont ni l'un ni l'autre d'adresse.

**« Le transporteur a atteint son plafond d'envois pour aujourd'hui »** —
vous avez touché le plafond quotidien. Le message **repartira tout
seul** : il est remis en file avec un délai. C'est le moment de regarder
le palier.

**« Sort inconnu — à vérifier »** — la connexion avec Brevo a cassé
pendant l'envoi. Le message est **peut-être** parti. Vérifiez auprès du
client avant de renvoyer : c'est le seul cas où le produit refuse de
choisir entre « parti » et « pas parti », parce qu'il ne sait pas.

**« Votre courrier est suspendu »** — un administrateur d'Oasis a coupé
l'expédition de cette entreprise, avec un motif que l'entreprise lit
elle-même. C'est le frein d'urgence qui protège la réputation du domaine
partagé, et il coupe tout, factures comprises.

**Rien du tout, aucun message** — vérifiez d'abord l'étape 3
(`npx supabase secrets list`), puis l'étape 5 (la fonction est-elle
déployée ?).
