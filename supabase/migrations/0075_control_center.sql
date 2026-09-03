-- Oasis Care — OASIS CONTROL CENTER, jalon 1 : LE SOCLE.
--
-- À exécuter en dernier, après toutes les migrations présentes. Au
-- moment d'écrire, le dépôt s'arrête à 0073 : 0074 est annoncée mais
-- n'existe pas encore sur disque. Aucune collision de nom avec
-- 0071-0073 (vérifiée) ; si 0074 arrive, la relire avant d'appliquer
-- celle-ci.
--
-- Idempotente et purement additive : ce fichier
-- ne touche à aucune table, aucune politique et aucune fonction
-- existantes. Il n'en avait pas le droit — l'application Pro, l'app
-- iPhone et le portail client partagent cette base et continuent de
-- tourner pendant que le Control Center se construit à côté.
--
-- CE QUE CE FICHIER CONTIENT, ET RIEN D'AUTRE :
--   1. les administrateurs de plateforme (table, rôles, matrice) ;
--   2. le journal d'audit administratif ;
--   3. les cinq lectures inter-organisations du jalon 1.
--
-- Support, tickets, sessions d'assistance, feature flags, RGPD,
-- analytics produit, churn, health score, broadcast, releases : hors
-- périmètre. On ne prépare même pas leurs tables.
--
-- ============================================================
-- LE PROBLÈME, EN UNE PHRASE
-- ============================================================
--
-- Un administrateur doit lire À TRAVERS toutes les organisations, et
-- c'est exactement ce que la RLS de ce produit interdit. Vérifié, pas
-- supposé : aucune table de `public` n'a la RLS désactivée, aucune
-- table à RLS n'est dépourvue de politique, et un compte ordinaire lit
-- 0 entreprise, 0 plante, 0 devis — seulement son propre profil. Seuls
-- `postgres` et `service_role` franchissent la barrière
-- (`pg_roles.rolbypassrls`) ; il n'existe aucun rôle intermédiaire.
--
-- Le projet a déjà franchi cette barrière deux fois, et s'est coupé les
-- deux fois :
--
--   • 0055 a créé des vues `client_*` en `security definer`. Une vue
--     `security definer` N'A PAS DE RLS À ELLE, Supabase accorde par
--     défaut tous les droits sur un objet créé dans `public` à `anon`
--     et `authenticated`, et une vue mono-table est modifiable
--     d'office. Résultat reproduit sur la vraie base : un visiteur
--     ANONYME a inséré une ligne dans `quotes` en écrivant dans
--     `client_quotes`. 0057 a dû tout révoquer.
--
--   • 0062 a corrigé trois politiques qui demandaient « as-tu le droit
--     dans l'organisation que tu viens de nommer ? » sans jamais
--     vérifier que l'AUTRE bout de la ligne appartenait à cette
--     organisation.
--
-- D'où les règles suivies ici, chacune adossée à l'un de ces incidents :
--
--   R1. AUCUNE VUE `security definer`. Là où il faut franchir la RLS,
--       c'est une FONCTION, avec `set search_path`, dont la PREMIÈRE
--       instruction refuse l'appelant qui n'est pas administrateur de
--       plateforme, et dont l'`execute` est révoqué de `public` et
--       `anon`.
--   R2. La clé `service_role` ne va pas dans le navigateur. Ces
--       fonctions n'en ont d'ailleurs pas besoin : elles s'authentifient
--       par le JETON de l'appelant (`auth.uid()`), pas par une clé.
--       Un client `service_role` sans jeton ne peut PAS les appeler —
--       il n'a pas l'`execute`, et `auth.uid()` y serait nul.
--   R3. Posséder la clé n'est pas être autorisé : le contrôle
--       d'identité est refait ici, dans la base, et pas seulement dans
--       le backend.
--   R4. Les deux bouts de la ligne : un identifiant reçu en paramètre
--       n'est jamais une preuve de portée. Aucune fonction de ce
--       fichier n'accepte un `organization_id` ou un `user_id` comme
--       laissez-passer.
--   R5. DES NOMBRES, PAS DES LIGNES. Les fonctions rendent des `count`,
--       des `sum` et des dates. Jamais un devis, jamais une photo,
--       jamais une plante. C'est la consigne de la spec p.11 (« ne pas
--       exposer automatiquement le contenu métier ») et c'est aussi la
--       meilleure protection contre R4 : un agrégat mal cadré fuit un
--       chiffre, une liste de lignes fuit des données.
--   R6. Moindre privilège par rôle, en SQL et non en commentaire (§2).
--   R7. Le journal administratif est une table à part (§3).
--
-- ============================================================
-- CE QU'ON NE SAIT PAS CALCULER, ET POURQUOI ON LE DIT
-- ============================================================
--
-- La spec p.4 : « Les KPI doivent être calculés depuis les vraies
-- données. Aucune valeur fictive en production. » L'audit a montré que
-- onze des seize chiffres demandés N'EXISTENT PAS dans cette base :
-- les quatre forfaits Pro ont `monthly_price_cents` à NULL, la table
-- `organization_subscriptions` est vide et AUCUNE ligne de code du
-- dépôt ne l'écrit jamais, aucune table n'enregistre de tokens ni de
-- coût IA, aucune table d'erreurs n'existe, et rien ne dit par quelle
-- application un compte est entré.
--
-- Ces chiffres rendent donc NULL, et chaque fonction rend en plus un
-- `unknown_reasons` jsonb qui dit POURQUOI. Un `coalesce(x, 0)` les
-- transformerait en faits faux : « 0 € de MRR » se lit « nous ne
-- gagnons rien », alors que la vérité est « nous ne suivons l'abonnement
-- d'aucune entreprise ». Les deux phrases n'appellent pas la même
-- décision.
--
-- Un zéro n'est écrit que lorsqu'il est VRAI, c'est-à-dire lorsque le
-- mécanisme d'écriture existe et est prouvé vivant. Chaque cas est
-- justifié à l'endroit du calcul.

-- ============================================================
-- 1. LES ADMINISTRATEURS DE PLATEFORME
-- ============================================================
--
-- LE PIÈGE NOMINATIF DE CE PROJET. Le mot « admin » est déjà pris, et
-- il désigne un rôle CLIENT : `organization_members.role` accepte
-- 'owner' et 'admin' (contrainte posée en 0043), et `has_permission()`
-- accorde tout à ces deux-là. Un « admin » dans Oasis Care Pro est
-- l'administrateur d'UNE entreprise cliente — un client, donc.
--
-- La spec p.32 l'écrit noir sur blanc : « Ne pas considérer simplement
-- organization owner comme admin Oasis Care. » D'où une table qui ne
-- peut pas être confondue, `platform_admins`, qui ne réutilise NI
-- `organization_members`, NI `role_permissions`, NI `has_permission()`.
-- Il n'existe aucun chemin de l'une vers l'autre, et le test
-- `supabase/tests/control_center.sql` le vérifie en relisant le code
-- source des fonctions.

create table if not exists public.platform_admins (
  -- Un compte auth = au plus une ligne. Un administrateur n'a qu'un
  -- rôle : cumuler « support » et « billingAdmin » sur deux lignes
  -- reconstituerait par la bande le super-administrateur que le moindre
  -- privilège cherche à éviter.
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Les six rôles de la spec p.30, en snake_case comme le reste du
  -- schéma. Ce sont des rôles de PLATEFORME : aucun d'eux n'apparaît
  -- dans `organization_members.role`, et c'est délibéré — deux
  -- vocabulaires distincts pour deux mondes distincts.
  role text not null check (role in (
    'super_admin',
    'support',
    'billing_admin',
    'product_admin',
    'security_admin',
    'read_only_analyst'
  )),

  is_active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,

  -- Pourquoi cette personne est administratrice. Utile le jour où on
  -- relit la liste et où plus personne ne se souvient.
  note text,

  -- Une révocation qui laisserait `is_active` à vrai serait une porte
  -- restée ouverte avec l'écriteau « fermé ». Les deux champs ne
  -- peuvent pas se contredire.
  constraint platform_admins_revocation_coherent
    check (revoked_at is null or is_active = false)
);

create index if not exists platform_admins_active_idx
  on public.platform_admins (role) where is_active;

alter table public.platform_admins enable row level security;

-- IMPORTANT : pas de `force row level security`. Les fonctions
-- ci-dessous sont `security definer` et s'exécutent donc sous le
-- propriétaire de la table ; forcer la RLS les soumettrait à leurs
-- propres politiques et créerait une récursion sans fin
-- (is_platform_admin → politique → is_platform_admin → …).
--
-- Les POLITIQUES de ces trois tables sont posées au §2.d, après les
-- deux prédicats : une politique qui nomme une fonction inexistante est
-- refusée à la création.

