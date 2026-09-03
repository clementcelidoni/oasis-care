# Oasis Care — Control Center

L'application interne de l'équipe qui **exploite** Oasis Care.

Elle n'est ni Oasis Care Mobile (iPhone, particuliers), ni Oasis Care Pro
(web, entreprises), ni le portail client d'une entreprise Pro. Elle
administre la plateforme SaaS entière : combien de gens l'utilisent,
combien paient, ce que coûte l'IA, si la plateforme tient debout.

## Démarrer

```bash
npm install --prefix web-admin
cp web-admin/.env.example web-admin/.env.local   # puis renseigner
npm run dev --prefix web-admin
```

Le site répond sur **http://localhost:3100**.

### ⚠️ Le port 3100 doit être déclaré dans Supabase

La connexion passe par Supabase, qui n'accepte de rediriger que vers des
adresses explicitement autorisées. Aujourd'hui la liste contient
`http://localhost:3000/**` — le port d'Oasis Care Pro. **Tant que
`http://localhost:3100/**` n'y est pas ajouté, la connexion échouera**,
et l'échec ressemble à un bug sans message clair.

*Supabase → Authentication → URL Configuration → Redirect URLs.*

Le port 3000 ne peut pas être partagé : les deux serveurs de
développement tourneraient en même temps.

## Pourquoi une application séparée de `web-pro/`

Quatre raisons, dans l'ordre.

**1. La clé `service_role` doit vivre ici, et nulle part ailleurs.**
Seuls `postgres` et `service_role` franchissent la RLS
(`pg_roles.rolbypassrls`), et un compte ordinaire ne lit littéralement
rien de la plateforme — vérifié en transaction annulée : 0 entreprise,
0 plante, 0 devis. Or `web-pro/.env.example` interdit explicitement d'y
mettre cette clé. Dans un groupe de routes intégré, la clé maîtresse
partagerait un processus avec les trente écrans locataires ; une faille
dans l'un d'eux ouvrirait la base entière. Deux applications = deux
processus, deux environnements, deux rayons d'explosion.

**2. La spec demande un domaine séparé** (`admin.oasiscare.com`, p.2) et
la non-exposition dans la navigation de Pro. Retirer une entrée de menu
donne « non affiché », pas « non joignable ».

**3. Le proxy de Pro échoue OUVERT**, et l'écrit lui-même : *« Deliberately
an OPTIMISTIC check only […] it FAILS OPEN »*. Ce choix est bon là-bas,
la RLS reprenant la main derrière. Ici la RLS ne reprend plus la main :
les lectures traversent les organisations. `proxy.ts` de cette
application ferme donc sur le doute.

**4. La duplication est mesurée et voulue.** Le système de composants
tient en ~1 500 lignes, sans dépendance d'interface tierce, et la spec
p.34 autorise une interface « légèrement différente du Pro pour éviter
toute confusion ». La divergence n'est pas une dette, c'est la consigne.

Aucun paquet partagé n'est créé : cela imposerait une racine de
monorepo et changerait la façon dont `web-pro` se construit aujourd'hui.

## L'accès

Se connecter **ne suffit pas**. Il faut une ligne active dans
`public.platform_admins`.

- Un utilisateur Oasis Care ordinaire → **404**, sans apprendre que la
  page existe.
- Un *owner* d'entreprise Pro → **404** également. La spec p.32 :
  « Ne pas considérer simplement organization owner comme admin Oasis
  Care. » Le mot « admin » est déjà pris dans ce produit, où il désigne
  l'administrateur d'**une entreprise cliente**.
- Un administrateur de plateforme dont le rôle ne couvre pas l'écran →
  une page qui le lui dit, dans la coquille (moindre privilège, p.30).

### Le second facteur (spec p.32)

`ADMIN_MFA_POLICY` vaut `encourage` par défaut : une bannière signale
l'absence de second facteur, personne n'est bloqué. Le cran `require`,
lui, **ferme vraiment** — `requireAdmin()` renvoie vers
`/second-facteur` toute session qui n'est pas `aal2`, avant même de
regarder le rôle, et un niveau *inconnu* ferme lui aussi.

Ce jalon ne livre pas d'écran d'enrôlement : basculer sur `require`
avant qu'un facteur ne soit enrôlé dans Supabase ferme la porte aux
administrateurs concernés. C'est écrit dans `.env.example`, et
`/second-facteur` le rappelle à qui tombe dessus.

