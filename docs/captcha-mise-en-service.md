# Mettre la vérification anti-robot en service

**L'ORDRE DES OPÉRATIONS N'EST PAS NÉGOCIABLE, ET C'EST TOUT L'ENJEU DE
CETTE PAGE. (a) Créer le compte Cloudflare et le widget Turnstile.
(b) Poser la clé de SITE dans les trois applications — Oasis Care Pro,
le Control Center, l'iPhone — puis reconstruire et redéployer les deux
sites. (c) Poser la clé SECRÈTE chez Supabase, de vos mains, jamais par
une conversation ni par un fichier du dépôt. (d) Envoyer la nouvelle
version iPhone sur TestFlight et ATTENDRE QU'ELLE SOIT INSTALLÉE sur les
téléphones. (e) SEULEMENT ALORS, activer le réglage chez Supabase.**

**Si vous inversez (d) et (e), tous les téléphones du parc sont enfermés
dehors dans la seconde : le réglage de Supabase est GLOBAL — il n'existe
pas de « vérification pour le web seulement » — et une application qui
n'envoie pas de jeton est refusée, sans message d'erreur compréhensible
et sans rien que son propriétaire puisse faire depuis son téléphone.**

**Une version publiée sur TestFlight mais pas installée ne compte pas :
c'est le téléphone qui appelle Supabase, pas l'App Store.**

---

## En deux phrases : à quoi ça sert

Deux choses qu'aucune ligne de code ne peut réparer. **On peut deviner
qui est client en chronométrant** : le serveur met deux fois plus de
temps à refuser un mot de passe sur une adresse qui existe (mesuré, sans
le moindre chevauchement). Et **n'importe qui peut faire expédier un
courriel Oasis Care à n'importe quelle adresse**, puisque le formulaire
d'entrée est public — un robot peut donc se servir de notre domaine pour
arroser des inconnus, et c'est la réputation d'envoi de tout le parc qui
tombe, y compris les codes de connexion de vos clients qui paient.

La vérification anti-robot ne supprime ni l'un ni l'autre. Elle coupe le
**volume**, et sans volume les deux abus ne valent plus la peine.

---

## (a) Créer le widget — dix minutes

1. `dash.cloudflare.com` → créer un compte si vous n'en avez pas. La
   vérification anti-robot (**Turnstile**) est **gratuite et sans
   plafond** ; aucune carte bancaire n'est demandée pour elle.