-- AUCUNE politique d'écriture. C'est le modèle explicite de
-- `subscription_entitlements` (0042 : « un utilisateur ne peut donc pas
-- s'auto-accorder un accès ») : sans politique `insert`, `update` ni
-- `delete`, aucun porteur de jeton — administrateur compris — ne peut
-- se promouvoir, promouvoir un ami, ou se dé-révoquer depuis le
-- navigateur. Le premier administrateur est semé à la main dans
-- l'éditeur SQL ; les suivants passeront par le backend, sous
-- `service_role`, et l'opération sera journalisée (§3).

-- ------------------------------------------------------------
-- 1.b Le catalogue des permissions
-- ------------------------------------------------------------
-- Une TABLE et non une énumération dans le code : `is_write` doit être
-- interrogeable en SQL, sans quoi la règle « un analyste en lecture
-- seule n'écrit rien » resterait une intention.

create table if not exists public.platform_admin_permissions (
  key text primary key,
  label text not null,
  -- Ce qui distingue lire de faire. Le garde-fou de la matrice
  -- (ci-dessous) s'appuie dessus.
  is_write boolean not null default false
);

alter table public.platform_admin_permissions enable row level security;

insert into public.platform_admin_permissions (key, label, is_write) values
  ('platform.dashboard.read',    'Voir le tableau de bord et l''activité', false),
  ('platform.users.read',        'Lister les utilisateurs (métadonnées)',  false),
  ('platform.organizations.read','Lister les entreprises Pro (nombres)',   false),
  ('platform.search',            'Recherche administrative globale',       false),
  ('platform.audit.read',        'Lire le journal des actions admin',      false),
  ('platform.admins.read',       'Voir la liste des administrateurs',      false),
  ('platform.admins.manage',     'Créer, modifier, révoquer un admin',     true),
  -- Aucune interface n'ouvre les données métier dans ce jalon, et
  -- AUCUN RÔLE DE TRAVAIL NE PORTE CETTE PERMISSION (voir le semis de
  -- la matrice, plus bas). Elle existe pour deux raisons : « Billing :
  -- ne peut pas ouvrir les données client » (spec p.30) n'a de sens que
  -- si la permission existe, et la spec p.36 exige « pas de données
  -- métier sensibles exposées dans les listes Admin ». La consigne de
  -- cette phase est plus nette encore : par défaut, AUCUN accès aux
  -- données métier d'un client. Un droit accordé d'avance est un droit
  -- que le premier écran du jalon suivant trouvera déjà ouvert — sans
  -- consentement, sans session d'assistance bornée, sans que personne
  -- ait eu à décider. Il se rajoutera avec le mécanisme qui
  -- l'accompagne (milestone Admin 4 : support, sessions d'assistance,
  -- journal).
  ('customer.data.read',         'Ouvrir les données métier d''un client', false),
  ('billing.subscriptions.read', 'Voir les abonnements',                   false),
  ('billing.subscriptions.write','Modifier un abonnement',                 true),
  ('billing.payments.write',     'Agir sur les paiements',                 true)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 1.c LA MATRICE RÔLE → PERMISSIONS
-- ------------------------------------------------------------
-- Spec p.30, PRINCIPE DU MOINDRE PRIVILÈGE :
--   « Support : ne peut pas modifier les abonnements. »
--   « Billing : ne peut pas ouvrir les données client. »
--   « Product : ne peut pas modifier les paiements. »
--
-- Ces trois phrases sont traduites deux fois : par l'ABSENCE de la
-- ligne correspondante dans la matrice, et par un DÉCLENCHEUR qui
-- refuse de l'y insérer. La seconde traduction est celle qui compte :
-- une absence peut être comblée par distraction dans six mois, un
-- refus doit être supprimé exprès.

create table if not exists public.platform_admin_role_permissions (
  role text not null check (role in (
    'super_admin', 'support', 'billing_admin',
    'product_admin', 'security_admin', 'read_only_analyst'
  )),
  permission text not null references public.platform_admin_permissions (key) on delete cascade,
  primary key (role, permission)
);

alter table public.platform_admin_role_permissions enable row level security;

-- Le garde-fou. Il s'applique à l'insertion comme à la modification, et
-- il s'applique aussi à `postgres` : ce n'est pas une politique RLS,
-- c'est un déclencheur, et un déclencheur ne se contourne pas en
-- changeant de rôle.
create or replace function public.platform_admin_matrix_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_is_write boolean;
begin
  select p.is_write into v_is_write
  from public.platform_admin_permissions p
  where p.key = new.permission;

  if v_is_write is null then
    raise exception 'Permission inconnue : %', new.permission
      using errcode = '23514';
  end if;

  -- « Support : ne peut pas modifier les abonnements. » (spec p.30)
  if new.role = 'support' and v_is_write and new.permission like 'billing.%' then
    raise exception 'Moindre privilège (spec p.30) : le support ne modifie pas les abonnements — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  -- « Billing : ne peut pas ouvrir les données client. » (spec p.30)
  --
  -- La règle est écrite pour QUATRE rôles et non pour le seul
  -- `billing_admin` que la spec nomme, parce que le défaut voulu est
  -- l'inverse d'une liste d'exclusions : par défaut, AUCUN accès aux
  -- données métier d'un client. Ne fermer que la porte nommée revenait
  -- à laisser les trois autres ouvertes, et `customer.data.read` est
  -- déclarée `is_write = false` — la règle de l'analyste en lecture
  -- seule, plus bas, ne mord donc pas dessus. Seuls `super_admin` et
  -- `support` peuvent en théorie la recevoir ; aujourd'hui aucun des
  -- deux rôles de travail ne l'a, et l'accorder à `support` sera un
  -- geste délibéré, le jour où le mécanisme qui l'encadre existera.
  if new.role in ('billing_admin', 'product_admin', 'security_admin', 'read_only_analyst')
     and new.permission like 'customer.%' then
    raise exception 'Moindre privilège (spec p.30) : le rôle « % » n''ouvre pas les données client — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  -- « Product : ne peut pas modifier les paiements. » (spec p.30)
  if new.role = 'product_admin' and v_is_write and new.permission like 'billing.%' then
    raise exception 'Moindre privilège (spec p.30) : le produit ne touche pas aux paiements — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  -- Un analyste en lecture seule qui écrirait quelque chose ne serait
  -- plus en lecture seule. La règle ne vise aucune permission
  -- particulière : elle vise la colonne `is_write`, donc elle couvrira
  -- aussi les permissions qui n'existent pas encore.
  if new.role = 'read_only_analyst' and v_is_write then
    raise exception 'Un analyste en lecture seule n''écrit rien — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists platform_admin_matrix_guard on public.platform_admin_role_permissions;
create trigger platform_admin_matrix_guard
  before insert or update on public.platform_admin_role_permissions
  for each row execute function public.platform_admin_matrix_guard();

-- super_admin : tout le catalogue. Écrit comme une jointure et non
-- comme une liste, pour que l'oubli d'une ligne soit impossible au
-- moment du semis.
insert into public.platform_admin_role_permissions (role, permission)
select 'super_admin', key from public.platform_admin_permissions
on conflict do nothing;

-- support : voit QUI sont les clients — des métadonnées et des
-- nombres — et LIT les abonnements pour comprendre, sans en changer
-- aucun.
--
-- `customer.data.read` n'y figure PAS, et c'est le seul écart assumé
-- avec la lecture naturelle de la spec p.30. Le défaut demandé est
-- « aucun accès aux données métier d'un client » ; le mécanisme qui
-- rendrait cet accès acceptable — consentement, session d'assistance
-- bornée dans le temps, écriture dans `admin_audit_events` avec son
-- motif — appartient au milestone Admin 4. Accorder le droit avant le
-- garde-fou, c'est livrer le garde-fou sans le droit qu'il encadre.
-- Aucune interface de ce jalon ne consulte cette permission : la
-- retirer ne retire rien à personne aujourd'hui, et la rajouter sera
-- une ligne à écrire ce jour-là.
insert into public.platform_admin_role_permissions (role, permission) values
  ('support', 'platform.dashboard.read'),
  ('support', 'platform.users.read'),
  ('support', 'platform.organizations.read'),
  ('support', 'platform.search'),
  ('support', 'billing.subscriptions.read')
on conflict do nothing;

-- billing_admin : l'argent, et rien que l'argent. Il lui faut trouver
-- qui paie — d'où `users.read` et `organizations.read`, qui ne rendent
-- que des métadonnées et des nombres — mais la porte des données
-- métier lui reste fermée.
insert into public.platform_admin_role_permissions (role, permission) values
  ('billing_admin', 'platform.dashboard.read'),
  ('billing_admin', 'platform.users.read'),
  ('billing_admin', 'platform.organizations.read'),
  ('billing_admin', 'platform.search'),
  ('billing_admin', 'billing.subscriptions.read'),
  ('billing_admin', 'billing.subscriptions.write'),
  ('billing_admin', 'billing.payments.write')
on conflict do nothing;

-- product_admin : les usages, jamais la caisse.
insert into public.platform_admin_role_permissions (role, permission) values
  ('product_admin', 'platform.dashboard.read'),
  ('product_admin', 'platform.users.read'),
  ('product_admin', 'platform.organizations.read'),
  ('product_admin', 'platform.search')
on conflict do nothing;

-- security_admin : le seul, avec le super-administrateur, à lire le
-- journal des actions administratives et la liste des administrateurs.
insert into public.platform_admin_role_permissions (role, permission) values
  ('security_admin', 'platform.dashboard.read'),
  ('security_admin', 'platform.users.read'),
  ('security_admin', 'platform.organizations.read'),
  ('security_admin', 'platform.search'),
  ('security_admin', 'platform.audit.read'),
  ('security_admin', 'platform.admins.read')
on conflict do nothing;

