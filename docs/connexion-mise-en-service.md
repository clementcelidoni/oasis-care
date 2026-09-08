# Mettre la nouvelle connexion en service

Oasis Care a désormais des mots de passe. Ce document dit ce qu'il reste
à faire **de vos mains**, dans le tableau de bord Supabase, pour que le
parcours fonctionne pour de vrais clients. Rien ici n'est du code : ce
sont des réglages.

J'ai relu la configuration réelle du projet le **7 septembre 2026**
avant d'écrire ces lignes. Ce qui est marqué **✔ déjà fait** l'a été
vérifié, pas supposé. Ce qui est marqué **à faire** ne l'est pas encore.

**Comptez vingt minutes.**

---

> **⚠ UN SEUL RÉGLAGE DE CETTE PAGE PEUT ENFERMER TOUT LE PARC DEHORS :
> LA VÉRIFICATION ANTI-ROBOT (CAPTCHA), AU POINT 6. Il est GLOBAL — il
> n'existe pas de « vérification pour le web seulement » — et dès qu'il
> est activé, toute application qui n'envoie pas de jeton est refusée, y
> compris l'application iPhone déjà installée sur les téléphones.
> L'ordre est donc imposé : (a) créer le widget chez Cloudflare ;
> (b) poser la clé de site dans les trois applications, reconstruire et
> redéployer ; (c) poser la clé secrète chez Supabase, interrupteur
> éteint ; (d) publier la version iPhone sur TestFlight ET ATTENDRE
> QU'ELLE SOIT INSTALLÉE ; (e) seulement alors, activer le réglage.
> Inverser (d) et (e) enferme dehors tous les téléphones du parc, dans
> la seconde et sans message compréhensible. La marche à suivre
> complète — y compris comment éteindre en trente secondes — est dans
> [`docs/captcha-mise-en-service.md`](captcha-mise-en-service.md).**

---

## 1. Le plafond d'envoi — la seule étape qui peut fermer la porte à un client qui paie

**✔ Déjà fait.** Supabase expédie par Brevo (`smtp-relay.brevo.com`).

**Pourquoi c'est en tête de cette notice quand même.** Supabase possède
son propre petit serveur de courrier, activé par défaut. C'est un
dépannage de développement : il est bridé à **quelques messages par
heure**, tous clients confondus. Tant qu'on entrait par un lien magique
et qu'on était quatre, personne ne s'en apercevait. Avec un code exigé à
chaque première connexion et à chaque mot de passe oublié, ce plafond
devient une porte fermée : le cinquième client de la journée n'entre
pas, et **il ne reçoit aucun message qui le lui explique**. Il vous
appelle.

**Où vérifier que c'est toujours branché** : Supabase → votre projet →
**Authentication** → **Emails** → **SMTP Settings**. Le champ *Host*
doit dire `smtp-relay.brevo.com`. S'il est vide, ou si l'interrupteur
*Enable Custom SMTP* est éteint, vous êtes retombé sur le serveur
interne : c'est la première chose à rebrancher, avant toute autre.

### Le plafond qui reste, et qu'il faut regarder

Trois nombres valent **30** dans votre projet : le nombre de courriels
d'authentification, le nombre de codes émis, et le nombre de
vérifications de code. **Authentication → Rate Limits** affiche l'unité
que l'interface de programmation ne donne pas — vraisemblablement « par
heure ».

Si c'est bien 30 par heure : **c'est trop bas pour tout un parc**, et
c'est le même mur que celui que Brevo devait faire tomber. Trente
premières connexions dans l'heure, et le trente-et-unième client reste
dehors. Montez-les, en conscience : trop bas, un client légitime est
bloqué ; trop haut, un robot peut abuser (voir le point 6).

Il reste enfin une limite qui, elle, est saine et qu'il ne faut pas
toucher : **un seul courriel par minute et par adresse**. L'écran tient
son propre décompte d'une minute pour ne pas offrir un bouton qui
refuserait.

---

## 2. L'adresse qui envoie ces courriels

**✔ Déjà fait.** L'expéditeur est `connexion@oasisrarecare.com`, nom
d'affichage « Oasis Care ».

**Ce que ce changement NE FAIT PAS, et il faut le savoir.** Il ne change
**rien** à la délivrabilité. Les messageries jugent le **domaine**, la
signature **DKIM** et l'**adresse IP** d'envoi — jamais le mot devant
l'arobase. La réputation reste donc commune à tout le parc : si un
client se fait signaler comme indésirable, `connexion@` tombe avec
`bonjour@` et `notifications@`, puisque c'est le même domaine.

Isoler pour de bon le courrier d'accès demanderait un **sous-domaine**
(`connexion.oasisrarecare.com`), authentifié séparément chez Brevo, avec
ses propres enregistrements DKIM. C'est un chantier, pas une case.