### Poser le premier administrateur

La migration `0075_control_center.sql` n'en sème aucun, et c'est un
choix : une migration qui promeut une adresse ferait de ce fichier
versionné le lieu où se décide qui gouverne la plateforme, et rejouée
ailleurs y ouvrirait le même accès.

Dans l'éditeur SQL de Supabase, une fois :

```sql
insert into public.platform_admins (user_id, role, note)
select id, 'super_admin', 'Premier administrateur, posé à la main.'
from auth.users where email = '<adresse>';
```

Les suivants seront créés depuis le backend, par un super-administrateur,
et l'opération sera journalisée.

## Architecture

| | |
|---|---|
| `app/(control)/` | Les écrans, derrière la garde |
| `app/login`, `app/auth/callback` | Connexion |
| `app/not-found.tsx` | Le 404 que reçoit un non-administrateur |
| `app/second-facteur` | Le refus quand `ADMIN_MFA_POLICY=require` n'est pas satisfait |
| `lib/auth/guard.ts` | **La porte.** `requireAdmin(permission?)` |
| `lib/auth/roles.ts` | Les six rôles, le catalogue de permissions |
| `lib/auth/mfa.ts` | Authentification renforcée — par défaut encouragée, **exigible pour de bon** |
| `lib/supabase/server.ts` | Le client de l'administrateur connecté |
| `lib/supabase/admin.ts` | `service_role`, `server-only`, inutilisé au jalon 1 |
| `lib/navigation.ts` | Les six entrées du jalon 1, filtrées par rôle |
| `lib/format.ts` | Le formatage — **jamais de `?? 0`** |
| `components/ui/` | Le système de composants |
| `proxy.ts` | Le filet extérieur, qui ferme sur le doute |

### Trois choses à savoir avant de coder ici

**`proxy.ts`, pas `middleware.ts`.** La convention `middleware` est
dépréciée depuis Next.js 16. Lire la doc locale dans
`node_modules/next/dist/docs/` avant d'écrire : cette version diffère de
ce que connaissent la plupart des exemples en ligne. `cookies()`,
`params` et `searchParams` sont asynchrones ; les types de routes sont
générés au build (`npm run typecheck` lance `next typegen` avant `tsc`).

**Les lectures passent par la session de l'administrateur, pas par
`service_role`.** Les fonctions de 0075 s'authentifient par `auth.uid()`,
qui est nul sous une clé de service : vérifié en transaction annulée,
`admin_me()` et `admin_platform_kpis()` lèvent 42501 quand on les appelle
sous `service_role`. Le droit d'exécution, lui, est bien accordé à
`service_role` — Supabase le fait par défaut sur toute fonction créée
dans `public` — mais il ne sert à rien : ce qui refuse est le contrôle
d'identité à l'intérieur de la fonction. Posséder la clé n'est pas être
autorisé.

**Un chiffre qu'on ne sait pas calculer s'affiche INCONNU.** Onze des
seize indicateurs de la spec n'existent pas dans cette base : pas de
prix sur les forfaits, aucun abonnement d'entreprise suivi, aucune table
de tokens ni de coût IA, aucune table d'erreurs, et rien qui dise par
quelle application un compte est entré. Ils rendent `null`, avec un
motif. Un `?? 0` transformerait chacun en fait faux — « 0 € de MRR » se
lit « nous ne gagnons rien », alors que la vérité est « nous ne suivons
l'abonnement d'aucune entreprise ».

## Base de données

Le socle est la migration `../supabase/migrations/0075_control_center.sql`,
avec ses tests dans `../supabase/tests/control_center.sql`.

Elle pose `platform_admins`, le catalogue et la matrice de permissions,
le journal `admin_audit_events` (ajout seul, motif obligatoire), et les
lectures inter-organisations : `admin_platform_kpis()`,
`admin_live_activity()`, `admin_list_users()`,
`admin_list_organizations()`, `admin_global_search()`, `admin_me()`.

**Elle n'est pas encore appliquée en production.** Tant qu'elle ne l'est
pas, l'application lève une erreur explicite
(`ControlCenterNotDeployed`) plutôt qu'un « accès refusé » trompeur.

## Vérifier

```bash
npm run lint --prefix web-admin
npm run typecheck --prefix web-admin   # next typegen + tsc --noEmit
npm run test --prefix web-admin
npm run build --prefix web-admin
```
