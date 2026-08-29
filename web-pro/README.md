# Oasis Care Pro — application web

ERP / CRM pour paysagistes et pépiniéristes (Phase 11). Application
Next.js 16 distincte de l'app iOS, qui lit **la même base Supabase** :
mêmes comptes, mêmes jardins, mêmes données.

## Démarrer

**Le plus simple :** double-cliquez sur `Lancer Oasis Care Pro.cmd`, à la
racine du projet. Il installe ce qu'il faut au premier lancement, puis
démarre le serveur.

En ligne de commande :

```bash
npm install --prefix web-pro
cp web-pro/.env.example web-pro/.env.local   # puis renseigner les valeurs
npm run dev --prefix web-pro
```

Le site est alors sur **http://localhost:3000**.

> Ce n'est **pas** un site en ligne : c'est un serveur de développement qui
> tourne sur votre machine. Il faut que la commande ci-dessus soit lancée,
> et la fenêtre laissée ouverte, pour que l'adresse réponde.

### ⚠️ Le port 3000 n'est pas négociable pour l'instant

La connexion passe par Supabase, qui n'accepte de rediriger que vers des
adresses explicitement autorisées. `http://localhost:3000/**` fait partie
de la liste ; un autre port **ne fonctionnera pas** et l'échec ressemble à
un bug de connexion sans message clair.

Si le port 3000 est déjà pris par un autre projet, arrêtez-le — ou
demandez l'ajout du nouveau port dans Supabase
(*Authentication → URL Configuration → Redirect URLs*).

## Connexion

Mêmes méthodes que l'app iPhone, et **le même compte** : Apple, Google,
ou lien magique par e-mail. Il n'y a pas de mot de passe — l'app iOS n'en
a jamais créé.

À la première connexion, si vous n'avez pas encore d'entreprise, l'app
propose d'en créer une (`/bienvenue`).

## Architecture

| | |
|---|---|
| `app/(app)/` | Écrans authentifiés, avec la sidebar |
| `app/login`, `app/auth/callback` | Connexion |
| `app/bienvenue` | Création de l'entreprise, au premier lancement |
| `lib/supabase/` | Clients Supabase (navigateur et serveur) |
| `lib/auth/` | Organisation, rôles, permissions |
| `lib/crm/` | Types et actions du CRM |
| `proxy.ts` | Rafraîchissement de session |

### Deux choses à savoir avant de coder ici

**`proxy.ts`, pas `middleware.ts`.** La convention `middleware` est
dépréciée depuis Next.js 16. Voir `AGENTS.md` : lire la doc locale dans
`node_modules/next/dist/docs/` avant d'écrire du code, cette version
diffère de ce que connaissent la plupart des exemples en ligne.

**Le proxy n'est pas la sécurité.** Il rafraîchit la session et renvoie
les visiteurs déconnectés, rien de plus — la documentation de Next
déconseille explicitement d'en faire la couche d'autorisation. Ce qui
protège réellement, c'est `getUser()` côté serveur et **RLS** en base.
De même, `lib/auth/permissions.ts` sert à afficher ou masquer ; la
vérification qui compte est `has_permission()` en PostgreSQL.

## Base de données

Migrations dans `../supabase/migrations/` :

- `0043` — organisations, membres, 14 rôles, permissions, invitations, audit
- `0044` — CRM : clients/prospects, contacts, sites, opportunités, activités

Tests d'isolation dans `../supabase/tests/`. Ils s'exécutent sous RLS
réelle et se terminent par un `ROLLBACK` : rien ne subsiste en base.

**Piège connu** : `gardens.id` n'a pas de valeur par défaut. Cette table
est alimentée par l'app iOS, qui génère ses propres UUID. Toute création
de jardin depuis le web doit donc fournir l'`id` elle-même.