**Pourquoi on le fait quand même, et le gain est réel** : on reconnaît
le message d'un coup d'œil dans une boîte encombrée, et un code de
sécurité ne se confond plus avec une lettre d'information. C'est aussi
ce qui permettra, le jour venu, de basculer vers un vrai sous-domaine
sans rien réécrire.

### La réponse — le seul point qui reste ouvert ici

Des gens **répondent** aux courriels de code. Supabase ne propose
**aucun champ « adresse de réponse »** dans ses réglages SMTP : je l'ai
vérifié, la clé n'existe pas. Une réponse partira donc vers
`connexion@oasisrarecare.com`, et si cette boîte n'est relevée par
personne, elle tombe dans le vide.

Le plus simple et le plus sûr : **faire suivre `connexion@` vers
`bonjour@`** chez votre hébergeur de courrier. Cinq minutes, et plus
personne ne parle à un mur.

*(Détail au passage : le gabarit d'invitation propose aujourd'hui
`support@oasisrarecare.com` comme contact. Si cette boîte n'existe pas,
remplacez-la par `bonjour@`.)*

---

## 3. Les gabarits de courriel — le piège exact dans lequel vous êtes tombé

**Le piège, en une phrase** : Supabase n'envoie pas le même message
selon la situation, alors que le logiciel, lui, fait exactement le même
geste. Une adresse **déjà connue** reçoit le gabarit *Magic Link*. Une
adresse **jamais vue** reçoit *Confirm signup*. Un mot de passe oublié
déclenche *Reset Password*. Trois messages différents, et il suffit
qu'un seul n'ait pas de code pour que la personne reste dehors sans rien
comprendre. C'est ce qui a laissé un compte bloqué quatre jours.

**✔ Déjà fait, et je l'ai vérifié un par un.** Les **six** gabarits
d'authentification sont personnalisés, en français, et **portent tous
`{{ .Token }}`** :

| Gabarit | Quand il part | Code présent |
|---|---|---|
| Confirm signup | une adresse jamais vue demande un code | ✔ |
| Magic Link | une adresse connue demande un code | ✔ |
| Reset Password | mot de passe oublié | ✔ |
| Invite user | vous invitez un collègue | ✔ |
| Change Email Address | pas encore utilisé | ✔ |
| Reauthentication | pas encore utilisé | ✔ |

Les textes de référence sont rangés dans `docs/courriels-supabase/` avec
leur mode d'emploi ; le tableau de bord est ce qui part vraiment, le
dossier est la mémoire. Les deux ne se synchronisent pas tout seuls.

*Un écart entre les deux, sans gravité : le mode d'emploi de ce dossier
recommande de faire figurer le code **dans l'objet** du message (« Votre
code de connexion : 12345678 »), ce qui permet de le lire dans la
notification du téléphone sans ouvrir le courriel. Les objets posés
aujourd'hui dans Supabase ne le font pas. À faire si vous voulez ce
confort ; ce n'est pas bloquant.*

### Deux choses que j'ai mesurées et qui méritent votre attention

**a) Il n'y a plus aucun lien dans ces courriels — seulement le code.**
C'est un choix cohérent (le code fonctionne depuis n'importe quel
appareil, le lien non), et il rend caduc tout un tas de réglages
d'adresses de retour. Mais sachez-le : personne ne pourra plus « se
connecter en un clic ». Si vous voulez le bouton en plus du code, il
faut rajouter `{{ .ConfirmationURL }}` aux gabarits — **jamais à la
place du code**, sinon Supabase cesse d'envoyer le code.

**b) Le bouton de l'invitation mène nulle part.** Le gabarit *Invite
user* pointe vers `{{ .SiteURL }}/login`, et votre *Site URL* vaut
aujourd'hui `com.oasisrarecare.app://` — l'adresse de l'application
iPhone, qu'aucun navigateur d'ordinateur ne sait ouvrir. Un collègue
invité cliquerait dans le vide.

**À faire** : Authentication → **URL Configuration** → mettez dans
*Site URL* l'adresse réelle d'Oasis Care Pro, et ajoutez cette même
adresse (plus celle du Control Center) dans *Redirect URLs*. Aujourd'hui
seuls `localhost` et l'application iPhone y figurent — le jour de la
mise en ligne, la connexion par Google et Apple en aura besoin.

**Et le test qu'il ne faut pas sauter** : essayez avec **une adresse
déjà en base** *et* **une adresse jamais vue**. Ce sont deux gabarits
différents. C'est la seule façon de s'apercevoir qu'on en a oublié un.

---

## 4. Les deux réglages du mot de passe

Authentication → **Sign In / Providers** → section **Password**.

**La longueur minimale : ✔ déjà à 12.** L'écran et le serveur disent
enfin la même chose. C'était important : la règle des douze caractères
n'était jusque-là qu'une politesse de l'écran, et un appel direct au
serveur passait à six.