-- read_only_analyst : les chiffres, point.
insert into public.platform_admin_role_permissions (role, permission) values
  ('read_only_analyst', 'platform.dashboard.read'),
  ('read_only_analyst', 'platform.users.read'),
  ('read_only_analyst', 'platform.organizations.read'),
  ('read_only_analyst', 'platform.search')
on conflict do nothing;

-- ============================================================
-- 2. LES DEUX PRÉDICATS
-- ============================================================
--
-- CE QUI REND CES DEUX FONCTIONS DIFFICILES À ASSOUPLIR PAR ACCIDENT,
-- et c'est le cœur de ce fichier :
--
--   a) ELLES NE PRENNENT PAS D'UTILISATEUR EN PARAMÈTRE. On ne peut pas
--      les pointer sur quelqu'un d'autre. `is_platform_admin(p_user)`
--      aurait été plus « souple » — et c'est précisément le genre de
--      souplesse qui finit en `is_platform_admin(p_target_user)` dans
--      une garde, six mois plus tard, un vendredi soir. La seule
--      identité qu'elles connaissent est celle du JETON en cours.
--
--   b) ELLES NE LISENT QU'UNE SEULE TABLE : `platform_admins`. Aucune
--      mention de `organization_members`, `role_permissions`,
--      `has_permission()`, `is_organization_member()` ni `owner`. Être
--      propriétaire d'une entreprise Pro n'est pas un chemin vers ici :
--      il n'y a pas de chemin. Le test relit le code source des deux
--      fonctions et échoue si l'un de ces mots y réapparaît.
--
--   c) LA RÉVOCATION EST VÉRIFIÉE DEUX FOIS, `is_active` ET
--      `revoked_at`, alors que la contrainte de table les rend déjà
--      cohérents. Redondant volontairement : le jour où quelqu'un
--      supprime la contrainte, la fonction tient encore.
--
--   d) `set search_path = public, pg_temp`. En `security definer`,
--      `pg_temp` non listé est fouillé EN PREMIER pour les tables : un
--      appelant qui créerait une table temporaire nommée
--      `platform_admins` détournerait la fonction. En le nommant
--      explicitement en dernier, il passe après `public`. C'est l'écart
--      qu'`increment_usage_counter` (0041) a laissé ouvert ; on ne le
--      reproduit pas.

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
      and pa.is_active
      and pa.revoked_at is null
  );
$$;

comment on function public.is_platform_admin() is
  'Vrai si le PORTEUR DU JETON EN COURS est un administrateur de plateforme actif. '
  'Ne prend aucun paramètre, exprès : on ne peut pas la pointer sur autrui. '
  'Ne consulte que platform_admins : être owner d''une entreprise Pro n''ouvre rien (spec p.32).';

create or replace function public.platform_admin_can(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- La conjonction est volontairement redondante : `is_platform_admin()`
  -- refait le contrôle d'activité que la jointure fait déjà. Si un jour
  -- la jointure est réécrite de travers, le premier terme tient encore.
  select public.is_platform_admin()
     and exists (
       select 1
       from public.platform_admins pa
       join public.platform_admin_role_permissions rp on rp.role = pa.role
       where pa.user_id = auth.uid()
         and pa.is_active
         and pa.revoked_at is null
         and rp.permission = p_permission
     );
$$;

comment on function public.platform_admin_can(text) is
  'Vrai si le porteur du jeton en cours est administrateur de plateforme ACTIF '
  'ET que son rôle porte cette permission. Matrice : platform_admin_role_permissions.';

-- ------------------------------------------------------------
-- 2.d Les politiques des trois tables du §1
-- ------------------------------------------------------------
-- Posées ici parce qu'elles nomment les prédicats ci-dessus. Toutes en
-- LECTURE SEULE : aucune politique `insert`, `update` ni `delete`
-- n'existe sur ces tables, donc aucun porteur de jeton ne peut se
-- promouvoir, promouvoir quelqu'un, ou se dé-révoquer.

-- Sa PROPRE ligne toujours — l'App Shell doit pouvoir afficher « vous
-- êtes support » sans demander la liste complète — et la liste entière
-- seulement avec la permission qui va bien.
drop policy if exists "Un admin lit sa fiche, les habilités lisent la liste" on public.platform_admins;
create policy "Un admin lit sa fiche, les habilités lisent la liste" on public.platform_admins
  for select using (
    user_id = auth.uid()
    or public.platform_admin_can('platform.admins.read')
  );

drop policy if exists "Les administrateurs lisent le catalogue" on public.platform_admin_permissions;
create policy "Les administrateurs lisent le catalogue" on public.platform_admin_permissions
  for select using (public.is_platform_admin());

drop policy if exists "Les administrateurs lisent la matrice" on public.platform_admin_role_permissions;
create policy "Les administrateurs lisent la matrice" on public.platform_admin_role_permissions
  for select using (public.is_platform_admin());

-- La fiche de l'appelant, pour l'App Shell : « qui suis-je, et qu''ai-je
-- le droit de faire ». Lève pour un non-administrateur — une réponse
-- vide se confondrait avec « administrateur sans aucune permission ».
create or replace function public.admin_me()
returns table (
  user_id uuid,
  role text,
  permissions text[],
  since timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs de la plateforme Oasis Care.'
      using errcode = '42501';
  end if;

  return query
  select pa.user_id,
         pa.role,
         (select array_agg(rp.permission order by rp.permission)
            from public.platform_admin_role_permissions rp
           where rp.role = pa.role),
         pa.created_at
  from public.platform_admins pa
  where pa.user_id = auth.uid();
end;
$$;

-- ============================================================
-- 3. LE JOURNAL D'AUDIT ADMINISTRATIF
-- ============================================================
--
-- POURQUOI UNE TABLE DISTINCTE DE `audit_events` (0058), alors que les
-- conventions sont les mêmes (ajout seul, `who / what / entity /
-- oldValue / newValue / timestamp`, écriture par fonction
-- `security definer` uniquement) — trois raisons, dont deux
-- rédhibitoires :
--
--   1. `audit_events.organization_id` est `not null`. Une action
--      portant sur un utilisateur mobile sans entreprise ne peut
--      LITTÉRALEMENT pas y être écrite.
--   2. Sa politique de lecture est « Members read the audit log »
--      (`is_organization_member(organization_id)`) : les salariés d'une
--      entreprise cliente liraient les actes d'un administrateur Oasis
--      Care sur leur compte.
--   3. `record_audit_event()` refuse d'écrire si l'appelant n'est pas
--      membre de l'organisation visée — un administrateur de plateforme
--      ne l'est jamais.
--
-- Et une raison de fond : mélanger les gestes de la plateforme et ceux
-- des clients rendrait les deux journaux illisibles. Celui-ci répond à
-- « qu'a fait l'équipe Oasis Care ? », l'autre à « que s'est-il passé
-- chez ce client ? ».

create table if not exists public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),

  -- « admin » — `set null` plutôt que `cascade` : effacer le compte de
  -- l'administrateur ne doit pas effacer ce qu'il a fait.
  admin_user_id uuid references auth.users (id) on delete set null,

  -- Le rôle AU MOMENT DU GESTE. Il est recopié, pas joint : un rôle
  -- change, et le journal doit dire sous quelle casquette la personne a
  -- agi, pas sous laquelle elle est aujourd'hui.
  admin_role text not null,

  -- « action » — le verbe : 'subscription.planChanged',
  -- 'platformAdmin.revoked', 'supportSession.started'…
  action text not null,

  -- « target »
  target_type text not null,
  target_id uuid,
  -- L'étiquette lisible de la cible, recopiée elle aussi : quand la
  -- cible est supprimée, `target_id` ne désigne plus rien.
  target_label text,

  old_value jsonb,
  new_value jsonb,

  -- « reason » — OBLIGATOIRE, et non vide. C'est la seule colonne
  -- contrainte de la table : une action administrative sans motif est
  -- exactement celle qu'on voudra comprendre plus tard.
  reason text not null constraint admin_audit_events_reason_not_blank check (btrim(reason) <> ''),

  -- « ip / session metadata when appropriate » (spec p.31) : nullable,
  -- parce qu'une action déclenchée par un traitement automatique n'a ni
  -- adresse ni navigateur, et qu'inventer les deux serait pire.
  ip inet,
  user_agent text,
  session_metadata jsonb,

  occurred_at timestamptz not null default now()
);

create index if not exists admin_audit_events_when_idx
  on public.admin_audit_events (occurred_at desc);
create index if not exists admin_audit_events_admin_idx
  on public.admin_audit_events (admin_user_id, occurred_at desc);
create index if not exists admin_audit_events_target_idx
  on public.admin_audit_events (target_type, target_id, occurred_at desc);

alter table public.admin_audit_events enable row level security;

-- Lecture : les seuls porteurs de `platform.audit.read`, c'est-à-dire
-- le super-administrateur et le responsable sécurité. Un support qui
-- lirait le journal saurait quel collègue a touché quel dossier ; ce
-- n'est pas son travail.
drop policy if exists "Le journal admin se lit avec la permission d'audit" on public.admin_audit_events;
create policy "Le journal admin se lit avec la permission d'audit" on public.admin_audit_events
  for select using (public.platform_admin_can('platform.audit.read'));

-- AUCUNE politique `insert`, `update` ni `delete` : ajout seul, par la
-- fonction uniquement. Un journal qu'on peut réécrire ne prouve rien,
-- et c'est justement quand quelqu'un veut effacer une ligne qu'il faut
-- qu'elle reste.

