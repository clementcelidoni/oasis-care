# Les courriels que Supabase envoie

Ce dossier contient les six messages que Supabase expédie tout seul :
codes de connexion, invitations, mot de passe oublié. Ils sont écrits en
français et dessinés aux couleurs du produit.

**Ce ne sont pas des fichiers du logiciel.** Rien ne les lit au
démarrage. Ce sont des textes à recopier une fois dans le tableau de
bord Supabase. Ils sont rangés ici pour que vous les retrouviez, et pour
qu'on puisse les corriger sans fouiller dans une interface web.

---

## Où les coller

Supabase → votre projet → **Authentication** → **Emails**. Chaque gabarit
a son onglet. Pour chacun : ouvrez le fichier, sélectionnez tout
(`Ctrl+A`), copiez (`Ctrl+C`), collez dans le champ **Message body**, et
recopiez l'objet dans le champ **Subject**.

| Onglet Supabase | Fichier | Objet à recopier |
|---|---|---|
| Confirm signup | `01-inscription.html` | `Votre code Oasis Care : {{ .Token }}` |
| Magic Link | `02-connexion.html` | `Votre code de connexion : {{ .Token }}` |
| Reset Password | `03-mot-de-passe-oublie.html` | `Votre code pour changer de mot de passe : {{ .Token }}` |
| Invite user | `04-invitation.html` | `On vous invite sur Oasis Care` |
| Change Email Address | `05-changement-adresse.html` | `Confirmez votre nouvelle adresse : {{ .Token }}` |
| Reauthentication | `06-reauthentification.html` | `Votre code de confirmation : {{ .Token }}` |
| Password changed | `07-mot-de-passe-modifie.html` | `Le mot de passe de votre compte a été modifié` |
| Sign-in method linked | `08-nouvelle-methode-connexion.html` | `Une nouvelle façon de se connecter a été ajoutée` |

Le code dans l'objet, c'est volontaire : on le lit dans la notification
du téléphone sans ouvrir le message, et l'iPhone sait alors le proposer
tout seul au-dessus du clavier.

`Change Email` et `Reauthentication` ne servent pas encore. Collez-les
quand même : le jour où ils partiront, ils seront déjà en français.

**Les deux derniers ne sont pas du même genre.** Ce ne sont pas des
codes : ce sont des **alertes**. Elles partent toutes seules quand
quelque chose change sur un compte, elles ne demandent rien, et le jour
où quelqu'un prend le compte de l'un de vos clients, ce sont les seuls
messages qui l'en préviendront. Ils ne contiennent **aucune variable**,
délibérément : les courriels de notification de Supabase n'offrent pas
la même liste que ceux d'authentification, et un `{{ .Provider }}` non
reconnu s'afficherait tel quel — au milieu d'une alerte de sécurité,
c'est le message entier qui perd sa crédibilité.

---

## Trois règles à ne jamais enfreindre

**1. Tout gabarit doit contenir `{{ .Token }}`.** C'est ce qui déclenche
l'envoi d'un code. Sans lui, Supabase envoie un lien à la place — et on
retombe exactement sur le problème du départ : un lien qui ne fonctionne
pas quand on ouvre son courriel sur un autre appareil que celui qui l'a
demandé.

**2. Jamais `{{ .ConfirmationURL }}` tout seul.** C'est le gabarit qui
décide de ce que reçoit l'utilisateur : `{{ .Token }}` donne un code,
`{{ .ConfirmationURL }}` donne un lien. Ces six fichiers ne contiennent
volontairement **aucun lien de connexion**, sauf l'invitation — où le
destinataire ne connaît pas encore l'adresse du site et a donc besoin
d'un bouton pour arriver au bon endroit.

**3. Testez les deux cas avant d'y croire.** Une adresse **déjà connue**
et une adresse **jamais vue** ne reçoivent pas le même gabarit : la
première reçoit `Magic Link`, la seconde `Confirm signup`. C'est
précisément le piège dans lequel on est tombé : un gabarit corrigé,
l'autre oublié, et le problème qui semble résolu jusqu'au premier vrai
client.

---

## Trois réglages à changer pendant que vous y êtes

Tous dans **Authentication**, ce sont des cases à cocher, pas du code.

**Les mots de passe éventés — `Leaked password protection`.**
Aujourd'hui **désactivé**. Il compare le mot de passe choisi à la liste
publique des mots de passe déjà volés ailleurs. C'est le seul contrôle
qui protège vraiment : il refuse `Paysage2024!` et accepte
`le figuier du fond a soif`, ce qu'aucune règle de majuscules et de
chiffres ne sait faire. À activer.

**La longueur minimale — `Minimum password length`.**
Aujourd'hui **6**. C'est trop court : six caractères se cassent en
quelques minutes. Montez à **12**. Et n'activez aucune exigence de
caractères : imposer une majuscule, un chiffre et un symbole produit
`Paysage1!` — court, prévisible, et écrit sur un carnet. Une phrase
longue vaut mieux et se retient.

**L'alerte « mot de passe modifié ».**
Aujourd'hui **désactivée**. Dès qu'il y aura des mots de passe, c'est le
message qui prévient quelqu'un dont on prend le compte. Il ne coûte rien
et c'est la meilleure alarme gratuite du lot. À activer.

---

## Un seul bouton est cassé, et ce n'est pas grave aujourd'hui

Le bouton « Rejoindre Oasis Care » de `04-invitation.html` pointe vers
`{{ .SiteURL }}`, le réglage *Site URL* de Supabase. Il vaut aujourd'hui
`com.oasisrarecare.app://` — l'adresse interne de l'application iPhone.
Dans un courriel, ce bouton ne mène nulle part.

**Rien à faire pour l'instant :** l'application web n'a pas encore
d'adresse publique, et personne n'envoie d'invitation. Les cinq autres
gabarits ne contiennent aucun lien, donc aucun n'est concerné.

**Le jour de la mise en ligne**, il faudra poser l'adresse du site dans
`Authentication → URL Configuration → Site URL`, et le bouton se
réparera tout seul. Attention ce jour-là : ce même réglage sert aussi de
retour par défaut à l'application iPhone.

---

## Ce qu'il ne faut PAS changer

**La longueur du code : elle est à 8 chiffres, laissez-la.** Le Control
Center a un second facteur qui affiche, lui, un code à **6** chiffres.
Deux champs de six chiffres à quelques écrans d'écart, et plus personne
ne sait lequel est lequel. Huit contre six, la différence se voit.

**L'expéditeur `connexion@oasisrarecare.com`** et l'hôte
`smtp-relay.brevo.com` : c'est déjà en place et ça fonctionne.

---

## Une limite dont il faut se souvenir

Supabase n'envoie **qu'un seul courriel par minute et par adresse**. Si
quelqu'un clique deux fois sur « Renvoyer le code », le deuxième message
ne part pas — et l'erreur revient en anglais. Ce n'est pas une panne :
c'est une protection. Attendez une minute.

---

## Si vous voulez modifier un texte

Changez-le dans le fichier, puis recollez-le dans Supabase. Les deux ne
se synchronisent pas tout seuls : le fichier est la mémoire, le tableau
de bord est ce qui part vraiment.