**Les mots de passe éventés : ✘ toujours désactivé — c'est ce qu'il
reste à faire, et c'est le plus important de cette notice.**

Le réglage s'appelle **Leaked password protection** (ou *Prevent use of
leaked passwords*). Une case à cocher.

**Pourquoi c'est le seul contrôle qui protège vraiment.** Exiger une
majuscule, un chiffre et un symbole produit `Paysage1!` : neuf
caractères, devinable, recopié sur un carnet. Cette règle-là ne protège
personne. La liste des mots de passe éventés, elle, compare ce que la
personne choisit à des milliards de mots de passe **réellement volés
ailleurs**. Elle refuse `Paysage2024!` et accepte
`le figuier du fond a soif`. C'est la différence entre une règle qui
embête et une règle qui protège.

Le logiciel sait déjà traduire le refus qu'elle provoque : *« Ce mot de
passe figure dans des listes de mots de passe volés… »*. Rien à écrire,
juste à cocher.

**N'imposez aucune expiration** et **aucune exigence de caractères** :
faire changer un mot de passe tous les trois mois produit `Paysage1!`
puis `Paysage2!`. Les organismes qui recommandaient cette pratique l'ont
abandonnée.

---

## 5. Vos quatre comptes existants — rien à faire

Aucune intervention, aucune migration, aucun mot de passe à poser à la
main.

Les quatre comptes n'ont **aucun mot de passe utilisable** aujourd'hui
(trois portent bien une empreinte en base, mais c'est une empreinte
aléatoire posée par Supabase lui-même, dont personne ne connaît la
valeur). Au premier passage, chacun clique sur *« Pas encore de mot de
passe, ou vous l'avez oublié ? »*, reçoit son code, le saisit, choisit
son mot de passe, et c'est réglé. Le code confirme l'adresse au passage.

Deux précisions :

- Le compte entré **uniquement par Apple** (l'adresse en
  `privaterelay.appleid.com`) ne se verra **jamais** proposer de mot de
  passe, nulle part. C'est voulu : il entre par Apple, et c'est très
  bien ainsi.
- Votre propre compte est lié à **trois** façons d'entrer — e-mail,
  Apple et Google. Vous verrez donc l'écran de mot de passe, ce qui est
  correct, et vous pourrez continuer d'entrer par Apple ou Google comme
  avant. Les deux parcours coexistent sans se gêner.

**Une question que vous seul pouvez trancher** : deux de ces comptes ont
été modifiés à la main dans le tableau de bord le 7 septembre. **Y
avez-vous posé un mot de passe ?** Si oui, il fonctionne dès maintenant
avec le nouvel écran. Aucune requête ne peut lever ce doute — le journal
d'audit du projet est désactivé.

---

## 6. La vérification anti-robot — le seul réglage à ne surtout pas cocher tout de suite

**Le CAPTCHA — Authentication → Attack Protection. Désactivé
aujourd'hui, et il doit le rester jusqu'à la toute fin de la manœuvre
décrite plus bas.**

**CE RÉGLAGE EST GLOBAL.** Il n'existe pas de « vérification pour le web
seulement ». Dès qu'il est activé, **toute** application qui n'envoie
pas de jeton est refusée — dont l'application iPhone déjà installée sur
les téléphones de vos clients. Le cocher avant que la nouvelle version
iPhone ne soit **installée** enferme tout le parc dehors, dans la
seconde, sans message compréhensible et sans rien qu'un client puisse
faire de son côté.

Il règle deux choses qu'aucune ligne de code ne peut régler :

**a) On peut deviner qui est client en chronométrant.** Le serveur
d'authentification met deux fois plus de temps à refuser un mot de passe
sur une adresse qui existe que sur une adresse inconnue — mesuré, dix
essais chacune, sans le moindre chevauchement. Les messages affichés
sont pourtant rigoureusement identiques : c'est tout ce qu'un écran peut
tenir. Le reste se passe chez Supabase.

**b) Sur Oasis Care Pro, n'importe qui peut faire envoyer un courriel
Oasis Care à n'importe quelle adresse.** C'est la contrepartie assumée
du fait qu'inscription et connexion sont le même chemin : taper une
adresse inconnue crée le compte et envoie le code. Sans CAPTCHA, un
script peut en abuser — et comme le domaine d'envoi est partagé par tout
le parc, un lot d'adresses qui signalent ces messages comme indésirables
abîme la délivrabilité **de tous vos clients**. C'est exactement la
chose que l'abandon des liens magiques cherchait à protéger.

Le CAPTCHA rend ces deux abus coûteux. Le code des trois applications
est prêt : elles envoient déjà le jeton dès que la clé est posée, et
tant que ce réglage-ci reste éteint, cela ne change rigoureusement rien
pour personne.