create or replace function public.record_admin_event(
  p_action text,
  p_target_type text,
  p_target_id uuid default null,
  p_target_label text default null,
  p_old_value jsonb default null,
  p_new_value jsonb default null,
  p_reason text default null,
  p_ip inet default null,
  p_user_agent text default null,
  p_session_metadata jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
  v_id uuid;
begin
  -- Le contrôle que la RLS ferait si la table était écrite directement.
  -- Sans lui, `security definer` laisserait n'importe qui signer une
  -- ligne du journal des administrateurs.
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : seul un administrateur de la plateforme journalise une action administrative.'
      using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Motif obligatoire : une action administrative se justifie au moment où on la fait, pas après.'
      using errcode = '23514';
  end if;

  select pa.role into v_role
  from public.platform_admins pa
  where pa.user_id = auth.uid();

  -- « Un analyste en lecture seule n'écrit rien » doit rester vrai
  -- LITTÉRALEMENT, y compris ici. Un analyste n'accomplit aucune action
  -- administrative ; une ligne de journal signée par lui ne pourrait
  -- être que du bruit — ou une piste fabriquée. C'est aussi la seule
  -- écriture que ce jalon rend possible : sans ce refus, la phrase
  -- serait déjà fausse au premier jour.
  if v_role = 'read_only_analyst' then
    raise exception 'Un analyste en lecture seule n''écrit rien, pas même dans le journal.'
      using errcode = '42501';
  end if;

  insert into public.admin_audit_events (
    admin_user_id, admin_role, action, target_type, target_id, target_label,
    old_value, new_value, reason, ip, user_agent, session_metadata
  )
  values (
    -- L'auteur est imposé, jamais reçu en paramètre : c'est ce qui rend
    -- la signature infalsifiable.
    auth.uid(), v_role, p_action, p_target_type, p_target_id, p_target_label,
    p_old_value, p_new_value, btrim(p_reason), p_ip, p_user_agent, p_session_metadata
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ============================================================
-- 4. LES LECTURES INTER-ORGANISATIONS
-- ============================================================
--
-- Chacune commence par le même refus explicite. C'est répétitif, et
-- c'est voulu : on doit pouvoir ouvrir n'importe laquelle de ces
-- fonctions et voir la barrière dans les dix premières lignes, sans
-- suivre un appel vers un utilitaire qui pourrait être modifié
-- ailleurs.

-- ------------------------------------------------------------
-- 4.a admin_platform_kpis() — le haut du tableau de bord (spec p.3-4)
-- ------------------------------------------------------------
create or replace function public.admin_platform_kpis()
returns table (
  total_users bigint,
  new_users_this_month bigint,
  mobile_users bigint,
  pro_organizations bigint,
  pro_users bigint,
  open_sessions bigint,
  tracked_subscriptions bigint,
  mrr_cents bigint,
  arr_cents bigint,
  pro_trials bigint,
  mobile_trials bigint,
  churn_30d_percent numeric,
  pro_ai_requests_this_month bigint,
  mobile_ai_requests_this_month bigint,
  ai_cost_cents bigint,
  unknown_reasons jsonb,
  computed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  -- Le mois « en cours » est celui de PARIS : à minuit le 1er, un
  -- compteur en UTC afficherait encore le mois précédent pendant deux
  -- heures. Le projet a déjà tranché ce point pour les priorités du
  -- jour (0066).
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris';

  -- Les périodes des compteurs IA, en revanche, sont écrites en UTC par
  -- leurs producteurs (`consume_pro_ai_quota`, 0058 : to_char(now() at
  -- time zone 'utc', 'YYYY-MM')). On relit donc avec la MÊME étiquette
  -- que l'écrivain : lire en Paris ce qui est écrit en UTC ferait
  -- disparaître les deux premières heures de chaque mois.
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');

  v_total_users bigint;
  v_new_users bigint;
  v_orgs bigint;
  v_pro_users bigint;
  v_sessions bigint;
  v_subs bigint;
  v_subs_billable bigint;
  v_unpriced bigint;
  v_mrr bigint;
  v_arr bigint;
  v_pro_trials bigint;
  v_pro_ai bigint;
  v_mobile_ai bigint;
  v_reasons jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs de la plateforme Oasis Care.'
      using errcode = '42501';
  end if;
  if not public.platform_admin_can('platform.dashboard.read') then
    raise exception 'Accès refusé : permission platform.dashboard.read manquante.'
      using errcode = '42501';
  end if;

  -- ---- Ce qui se calcule vraiment -------------------------------

  -- `deleted_at` : Supabase efface en douceur. Sans ce filtre, le
  -- compteur ne baisserait jamais.
  select count(*) into v_total_users from auth.users where deleted_at is null;

  select count(*) into v_new_users
  from auth.users
  where deleted_at is null and created_at >= v_month_start;

  select count(*) into v_orgs
  from public.business_organizations where archived_at is null;

  -- `count(distinct)` obligatoire : un même compte peut être membre de
  -- plusieurs entreprises (l'unicité ne porte que sur le couple
  -- (organization_id, user_id)).
  --
  -- LES DEUX JOINTURES NE SONT PAS DÉCORATIVES : ce chiffre est le
  -- NUMÉRATEUR d'une barre dont `v_total_users` est le dénominateur, et
  -- deux populations différentes donnent un pourcentage qui n'a aucun
  -- sens. Sans elles, un compte effacé en douceur resterait « membre »
  -- (l'effacement Supabase pose `deleted_at`, il ne supprime pas la
  -- ligne, donc le `on delete cascade` de la clé étrangère ne se
  -- déclenche JAMAIS) et la barre pouvait afficher « 1 sur 1 · 100 % »
  -- là où la vérité est 0 %. Une entreprise archivée sortant déjà de
  -- `v_orgs`, ses membres doivent en sortir aussi : « utilisateur Pro »
  -- veut dire « rattaché à une entreprise VIVANTE ».
  select count(distinct om.user_id) into v_pro_users
  from public.organization_members om
  join auth.users u on u.id = om.user_id and u.deleted_at is null
  join public.business_organizations o
    on o.id = om.organization_id and o.archived_at is null
  where om.archived_at is null;

  -- INSTANTANÉ, pas historique : `auth.sessions` ne contient que les
  -- sessions VIVANTES — la ligne disparaît à la déconnexion. Cette
  -- valeur répond à « combien de sessions sont ouvertes en ce
  -- moment », jamais à « combien de connexions aujourd'hui ».
  select count(distinct s.user_id) into v_sessions
  from auth.sessions s
  where coalesce(s.refreshed_at at time zone 'UTC', s.updated_at) >= now() - interval '30 minutes';

  -- MÊME POPULATION QUE `v_orgs`, pour la même raison qu'au-dessus :
  -- ce chiffre est le numérateur de la barre « entreprises dont
  -- l'abonnement est suivi », dont `v_orgs` est le dénominateur. Une
  -- entreprise archivée qui garderait son abonnement compté ferait
  -- afficher « 1 sur 1 · 100 % » alors que la seule entreprise vivante
  -- n'a rien. Rien n'annule l'abonnement à l'archivage — la table n'est
  -- écrite par aucune ligne du dépôt — donc l'état « archivée +
  -- active » est atteignable et durable.
  select count(*) into v_subs
  from public.organization_subscriptions s
  join public.business_organizations o
    on o.id = s.organization_id and o.archived_at is null;

  -- Requêtes IA du mois. Le zéro est ici une VÉRITÉ et non un défaut :
  -- `consume_pro_ai_quota` crée la ligne de période au premier appel,
  -- donc l'absence de ligne signifie l'absence d'appel. C'est la
  -- différence avec le MRR ci-dessous, dont la table n'est écrite par
  -- personne.
  select coalesce(sum(u.used), 0) into v_pro_ai
  from public.ai_pro_usage u where u.period = v_period;

  select coalesce(sum(c.count), 0) into v_mobile_ai
  from public.usage_counters c where c.period = v_period;

  -- ---- Le MRR, et pourquoi il est inconnu -----------------------
  --
  -- Trois pièces manquent sur trois. (1) Les quatre lignes de
  -- `organization_plans` ont `monthly_price_cents` à NULL — le semis de
  -- 0060 ne renseigne pas la colonne. (2) `organization_subscriptions`
  -- est vide. (3) AUCUNE ligne de code du dépôt ne l'écrit : la seule
  -- occurrence est une LECTURE (web-pro/lib/billing/provider.ts), et
  -- `startCheckout` rend délibérément { kind: "unavailable" }.
  --
  -- La requête est néanmoins écrite pour de bon : le jour où les prix
  -- et les abonnements existeront, elle rendra le vrai chiffre sans
  -- qu'on y revienne. En attendant elle rend NULL, et deux garde-fous
  -- l'y obligent.
  --
  -- LES ENTREPRISES ARCHIVÉES SONT EXCLUES, ici comme partout ailleurs
  -- dans cette fonction. C'était le seul endroit où l'argent ne suivait
  -- pas la même définition que le reste de l'écran : le MRR d'un client
  -- parti s'affichait à côté d'un décompte d'entreprises qui, lui, ne
  -- le contenait plus. Le choix inverse — facturer encore une
  -- entreprise archivée — serait défendable, mais il faudrait alors
  -- aligner `v_orgs` : ce qu'on ne veut pas, c'est que les deux
  -- définitions divergent en silence sur l'écran de direction.
  select count(*) into v_subs_billable
  from public.organization_subscriptions s
  join public.business_organizations o
    on o.id = s.organization_id and o.archived_at is null
  where s.status in ('active', 'pastDue');

  select count(*) into v_unpriced
  from public.organization_subscriptions s
  join public.business_organizations o
    on o.id = s.organization_id and o.archived_at is null
  join public.organization_plans p on p.key = s.plan
  where s.status in ('active', 'pastDue')
    and p.monthly_price_cents is null;

  if v_subs_billable = 0 then
    -- Garde-fou 1 : aucun abonnement suivi. `sum()` sur zéro ligne rend
    -- déjà NULL, mais on l'écrit à la main pour que personne ne
    -- « répare » ce NULL avec un coalesce en croyant bien faire.
    v_mrr := null;
  elsif v_unpriced > 0 then
    -- Garde-fou 2 : au moins un forfait sans prix. Un `sum()` naïf
    -- ignorerait ces lignes et rendrait un MRR TROP BAS — le pire des
    -- cas, parce qu'il a l'air d'un chiffre.
    v_mrr := null;
  else
    select sum(p.monthly_price_cents) into v_mrr
    from public.organization_subscriptions s
    join public.business_organizations o
      on o.id = s.organization_id and o.archived_at is null
    join public.organization_plans p on p.key = s.plan
    where s.status in ('active', 'pastDue');
  end if;

  -- ARR : `organization_plans` ne porte qu'un prix MENSUEL et le schéma
  -- n'a aucune notion de cycle. Multiplier par douze est donc exact
  -- AUJOURD'HUI, par construction — et deviendra faux le jour où un
  -- abonnement annuel remisé existera. Cette ligne devra changer ce
  -- jour-là ; la spec p.12 demande déjà un champ « Cycle ».
  v_arr := case when v_mrr is null then null else v_mrr * 12 end;

  -- Essais Pro : même cause que le MRR. Si la table n'est alimentée par
  -- personne, « 0 essai » se lit « personne n'essaie », alors que la
  -- vérité est « on ne suit aucun essai ».
  if v_subs = 0 then
    v_pro_trials := null;
  else
    select count(*) into v_pro_trials
    from public.organization_subscriptions s
    join public.business_organizations o
      on o.id = s.organization_id and o.archived_at is null
    where s.status = 'trialing';
  end if;

  -- ---- Les motifs des inconnus ----------------------------------
  -- Construits à partir des valeurs RÉELLEMENT nulles : le jour où le
  -- MRR se calcule, son motif disparaît de lui-même.
  select jsonb_object_agg(k, v) into v_reasons
  from (values
    ('mobile_users',
     'Aucune colonne n''enregistre par quelle application un compte est entré. Le seul proxy imaginable — posséder un espace personnel — est sans valeur : le trigger on_auth_user_created en crée un pour TOUT compte auth, y compris celui qui n''ouvrira jamais l''iPhone.'::text),
    ('mrr_cents',
     case when v_mrr is null then
       case when v_subs_billable = 0
         then 'Aucun abonnement facturable sur une entreprise vivante : organization_subscriptions est vide et aucune ligne de code du dépôt ne l''écrit (startCheckout rend « unavailable »). 0 € serait un fait faux.'
         else 'Au moins un forfait actif n''a pas de prix (organization_plans.monthly_price_cents est NULL) : la somme serait silencieusement trop basse.'
       end
     end),
    ('arr_cents',
     case when v_arr is null then 'Dérivé du MRR, inconnu tant que le MRR l''est.' end),
    ('pro_trials',
     case when v_pro_trials is null then
       'Aucun abonnement suivi sur une entreprise vivante : organization_subscriptions n''est écrite par personne, et le statut « trialing » n''existe que dans la contrainte. « 0 essai » se lirait « personne n''essaie » au lieu de « on ne suit aucun essai ».'
     end),
    ('mobile_trials',
     'Le webhook Apple n''écrit que subscribed / expired / revoked : un essai gratuit y est enregistré comme « subscribed », indiscernable d''un abonnement payé.'),
    ('churn_30d_percent',
     'Ni numérateur ni dénominateur. Côté Pro, organization_subscriptions a pour clé primaire organization_id — une seule ligne par entreprise — donc cancelled_at est écrasé à chaque changement : il n''y a pas d''historique. Côté mobile, subscription_events est bien en ajout seul mais ne contient aucune ligne.'),
    ('ai_cost_cents',
     'Aucune table du projet n''enregistre de tokens, de modèle, de latence ni de coût. ai_pro_usage et usage_counters comptent des REQUÊTES, pas des euros.')
  ) t(k, v)
  where v is not null;

  return query select
    v_total_users,
    v_new_users,
    null::bigint,        -- mobile_users : voir unknown_reasons
    v_orgs,
    v_pro_users,
    v_sessions,
    v_subs,
    v_mrr,
    v_arr,
    v_pro_trials,
    null::bigint,        -- mobile_trials
    null::numeric,       -- churn_30d_percent
    v_pro_ai,
    v_mobile_ai,
    null::bigint,        -- ai_cost_cents
    coalesce(v_reasons, '{}'::jsonb),
    now();
end;
$$;

-- ------------------------------------------------------------
-- 4.b admin_live_activity(depuis) — ACTIVITÉ TEMPS RÉEL (spec p.4-5)
-- ------------------------------------------------------------
create or replace function public.admin_live_activity(p_since timestamptz default null)
returns table (
  since_at timestamptz,
  until_at timestamptz,
  signups bigint,
  new_organizations bigint,
  signed_in_users bigint,
  open_sessions bigint,
  premium_conversions bigint,
  pro_conversions bigint,
  mobile_cancellations bigint,
  pro_cancellations bigint,
  plant_ai_analyses bigint,
  ai_requests bigint,
  important_errors bigint,
  unknown_reasons jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  -- Par défaut : depuis minuit à PARIS. « Aujourd'hui » est une notion
  -- locale, et l'équipe qui lit cet écran est à Paris.
  v_since timestamptz := coalesce(p_since, date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris');
  v_signups bigint;
  v_new_orgs bigint;
  v_signed_in bigint;
  v_sessions bigint;
  v_events_total bigint;
  v_premium bigint;
  v_mobile_cancel bigint;
  v_analyses bigint;
  v_reasons jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs de la plateforme Oasis Care.'
      using errcode = '42501';
  end if;
  if not public.platform_admin_can('platform.dashboard.read') then
    raise exception 'Accès refusé : permission platform.dashboard.read manquante.'
      using errcode = '42501';
  end if;

  select count(*) into v_signups
  from auth.users where deleted_at is null and created_at >= v_since;

  select count(*) into v_new_orgs
  from public.business_organizations where created_at >= v_since;

  -- LE CHIFFRE QUI DEMANDE UNE EXPLICATION. `auth.audit_log_entries`
  -- est vide sur ce projet, et `auth.sessions` ne garde que les
  -- sessions vivantes : compter les CONNEXIONS d'une journée est
  -- impossible. En revanche `last_sign_in_at` donne la DERNIÈRE
  -- connexion de chaque compte — et pour une fenêtre qui se termine
  -- MAINTENANT, « dernière connexion postérieure à v_since » est
  -- exactement l'ensemble des comptes qui se sont connectés depuis
  -- v_since. C'est un nombre de PERSONNES, pas de connexions, et il
  -- cesserait d'être exact pour une fenêtre passée (d'où l'absence de
  -- paramètre « jusqu'à » : cette fonction ne regarde pas en arrière).
  select count(*) into v_signed_in
  from auth.users
  where deleted_at is null and last_sign_in_at >= v_since;

  select count(distinct s.user_id) into v_sessions
  from auth.sessions s
  where coalesce(s.refreshed_at at time zone 'UTC', s.updated_at) >= now() - interval '30 minutes';

  -- Conversions et résiliations mobiles : `subscription_events` est la
  -- bonne source — en ajout seul, unique sur (transaction_id,
  -- event_type), alimentée par le webhook Apple. Mais elle n'a JAMAIS
  -- reçu de ligne, et on ne sait pas si c'est parce que personne n'a
  -- acheté ou parce que le webhook n'est pas branché. Tant que la table
  -- est vide, le compteur rend INCONNU ; à la première ligne écrite, il
  -- se met à répondre tout seul.
  select count(*) into v_events_total from public.subscription_events;

  if v_events_total = 0 then
    v_premium := null;
    v_mobile_cancel := null;
  else
    -- On compte des ABONNÉS, pas des lignes — et on retombe sur la
    -- transaction d'origine quand le webhook n'a pas su rattacher un
    -- compte : `count(distinct user_id)` seul rendrait ces
    -- événements-là invisibles (le webhook n'écrit JAMAIS `user_id`,
    -- cf. apple-subscription-webhook/index.ts).
    --
    -- UN SEUL TYPE D'ÉVÉNEMENT, ET C'EST LE POINT DÉLICAT DE CETTE
    -- FONCTION. `event_type` est recopié tel quel depuis
    -- `payload.notificationType` d'Apple (App Store Server
    -- Notifications V2). Trois types y ressemblent à une conversion
    -- sans en être une :
    --
    --   • DID_RENEW est envoyé à CHAQUE reconduction automatique d'un
    --     abonné DÉJÀ payant. Le compter ferait apparaître, à mille
    --     abonnés mensuels, une trentaine de « conversions » par jour
    --     en régime permanent — un chiffre faux, gonflé, et d'apparence
    --     parfaitement légitime. C'est le mode de défaillance le plus
    --     dangereux : il n'apparaîtra qu'au premier vrai client.
    --   • OFFER_REDEEMED s'applique aussi à un abonné existant qui
    --     utilise une offre promotionnelle.
    --   • INITIAL_BUY est un type de la V1 : ce webhook ne l'écrit
    --     jamais.
    --
    -- Reste SUBSCRIBED, la seule notification qui marque le début d'un
    -- abonnement. RÉSERVE ASSUMÉE : Apple distingue un premier achat
    -- (sous-type INITIAL_BUY) d'un réabonnement (sous-type RESUBSCRIBE)
    -- par le SOUS-TYPE, que le webhook ne stocke pas — il n'écrit ni
    -- `subtype` ni le `signedDate` d'Apple. Un client qui revient est
    -- donc compté comme une conversion. La correction demande une
    -- colonne `subtype` sur `subscription_events` ET une modification
    -- du webhook : les deux sont hors du périmètre de ce jalon, et la
    -- réserve est écrite à l'écran à côté du chiffre.
    select count(distinct coalesce(e.user_id::text, e.original_transaction_id)) into v_premium
    from public.subscription_events e
    where e.occurred_at >= v_since
      and e.event_type = 'SUBSCRIBED';

    -- Les trois types qui mettent FIN à un droit. DID_CHANGE_RENEWAL_STATUS
    -- (sous-type AUTO_RENEW_DISABLED) est délibérément absent : il dit
    -- « cette personne a décoché le renouvellement », pas « elle a
    -- cessé de payer » — elle reste abonnée jusqu'à l'échéance, et le
    -- compter ici ferait une résiliation le jour de l'intention PUIS
    -- une seconde le jour de l'expiration. Le sous-type n'étant de
    -- toute façon pas stocké, on ne pourrait pas distinguer une
    -- désactivation d'une RÉactivation du renouvellement.
    select count(distinct coalesce(e.user_id::text, e.original_transaction_id)) into v_mobile_cancel
    from public.subscription_events e
    where e.occurred_at >= v_since
      and e.event_type in ('EXPIRED', 'REVOKE', 'REFUND');
  end if;

  -- La seule trace IA horodatée à la journée. Elle ne couvre QUE les
  -- analyses rattachées à une plante — ni l'assistant, ni la recherche,
  -- ni les agents Pro — d'où son nom explicite : la lire comme « la
  -- consommation IA du jour » serait un contresens.
  select count(*) into v_analyses
  from public.ai_analyses a where a.date >= v_since;

  select jsonb_object_agg(k, v) into v_reasons
  from (values
    ('premium_conversions',
     case when v_premium is null then
       'subscription_events (la table qui répondrait, en ajout seul) ne contient aucune ligne : soit aucun achat depuis le lancement, soit le webhook Apple n''est pas branché. On ne sait pas lequel, donc on ne dit pas 0.'
     end),
    ('pro_conversions',
     'Aucune écriture de organization_subscriptions dans tout le dépôt, et pas de journal d''événements côté Pro : started_at serait de toute façon écrasé à chaque changement de forfait.'::text),
    ('mobile_cancellations',
     case when v_mobile_cancel is null then
       'Même source vide que les conversions Premium : subscription_events n''a jamais reçu de ligne.'
     end),
    ('pro_cancellations',
     'organization_subscriptions n''a qu''une ligne par entreprise : cancelled_at est écrasé, un client qui part, revient et repart ne laisse qu''une trace.'),
    ('ai_requests',
     'ai_pro_usage et usage_counters sont indexés par période mensuelle (YYYY-MM). Il n''existe aucun seau journalier, et le compteur étant cumulatif sans instantané quotidien, on ne peut même pas soustraire.'),
    ('important_errors',
     'Aucune table d''erreurs, de crashs ni d''incidents n''existe. Les Edge Functions écrivent dans les journaux de la plateforme Supabase, qui ne sont pas interrogeables en SQL.')
  ) t(k, v)
  where v is not null;

  return query select
    v_since,
    now(),
    v_signups,
    v_new_orgs,
    v_signed_in,
    v_sessions,
    v_premium,
    null::bigint,     -- pro_conversions
    v_mobile_cancel,
    null::bigint,     -- pro_cancellations
    v_analyses,
    null::bigint,     -- ai_requests (du jour)
    null::bigint,     -- important_errors
    coalesce(v_reasons, '{}'::jsonb);
end;
$$;

-- ------------------------------------------------------------
-- 4.c admin_list_users(...) — USERS (spec p.7)
-- ------------------------------------------------------------
--
-- « nom, email, userId, organisation, plan, date inscription. » Des
-- métadonnées et des nombres : pas un jardin, pas une plante, pas une
-- photo (spec p.9 : « Ne PAS afficher par défaut toutes ses plantes ou
-- photos dans l'administration »).
--
-- LES FILTRES QU'ON NE PEUT PAS HONORER LÈVENT UNE EXCEPTION. La spec
-- p.7 en demande neuf ; trois n'ont aucune donnée derrière. Rendre
-- toute la liste en ignorant silencieusement le filtre serait le pire
-- comportement possible : l'écran affirmerait « voici les utilisateurs
-- Mobile » en montrant tout le monde. L'exception dit la vérité, et
-- l'interface n'a qu'à ne pas proposer le filtre.
create or replace function public.admin_list_users(
  p_search text default null,
  p_filter text default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  user_id uuid,
  email text,
  display_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  product text,
  organization_count bigint,
  organizations text[],
  pro_plans text[],
  mobile_plan text,
  complimentary boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
-- Les noms de colonnes de sortie (`email`, `created_at`, …) sont aussi
-- des noms de colonnes des tables lues. Sans cette directive, plpgsql
-- refuserait d'arbitrer et lèverait « column reference is ambiguous » au
-- premier appel. On tranche une fois, en faveur de la COLONNE.
#variable_conflict use_column
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_filter text := nullif(btrim(lower(coalesce(p_filter, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  -- Plafond dur : une page de dix mille lignes n'est pas une page,
  -- c'est un export — et un export d'annuaire n'a rien à faire dans un
  -- écran de liste.
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 200);
  -- Trente jours : le seuil d'« inactif » de cet écran. Arbitraire et
  -- assumé — il est écrit ici, une fois, plutôt que dispersé dans le
  -- front.
  v_idle interval := interval '30 days';
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs de la plateforme Oasis Care.'
      using errcode = '42501';
  end if;
  if not public.platform_admin_can('platform.users.read') then
    raise exception 'Accès refusé : permission platform.users.read manquante.'
      using errcode = '42501';
  end if;

  if v_filter in ('mobile', 'ios', 'android') then
    raise exception 'Filtre « % » impossible : rien n''enregistre par quelle application un compte est entré. Le proxy « possède un espace personnel » est faux (le trigger on_auth_user_created en crée un pour tout compte).', v_filter
      using errcode = '0A000';
  elsif v_filter in ('trial', 'essai') then
    raise exception 'Filtre « % » impossible : côté Pro aucun abonnement n''est suivi, côté Apple un essai est enregistré comme « subscribed » et reste indiscernable d''un abonnement payé.', v_filter
      using errcode = '0A000';
  elsif v_filter in ('cancelled', 'resilie', 'résilié') then
    raise exception 'Filtre « % » impossible : il n''existe aucun historique de résiliation (cancelled_at est écrasé côté Pro, subscription_events est vide côté mobile).', v_filter
      using errcode = '0A000';
  elsif v_filter is not null and v_filter not in (
    'pro', 'sans_organisation', 'premium', 'gratuit', 'offert', 'actif', 'inactif', 'banni'
  ) then
    raise exception 'Filtre inconnu : « % ». Attendu : pro, sans_organisation, premium, gratuit, offert, actif, inactif, banni.', v_filter
      using errcode = '22023';
  end if;

  return query
  with base as (
    select u.id,
           u.email::text as email,
           p.display_name,
           u.created_at,
           u.last_sign_in_at,
           u.banned_until
    from auth.users u
    left join public.profiles p on p.id = u.id
    -- Les comptes effacés en douceur ne sont plus des utilisateurs.
    where u.deleted_at is null
      and (
        v_q is null
        or u.email ilike '%' || v_q || '%'
        or coalesce(p.display_name, '') ilike '%' || v_q || '%'
        -- Recherche par identifiant exact : la spec p.33 la demande, et
        -- un uuid partiel n'a aucun sens.
        or u.id::text = v_q
      )
      and (
        v_filter is null
        -- « Rattaché à une entreprise » veut dire une entreprise
        -- VIVANTE, ici comme dans le KPI `pro_users` : sans la jointure
        -- sur `business_organizations`, la carte du tableau de bord et
        -- cette liste compteraient deux populations différentes, et
        -- c'est la carte qui renvoie vers cette liste.
        or (v_filter = 'pro' and exists (
              select 1 from public.organization_members m
              join public.business_organizations o
                on o.id = m.organization_id and o.archived_at is null
              where m.user_id = u.id and m.archived_at is null))
        or (v_filter = 'sans_organisation' and not exists (
              select 1 from public.organization_members m
              join public.business_organizations o
                on o.id = m.organization_id and o.archived_at is null
              where m.user_id = u.id and m.archived_at is null))
        or (v_filter = 'premium' and exists (
              select 1 from public.subscription_entitlements e
              where e.user_id = u.id and e.status = 'subscribed'
                and (e.expires_at is null or e.expires_at > now())))
        or (v_filter = 'gratuit' and not exists (
              select 1 from public.subscription_entitlements e
              where e.user_id = u.id and e.status = 'subscribed'
                and (e.expires_at is null or e.expires_at > now())))
        or (v_filter = 'offert' and exists (
              select 1 from public.subscription_entitlements e
              where e.user_id = u.id and e.source = 'complimentary'))
        or (v_filter = 'actif' and u.last_sign_in_at >= now() - v_idle)
        or (v_filter = 'inactif' and (u.last_sign_in_at is null or u.last_sign_in_at < now() - v_idle))
        or (v_filter = 'banni' and u.banned_until > now())
      )
  ),
  counted as (select count(*) as n from base),
  page as (
    select * from base
    order by base.created_at desc, base.id
    offset (v_page - 1) * v_size
    limit v_size
  )
  select
    b.id,
    b.email,
    b.display_name,
    b.created_at,
    b.last_sign_in_at,
    b.banned_until,
    -- « Produit utilisé : Oasis Care Mobile / Pro / ou les deux »
    -- (spec p.8). On ne sait dire que la moitié de la phrase : la
    -- présence dans une organisation prouve l'usage de Pro, rien ne
    -- prouve l'usage de Mobile. Donc 'pro' ou INCONNU — jamais
    -- 'mobile' par défaut, qui serait une invention.
    -- Les quatre colonnes qui suivent ne comptent que les entreprises
    -- VIVANTES, comme le filtre ci-dessus et comme le KPI `pro_users` :
    -- une entreprise archivée a été effacée en douceur, elle ne
    -- rattache plus personne.
    case when exists (
      select 1 from public.organization_members m
      join public.business_organizations o
        on o.id = m.organization_id and o.archived_at is null
      where m.user_id = b.id and m.archived_at is null
    ) then 'pro' else null end::text,
    (select count(*) from public.organization_members m
      join public.business_organizations o
        on o.id = m.organization_id and o.archived_at is null
      where m.user_id = b.id and m.archived_at is null),
    (select array_agg(o.name order by o.name)
       from public.organization_members m
       join public.business_organizations o on o.id = m.organization_id
      where m.user_id = b.id and m.archived_at is null
        and o.archived_at is null),
    (select array_agg(distinct s.plan)
       from public.organization_members m
       join public.business_organizations o
         on o.id = m.organization_id and o.archived_at is null
       join public.organization_subscriptions s on s.organization_id = m.organization_id
      where m.user_id = b.id and m.archived_at is null),
    (select max(e.plan) from public.subscription_entitlements e
      where e.user_id = b.id and e.status = 'subscribed'
        and (e.expires_at is null or e.expires_at > now())),
    -- LE PIÈGE DE L'AUDIT, rendu visible plutôt que caché : les 25
    -- lignes de subscription_entitlements du compte propriétaire sont
    -- un ACCÈS OFFERT (0042, source='complimentary'), pas un
    -- abonnement payé. Sans cette colonne, l'écran compterait un
    -- abonné de plus.
    exists (select 1 from public.subscription_entitlements e
             where e.user_id = b.id and e.source = 'complimentary'),
    (select n from counted)
  from page b;
end;
$$;

-- ------------------------------------------------------------
-- 4.d admin_list_organizations(...) — PRO ORGANIZATIONS (spec p.9-11)
-- ------------------------------------------------------------
--
-- « Afficher principalement des nombres et statistiques. Ne pas
-- exposer automatiquement le contenu métier. » Chaque colonne d'usage
-- est donc un `count`, jamais une liste : on apprend qu'une entreprise
-- a 42 devis, on n'apprend rien de ces devis.
create or replace function public.admin_list_organizations(
  p_search text default null,
  p_filter text default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  organization_id uuid,
  name text,
  legal_name text,
  siret text,
  country text,
  business_type text,
  plan text,
  subscription_status text,
  member_count bigint,
  active_member_count bigint,
  seat_limit integer,
  disabled_module_count integer,
  crm_customer_count bigint,
  project_count bigint,
  quote_count bigint,
  invoice_count bigint,
  nursery_lot_count bigint,
  document_count bigint,
  garden_count bigint,
  plant_count bigint,
  ai_requests_this_month bigint,
  created_at timestamptz,
  last_audited_action_at timestamptz,
  archived_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
-- Même raison qu'au 4.c : `name`, `plan`, `created_at`… sont à la fois
-- des colonnes de sortie et des colonnes lues.
#variable_conflict use_column
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
  v_filter text := nullif(btrim(lower(coalesce(p_filter, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 50), 1), 200);
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_idle interval := interval '30 days';
  -- QUATRE CHIFFRES AU MINIMUM pour déclencher la recherche par SIRET.
  -- En dessous, le moindre chiffre égaré dans un nom ou une adresse
  -- e-mail — « owner2 » en contient un — ferait remonter toutes les
  -- entreprises immatriculées. Un SIRET fait quatorze chiffres, un
  -- SIREN neuf : quatre est déjà généreux.
  v_digits text := case
    when length(public.oasis_digits(coalesce(p_search, ''))) >= 4
      then public.oasis_digits(coalesce(p_search, ''))
    else ''
  end;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs de la plateforme Oasis Care.'
      using errcode = '42501';
  end if;
  if not public.platform_admin_can('platform.organizations.read') then
    raise exception 'Accès refusé : permission platform.organizations.read manquante.'
      using errcode = '42501';
  end if;

  if v_filter is not null and v_filter not in (
    'archivees', 'toutes', 'avec_abonnement', 'sans_abonnement'
  ) then
    raise exception 'Filtre inconnu : « % ». Attendu : archivees, toutes, avec_abonnement, sans_abonnement.', v_filter
      using errcode = '22023';
  end if;

  return query
  with base as (
    select o.*
    from public.business_organizations o
    where (
        -- Par défaut on montre les entreprises vivantes.
        -- `archived_at` est un effacement doux : sans ce filtre le
        -- compteur ne baisse jamais.
        case
          when v_filter = 'archivees' then o.archived_at is not null
          when v_filter = 'toutes' then true
          else o.archived_at is null
        end
      )
      and (
        v_filter is null
        or v_filter in ('archivees', 'toutes')
        or (v_filter = 'avec_abonnement' and exists (
              select 1 from public.organization_subscriptions s where s.organization_id = o.id))
        or (v_filter = 'sans_abonnement' and not exists (
              select 1 from public.organization_subscriptions s where s.organization_id = o.id))
      )
      and (
        v_q is null
        or o.name ilike '%' || v_q || '%'
        or coalesce(o.legal_name, '') ilike '%' || v_q || '%'
        or coalesce(o.trade_name, '') ilike '%' || v_q || '%'
        -- SIRET : on compare les CHIFFRES SEULS, comme le fait déjà la
        -- recherche globale de 0061 pour les téléphones. « 123 456 789 »
        -- et « 123456789 » désignent la même entreprise.
        or (v_digits <> ''
            and public.oasis_digits(coalesce(o.siret, '')) like '%' || v_digits || '%')
        or o.id::text = v_q
      )
  ),
  counted as (select count(*) as n from base),
  page as (
    select * from base
    order by base.created_at desc, base.id
    offset (v_page - 1) * v_size
    limit v_size
  )
  select
    o.id,
    o.name,
    o.legal_name,
    o.siret,
    o.country,
    o.business_type,
    s.plan,
    s.status,
    -- Les comptes effacés en douceur sont exclus des DEUX compteurs :
    -- l'effacement Supabase pose `deleted_at` sans supprimer la ligne,
    -- donc le `on delete cascade` de `organization_members` ne se
    -- déclenche jamais et un compte fermé resterait un « membre » —
    -- avec un décompte plus élevé que le total d'utilisateurs de la
    -- plateforme, qui lui les exclut.
    (select count(*) from public.organization_members m
       join auth.users u on u.id = m.user_id and u.deleted_at is null
      where m.organization_id = o.id and m.archived_at is null),
    -- « Nombre utilisateurs actifs » : membres dont la dernière
    -- connexion est récente. C'est un proxy de connexion, pas d'usage —
    -- rien dans cette base ne date un geste métier par utilisateur.
    (select count(*) from public.organization_members m
       join auth.users u on u.id = m.user_id and u.deleted_at is null
      where m.organization_id = o.id and m.archived_at is null
        and u.last_sign_in_at >= now() - v_idle),
    pl.max_users,
    coalesce(cardinality(o.disabled_modules), 0),
    (select count(*) from public.crm_customers c
      where c.organization_id = o.id and c.archived_at is null),
    (select count(*) from public.projects pr
      where pr.organization_id = o.id and pr.archived_at is null),
    (select count(*) from public.quotes q
      where q.organization_id = o.id and q.archived_at is null),
    (select count(*) from public.invoices i
      where i.organization_id = o.id and i.archived_at is null),
    (select count(*) from public.nursery_lots n
      where n.organization_id = o.id and n.archived_at is null),
    (select count(*) from public.documents d
      where d.organization_id = o.id),
    -- Jardins et plantes passent par l'espace de travail : ces tables
    -- sont partagées avec l'app iPhone et ne portent pas
    -- d'organization_id.
    (select count(*) from public.gardens g
      where g.workspace_id = o.workspace_id and g.deleted_at is null),
    (select count(*) from public.plants pt
      where pt.workspace_id = o.workspace_id and pt.deleted_at is null),
    (select u.used::bigint from public.ai_pro_usage u
      where u.organization_id = o.id and u.period = v_period),
    o.created_at,
    -- « Dernière activité » : le nom est prudent exprès. C'est la
    -- dernière action MÉTIER JOURNALISÉE (audit_events), donc NULL pour
    -- une entreprise qui travaille sans déclencher d'écriture auditée.
    -- Mieux vaut un inconnu franc qu'une date d'apparence exacte.
    (select max(a.occurred_at) from public.audit_events a
      where a.organization_id = o.id),
    o.archived_at,
    (select n from counted)
  from page o
  left join public.organization_subscriptions s on s.organization_id = o.id
  left join public.organization_plans pl on pl.key = s.plan;
end;
$$;

-- ------------------------------------------------------------
-- 4.e admin_global_search(...) — GLOBAL ADMIN SEARCH (spec p.33)
-- ------------------------------------------------------------
--
-- POURQUOI PAS `global_search()` (0061). Cette fonction-là est bornée à
-- UNE organisation : elle prend un `p_organization_id`, vérifie
-- `is_organization_member`, et filtre chaque branche dessus. C'est
-- exactement l'inverse du besoin ici — et la réutiliser en lui passant
-- les organisations une par une reviendrait à lui faire dire ce qu'elle
-- a été écrite pour refuser.
--
-- Ce qu'on cherche ici est d'une autre nature : des IDENTITÉS
-- (utilisateur, e-mail, entreprise, SIRET, identifiants), pas du
-- contenu métier. Aucune branche ne touche un devis, une facture ou une
-- plante.
create or replace function public.admin_global_search(
  p_query text,
  p_limit integer default 10
)
returns table (
  result_type text,
  result_id uuid,
  title text,
  subtitle text,
  matched_on text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  -- Quatre chiffres au minimum, pour la même raison qu'au 4.d : sans ce
  -- seuil, chercher « cc-owner2@… » remonterait toutes les entreprises
  -- dont le SIRET contient un « 2 », c'est-à-dire presque toutes.
  v_digits text := case
    when length(public.oasis_digits(coalesce(p_query, ''))) >= 4
      then public.oasis_digits(coalesce(p_query, ''))
    else ''
  end;
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  v_uuid uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs de la plateforme Oasis Care.'
      using errcode = '42501';
  end if;
  if not public.platform_admin_can('platform.search') then
    raise exception 'Accès refusé : permission platform.search manquante.'
      using errcode = '42501';
  end if;

  -- Deux caractères au minimum, comme la recherche de 0061 : en
  -- dessous, la requête balaierait tout pour ne rien dire d'utile.
  if v_q is null or length(v_q) < 2 then
    return;
  end if;

  -- Un identifiant exact est une recherche à part : on ne le passe pas
  -- dans un `ilike`.
  begin
    v_uuid := v_q::uuid;
  exception when others then
    v_uuid := null;
  end;

  -- Les utilisateurs, si et seulement si l'appelant a le droit de les
  -- lister. Une recherche qui rendrait ce qu'une liste refuse serait
  -- une porte dérobée dans le moindre privilège.
  if public.platform_admin_can('platform.users.read') then
    return query
    select 'user'::text,
           u.id,
           coalesce(nullif(btrim(p.display_name), ''), u.email::text),
           u.email::text,
           case when v_uuid is not null and u.id = v_uuid then 'identifiant'
                when u.email ilike '%' || v_q || '%' then 'email'
                else 'nom' end::text
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.deleted_at is null
      and (
        (v_uuid is not null and u.id = v_uuid)
        or u.email ilike '%' || v_q || '%'
        or coalesce(p.display_name, '') ilike '%' || v_q || '%'
      )
    order by u.created_at desc
    limit v_limit;
  end if;

  if public.platform_admin_can('platform.organizations.read') then
    return query
    select 'organization'::text,
           o.id,
           o.name,
           nullif(concat_ws(' · ', o.legal_name, o.siret, o.city), ''),
           case when v_uuid is not null and o.id = v_uuid then 'identifiant'
                when v_digits <> '' and public.oasis_digits(coalesce(o.siret, '')) like '%' || v_digits || '%' then 'siret'
                when v_digits <> '' and public.oasis_digits(coalesce(o.siren, '')) like '%' || v_digits || '%' then 'siren'
                when v_digits <> '' and public.oasis_digits(coalesce(o.vat_number, '')) like '%' || v_digits || '%' then 'tva'
                else 'nom' end::text
    from public.business_organizations o
    where (v_uuid is not null and o.id = v_uuid)
       or o.name ilike '%' || v_q || '%'
       or coalesce(o.legal_name, '') ilike '%' || v_q || '%'
       or coalesce(o.trade_name, '') ilike '%' || v_q || '%'
       or (v_digits <> '' and public.oasis_digits(coalesce(o.siret, '')) like '%' || v_digits || '%')
       or (v_digits <> '' and public.oasis_digits(coalesce(o.siren, '')) like '%' || v_digits || '%')
       or (v_digits <> '' and public.oasis_digits(coalesce(o.vat_number, '')) like '%' || v_digits || '%')
    order by o.created_at desc
    limit v_limit;
  end if;
end;
$$;

-- ============================================================
-- 5. LES DROITS
-- ============================================================
--
-- LA LEÇON DE 0057, APPLIQUÉE D'AVANCE. Supabase accorde par défaut
-- tous les droits sur un objet créé dans `public` à `anon` et
-- `authenticated`, et une fonction est par défaut exécutable par
-- `public`. Sur une fonction `security definer`, ce défaut est une
-- porte ouverte : la clause de garde est le seul filtre, et un objet
-- dont on a oublié de retirer les droits n'a plus de filtre du tout.
--
-- On retire donc tout, à `public` d'abord — un droit accordé au
-- pseudo-rôle `public` est hérité par tout le monde et survivrait au
-- retrait des deux autres — puis on rend le strict nécessaire.

do $$
declare
  t text;
begin
  foreach t in array array[
    'platform_admins',
    'platform_admin_permissions',
    'platform_admin_role_permissions',
    'admin_audit_events'
  ]
  loop
    execute format('revoke all on public.%I from public', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    -- `select` seulement, et la RLS filtre derrière. Aucune écriture
    -- n'est possible depuis un jeton, quel qu'il soit : ni promotion,
    -- ni révocation, ni ligne de journal fabriquée à la main.
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.is_platform_admin()',
    'public.platform_admin_can(text)',
    'public.admin_me()',
    'public.record_admin_event(text, text, uuid, text, jsonb, jsonb, text, inet, text, jsonb)',
    'public.admin_platform_kpis()',
    'public.admin_live_activity(timestamptz)',
    'public.admin_list_users(text, text, integer, integer)',
    'public.admin_list_organizations(text, text, integer, integer)',
    'public.admin_global_search(text, integer)'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    -- On rend l'`execute` à `authenticated`, et à lui seul de façon
    -- explicite.
    --
    -- PRÉCISION QUI ÉVITE UNE FAUSSE CONFIANCE : `service_role` en
    -- conserve un, hérité du défaut de Supabase sur toute fonction
    -- créée dans `public`. Le retirer serait cosmétique — vérifié en
    -- transaction annulée, `service_role` SANS jeton reçoit 42501 sur
    -- `admin_platform_kpis()`, `admin_list_users()` et
    -- `record_admin_event()`, parce que `auth.uid()` y est nul. C'est
    -- le contrôle d'identité À L'INTÉRIEUR de la fonction qui refuse,
    -- pas le droit d'exécution. Posséder la clé n'est pas être
    -- autorisé.
    --
    -- Et le contrôle réel est bien celui-là : ces fonctions LÈVENT,
    -- elles ne rendent pas une liste vide — une liste vide se
    -- confondrait avec « aucune donnée ».
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Le déclencheur de la matrice n'est appelé par personne directement :
-- il n'a aucune raison d'être exécutable.
revoke all on function public.platform_admin_matrix_guard() from public;
revoke all on function public.platform_admin_matrix_guard() from anon;
revoke all on function public.platform_admin_matrix_guard() from authenticated;

-- ============================================================
-- 6. LE PREMIER ADMINISTRATEUR
-- ============================================================
--
-- Il n'est PAS semé ici, et c'est un choix. Une migration qui
-- promeuvrait une adresse e-mail en super-administrateur ferait de ce
-- fichier — versionné, relu, copié — le lieu où se décide qui gouverne
-- la plateforme. Et rejouée sur un autre environnement, elle y
-- ouvrirait le même accès.
--
-- Le premier administrateur se pose à la main, une fois, dans
-- l'éditeur SQL du projet, par quelqu'un qui a déjà les clés :
--
--   insert into public.platform_admins (user_id, role, note)
--   select id, 'super_admin', 'Premier administrateur, posé à la main.'
--   from auth.users where email = '<adresse>';
--
-- Les suivants seront créés par un super-administrateur, depuis le
-- backend en `service_role`, et l'opération sera journalisée par
-- `record_admin_event('platformAdmin.created', 'platform_admin', …)`
-- avec son motif.