2. Menu de gauche → **Turnstile** → **Add widget**.
3. **Nom** : `Oasis Care — connexion`.
4. **Hostnames** — ajoutez-les **tous**, un domaine oublié ferme la
   porte correspondante sans prévenir :
   - `oasisrarecare.com` (le site public **et** l'origine annoncée par
     l'application iPhone) ;
   - le domaine du **Control Center**, s'il en a un différent ;
   - `localhost`, pour le développement.
5. **Widget Mode** : **Managed** (« géré »). C'est le mode où l'immense
   majorité des visiteurs ne voit **rien du tout**. Ne choisissez pas
   *Invisible* : un visiteur jugé suspect y serait refusé **sans
   recours**, et il vous appellerait.
6. Cloudflare affiche alors **deux clés**, et elles n'ont pas le même
   statut :
   - la **clé de site** (`Site Key`) est **publique**. Elle part dans le
     navigateur de chaque visiteur, c'est son métier.
   - la **clé secrète** (`Secret Key`) ne doit **jamais** entrer dans le
     dépôt, ni dans un fichier, ni dans une conversation. Elle va
     directement chez Supabase à l'étape (c).

---

## (b) Poser la clé de SITE dans les trois applications

Toujours la **clé de site**, jamais la secrète. La même valeur partout.

| Où | Quoi |
|---|---|
| **Oasis Care Pro** | variable `NEXT_PUBLIC_TURNSTILE_SITE_KEY` chez l'hébergeur |
| **Control Center** | la même variable, même valeur |
| **iPhone** | ligne `OASIS_TURNSTILE_SITE_KEY: ""` dans `project.yml` |

**Ces variables sont figées à la compilation.** En changer la valeur ne
demande pas un redémarrage : il faut **reconstruire et redéployer** les
deux sites. Prévoyez-le, sinon vous croirez la clé posée alors que le
site en ligne tourne encore sans elle.

**Poser la clé ne ferme aucune porte.** Tant que l'étape (e) n'est pas
faite, le jeton part et Supabase l'ignore : les trois applications se
comportent exactement comme aujourd'hui. Vous pouvez donc faire (b) et
(c) tranquillement, et prendre le temps de (d).

*Note pour la personne qui publie l'iPhone : la chaîne de publication
TestFlight refuse désormais de construire si cette ligne est restée
vide. C'est volontaire — une version sans clé fonctionne parfaitement
jusqu'à la seconde où vous faites (e), et enferme alors le parc dehors.*

---

## (c) Poser la clé SECRÈTE chez Supabase

Supabase → votre projet → **Authentication** → **Attack Protection** →
section **CAPTCHA**. Choisissez le fournisseur **Turnstile** (et non
hCaptcha), collez la **clé secrète**, enregistrez — **mais laissez
l'interrupteur ÉTEINT**. Vous n'allumez qu'à l'étape (e).

---

## (d) La version iPhone, et l'attente qui compte

Publiez la nouvelle version sur TestFlight, puis **attendez qu'elle soit
réellement installée** sur tous les téléphones concernés. Demandez-le
nommément aux personnes du parc plutôt que de le supposer : c'est la
seule étape de cette page qui ne se vérifie pas depuis un écran.

---

## (e) Allumer — et comment éteindre en trente secondes

Même écran qu'en (c) : **Authentication → Attack Protection → CAPTCHA →
Enable**. Enregistrez.

**LE RETOUR EN ARRIÈRE, SI QUELQUE CHOSE SE PASSE MAL.** Retournez à
`Authentication → Attack Protection`, **décochez l'interrupteur CAPTCHA**,
enregistrez. C'est immédiat, il n'y a **rien à redéployer**, ni côté web
ni côté téléphone, et tout le monde entre à nouveau à la seconde
suivante. Gardez cet écran ouvert dans un onglet le jour où vous
allumez : c'est la seule manœuvre d'urgence dont vous ayez besoin.

---

## Ce que vous devez essayer juste après avoir allumé

Dans cet ordre, et sans sauter le troisième :

1. **Le site**, avec une adresse **déjà connue** : entrez normalement.
2. **Le site**, avec une adresse **jamais vue** : le code doit arriver.
3. **Un iPhone du parc**, mise à jour faite : connexion, puis
   « Renvoyer le code ». C'est l'enchaînement le plus fragile, parce
   qu'il demande deux vérifications de suite.

Si l'un des trois refuse avec une phrase parlant de vérification
anti-robot, **éteignez** (trente secondes, ci-dessus) et regardez
d'abord la **liste des domaines** du widget chez Cloudflare : c'est la
cause la plus fréquente, et de loin.

---

## Ce qu'un client verra de plus, à l'écran

**Rien, dans l'immense majorité des cas.** Aucune case à cocher, aucune
image à désigner, aucun espace vide réservé : le widget est réglé pour
n'occuper aucune place tant qu'il n'a rien à montrer.

Deux exceptions, rares et prévues :

- **Une énigme s'affiche** quand Cloudflare doute. Une ligne l'annonce
  au-dessus, en français, et la page se déplace pour l'amener sous les
  yeux.
- **La vérification ne se charge pas** — réseau coupé, bloqueur de
  publicités, réseau d'entreprise qui filtre Cloudflare. Une phrase
  l'explique et propose de réessayer, **et le bouton d'entrée reste
  actif** : on tente quand même. C'est délibéré — refuser d'agir
  enfermerait dehors quelqu'un que le serveur, lui, laisserait entrer.