### La marche à suivre, dans cet ordre et pas un autre

1. **Créer le widget** chez Cloudflare (`dash.cloudflare.com` →
   Turnstile → *Add widget*), en mode **Managed**, avec
   `oasisrarecare.com`, le domaine du Control Center et `localhost`
   dans la liste des domaines. Cloudflare rend deux clés.
2. **Poser la clé de SITE** — la publique — aux trois endroits :
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` chez l'hébergeur d'Oasis Care Pro,
   la même chez celui du Control Center, et `OASIS_TURNSTILE_SITE_KEY`
   dans `project.yml` pour l'iPhone. **Reconstruire et redéployer les
   deux sites** : ces variables sont figées à la compilation.
3. **Poser la clé SECRÈTE** ici même (Attack Protection → CAPTCHA →
   fournisseur **Turnstile**), enregistrer, **et laisser l'interrupteur
   éteint**. Cette clé ne passe ni par le dépôt, ni par une
   conversation : de vos mains, dans cet écran, et nulle part ailleurs.
4. **Publier la version iPhone** sur TestFlight, puis **attendre qu'elle
   soit réellement installée** sur les téléphones du parc. Une version
   publiée mais pas installée ne compte pas : c'est le téléphone qui
   appelle Supabase, pas l'App Store.
5. **Seulement alors, cocher l'interrupteur.**

**Et si ça se passe mal : revenez ici, décochez, enregistrez.** C'est
immédiat, il n'y a rien à redéployer, et tout le monde entre à nouveau à
la seconde suivante. Trente secondes, et c'est la seule manœuvre
d'urgence à connaître.

Le détail — ce qu'un client verra de plus à l'écran (idéalement rien),
les trois essais à faire juste après avoir allumé, et ce que la
vérification n'empêche pas — est dans
[`docs/captcha-mise-en-service.md`](captcha-mise-en-service.md).

---

## 7. Faut-il un nouveau build iPhone ?

**Oui.** L'écran de connexion de l'application a été réécrit : il
demande maintenant l'adresse et le mot de passe d'emblée, accepte un
code à huit chiffres, et fait choisir un mot de passe après le code.
Tant que le nouveau build n'est pas passé par TestFlight, le téléphone
garde l'ancien écran.

**Et ce build-là est aussi celui qui porte la vérification anti-robot.**
Avant de le publier, la clé de site doit être posée dans `project.yml`
(étape 2 du point 6). La chaîne de publication TestFlight refuse
désormais de construire tant qu'elle est vide : c'est volontaire, parce
qu'une version sans clé fonctionne parfaitement jusqu'à la seconde où
vous activez le réglage, et enferme alors le parc dehors.

Deux remarques à ce sujet :

- **Je n'ai pas pu compiler le code iPhone** : ce poste est sous
  Windows, il n'y a pas de Mac. Trois appels au kit Supabase pour Swift
  n'ont donc jamais été vus par un compilateur. Si l'un d'eux échoue au
  build, c'est un nom de méthode à ajuster, pas le parcours à refaire.
- Pour que le mot de passe créé sur le site soit **proposé
  automatiquement** sur le téléphone, l'application doit déclarer le
  domaine `oasisrarecare.com` (réglage *Associated Domains*, plus un
  fichier à poser sur le site). Sans cela, tout fonctionne, mais la
  personne devra retaper son mot de passe une fois sur le téléphone.

---

## Récapitulatif — ce qu'il reste vraiment à faire

| | |
|---|---|
| **Activer** *Leaked password protection* | Le seul contrôle qui protège vraiment |
| **Regarder** l'unité des trois limites à 30 | Sinon le 31ᵉ client de l'heure reste dehors |
| **Corriger** *Site URL* et *Redirect URLs* | Sinon le bouton d'invitation mène nulle part |
| **Faire suivre** `connexion@` vers `bonjour@` | Sinon les réponses tombent dans le vide |
| **Essayer** avec une adresse connue *et* une inconnue | Deux gabarits différents |

Et une **séquence** qui ne se découpe pas : les cinq étapes vont
ensemble, dans cet ordre, et la dernière est la seule qui puisse faire
du mal.

| | |
|---|---|
| 1. **Créer** le widget Turnstile chez Cloudflare | Mode *Managed*, tous les domaines |
| 2. **Poser** la clé de site dans les trois applications | Puis reconstruire et redéployer les deux sites |
| 3. **Poser** la clé secrète chez Supabase, **interrupteur éteint** | De vos mains, jamais par une conversation |
| 4. **Publier** le build iPhone **et attendre son installation** | L'ancien écran ne connaît ni les mots de passe ni la vérification |
| 5. **Activer** le CAPTCHA — et pas avant | Fait avant l'étape 4, il met tout le parc dehors |
