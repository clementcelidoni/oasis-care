-- Oasis Care — OASIS CONTROL CENTER, jalon 2 : L'ARGENT, L'ÉQUIPE ET
-- L'ASSISTANCE.
--
-- À exécuter après 0080. IDEMPOTENTE et ADDITIVE : aucune colonne
-- existante n'est supprimée ni changée de type, aucune fonction du
-- produit n'est réécrite. Trois exceptions, toutes assumées et toutes
-- justifiées à l'endroit où elles arrivent :
--
--   • la politique d'écriture « Admins change their subscription » de
--     `organization_subscriptions` (0060) est RETIRÉE — c'est une faille
--     ouverte, § 5.a ;
--   • `platform_admin_matrix_guard()` est remplacée, comme 0080 l'a
--     fait, pour couvrir les préfixes que ce fichier introduit — et
--     surtout `platform.%`, que personne ne couvrait, § 1.b ;
--   • les lignes d'`organization_plans` reçoivent enfin un nom, un prix
--     et une place dans la grille, § 4.f.
--
-- ============================================================
-- CE QUE CE FICHIER FAIT EXISTER, ET DANS QUEL ORDRE
-- ============================================================
--
--   1. Le vocabulaire des droits : les permissions neuves, le garde-fou
--      de la matrice étendu, et le semis qui les rend réellement
--      portées.
--   2. Le second facteur : savoir qui en a un, et pouvoir l'exiger sans
--      enfermer dehors celui qui n'en a pas encore.
--   3. L'équipe Oasis Care : nommer, changer de rôle, révoquer, inviter.
--   4. La grille tarifaire : prix mensuels et annuels, cycle, sièges,
--      remise datée, et la MATRICE offre × module.
--   5. Les abonnements Pro, administrés à la main, avec leur historique.
--   6. La facturation SaaS d'Oasis Care à ses entreprises clientes :
--      numérotation séquentielle sans trou, TVA par régime, émission,
--      encaissement manuel, avoir, génération idempotente.
--   7. Les drapeaux de fonctionnalité, dont la table existe déjà.
--   8. Le support : tickets, et sessions d'assistance qui EXPIRENT.
--   9. Les droits.
--
-- ============================================================
-- CE QUE CE FICHIER NE FAIT PAS, ET POURQUOI
-- ============================================================
--
-- AUCUN APPEL À UN PRESTATAIRE DE PAIEMENT. Pas de clé, pas de webhook,
-- pas de bouton « payer en ligne ». Le schéma est écrit en SACHANT que
-- le prestataire arrive au chantier suivant : une facture porte un
-- moyen de règlement et une RÉFÉRENCE EXTERNE nullable, qui restera
-- vide jusque-là. Quelques octets aujourd'hui contre une migration
-- pénible plus tard sur une table de documents comptables.
--
-- ET LA DÉCISION D'ARCHITECTURE QUI COMMANDE TOUT LE § 6 : le
-- prestataire ENCAISSERA, Oasis Care FACTURE. Les factures que le
-- prestataire produit pour ses propres besoins ne sont pas le document
-- légal. Il n'existe donc ici QU'UNE SEULE numérotation, celle de ce
-- fichier. Rien n'est écrit qui supposerait l'inverse.
--
-- AUCUNE FACTURE CÔTÉ MOBILE. Apple encaisse, Apple facture, Apple
-- rembourse. En construire une seconde serait facturer deux fois, et
-- les conditions de l'App Store l'interdisent. Le Control Center se
-- contente d'AFFICHER ce qu'Apple rapporte, et rien de ce fichier ne
-- touche à `subscription_events` ni à `subscription_entitlements`.
--
-- AUCUN PLANIFICATEUR. `saas_generate_invoices()` existe et elle est
-- idempotente ; personne ne l'appelle encore. Le déclenchement viendra
-- avec le chantier suivant.
--
-- ============================================================
-- LES DEUX FAILLES QUE CE FICHIER REFERME
-- ============================================================
--
-- 1. UN PROPRIÉTAIRE D'ENTREPRISE CLIENTE POUVAIT CHANGER SON PROPRE
--    ABONNEMENT. Vérifié en base : `organization_subscriptions` porte
--    une politique « Admins change their subscription » en `cmd = ALL`,
--    dont le prédicat est `has_permission(organization_id,
--    'organization.manageUsers')` — c'est-à-dire tout `owner` ou
--    `admin` d'entreprise cliente. Aucun encaissement n'existant, nul
--    n'en a profité ; mais ce fichier POSE LES PRIX, et le jour même où
--    ils existent, un client peut se mettre en offre supérieure sans
--    rien payer. On ne crée pas une valeur pour la laisser voler : la
--    politique part au § 5.a.
--
-- 2. LE GARDE-FOU DE LA MATRICE NE CONNAISSAIT PAS `platform.%`.
--    Sondé sur la vraie fonction, en transaction annulée :
--    ('support', 'platform.admins.manage') était ACCEPTÉ, et
--    ('security_admin', 'platform.admins.manage') aussi. Autrement dit,
--    le droit de CRÉER ET RÉVOQUER DES ADMINISTRATEURS pouvait être
--    accordé à n'importe quel rôle sans qu'aucune barrière ne proteste —
--    et c'est exactement le droit qui commande l'écran « Équipe » que ce
--    fichier construit. Étendu au § 1.b, testé dans
--    `supabase/tests/control_center_suite.sql`.
--
-- ============================================================
-- LA RÈGLE QUI TRAVERSE TOUT LE FICHIER
-- ============================================================
--
-- Aucune politique d'écriture sur les tables administratives. Le seul
-- chemin est une FONCTION `security definer` dont les premières lignes
-- refusent l'appelant, qui exige un MOTIF non vide, et qui rend
-- l'identifiant de sa ligne de journal. Si la journalisation échoue,
-- l'écriture est annulée avec elle : il n'existe pas d'état « changé
-- mais non tracé ». C'est le modèle de 0075 § 3 et de 0080 § 5, et on
-- ne l'invente pas une seconde fois.
--
-- Et `set search_path = public, pg_temp`, `pg_temp` nommé EN DERNIER,
-- sur chaque fonction `security definer` : sans cela, un appelant qui
-- crée une table temporaire homonyme détourne la fonction.

-- ============================================================
-- 1. LE VOCABULAIRE DES DROITS
-- ============================================================

-- ------------------------------------------------------------
-- 1.a Les permissions neuves
-- ------------------------------------------------------------
-- Pourquoi autant de clés plutôt qu'une « billing.manage » : lire une
-- grille tarifaire, la changer, émettre un document comptable et
-- encaisser ne sont pas le même geste et n'engagent pas la même
-- responsabilité. Une permission unique ferait de tout lecteur un
-- ordonnateur.

insert into public.platform_admin_permissions (key, label, is_write) values
  ('billing.plans.read',      'Voir la grille tarifaire et la matrice des modules',        false),
  ('billing.plans.write',     'Fixer les prix, les remises et la matrice des modules',     true),
  ('billing.invoices.read',   'Lire les factures d''abonnement émises par Oasis Care',     false),
  ('billing.invoices.write',  'Créer, émettre, encaisser, annuler une facture SaaS',       true),
  -- L'identité légale de l'ÉMETTEUR — Oasis Care lui-même — n'est pas
  -- un réglage de facturation : c'est ce qui rend le document opposable.
  -- Elle reste au super-administrateur (§ 1.b).
  ('billing.issuer.write',    'Modifier l''identité légale et le RIB de l''émetteur',      true),
  -- LE PRESTATAIRE D'ENCAISSEMENT. Ces deux clés sont semées ICI et non
  -- dans la migration qui construira Stripe, parce que le catalogue
  -- TypeScript de web-admin/lib/auth/roles.ts les déclare DÉJÀ, et
  -- qu'un test compare les deux listes. Les laisser à plus tard rendrait
  -- ce test rouge entre les deux migrations — c'est-à-dire pendant
  -- exactement le laps où quelqu'un exécute la première et se demande
  -- ce qu'il a cassé. Une permission qu'aucune politique n'invoque
  -- encore ne fait rien du tout : le coût est nul, la cohérence est
  -- immédiate, et la migration Stripe les repose « on conflict do
  -- nothing » sans conséquence.
  ('billing.providers.read',  'Voir la correspondance des tarifs et le journal du prestataire', false),
  ('billing.providers.write', 'Enregistrer une correspondance de tarif et régler le mode d''encaissement', true),
  ('support.tickets.read',    'Lire les demandes d''assistance',                           false),
  ('support.tickets.write',   'Répondre, assigner, clore une demande d''assistance',       true),
  ('support.sessions.read',   'Voir les sessions d''assistance et leur journal d''accès',  false),
  ('support.sessions.manage', 'Ouvrir et révoquer une session d''assistance',              true),
  ('product.flags.read',      'Voir les drapeaux de fonctionnalité',                       false),
  ('product.flags.write',     'Basculer un drapeau de fonctionnalité',                     true),
  ('platform.security.write', 'Régler la politique de second facteur des administrateurs', true)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 1.b LE GARDE-FOU DE LA MATRICE, ÉTENDU
-- ------------------------------------------------------------
-- 0075 § 1.c pose la doctrine : le moindre privilège s'écrit DEUX FOIS,
-- par l'absence de la ligne dans la matrice et par un déclencheur qui
-- refuse de l'y insérer — « une absence peut être comblée par
-- distraction dans six mois, un refus doit être supprimé exprès ».
--
-- Les sept règles de 0075 et 0080 sont RECOPIÉES MOT POUR MOT ; ce
-- fichier en ajoute six. La plus importante est la première : jusqu'ici
-- le garde-fou ne raisonnait que sur `billing.%`, `customer.%` et
-- `ai.%`. Le préfixe `platform.%` — celui qui contient le droit de
-- nommer et de révoquer des administrateurs — n'était couvert par RIEN.

create or replace function public.platform_admin_matrix_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_is_write boolean;
begin
  -- ---- LE RETRAIT, qui manquait ------------------------------------
  -- Le garde-fou ne surveillait que l'INSERT et l'UPDATE. Un
  -- `delete from platform_admin_role_permissions where role =
  -- 'super_admin' and permission = 'platform.admins.manage'` passait
  -- donc — et après lui, plus personne, super-administrateur compris,
  -- ne pouvait nommer ni révoquer un administrateur. Aucune fonction de
  -- ce fichier ne sait reposer cette ligne : la plateforme serait
  -- inadministrable, sans message d'erreur pour l'expliquer.
  --
  -- On ne surveille QUE cette ligne-là au retrait. Retirer une autre
  -- permission à un rôle est un geste légitime de resserrement ;
  -- retirer celle-ci est un suicide administratif.
  if tg_op = 'DELETE' then
    if old.role = 'super_admin' and old.permission = 'platform.admins.manage' then
      raise exception 'Retrait refusé : sans (super_admin, platform.admins.manage), plus personne ne peut nommer ni révoquer un administrateur, et aucune fonction ne sait reposer cette ligne.'
        using errcode = '23514';
    end if;
    return old;
  end if;

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
  -- Écrite pour quatre rôles et non pour le seul `billing_admin` : le
  -- défaut voulu est l'inverse d'une liste d'exclusions.
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

  -- ---- 0080 : les réglages IA de l'éditeur ------------------------
  if v_is_write and new.permission like 'ai.%'
     and new.role not in ('super_admin', 'product_admin', 'billing_admin') then
    raise exception 'Moindre privilège : le rôle « % » ne règle pas l''IA de la plateforme — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  if new.role = 'billing_admin' and v_is_write and new.permission like 'ai.model%' then
    raise exception 'Séparation des pouvoirs : la facturation ne choisit pas le modèle des agents — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  if new.role = 'product_admin' and v_is_write and new.permission like 'ai.cost%' then
    raise exception 'Séparation des pouvoirs : le produit ne lève pas les plafonds de dépense IA — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  -- ---- Neuf en 0081 -----------------------------------------------
  --
  -- a) LE TROU QUE CE FICHIER REFERME. Aucun préfixe `platform.%`
  --    n'était surveillé : ('support', 'platform.admins.manage')
  --    passait, et ('security_admin', 'platform.admins.manage') aussi.
  --    Un droit d'écriture sur la plateforme elle-même n'appartient
  --    qu'à deux rôles — celui qui gouverne, et celui qui répond de la
  --    sécurité.
  if v_is_write and new.permission like 'platform.%'
     and new.role not in ('super_admin', 'security_admin') then
    raise exception 'Moindre privilège : le rôle « % » n''écrit rien sur la plateforme elle-même — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  -- b) Et parmi celles-là, NOMMER OU RÉVOQUER UN ADMINISTRATEUR est la
  --    seule qui puisse fabriquer un autre administrateur. Elle
  --    n'appartient qu'au super-administrateur : un responsable
  --    sécurité qui pourrait se nommer un complice n'aurait plus
  --    personne au-dessus de lui.
  if new.permission = 'platform.admins.manage' and new.role <> 'super_admin' then
    raise exception 'Seul le super-administrateur nomme et révoque des administrateurs — permission % refusée pour le rôle « % ».', new.permission, new.role
      using errcode = '23514';
  end if;

  -- c) L'argent, en liste blanche plutôt qu'en liste d'exclusions. Les
  --    deux règles de la spec p.30 recopiées plus haut nommaient
  --    `support` et `product_admin` ; elles laissaient passer
  --    `security_admin`. On renverse le défaut : personne n'écrit sur
  --    la facturation, sauf ceux dont c'est le métier.
  if v_is_write and new.permission like 'billing.%'
     and new.role not in ('super_admin', 'billing_admin') then
    raise exception 'Moindre privilège : le rôle « % » n''écrit rien sur la facturation — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  -- d) L'identité légale de l'émetteur engage Oasis Care devant
  --    l'administration fiscale. Un SIRET ou un IBAN changé par erreur
  --    ne se rattrape pas sur une facture déjà partie.
  if v_is_write and new.permission like 'billing.issuer%' and new.role <> 'super_admin' then
    raise exception 'Seul le super-administrateur modifie l''identité légale de l''émetteur — permission % refusée pour le rôle « % ».', new.permission, new.role
      using errcode = '23514';
  end if;

  -- e) L'assistance et le produit : chacun chez soi. La règle vise le
  --    PRÉFIXE et `is_write`, donc elle couvrira les permissions
  --    `support.*` et `product.*` qui n'existent pas encore.
  if v_is_write and new.permission like 'support.%'
     and new.role not in ('super_admin', 'support') then
    raise exception 'Moindre privilège : le rôle « % » ne conduit pas l''assistance — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;

  if v_is_write and new.permission like 'product.%'
     and new.role not in ('super_admin', 'product_admin') then
    raise exception 'Moindre privilège : le rôle « % » ne règle pas le produit — permission % refusée.', new.role, new.permission
      using errcode = '23514';
  end if;
  -- -----------------------------------------------------------------

  -- Un analyste en lecture seule qui écrirait quelque chose ne serait
  -- plus en lecture seule. La règle ne vise aucune permission
  -- particulière : elle vise la colonne `is_write`.
  if new.role = 'read_only_analyst' and v_is_write then
    raise exception 'Un analyste en lecture seule n''écrit rien — permission % refusée.', new.permission
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists platform_admin_matrix_guard on public.platform_admin_role_permissions;
create trigger platform_admin_matrix_guard
  before insert or update or delete on public.platform_admin_role_permissions
  for each row execute function public.platform_admin_matrix_guard();

revoke all on function public.platform_admin_matrix_guard() from public;
revoke all on function public.platform_admin_matrix_guard() from anon;
revoke all on function public.platform_admin_matrix_guard() from authenticated;

-- ------------------------------------------------------------
-- 1.b bis ON NE TRONQUE NI LA MATRICE, NI LA LISTE DES ADMINISTRATEURS
-- ------------------------------------------------------------
-- `truncate` ne déclenche AUCUN déclencheur `for each row` : le
-- garde-fou ci-dessus, et celui du § 3 qui protège le dernier
-- super-administrateur, le laissent passer sans un mot. Un
-- `truncate public.platform_admins` vide donc la table, et il ne reste
-- plus un seul administrateur — le désastre exact que le § 3 prétend
-- rendre impossible.
--
-- Un déclencheur d'INSTRUCTION `before truncate` ferme cette porte. Il
-- ne laisse aucune exception : on ne tronque jamais ces deux tables, et
-- s'il fallait vraiment le faire un jour, il faudra désactiver le
-- déclencheur — c'est-à-dire le faire exprès, et pas en croyant
-- nettoyer.
create or replace function public.refuse_truncate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'On ne tronque pas « % » : cette table porte les droits d''administration de la plateforme. Supprimez ligne à ligne, sous les garde-fous.', tg_table_name
    using errcode = '23514';
end;
$$;

drop trigger if exists platform_admins_no_truncate on public.platform_admins;
create trigger platform_admins_no_truncate
  before truncate on public.platform_admins
  for each statement execute function public.refuse_truncate();

drop trigger if exists platform_admin_role_permissions_no_truncate on public.platform_admin_role_permissions;
create trigger platform_admin_role_permissions_no_truncate
  before truncate on public.platform_admin_role_permissions
  for each statement execute function public.refuse_truncate();

revoke all on function public.refuse_truncate() from public;
revoke all on function public.refuse_truncate() from anon;
revoke all on function public.refuse_truncate() from authenticated;

-- ------------------------------------------------------------
-- 1.c LE SEMIS — et le piège qu'il évite
-- ------------------------------------------------------------
-- LE PIÈGE, VÉRIFIÉ DEUX FOIS DANS L'HISTOIRE DE CE PROJET :
-- `super_admin` a été semé en 0075 PAR JOINTURE sur le catalogue, au
-- moment où 0075 s'exécutait. Une permission ajoutée après coup n'est
-- donc portée par PERSONNE — pas même par le super-administrateur — et
-- l'écran correspondant disparaît simplement du menu, sans erreur.
-- 0080 a rejoué la jointure ; on la rejoue encore.

insert into public.platform_admin_role_permissions (role, permission)
select 'super_admin', key from public.platform_admin_permissions
on conflict do nothing;

-- billing_admin : la grille, les factures, l'encaissement. PAS
-- l'identité légale de l'émetteur (le garde-fou la lui refuserait de
-- toute façon).
insert into public.platform_admin_role_permissions (role, permission) values
  ('billing_admin', 'billing.plans.read'),
  ('billing_admin', 'billing.plans.write'),
  ('billing_admin', 'billing.invoices.read'),
  ('billing_admin', 'billing.invoices.write')
on conflict do nothing;

-- support : conduit l'assistance, et LIT ce qu'il doit pouvoir
-- expliquer au client — sa grille tarifaire, ses factures. Il n'écrit
-- ni l'une ni les autres.
insert into public.platform_admin_role_permissions (role, permission) values
  ('support', 'support.tickets.read'),
  ('support', 'support.tickets.write'),
  ('support', 'support.sessions.read'),
  ('support', 'support.sessions.manage'),
  ('support', 'billing.plans.read'),
  ('support', 'billing.invoices.read')
on conflict do nothing;

-- product_admin : les drapeaux, et la grille en lecture — un prix est
-- une décision produit autant que commerciale, mais il ne la prend pas.
insert into public.platform_admin_role_permissions (role, permission) values
  ('product_admin', 'product.flags.read'),
  ('product_admin', 'product.flags.write'),
  ('product_admin', 'billing.plans.read')
on conflict do nothing;

-- security_admin : la politique de second facteur, et la SURVEILLANCE
-- des sessions d'assistance — voir qui a ouvert quoi chez qui. Il n'en
-- ouvre aucune : surveiller et faire ne sont pas le même rôle.
insert into public.platform_admin_role_permissions (role, permission) values
  ('security_admin', 'platform.security.write'),
  ('security_admin', 'support.sessions.read')
on conflict do nothing;

-- `read_only_analyst` ne reçoit RIEN de ce fichier. Les chiffres qu'il
-- lit passent par les fonctions de tableau de bord de 0075, qui ne
-- demandent que `platform.dashboard.read`.

-- ============================================================
-- 2. LE SECOND FACTEUR
-- ============================================================
--
-- CE QUE LA BASE PEUT ET NE PEUT PAS FAIRE, et il faut être précis
-- parce que la moitié du sujet vit ailleurs :
--
--   • L'ENRÔLEMENT lui-même — le QR code, le secret, la vérification du
--     code à six chiffres — appartient au service Auth de Supabase et
--     n'est atteignable que par le SDK (`mfa.enroll`,
--     `mfa.challengeAndVerify`). AUCUNE ligne de SQL ne peut créer un
--     facteur, et il serait dangereux de faire semblant.
--   • CE QUE LA BASE PEUT FAIRE, elle seule : dire si un administrateur
--     a réellement un facteur VÉRIFIÉ (`auth.mfa_factors`), porter la
--     politique — exigé ou non, à partir de quelle date — et surtout
--     REFUSER LES ÉCRITURES ADMINISTRATIVES quand la session en cours
--     n'est pas de niveau `aal2`.
--
-- LE NIVEAU DE LA SESSION SE LIT DANS LE JETON, PAS DANS LE NAVIGATEUR.
-- PostgREST place les revendications du JWT — déjà VÉRIFIÉES par la
-- passerelle — dans `request.jwt.claims`, et le niveau d'assurance y
-- figure sous la clé `aal`. C'est une preuve serveur : une page qui
-- afficherait « second facteur validé » sans que le jeton le dise ne
-- tromperait que l'écran, pas ces fonctions.
--
-- LA RÈGLE À NE PAS ENFREINDRE, et elle est structurelle :
-- ON NE FERME JAMAIS LA LECTURE. Un administrateur sans facteur doit
-- pouvoir entrer pour en poser un — sinon le premier basculement de la
-- politique enferme dehors l'unique administrateur existant, et la
-- seule sortie est une modification de variable d'environnement suivie
-- d'un redéploiement. Ce sont donc les ÉCRITURES, et elles seules, qui
-- sont conditionnées : il peut entrer, regarder, s'enrôler, et rien de
-- plus.

create table if not exists public.platform_security_settings (
  -- Table à une seule ligne. La contrainte `check (id)` est ce qui
  -- garantit qu'il n'y en aura jamais deux : un second réglage
  -- contradictoire serait pire que pas de réglage du tout.
  id boolean primary key default true check (id),

  mfa_required boolean not null default false,

  -- La date à partir de laquelle l'exigence mord. Elle sert de délai de
  -- grâce : on peut annoncer l'exigence avant de la faire s'appliquer,
  -- ce qui laisse à l'équipe le temps de s'enrôler. NULL = tout de
  -- suite.
  mfa_required_from timestamptz,

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  constraint platform_security_settings_grace_coherent
    check (mfa_required or mfa_required_from is null)
);

-- La ligne existe dès l'installation, avec l'exigence à FAUX. Poser
-- l'exigence en même temps que le mécanisme reviendrait à fermer la
-- porte avant d'avoir distribué les clés.
insert into public.platform_security_settings (id, mfa_required)
values (true, false)
on conflict (id) do nothing;

alter table public.platform_security_settings enable row level security;

drop policy if exists "Les administrateurs lisent la politique de second facteur" on public.platform_security_settings;
create policy "Les administrateurs lisent la politique de second facteur" on public.platform_security_settings
  for select using (public.is_platform_admin());

-- AUCUNE politique d'écriture : `admin_set_mfa_policy()` est le seul
-- chemin, et elle journalise.

-- ------------------------------------------------------------
-- 2.a Lire le niveau d'assurance de la session en cours
-- ------------------------------------------------------------
-- Isolée dans sa propre fonction pour une raison : `current_setting()`
-- rend une chaîne vide hors PostgREST (dans l'éditeur SQL, dans un test,
-- dans un traitement planifié) et le `::jsonb` lèverait. Une exception
-- ici ferait échouer une écriture pour une raison qui n'a rien à voir
-- avec la sécurité.
create or replace function public.auth_assurance_level()
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_claims jsonb;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return null;
  end;
  return v_claims ->> 'aal';
end;
$$;

comment on function public.auth_assurance_level() is
  'Le niveau d''assurance (aal1 / aal2) du JETON en cours, tel que la passerelle l''a vérifié. '
  'NULL hors d''une requête authentifiée par PostgREST — ce qui compte comme « pas aal2 ».';

-- ------------------------------------------------------------
-- 2.b L'état du second facteur, pour l'écran d'enrôlement
-- ------------------------------------------------------------
-- `security definer` parce que `auth.mfa_factors` est fermée à
-- `authenticated` : sans cela l'écran ne saurait pas distinguer « aucun
-- facteur » de « je n'ai pas le droit de regarder ».
--
-- Ne rend JAMAIS le secret ni l'URI du facteur — le SDK les affiche une
-- fois, à l'enrôlement, et ils n'ont rien à faire dans une réponse SQL.
create or replace function public.platform_admin_mfa_state()
returns table (
  is_admin boolean,
  policy_required boolean,
  required_from timestamptz,
  policy_in_force boolean,
  verified_factors integer,
  unverified_factors integer,
  current_level text,
  satisfied boolean,
  writes_blocked boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin boolean := public.is_platform_admin();
  v_required boolean;
  v_from timestamptz;
  v_in_force boolean;
  v_verified integer;
  v_unverified integer;
  v_level text := public.auth_assurance_level();
begin
  if not v_admin then
    raise exception 'Accès refusé : réservé aux administrateurs de la plateforme Oasis Care.'
      using errcode = '42501';
  end if;

  select s.mfa_required, s.mfa_required_from
    into v_required, v_from
  from public.platform_security_settings s where s.id;

  v_in_force := coalesce(v_required, false) and (v_from is null or now() >= v_from);

  select count(*) filter (where f.status = 'verified'),
         count(*) filter (where f.status <> 'verified')
    into v_verified, v_unverified
  from auth.mfa_factors f
  where f.user_id = auth.uid();

  return query select
    v_admin,
    coalesce(v_required, false),
    v_from,
    v_in_force,
    v_verified,
    v_unverified,
    v_level,
    -- « Satisfait » demande LES DEUX : un facteur posé ET une session
    -- qui l'a réellement présenté. Un facteur enrôlé puis jamais
    -- rechallengé laisse la session en `aal1`, et c'est exactement le
    -- cas qu'un contrôle naïf laisserait passer.
    (v_verified > 0 and v_level = 'aal2'),
    (v_in_force and not (v_verified > 0 and v_level = 'aal2'));
end;
$$;

-- ------------------------------------------------------------
-- 2.c Le cran, appelé par toutes les écritures de ce fichier
-- ------------------------------------------------------------
create or replace function public.platform_admin_mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not (
    exists (
      select 1 from public.platform_security_settings s
      where s.id
        and s.mfa_required
        and (s.mfa_required_from is null or now() >= s.mfa_required_from)
    )
    and not (
      exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      )
      and public.auth_assurance_level() = 'aal2'
    )
  );
$$;

create or replace function public.platform_admin_require_mfa()
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if not public.platform_admin_mfa_satisfied() then
    -- Le message dit quoi faire, pas seulement que c'est refusé : la
    -- personne est déjà connectée et n'a aucune raison de deviner que
    -- son problème est un second facteur.
    raise exception 'Second facteur exigé : cette action administrative demande une session vérifiée en second facteur. Enrôlez une application d''authentification, puis reconnectez-vous — la LECTURE du Control Center reste ouverte pour cela.'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.platform_admin_require_mfa() is
  'Refuse une ÉCRITURE administrative quand la politique exige le second facteur et que la session en cours ne le présente pas. '
  'N''est jamais appelée sur une lecture : un administrateur sans facteur doit pouvoir entrer pour en poser un.';

-- ------------------------------------------------------------
-- 2.d Régler la politique
-- ------------------------------------------------------------
create or replace function public.admin_set_mfa_policy(
  p_required boolean,
  p_required_from timestamptz,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_old jsonb;
begin
  if not public.platform_admin_can('platform.security.write') then
    raise exception 'Accès refusé : permission platform.security.write manquante.'
      using errcode = '42501';
  end if;

  -- ON N'EXIGE PAS LE SECOND FACTEUR ICI, et c'est délibéré : cette
  -- fonction est la seule sortie de secours si la politique a enfermé
  -- tout le monde dehors. La protéger par elle-même serait une porte
  -- fermée à clé de l'intérieur.
  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : exiger ou lever le second facteur change qui peut agir, cela se justifie.'
      using errcode = '23514';
  end if;

  if p_required is null then
    raise exception 'Exigence non renseignée : « peut-être » n''est pas une politique de sécurité.'
      using errcode = '23514';
  end if;

  select jsonb_build_object('required', s.mfa_required, 'from', s.mfa_required_from)
    into v_old
  from public.platform_security_settings s where s.id;

  insert into public.platform_security_settings (id, mfa_required, mfa_required_from, updated_at, updated_by)
  values (true, p_required, case when p_required then p_required_from else null end, now(), auth.uid())
  on conflict (id) do update
    set mfa_required = excluded.mfa_required,
        mfa_required_from = excluded.mfa_required_from,
        updated_at = now(),
        updated_by = excluded.updated_by;

  return public.record_admin_event(
    'security.mfaPolicyChanged', 'platform', null, 'Politique de second facteur',
    v_old,
    jsonb_build_object('required', p_required,
                       'from', case when p_required then p_required_from else null end),
    v_reason);
end;
$$;

-- ============================================================
-- 3. L'ÉQUIPE OASIS CARE
-- ============================================================
--
-- `platform_admins` n'a AUCUNE politique d'écriture, et 0075 l'a voulu
-- ainsi : sans `insert`, `update` ni `delete`, aucun porteur de jeton ne
-- peut se promouvoir, promouvoir un ami, ou se dé-révoquer depuis le
-- navigateur. On n'ouvre donc pas la table : on ajoute trois fonctions
-- `security definer`, réservées à `platform.admins.manage`, que le
-- garde-fou du § 1.b réserve maintenant au seul super-administrateur.
--
-- TROIS GARDE-FOUS, ET ILS SONT DOUBLÉS.
--
--   1. ON NE SE RÉVOQUE PAS SOI-MÊME. Se retirer son propre accès, c'est
--      se verrouiller dehors ; et si l'on est le dernier, c'est
--      verrouiller la plateforme entière.
--   2. LE DERNIER SUPER-ADMINISTRATEUR ACTIF NE PEUT ÊTRE NI RÉVOQUÉ NI
--      RÉTROGRADÉ. Sans lui, plus personne ne peut nommer qui que ce
--      soit : `platform.admins.manage` n'appartient qu'à ce rôle. La
--      plateforme deviendrait inadministrable, et la seule réparation
--      passerait par l'éditeur SQL du projet.
--   3. TOUT EST JOURNALISÉ, dans la même transaction que le geste.
--
-- « Doublés » veut dire : les fonctions refusent, ET un DÉCLENCHEUR
-- refuse. Les fonctions protègent l'usage normal ; le déclencheur
-- protège aussi l'`update` lancé à la main dans l'éditeur SQL, celui
-- qu'on tape un vendredi soir en croyant faire simple.

create or replace function public.platform_admins_last_super_admin_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_remaining integer;
begin
  -- ON NE SE RÉVOQUE PAS SOI-MÊME. `auth.uid()` est nul hors d'une
  -- requête authentifiée (migration, éditeur SQL, traitement planifié) :
  -- la règle ne mord alors sur personne, et c'est correct — il n'y a
  -- pas de « soi-même » à protéger.
  if tg_op = 'UPDATE'
     and auth.uid() is not null
     and old.user_id = auth.uid()
     and old.is_active and not new.is_active then
    raise exception 'On ne se révoque pas soi-même : demandez à un autre super-administrateur.'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' and auth.uid() is not null and old.user_id = auth.uid() then
    raise exception 'On ne se supprime pas soi-même de la liste des administrateurs.'
      using errcode = '23514';
  end if;

  -- LE DERNIER SUPER-ADMINISTRATEUR. On compte APRÈS coup, ce qui
  -- couvre d'un seul contrôle la révocation, la rétrogradation et la
  -- suppression — trois façons différentes d'arriver au même désastre.
  select count(*) into v_remaining
  from public.platform_admins pa
  where pa.role = 'super_admin' and pa.is_active and pa.revoked_at is null;

  if v_remaining = 0 then
    raise exception 'Il doit rester au moins un super-administrateur actif : sans lui, plus personne ne peut nommer d''administrateur et la plateforme devient inadministrable.'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

drop trigger if exists platform_admins_last_super_admin_guard on public.platform_admins;
create trigger platform_admins_last_super_admin_guard
  after update or delete on public.platform_admins
  for each row execute function public.platform_admins_last_super_admin_guard();

revoke all on function public.platform_admins_last_super_admin_guard() from public;
revoke all on function public.platform_admins_last_super_admin_guard() from anon;
revoke all on function public.platform_admins_last_super_admin_guard() from authenticated;

-- ------------------------------------------------------------
-- 3.a Les invitations — le cas « le compte n'existe pas encore »
-- ------------------------------------------------------------
-- NOMMER QUELQU'UN EXIGE DE CONNAÎTRE SON COMPTE, et `platform_admins`
-- a pour clé une référence à `auth.users`. Deux situations, deux
-- chemins, et il faut les deux :
--
--   • LE COLLÈGUE A DÉJÀ UN COMPTE. `admin_grant_platform_admin()` le
--     nomme directement, à partir de son identifiant.
--   • LE COLLÈGUE N'A PAS ENCORE DE COMPTE. Aucune fonction SQL ne peut
--     créer un utilisateur `auth` — c'est l'affaire de `auth.admin`, en
--     `service_role`, depuis le backend. La base enregistre donc
--     l'INTENTION : « cette adresse, ce rôle, ce motif, jusqu'à cette
--     date ». Le jour où la personne se connecte pour la première fois,
--     elle réclame son invitation et devient administratrice.
--
-- POURQUOI L'INVITATION EXPIRE. Une invitation sans fin est une porte
-- laissée entrouverte : un collègue qui ne rejoint jamais l'équipe garde
-- indéfiniment le droit de devenir administrateur en créant un compte
-- avec cette adresse.

create table if not exists public.platform_admin_invitations (
  -- L'adresse en minuscules, sans espace : c'est la clé de
  -- rapprochement avec `auth.users.email`, et deux casses différentes
  -- feraient deux invitations pour une seule personne.
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),

  role text not null check (role in (
    'super_admin', 'support', 'billing_admin',
    'product_admin', 'security_admin', 'read_only_analyst'
  )),

  -- Qui a invité, et sous quelle casquette. Le rôle est RECOPIÉ, comme
  -- dans `admin_audit_events` : c'est lui qui figurera dans le journal
  -- au moment où l'invitation sera réclamée, parfois des semaines plus
  -- tard, quand l'inviteur aura peut-être changé de rôle.
  invited_by uuid references auth.users (id) on delete set null,
  invited_by_role text not null,
  reason text not null constraint platform_admin_invitations_reason_not_blank check (btrim(reason) <> ''),
  note text,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,

  constraint platform_admin_invitations_expiry_after_creation
    check (expires_at > created_at),
  constraint platform_admin_invitations_acceptance_coherent
    check ((accepted_at is null) = (accepted_user_id is null)),
  -- Une invitation acceptée ne se révoque plus : elle a produit son
  -- effet, et la révocation porte désormais sur l'administrateur.
  constraint platform_admin_invitations_not_both
    check (accepted_at is null or revoked_at is null)
);

create index if not exists platform_admin_invitations_pending_idx
  on public.platform_admin_invitations (expires_at)
  where accepted_at is null and revoked_at is null;

alter table public.platform_admin_invitations enable row level security;

drop policy if exists "Les habilités lisent les invitations" on public.platform_admin_invitations;
create policy "Les habilités lisent les invitations" on public.platform_admin_invitations
  for select using (public.platform_admin_can('platform.admins.read'));

-- ------------------------------------------------------------
-- 3.b Nommer un administrateur qui a déjà un compte
-- ------------------------------------------------------------
create or replace function public.admin_grant_platform_admin(
  p_user_id uuid,
  p_role text,
  p_reason text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_note text;
  v_email text;
  v_existing record;
begin
  if not public.platform_admin_can('platform.admins.manage') then
    raise exception 'Accès refusé : seul le super-administrateur nomme un administrateur de plateforme.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : donner à quelqu''un le droit de voir toutes les entreprises se justifie au moment où on le fait.'
      using errcode = '23514';
  end if;
  v_note := public.ai_clean_text(p_note, 500);

  if p_role is null or p_role not in (
    'super_admin', 'support', 'billing_admin',
    'product_admin', 'security_admin', 'read_only_analyst') then
    raise exception 'Rôle inconnu : %.', coalesce(p_role, '(vide)')
      using errcode = '23514';
  end if;

  -- Le compte doit exister ET être vivant. Nommer un compte effacé en
  -- douceur créerait un administrateur que personne ne verrait dans la
  -- liste des utilisateurs.
  select u.email::text into v_email
  from auth.users u where u.id = p_user_id and u.deleted_at is null;

  if v_email is null then
    raise exception 'Aucun compte vivant ne porte cet identifiant : %. Si la personne n''a pas encore de compte, utilisez admin_invite_platform_admin().', p_user_id
      using errcode = '23503';
  end if;

  select * into v_existing from public.platform_admins pa where pa.user_id = p_user_id;

  if v_existing.user_id is not null and v_existing.is_active then
    raise exception 'Cette personne est déjà administratrice (rôle « % ») : pour changer son rôle, utilisez admin_change_platform_admin_role().', v_existing.role
      using errcode = '23505';
  end if;

  if v_existing.user_id is null then
    insert into public.platform_admins (user_id, role, created_by, note)
    values (p_user_id, p_role, auth.uid(), v_note);
  else
    -- Réintégration d'un administrateur révoqué : on écrit les deux
    -- champs de révocation, jamais un seul. La contrainte
    -- `platform_admins_revocation_coherent` refuserait l'incohérence,
    -- mais on ne compte pas sur elle pour dire quoi faire.
    update public.platform_admins
       set role = p_role, is_active = true, revoked_at = null,
           note = coalesce(v_note, note), created_by = coalesce(created_by, auth.uid())
     where user_id = p_user_id;
  end if;

  return public.record_admin_event(
    case when v_existing.user_id is null then 'platformAdmin.created' else 'platformAdmin.reinstated' end,
    'platform_admin', p_user_id, v_email,
    case when v_existing.user_id is null then null
         else jsonb_build_object('role', v_existing.role, 'isActive', v_existing.is_active) end,
    jsonb_build_object('role', p_role, 'isActive', true),
    v_reason);
end;
$$;

-- ------------------------------------------------------------
-- 3.c Changer le rôle d'un administrateur
-- ------------------------------------------------------------
create or replace function public.admin_change_platform_admin_role(
  p_user_id uuid,
  p_role text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_old text;
  v_email text;
  v_supers integer;
begin
  if not public.platform_admin_can('platform.admins.manage') then
    raise exception 'Accès refusé : seul le super-administrateur change le rôle d''un administrateur.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : un changement de rôle change ce que la personne peut faire.'
      using errcode = '23514';
  end if;

  if p_role is null or p_role not in (
    'super_admin', 'support', 'billing_admin',
    'product_admin', 'security_admin', 'read_only_analyst') then
    raise exception 'Rôle inconnu : %.', coalesce(p_role, '(vide)')
      using errcode = '23514';
  end if;

  select pa.role into v_old
  from public.platform_admins pa
  where pa.user_id = p_user_id and pa.is_active and pa.revoked_at is null;

  if v_old is null then
    raise exception 'Cette personne n''est pas administratrice active : rien à changer.'
      using errcode = '23503';
  end if;

  if v_old = p_role then
    -- Un succès silencieux qui n'a rien fait laisserait croire au geste.
    raise exception 'Cette personne a déjà le rôle « % ».', p_role
      using errcode = '23505';
  end if;

  -- La rétrogradation du dernier super-administrateur est aussi
  -- attrapée par le déclencheur ; on la refuse ici pour dire POURQUOI.
  if v_old = 'super_admin' and p_role <> 'super_admin' then
    select count(*) into v_supers
    from public.platform_admins pa
    where pa.role = 'super_admin' and pa.is_active and pa.revoked_at is null;
    if v_supers <= 1 then
      raise exception 'Dernier super-administrateur actif : le rétrograder rendrait la plateforme inadministrable. Nommez d''abord un remplaçant.'
        using errcode = '23514';
    end if;
  end if;

  select u.email::text into v_email from auth.users u where u.id = p_user_id;

  update public.platform_admins set role = p_role where user_id = p_user_id;

  return public.record_admin_event(
    'platformAdmin.roleChanged', 'platform_admin', p_user_id, v_email,
    jsonb_build_object('role', v_old), jsonb_build_object('role', p_role), v_reason);
end;
$$;

-- ------------------------------------------------------------
-- 3.d Révoquer
-- ------------------------------------------------------------
create or replace function public.admin_revoke_platform_admin(
  p_user_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_old text;
  v_email text;
  v_supers integer;
begin
  if not public.platform_admin_can('platform.admins.manage') then
    raise exception 'Accès refusé : seul le super-administrateur révoque un administrateur.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : une révocation se relit un jour, et il faut qu''elle se comprenne.'
      using errcode = '23514';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'On ne se révoque pas soi-même : vous vous enfermeriez dehors. Demandez à un autre super-administrateur.'
      using errcode = '23514';
  end if;

  select pa.role into v_old
  from public.platform_admins pa
  where pa.user_id = p_user_id and pa.is_active and pa.revoked_at is null;

  if v_old is null then
    raise exception 'Cette personne n''est pas administratrice active : rien à révoquer.'
      using errcode = '23503';
  end if;

  if v_old = 'super_admin' then
    select count(*) into v_supers
    from public.platform_admins pa
    where pa.role = 'super_admin' and pa.is_active and pa.revoked_at is null;
    if v_supers <= 1 then
      raise exception 'Dernier super-administrateur actif : le révoquer rendrait la plateforme inadministrable.'
        using errcode = '23514';
    end if;
  end if;

  select u.email::text into v_email from auth.users u where u.id = p_user_id;

  -- Les DEUX champs, toujours : `is_active` à faux ET `revoked_at`
  -- daté. Une révocation qui laisserait le compte « actif » serait une
  -- porte ouverte avec l'écriteau « fermé ».
  update public.platform_admins
     set is_active = false, revoked_at = now()
   where user_id = p_user_id;

  -- LES SESSIONS D'ASSISTANCE SE FERMENT AVEC LES DROITS, et ce n'est
  -- plus cette fonction qui s'en charge : le déclencheur
  -- `close_support_sessions_on_admin_change` (§ 8.b bis) l'a déjà fait
  -- au moment de l'`update` ci-dessus. Le geste a été DÉPLACÉ parce
  -- qu'il ne couvrait ici qu'un des quatre chemins par lesquels on perd
  -- ses droits — ni la rétrogradation, ni une désactivation tapée dans
  -- l'éditeur SQL, ni la suppression de la fiche ne passaient par cette
  -- fonction, et laissaient donc courir une fenêtre ouverte sur les
  -- données d'un client.

  return public.record_admin_event(
    'platformAdmin.revoked', 'platform_admin', p_user_id, v_email,
    jsonb_build_object('role', v_old, 'isActive', true),
    jsonb_build_object('role', v_old, 'isActive', false),
    v_reason);
end;
$$;

-- ------------------------------------------------------------
-- 3.e Inviter quelqu'un qui n'a pas encore de compte
-- ------------------------------------------------------------
create or replace function public.admin_invite_platform_admin(
  p_email text,
  p_role text,
  p_reason text,
  p_note text default null,
  p_valid_days integer default 14
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_email text;
  v_role_of_caller text;
  v_days integer := coalesce(p_valid_days, 14);
  v_existing_user uuid;
begin
  if not public.platform_admin_can('platform.admins.manage') then
    raise exception 'Accès refusé : seul le super-administrateur invite un administrateur.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : on n''invite pas quelqu''un dans l''administration sans dire pourquoi.'
      using errcode = '23514';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if position('@' in v_email) < 2 or length(v_email) > 320 then
    raise exception 'Adresse invalide : %.', coalesce(nullif(v_email, ''), '(vide)')
      using errcode = '23514';
  end if;

  if p_role is null or p_role not in (
    'super_admin', 'support', 'billing_admin',
    'product_admin', 'security_admin', 'read_only_analyst') then
    raise exception 'Rôle inconnu : %.', coalesce(p_role, '(vide)')
      using errcode = '23514';
  end if;

  if v_days < 1 or v_days > 90 then
    raise exception 'Une invitation vaut entre 1 et 90 jours : % demandé.', v_days
      using errcode = '23514';
  end if;

  -- Si le compte existe déjà, l'invitation est un détour inutile et,
  -- pire, un chemin parallèle : on renvoie vers la nomination directe.
  select u.id into v_existing_user
  from auth.users u where lower(u.email::text) = v_email and u.deleted_at is null;

  if v_existing_user is not null then
    raise exception 'Cette adresse a déjà un compte Oasis Care (%) : nommez-la directement avec admin_grant_platform_admin().', v_existing_user
      using errcode = '23505';
  end if;

  select pa.role into v_role_of_caller from public.platform_admins pa where pa.user_id = auth.uid();

  insert into public.platform_admin_invitations
    (email, role, invited_by, invited_by_role, reason, note, expires_at)
  values (v_email, p_role, auth.uid(), v_role_of_caller, v_reason,
          public.ai_clean_text(p_note, 500), now() + make_interval(days => v_days))
  on conflict (email) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        invited_by_role = excluded.invited_by_role,
        reason = excluded.reason,
        note = excluded.note,
        created_at = now(),
        expires_at = excluded.expires_at,
        accepted_at = null,
        accepted_user_id = null,
        revoked_at = null,
        revoked_by = null;

  return public.record_admin_event(
    'platformAdmin.invited', 'platform_admin_invitation', null, v_email,
    null, jsonb_build_object('role', p_role, 'validDays', v_days), v_reason);
end;
$$;

create or replace function public.admin_revoke_platform_admin_invitation(
  p_email text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text;
begin
  if not public.platform_admin_can('platform.admins.manage') then
    raise exception 'Accès refusé : seul le super-administrateur retire une invitation.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  select i.role into v_role
  from public.platform_admin_invitations i
  where i.email = v_email and i.accepted_at is null and i.revoked_at is null;

  if v_role is null then
    raise exception 'Aucune invitation en attente pour %.', coalesce(nullif(v_email, ''), '(vide)')
      using errcode = '23503';
  end if;

  update public.platform_admin_invitations
     set revoked_at = now(), revoked_by = auth.uid()
   where email = v_email;

  return public.record_admin_event(
    'platformAdmin.invitationRevoked', 'platform_admin_invitation', null, v_email,
    jsonb_build_object('role', v_role), null, v_reason);
end;
$$;

-- ------------------------------------------------------------
-- 3.f Réclamer son invitation
-- ------------------------------------------------------------
-- Appelée PAR L'INVITÉ, une fois son compte créé et son adresse
-- confirmée. C'est la seule fonction de tout le Control Center qu'un
-- non-administrateur puisse appeler avec succès, et il faut donc en
-- lister les verrous :
--
--   • l'adresse doit être CONFIRMÉE (`email_confirmed_at`) — sinon
--     n'importe qui pourrait s'inscrire avec l'adresse d'un collègue
--     invité et hériter de son rôle ;
--   • l'invitation doit exister, ne pas être expirée, ni révoquée, ni
--     déjà acceptée ;
--   • le rôle est celui de l'INVITATION, jamais un paramètre — sans
--     quoi l'invité choisirait sa propre puissance.
--
-- LA LIGNE DE JOURNAL EST ÉCRITE EN DIRECT, ET C'EST LE SEUL ENDROIT DU
-- FICHIER OÙ L'ON N'APPELLE PAS `record_admin_event()`. Deux raisons,
-- toutes deux dirimantes : au moment du geste l'appelant n'est pas
-- encore administrateur, donc la fonction le refuserait ; et l'AUTEUR
-- de la décision n'est pas l'invité mais l'INVITEUR. Une ligne signée
-- par l'invité se lirait « il s'est nommé lui-même », ce qui serait
-- faux et inquiétant.
create or replace function public.claim_platform_admin_invitation()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_inv record;
begin
  if v_uid is null then
    raise exception 'Il faut être connecté pour réclamer une invitation.'
      using errcode = '42501';
  end if;

  select lower(u.email::text), u.email_confirmed_at
    into v_email, v_confirmed
  from auth.users u where u.id = v_uid and u.deleted_at is null;

  if v_email is null then
    raise exception 'Compte introuvable.' using errcode = '42501';
  end if;

  if v_confirmed is null then
    raise exception 'Adresse non confirmée : confirmez votre adresse avant de réclamer une invitation d''administrateur.'
      using errcode = '42501';
  end if;

  select * into v_inv
  from public.platform_admin_invitations i
  where i.email = v_email
    and i.accepted_at is null
    and i.revoked_at is null
    and i.expires_at > now();

  if v_inv.email is null then
    -- Message volontairement identique pour « pas d'invitation » et
    -- « invitation expirée » vue de l'extérieur ? Non : ici l'appelant
    -- est légitime et a besoin de savoir quoi demander.
    raise exception 'Aucune invitation valide pour cette adresse. Elle a peut-être expiré ou été retirée : demandez-en une nouvelle.'
      using errcode = '42501';
  end if;

  if exists (select 1 from public.platform_admins pa where pa.user_id = v_uid and pa.is_active) then
    raise exception 'Vous êtes déjà administrateur.' using errcode = '23505';
  end if;

  insert into public.platform_admins (user_id, role, created_by, note)
  values (v_uid, v_inv.role, v_inv.invited_by, v_inv.note)
  on conflict (user_id) do update
    set role = excluded.role, is_active = true, revoked_at = null;

  update public.platform_admin_invitations
     set accepted_at = now(), accepted_user_id = v_uid
   where email = v_email;

  insert into public.admin_audit_events
    (admin_user_id, admin_role, action, target_type, target_id, target_label,
     old_value, new_value, reason)
  values
    (v_inv.invited_by, v_inv.invited_by_role, 'platformAdmin.invitationAccepted',
     'platform_admin', v_uid, v_email,
     null, jsonb_build_object('role', v_inv.role),
     'Invitation acceptée. Motif de l''invitation : ' || v_inv.reason);

  return v_inv.role;
end;
$$;

-- ------------------------------------------------------------
-- 3.g Lire l'équipe — avec l'état du second facteur
-- ------------------------------------------------------------
-- `auth.users` et `auth.mfa_factors` sont fermées à `authenticated` :
-- sans cette fonction, l'écran « Équipe » afficherait des identifiants
-- sans adresses et ne saurait pas qui est protégé.
create or replace function public.admin_list_platform_admins()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role text,
  is_active boolean,
  created_at timestamptz,
  revoked_at timestamptz,
  note text,
  has_verified_mfa boolean,
  last_sign_in_at timestamptz
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
  if not public.platform_admin_can('platform.admins.read') then
    raise exception 'Accès refusé : permission platform.admins.read manquante.'
      using errcode = '42501';
  end if;

  return query
  select pa.user_id,
         u.email::text,
         nullif(btrim(coalesce(p.display_name, '')), ''),
         pa.role,
         pa.is_active,
         pa.created_at,
         pa.revoked_at,
         pa.note,
         exists (select 1 from auth.mfa_factors f
                  where f.user_id = pa.user_id and f.status = 'verified'),
         u.last_sign_in_at
  from public.platform_admins pa
  left join auth.users u on u.id = pa.user_id
  left join public.profiles p on p.id = pa.user_id
  order by pa.is_active desc, pa.role, u.email;
end;
$$;

-- ============================================================
-- 4. LA GRILLE TARIFAIRE
-- ============================================================
--
-- CE QUE LA BASE PORTAIT, ET CE QU'ELLE NE PORTAIT PAS.
-- `organization_plans` a `key, name, tagline, features,
-- monthly_price_cents, max_users, position, is_active, created_at` —
-- et c'est tout. Il n'y a NI prix annuel, NI notion de cycle : les
-- 399 € / 799 € / 1 399 € n'avaient nulle part où vivre, et le champ
-- « Cycle » que la spec p.12 réclame ne pouvait pas s'afficher. 0075
-- l'écrit noir sur blanc à la ligne du calcul de l'ARR — « le schéma n'a
-- aucune notion de cycle » — et multiplie faute de mieux le MRR par
-- douze.
--
-- POSER LES PRIX N'EST PAS UN DÉTAIL D'AFFICHAGE. Les quatre lignes ont
-- `monthly_price_cents` à NULL, ce qui neutralise DEUX garde-fous de
-- 0075 : le MRR rend NULL parce qu'« au moins un forfait actif n'a pas
-- de prix », et l'ARR rend NULL par dérivation. Ce paragraphe rallume
-- mécaniquement les deux — à une condition que 0075 pose aussi, et
-- qu'aucun prix ne remplace : il faut au moins un abonnement en
-- 'active' ou 'pastDue', et la table en compte zéro. Les prix sont la
-- première moitié ; le § 5 fournit la seconde.
--
-- ET UN EFFET IMMÉDIAT À CONNAÎTRE : `web-pro` lit ces lignes et les
-- affiche telles quelles aux entreprises clientes
-- (`lib/billing/provider.ts`, `.eq("is_active", true)`). Écrire un prix
-- ici change, à la seconde, ce qu'une entreprise Pro voit sur son écran
-- d'abonnement.

-- ------------------------------------------------------------
-- 4.a Ce qui manquait à `organization_plans`
-- ------------------------------------------------------------
-- STRICTEMENT ADDITIF : `add column if not exists`, aucun `alter
-- column`, aucun `drop`. `monthly_price_cents` et `max_users` gardent
-- leur type et leur nullabilité — d'autres écrans les lisent.

alter table public.organization_plans
  -- Le prix annuel, en centimes comme partout. Nullable : une offre
  -- « sur devis » n'en a pas, et une offre sans engagement annuel non
  -- plus.
  add column if not exists yearly_price_cents bigint,

  -- La devise est portée par le forfait et non déduite du pays : une
  -- entreprise belge paiera en euros le même tarif qu'une française.
  add column if not exists currency text not null default 'EUR',

  -- LES DEUX CAS QUE LE MODÈLE DOIT SAVOIR DIRE, sans quoi il ment.
  --
  -- « Sur devis » n'est pas « prix à zéro » ni « prix inconnu » : c'est
  -- une offre qui NE PEUT PAS être souscrite en libre-service. La base
  -- l'empêche (§ 5.b) au lieu de compter sur l'écran pour y penser.
  add column if not exists is_quote_only boolean not null default false,
  -- « À partir de 249 € » est un PLANCHER COMMERCIAL, pas un prix. Le
  -- confondre avec `monthly_price_cents` ferait facturer 249 € une
  -- offre dont le vrai prix sort d'une négociation.
  add column if not exists price_floor_cents bigint,

  -- LES SIÈGES. `max_users` et le siège supplémentaire à 9,90 € se
  -- contredisaient tant qu'on ne tranchait pas. LA RÉPONSE, ET ELLE EST
  -- PORTÉE PAR LA BASE : `max_users` reste ce qu'il a toujours été —
  -- une indication d'affichage, lue par `web-pro` (« Ce forfait en
  -- prévoit N ») et par AUCUN contrôle. `included_seats` est la
  -- nouvelle colonne qui fait autorité pour la facturation, et
  -- `seat_policy` dit ce qui se passe au-delà.
  --
  -- `included_seats` À NULL VEUT DIRE « NON DÉCIDÉ », explicitement, et
  -- non « illimité » : le dirigeant a fixé le prix du siège
  -- supplémentaire (9,90 €) sans dire combien de sièges chaque offre en
  -- comprend. Inventer un nombre facturerait faux dans un sens ou dans
  -- l'autre. Tant qu'il est nul, la facturation n'ajoute AUCUNE ligne
  -- de siège automatiquement — voir § 5.c, où le nombre de sièges
  -- facturés est saisi par un administrateur.
  add column if not exists included_seats integer,
  add column if not exists seat_policy text not null default 'billedBeyondIncluded',
  add column if not exists extra_seat_monthly_price_cents bigint,

  -- Le quota IA et le stockage que la spec p.14 demande sur la fiche
  -- d'un forfait. NULL = non décidé, pas « illimité » : la nuance est
  -- la même que pour les sièges, et elle a la même conséquence.
  add column if not exists ai_monthly_quota integer,
  add column if not exists storage_gb integer,

  -- Le badge de la grille. Un `text` libre serait un champ de mise en
  -- page dans une table de tarifs ; la contrainte le garde fermé.
  add column if not exists badge text,

  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organization_plans_seat_policy_valid') then
    alter table public.organization_plans add constraint organization_plans_seat_policy_valid
      check (seat_policy in ('hardCap', 'billedBeyondIncluded'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'organization_plans_badge_valid') then
    alter table public.organization_plans add constraint organization_plans_badge_valid
      check (badge is null or badge in ('bestSeller', 'new'));
  end if;

  -- UNE OFFRE SUR DEVIS N'A PAS DE PRIX PUBLIC, et une offre à prix
  -- public n'a pas de plancher. Écrire les deux serait afficher deux
  -- vérités concurrentes sur la même ligne.
  if not exists (select 1 from pg_constraint where conname = 'organization_plans_quote_only_has_no_public_price') then
    alter table public.organization_plans add constraint organization_plans_quote_only_has_no_public_price
      check (
        (is_quote_only and monthly_price_cents is null and yearly_price_cents is null and price_floor_cents is not null)
        or (not is_quote_only and price_floor_cents is null)
      );
  end if;

  -- Des montants négatifs n'auraient aucun sens, et un prix à zéro non
  -- plus : une offre gratuite se déclare `is_active = false` ou porte
  -- un vrai zéro assumé — on refuse le négatif seulement, parce qu'une
  -- offre d'appel à 0 € est un choix commercial possible.
  if not exists (select 1 from pg_constraint where conname = 'organization_plans_prices_not_negative') then
    alter table public.organization_plans add constraint organization_plans_prices_not_negative
      check (coalesce(monthly_price_cents, 0) >= 0
         and coalesce(yearly_price_cents, 0) >= 0
         and coalesce(price_floor_cents, 0) >= 0
         and coalesce(extra_seat_monthly_price_cents, 0) >= 0
         and coalesce(included_seats, 0) >= 0);
  end if;
end $$;

comment on column public.organization_plans.included_seats is
  'Sièges compris dans le forfait. NULL = NON DÉCIDÉ (pas « illimité ») : tant qu''il est nul, aucune ligne de siège n''est facturée automatiquement.';
comment on column public.organization_plans.max_users is
  'Indication d''affichage héritée de 0060, lue par web-pro. Ce n''est PAS un plafond appliqué : la référence de facturation est included_seats.';
comment on column public.organization_plans.price_floor_cents is
  'Plancher commercial d''une offre sur devis (« à partir de … »). Ce n''est pas un prix : le vrai montant est négocié et se pose sur l''abonnement.';

-- ------------------------------------------------------------
-- 4.b LES MODULES, ET LA MATRICE
-- ------------------------------------------------------------
-- LA VRAIE DIFFICULTÉ DE MODÉLISATION DE CE CHANTIER TIENT DANS UNE
-- PHRASE DU DIRIGEANT : « BioLab et Pépinière inclus dans Business, et
-- à 20 € de plus dans Pro. »
--
-- UN MÊME MODULE EST DONC INCLUS DANS UNE OFFRE ET PAYANT DANS UNE
-- AUTRE. Ce n'est pas une liste plate `add_ons(cle, prix)` : un tel
-- schéma ne saurait JAMAIS dire que Business inclut BioLab, et il
-- faudrait tout reprendre à la première facture. C'est une MATRICE
-- offre × module, dont chaque case vaut « inclus », « en option à tel
-- prix », « indisponible » — ou « non décidé », qui est un état à part
-- entière et non une case vide.
--
-- DEUX CONSÉQUENCES PORTÉES JUSQU'AU BOUT, sans quoi la facture serait
-- fausse :
--
--   • Une entreprise Business qui souscrit BioLab ne paie RIEN de plus.
--     C'est mécanique ici : la ligne d'abonnement au module NE PORTE
--     AUCUN PRIX. Le prix est lu dans la matrice au moment de facturer,
--     jamais recopié. Un prix recopié serait un prix qui survit au
--     changement d'offre.
--   • Une entreprise Pro qui paie BioLab 20 €, puis passe à Business,
--     cesse d'être facturée pour ce module SANS QU'AUCUN GESTE NE SOIT
--     NÉCESSAIRE — pour la même raison. Et si la nouvelle offre rend le
--     module indisponible ou non décidé, le changement d'offre est
--     REFUSÉ (§ 5.b) plutôt que de laisser une entreprise avec un
--     module qu'on ne sait ni facturer ni retirer.
--
-- ET LE RAPPEL QUI PRIME SUR TOUT : LE JARDIN CONNECTÉ N'EST PAS UN
-- MODULE. Capteurs, automatisations, jumeau numérique, IA du jardin :
-- tout est dans Pro à 79,90 €, entier, et il n'apparaît donc nulle part
-- dans cette table. Le remonter en option ou en offre supérieure serait
-- l'inverse exact de la stratégie décidée.

create table if not exists public.platform_modules (
  key text primary key,
  name text not null,
  tagline text,

  -- LIVRÉ OU NON. Plusieurs modules sont annoncés sans être construits
  -- (IA Pro+, marque blanche, SMS, signature, paiement en ligne…). Les
  -- accueillir dans la matrice sans le dire ferait vendre du vent : la
  -- colonne existe pour que l'écran l'annonce franchement, et pour que
  -- la souscription les refuse (§ 5.d).
  is_delivered boolean not null default false,

  -- AU FORFAIT OU AU COMPTEUR. Les SMS et le stockage ne se facturent
  -- pas comme un abonnement mensuel fixe : un modèle qui ne connaîtrait
  -- que le forfait les tarifierait faux dès le premier envoi.
  pricing_model text not null default 'flat'
    check (pricing_model in ('flat', 'metered', 'commission')),
  metered_unit text,

  position integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint platform_modules_metered_has_unit
    check (pricing_model <> 'metered' or metered_unit is not null)
);

alter table public.platform_modules enable row level security;

-- Le catalogue des modules est PUBLIC pour tout compte connecté, comme
-- `organization_plans` : c'est une grille tarifaire, pas un secret, et
-- l'écran d'abonnement de `web-pro` en aura besoin.
drop policy if exists "Tout compte connecté lit le catalogue des modules" on public.platform_modules;
create policy "Tout compte connecté lit le catalogue des modules" on public.platform_modules
  for select using (auth.uid() is not null);

create table if not exists public.plan_modules (
  plan_key text not null references public.organization_plans (key) on delete cascade,
  module_key text not null references public.platform_modules (key) on delete cascade,

  -- LES QUATRE ÉTATS D'UNE CASE. « undecided » n'est pas un défaut de
  -- saisie : c'est la réponse honnête quand le dirigeant n'a rien dit,
  -- et elle BLOQUE — on ne souscrit pas, on ne facture pas, et l'écran
  -- le signale comme une décision à prendre. Une case vide qui se
  -- comporterait comme « inclus » ou comme « indisponible » sans qu'on
  -- l'ait choisi serait exactement le défaut qu'on cherche à éviter.
  availability text not null default 'undecided'
    check (availability in ('included', 'optional', 'unavailable', 'undecided')),

  monthly_price_cents bigint,
  yearly_price_cents bigint,
  metered_unit_price_cents bigint,

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  primary key (plan_key, module_key),

  -- « En option » sans prix serait invendable ; un prix sur une case
  -- « incluse » serait un prix qu'on finirait par facturer.
  constraint plan_modules_optional_has_a_price
    check (availability <> 'optional'
           or monthly_price_cents is not null
           or metered_unit_price_cents is not null),
  constraint plan_modules_non_optional_has_no_price
    check (availability = 'optional'
           or (monthly_price_cents is null
               and yearly_price_cents is null
               and metered_unit_price_cents is null)),
  constraint plan_modules_prices_not_negative
    check (coalesce(monthly_price_cents, 0) >= 0
       and coalesce(yearly_price_cents, 0) >= 0
       and coalesce(metered_unit_price_cents, 0) >= 0)
);

alter table public.plan_modules enable row level security;

drop policy if exists "Tout compte connecté lit la matrice des modules" on public.plan_modules;
create policy "Tout compte connecté lit la matrice des modules" on public.plan_modules
  for select using (auth.uid() is not null);

-- LA FONCTION QUE LA FACTURATION CONSULTE, ET LA SEULE. Aucun appelant
-- ne doit lire `platform_modules.monthly_price_cents` — la colonne
-- n'existe d'ailleurs pas, exprès : un module n'a pas de prix en soi,
-- il a un prix DANS UNE OFFRE.
create or replace function public.plan_module_terms(
  p_plan_key text,
  p_module_key text
)
returns table (
  availability text,
  monthly_price_cents bigint,
  yearly_price_cents bigint,
  metered_unit_price_cents bigint,
  is_delivered boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(pm.availability, 'undecided'),
         pm.monthly_price_cents,
         pm.yearly_price_cents,
         pm.metered_unit_price_cents,
         coalesce(m.is_delivered, false)
  from public.platform_modules m
  left join public.plan_modules pm
    on pm.module_key = m.key and pm.plan_key = p_plan_key
  where m.key = p_module_key;
$$;

comment on function public.plan_module_terms(text, text) is
  'La case de la matrice offre × module. C''est la SEULE source du prix d''un module : '
  'un module inclus dans une offre coûte zéro, et le changement d''offre change le prix sans qu''on recopie rien.';

-- ------------------------------------------------------------
-- 4.c LES REMISES : UNE FIN, UNE OFFRE, ET UN ENGAGEMENT
-- ------------------------------------------------------------
-- LE DIRIGEANT A ÉCARTÉ L'À-VIE. « Tarif fondateur 49,90 €/mois HT
-- pendant 12 MOIS, puis retour au tarif public » — et non une remise à
-- vie, parce qu'une remise à vie sur un abonnement récurrent est une
-- dette perpétuelle que rien ne peut plus corriger.
--
-- CETTE DÉCISION EST PORTÉE PAR LE SCHÉMA ET NON PAR LA POLITESSE DE
-- L'INTERFACE : `ends_on` est NOT NULL. Il n'existe littéralement aucune
-- façon d'enregistrer une remise sans fin. Un écran qui l'oublierait
-- serait refusé par la base.
--
-- UNE REMISE VISE UNE OFFRE, ET C'EST LA SECONDE DÉCISION. Le tarif
-- fondateur ne vaut que sur Pro (`team`, 79,90 €). Sans restriction en
-- base, rien n'empêcherait de le poser sur Pro Business (139,90 €) :
-- le prix imposé y resterait 49,90 €, et l'entreprise recevrait 90 €
-- de remise par mois au lieu de 30 €. La différence ne se verrait
-- NULLE PART, puisque la facture et le MRR seraient d'accord entre eux
-- — tous les deux faux. D'où `applies_to_plan`, tenu par un
-- déclencheur et non par la discipline de l'écran.
--
-- UNE REMISE PEUT VERROUILLER, ET C'EST LA TROISIÈME. Douze mois à
-- 49,90 € se paient CONTRE un engagement de douze mois : la
-- résiliation avant terme n'est pas en libre-service. Trois choses
-- doivent alors exister en base, et la troisième est celle qu'on
-- oublie — la durée et les deux prix, pour que l'écran puisse les
-- ANNONCER AVANT ; le geste d'acceptation ; et la PREUVE, qui contient
-- le texte exact affiché ce jour-là (§ 4.c bis).
--
-- CONSÉQUENCE ADOPTÉE ICI, ET ÉCRITE PLUTÔT QUE SUBIE : une remise à
-- engagement NE SE VEND QU'AU MOIS. Douze mensualités verrouillées et
-- un abonnement annuel disent la même chose deux fois ; l'annuel n'y
-- ajoute qu'une question sans réponse — le prix fondateur annuel, que
-- personne n'a fixé. La base refuse donc en amont plutôt que de
-- produire une facture bancale.

create table if not exists public.discount_offers (
  code text primary key check (code = upper(btrim(code)) and length(code) between 2 and 40),
  label text not null,

  kind text not null check (kind in ('fixedMonthlyPrice', 'percentOff', 'amountOff')),
  -- « Prix mensuel imposé » pour le tarif fondateur : ce n'est pas une
  -- réduction en pourcentage, c'est un prix qui se substitue à celui de
  -- l'offre. Le modéliser comme un pourcentage obligerait à recalculer
  -- le taux à chaque changement de tarif public, et la remise dériverait.
  value_cents bigint,
  percent numeric(5, 2) check (percent is null or (percent > 0 and percent <= 100)),

  -- La durée en MOIS, pas une date de fin : l'offre s'applique à des
  -- abonnements qui commencent à des dates différentes, et c'est la
  -- durée qui est promise, pas l'échéance.
  duration_months integer not null check (duration_months between 1 and 60),

  -- L'OFFRE VISÉE. NULL = « toutes les offres », pour une remise
  -- commerciale générale ; une valeur = « cette offre-là seulement ».
  -- `on delete restrict` et non `set null` : supprimer une clé d'offre
  -- transformerait sinon, en silence, une remise restreinte en remise
  -- universelle — exactement la fuite qu'on referme ici.
  applies_to_plan text references public.organization_plans (key) on delete restrict,

  -- L'ENGAGEMENT. Souscrire verrouille la durée : la résiliation avant
  -- terme n'est pas en libre-service (§ 5.b et § 5.d). `commitment_months`
  -- ne diverge jamais de `duration_months` — un verrou plus court que la
  -- remise, ou plus long, serait une promesse à deux vitesses.
  requires_commitment boolean not null default false,
  commitment_months integer,

  is_active boolean not null default true,
  -- Jusqu'à quand on peut ENTRER dans l'offre (à ne pas confondre avec
  -- la durée : on peut souscrire jusqu'au 31 décembre et garder la
  -- remise douze mois après).
  available_until date,

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint discount_offers_value_matches_kind check (
    (kind = 'fixedMonthlyPrice' and value_cents is not null and value_cents >= 0 and percent is null)
    or (kind = 'amountOff'      and value_cents is not null and value_cents >  0 and percent is null)
    or (kind = 'percentOff'     and percent is not null and value_cents is null)
  ),

  constraint discount_offers_commitment_coherent check (
    (requires_commitment and commitment_months is not null and commitment_months = duration_months)
    or (not requires_commitment and commitment_months is null)
  ),

  -- UN ENGAGEMENT SANS OFFRE VISÉE NE SAIT PAS DIRE LE PRIX D'APRÈS.
  -- L'écran doit annoncer les trois chiffres — durée, prix pendant,
  -- prix après — et le prix après est celui de l'offre visée. Sans
  -- `applies_to_plan`, le troisième est introuvable.
  constraint discount_offers_commitment_needs_plan check (
    not requires_commitment or applies_to_plan is not null
  )
);

alter table public.discount_offers enable row level security;

drop policy if exists "Les habilités lisent les offres de remise" on public.discount_offers;
create policy "Les habilités lisent les offres de remise" on public.discount_offers
  for select using (public.platform_admin_can('billing.plans.read'));

comment on column public.discount_offers.applies_to_plan is
  'Offre à laquelle la remise est réservée. NULL = toutes les offres. Recopiée sur la remise posée : le catalogue peut changer, la remise accordée non.';
comment on column public.discount_offers.requires_commitment is
  'La souscription verrouille la durée : la résiliation avant terme est refusée par la base, sauf dérogation motivée d''un administrateur.';

-- UN PRIX MENSUEL IMPOSÉ N'A DE SENS QUE FACE À UN TARIF PUBLIC. Sur
-- une offre sur devis, il n'y a rien à quoi il se substitue : le vrai
-- prix sort d'une négociation et vit sur l'abonnement. Un déclencheur
-- plutôt qu'une contrainte `check`, parce que la règle dépend d'une
-- AUTRE table (`organization_plans.is_quote_only`).
create or replace function public.discount_offers_plan_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_plan record;
begin
  if new.applies_to_plan is null then
    return new;
  end if;

  select * into v_plan from public.organization_plans where key = new.applies_to_plan;
  if v_plan.key is null then
    raise exception 'Offre inconnue : %.', new.applies_to_plan using errcode = '23503';
  end if;

  if new.kind = 'fixedMonthlyPrice' and v_plan.is_quote_only then
    raise exception 'L''offre « % » est sur devis : un prix mensuel imposé n''y remplace aucun tarif public. Une remise en pourcentage ou en montant convient, un prix imposé non.', v_plan.name
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists discount_offers_plan_guard on public.discount_offers;
create trigger discount_offers_plan_guard
  before insert or update on public.discount_offers
  for each row execute function public.discount_offers_plan_guard();

revoke all on function public.discount_offers_plan_guard() from public;
revoke all on function public.discount_offers_plan_guard() from anon;
revoke all on function public.discount_offers_plan_guard() from authenticated;

create table if not exists public.subscription_discounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  code text references public.discount_offers (code) on delete set null,
  label text not null,

  kind text not null check (kind in ('fixedMonthlyPrice', 'percentOff', 'amountOff')),
  value_cents bigint,
  percent numeric(5, 2) check (percent is null or (percent > 0 and percent <= 100)),

  -- LA RESTRICTION D'OFFRE, RECOPIÉE — et ce n'est pas de la
  -- redondance. `code` est en `on delete set null` juste au-dessus :
  -- une ligne de catalogue supprimée ferait perdre à cette remise
  -- toute trace de l'offre à laquelle elle était réservée, et elle
  -- deviendrait universelle sans erreur ni trace. La table recopie
  -- déjà `label`, `kind`, `value_cents` et `percent` pour exactement
  -- cette raison ; on suit sa convention.
  applies_to_plan text,

  starts_on date not null,
  -- NOT NULL : voir l'en-tête de ce paragraphe. C'est la traduction en
  -- schéma d'une décision du dirigeant, et c'est le genre de décision
  -- qu'on ne veut pas voir se perdre dans un commentaire.
  ends_on date not null,

  -- LA DATE JUSQU'À LAQUELLE ON NE PEUT PAS PARTIR. Nulle quand la
  -- remise n'engage à rien. C'est CETTE colonne que la résiliation
  -- interroge — jamais le catalogue, qui a pu changer depuis.
  commitment_ends_on date,

  granted_by uuid references auth.users (id) on delete set null,
  reason text not null constraint subscription_discounts_reason_not_blank check (btrim(reason) <> ''),
  audit_event_id uuid references public.admin_audit_events (id) on delete set null,

  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancelled_reason text,

  created_at timestamptz not null default now(),

  constraint subscription_discounts_period_ordered check (ends_on > starts_on),
  constraint subscription_discounts_value_matches_kind check (
    (kind = 'fixedMonthlyPrice' and value_cents is not null and value_cents >= 0 and percent is null)
    or (kind = 'amountOff'      and value_cents is not null and value_cents >  0 and percent is null)
    or (kind = 'percentOff'     and percent is not null and value_cents is null)
  ),
  -- On ne consigne pas QUI a annulé ni POURQUOI sans qu'une annulation
  -- ait eu lieu : la trace se lirait comme une remise annulée alors
  -- qu'elle court toujours.
  constraint subscription_discounts_cancellation_coherent
    check (cancelled_at is not null or (cancelled_by is null and cancelled_reason is null)),

  -- L'engagement ne survit pas à la remise qui le porte : on ne
  -- verrouille pas un client au-delà de l'avantage qu'il a reçu.
  constraint subscription_discounts_commitment_within_period
    check (commitment_ends_on is null
           or (commitment_ends_on > starts_on and commitment_ends_on <= ends_on))
);

create index if not exists subscription_discounts_org_idx
  on public.subscription_discounts (organization_id, starts_on desc);

alter table public.subscription_discounts enable row level security;

-- LE CLIENT VOIT SA REMISE ET SA DATE DE FIN. C'est la contrepartie de
-- la décision « pas d'à-vie » : si la remise tombe dans onze mois, il
-- doit pouvoir le lire, et pas le découvrir sur une facture.
drop policy if exists "Le client voit sa remise, les habilités toutes" on public.subscription_discounts;
create policy "Le client voit sa remise, les habilités toutes" on public.subscription_discounts
  for select using (
    public.is_organization_member(organization_id)
    or public.platform_admin_can('billing.plans.read')
  );

-- DEUX REMISES QUI SE CHEVAUCHENT NE SE CUMULENT PAS : elles se
-- contredisent. Un déclencheur plutôt qu'une contrainte d'exclusion,
-- pour ne pas dépendre de l'extension `btree_gist`, qui n'est pas
-- installée sur ce projet.
create or replace function public.subscription_discounts_no_overlap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.cancelled_at is not null then
    return new;
  end if;

  if exists (
    select 1 from public.subscription_discounts d
    where d.organization_id = new.organization_id
      and d.id <> new.id
      and d.cancelled_at is null
      and daterange(d.starts_on, d.ends_on, '[)') && daterange(new.starts_on, new.ends_on, '[)')
  ) then
    raise exception 'Une remise en vigueur couvre déjà tout ou partie de cette période pour cette entreprise : annulez-la d''abord. Deux remises simultanées ne se cumulent pas, elles se contredisent.'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists subscription_discounts_no_overlap on public.subscription_discounts;
create trigger subscription_discounts_no_overlap
  before insert or update on public.subscription_discounts
  for each row execute function public.subscription_discounts_no_overlap();

revoke all on function public.subscription_discounts_no_overlap() from public;
revoke all on function public.subscription_discounts_no_overlap() from anon;
revoke all on function public.subscription_discounts_no_overlap() from authenticated;

-- UNE REMISE RÉSERVÉE À UNE OFFRE NE SE POSE PAS AILLEURS, ET C'EST LA
-- BASE QUI LE TIENT. Un déclencheur et non une contrainte `check`,
-- pour la même raison qu'au-dessus : la règle dépend d'une AUTRE table
-- (`organization_subscriptions.plan`).
--
-- IL REFUSE AUSSI LA REMISE POSÉE AVANT L'ABONNEMENT. Sans cela, le
-- contrôle se contourne en deux gestes : poser la remise sur une
-- entreprise sans abonnement, souscrire Business ensuite.
create or replace function public.subscription_discounts_plan_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_sub record;
  v_plan text;
begin
  -- Une remise annulée ne contraint plus rien : c'est aussi ce qui
  -- permet à une dérogation d'administrateur de l'annuler d'abord et de
  -- résilier ensuite (§ 5.d).
  if new.cancelled_at is not null then
    return new;
  end if;

  if new.applies_to_plan is null and new.commitment_ends_on is null then
    return new;
  end if;

  select * into v_sub from public.organization_subscriptions
   where organization_id = new.organization_id;

  if v_sub.organization_id is null then
    raise exception 'Cette remise vise une offre précise, ou porte un engagement : elle ne se pose pas sur une entreprise SANS abonnement. Créez l''abonnement d''abord.'
      using errcode = '23503';
  end if;

  if new.applies_to_plan is not null and v_sub.plan is distinct from new.applies_to_plan then
    select p.name into v_plan from public.organization_plans p where p.key = new.applies_to_plan;
    raise exception 'Remise refusée : « % » est réservée à l''offre « % », et cette entreprise est abonnée à « % ». Un prix imposé posé sur une offre plus chère offrirait la différence en silence.',
      new.label, coalesce(v_plan, new.applies_to_plan), v_sub.plan
      using errcode = '23514';
  end if;

  -- L'ENGAGEMENT SE PAIE AU MOIS. Voir l'en-tête du § 4.c : douze
  -- mensualités verrouillées et un abonnement annuel diraient la même
  -- chose deux fois, et le prix annuel de la remise n'existe pas.
  if new.commitment_ends_on is not null and v_sub.billing_cycle = 'yearly' then
    raise exception 'Remise refusée : « % » engage sur % et ne se vend qu''AU MOIS. Cet abonnement est ANNUEL.',
      new.label, to_char(new.commitment_ends_on, 'DD/MM/YYYY')
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists subscription_discounts_plan_guard on public.subscription_discounts;
create trigger subscription_discounts_plan_guard
  before insert or update on public.subscription_discounts
  for each row execute function public.subscription_discounts_plan_guard();

revoke all on function public.subscription_discounts_plan_guard() from public;
revoke all on function public.subscription_discounts_plan_guard() from anon;
revoke all on function public.subscription_discounts_plan_guard() from authenticated;

-- ------------------------------------------------------------
-- 4.c bis L'ENGAGEMENT ACCEPTÉ, ET SA PREUVE
-- ------------------------------------------------------------
-- SAVOIR NE SUFFIT PAS : IL FAUT DÉMONTRER QU'IL SAVAIT. Une trace qui
-- dit « a accepté » sans conserver ce qu'il a lu ne vaut rien le jour
-- où l'écran aura changé — et il changera.
--
-- LE TEXTE EST DONC RECOPIÉ EN ENTIER, jamais référencé. C'est la
-- convention de ce dépôt, deux fois : `quote_revisions.snapshot` (0049)
-- garde ce que le client a REÇU, et les colonnes `issuer_*` de
-- `saas_invoices` (§ 6.d) recopient l'identité de l'émetteur au moment
-- de l'émission plutôt que de pointer vers une table qui bougera. Une
-- référence vers un texte modifiable rendrait la preuve fausse à la
-- première correction de virgule.
--
-- ET SI LE TEXTE CHANGE ENTRE DEUX SOUSCRIPTIONS ? Chaque acceptation
-- garde SA version, parce qu'elle garde SON texte. `terms_version` est
-- l'étiquette lisible de cette copie, pas sa source.
--
-- LE TEXTE COURANT, LUI, VIT DANS `commercial_config` sous la clé
-- `billing.commitment.terms`, écrite par `admin_set_commercial_config`
-- (§ 7) — avec motif et journal, comme tout le reste. On réutilise le
-- moteur existant plutôt que d'en poser un second.

create table if not exists public.subscription_commitment_acceptances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  -- Le code AU MOMENT DE L'ACTE, sans clé étrangère : une preuve ne
  -- doit pas pouvoir être vidée par la suppression d'une ligne de
  -- catalogue.
  discount_code text not null,
  subscription_discount_id uuid references public.subscription_discounts (id) on delete set null,

  -- Le compte qui a accompli le geste d'acceptation. Aujourd'hui
  -- l'administrateur qui pose la remise ; demain le client lui-même,
  -- quand l'écran de souscription existera. La colonne ne change pas de
  -- sens entre les deux.
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz not null default now(),

  -- LES TROIS CHIFFRES ANNONCÉS AVANT, FIGÉS. Ils sont dérivables
  -- aujourd'hui ; ils ne le seront plus quand la grille aura bougé, et
  -- c'est justement ce qu'une preuve doit résister.
  commitment_months integer not null check (commitment_months between 1 and 60),
  monthly_price_during_cents bigint not null check (monthly_price_during_cents >= 0),
  monthly_price_after_cents bigint not null check (monthly_price_after_cents >= 0),
  plan_key text not null,

  terms_text text not null
    constraint subscription_commitment_acceptances_terms_not_blank check (btrim(terms_text) <> ''),
  terms_version text not null
    constraint subscription_commitment_acceptances_version_not_blank check (btrim(terms_version) <> ''),

  audit_event_id uuid references public.admin_audit_events (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists subscription_commitment_acceptances_org_idx
  on public.subscription_commitment_acceptances (organization_id, accepted_at desc);

alter table public.subscription_commitment_acceptances enable row level security;

-- LE CLIENT RELIT CE QU'IL A SIGNÉ. C'est la contrepartie de
-- l'engagement, et c'est déjà ce que fait la remise elle-même
-- juste au-dessus.
drop policy if exists "Le client relit son engagement, les habilités tous"
  on public.subscription_commitment_acceptances;
create policy "Le client relit son engagement, les habilités tous"
  on public.subscription_commitment_acceptances
  for select using (
    public.is_organization_member(organization_id)
    or public.platform_admin_can('billing.subscriptions.read')
  );

-- AUCUNE POLITIQUE D'ÉCRITURE, NI D'`update`, NI DE `delete` — comme
-- `organization_subscription_events`. Une preuve qui se modifie n'est
-- pas une preuve. Le seul chemin d'écriture est `admin_apply_discount`,
-- en `security definer`.

comment on table public.subscription_commitment_acceptances is
  'La preuve qu''un abonné a accepté un engagement : qui, quand, les trois chiffres annoncés, et LE TEXTE EXACT qu''il a lu. En ajout seul.';

-- LE TEXTE COURANT, semé une fois. `on conflict do nothing` : il vit
-- ensuite dans le Control Center, et une reprise de migration
-- n'écrase pas une version rédigée depuis.
insert into public.commercial_config (config_key, config_value)
values ('billing.commitment.terms', jsonb_build_object(
  'version', '2026-01',
  'texte',
    'Engagement de douze mois. Le tarif fondateur de 49,90 € HT par mois s''applique pendant '
 || 'douze mois à compter de la souscription, sur l''offre Pro. Pendant cette durée, '
 || 'l''abonnement ne peut pas être résilié. Au treizième mois, l''abonnement se poursuit au '
 || 'tarif public de l''offre Pro, soit 79,90 € HT par mois, et redevient résiliable à tout '
 || 'moment. Tous les montants sont hors taxes ; la TVA applicable s''ajoute.'))
on conflict (config_key) do nothing;

-- ------------------------------------------------------------
-- 4.c ter LES TROIS CHIFFRES À ANNONCER AVANT
-- ------------------------------------------------------------
-- LE PRIX APRÈS N'EST PAS RECOPIÉ DANS LE CATALOGUE, ET C'EST VOULU :
-- il se DÉDUIT du tarif public de l'offre visée, ce à quoi sert
-- `applies_to_plan`. Recopié, il dériverait au premier changement de
-- grille et l'écran annoncerait un retour à un tarif qui n'existe plus.
--
-- Une fonction plutôt qu'une vue, pour que DEUX écrans ne recomposent
-- pas le prix d'après chacun à sa façon.
create or replace function public.discount_offer_terms(p_code text)
returns table (
  code text,
  label text,
  plan_key text,
  plan_name text,
  duration_months integer,
  monthly_price_during_cents bigint,
  monthly_price_after_cents bigint,
  requires_commitment boolean,
  commitment_months integer,
  blocking_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_offer record;
  v_plan record;
begin
  if not public.platform_admin_can('billing.plans.read') then
    raise exception 'Accès refusé : permission billing.plans.read manquante.'
      using errcode = '42501';
  end if;

  select * into v_offer from public.discount_offers o
   where o.code = upper(btrim(coalesce(p_code, '')));
  if v_offer.code is null then
    return;
  end if;

  select * into v_plan from public.organization_plans p where p.key = v_offer.applies_to_plan;

  return query select
    v_offer.code,
    v_offer.label,
    v_offer.applies_to_plan,
    v_plan.name,
    v_offer.duration_months,
    -- Le prix PENDANT n'a de sens que pour un prix mensuel imposé. Pour
    -- un pourcentage, il dépend de l'offre et se calcule à la facture :
    -- on rend INCONNU plutôt qu'un chiffre inventé.
    case when v_offer.kind = 'fixedMonthlyPrice' then v_offer.value_cents end,
    v_plan.monthly_price_cents,
    v_offer.requires_commitment,
    v_offer.commitment_months,
    case
      when v_offer.applies_to_plan is null then
        'Cette remise ne vise aucune offre en particulier : le tarif d''après dépend de l''abonnement.'
      when v_plan.key is null then
        'L''offre « ' || v_offer.applies_to_plan || ' » n''existe pas.'
      when v_plan.monthly_price_cents is null then
        'L''offre « ' || v_plan.name || ' » n''a pas de tarif mensuel public : le prix d''après ne peut pas être annoncé.'
      when v_offer.kind = 'fixedMonthlyPrice' and v_offer.value_cents is null then
        'Le prix imposé par cette remise n''est pas renseigné.'
    end;
end;
$$;

comment on function public.discount_offer_terms(text) is
  'Ce qu''un écran doit ANNONCER AVANT une souscription à remise : durée, prix pendant, prix après, engagement. '
  'Le prix après vient du tarif public de l''offre visée — il n''est jamais recopié, donc jamais périmé.';

-- ------------------------------------------------------------
-- 4.d Le catalogue des modules — semis
-- ------------------------------------------------------------
-- LIVRÉS : BioLab (phase 7) et Pépinière (0052). Ils deviennent des
-- modules FACTURABLES, et c'est le seul changement de nature apporté
-- ici.
--
-- ANNONCÉS SANS PRIX ARRÊTÉ : les huit suivants. On les accueille dans
-- la matrice — c'est le point d'une matrice — mais `is_delivered` reste
-- faux, la souscription les refuse, et l'écran doit dire franchement
-- qu'ils ne sont pas livrés. Les prix annoncés (19 €, 49 €) sont posés
-- au niveau de la CASE, pas du module, parce qu'un module n'a pas de
-- prix en soi.

insert into public.platform_modules (key, name, tagline, is_delivered, pricing_model, metered_unit, position, note) values
  ('biolab',        'BioLab',                'Culture in vitro, micropropagation, laboratoire', true,  'flat',       null,           1,
   'Livré (phase 7). Inclus dans Pro Business, en option sur Pro.'),
  ('nursery',       'Pépinière',             'Lots, emplacements, mouvements de stock, production', true, 'flat',    null,           2,
   'Livré (0052). Inclus dans Pro Business, en option sur Pro.'),
  ('aiProPlus',     'IA Pro+',               'Agents avancés et quotas relevés',                false, 'flat',       null,           3,
   'ANNONCÉ, NON LIVRÉ. Prix annoncé 19 €/mois, à confirmer offre par offre.'),
  ('whiteLabel',    'Marque blanche',        'Documents et portail aux couleurs du client',     false, 'flat',       null,           4,
   'ANNONCÉ, NON LIVRÉ. Prix annoncé 49 €/mois.'),
  ('sms',           'SMS',                   'Rappels et notifications par SMS',                false, 'metered',    'sms',          5,
   'ANNONCÉ, NON LIVRÉ. Au compteur : le prix unitaire n''est pas arrêté.'),
  ('eSignature',    'Signature électronique','Devis et contrats signés en ligne',               false, 'metered',    'signature',    6,
   'ANNONCÉ, NON LIVRÉ. Prix non arrêté.'),
  ('onlinePayments','Paiement en ligne',     'Règlement des factures clients par carte',        false, 'commission', null,           7,
   'ANNONCÉ, NON LIVRÉ. Rémunéré à la commission : le taux n''est pas arrêté.'),
  ('extraStorage',  'Stockage supplémentaire','Au-delà du stockage compris dans l''offre',      false, 'metered',    'Go par mois',  8,
   'ANNONCÉ, NON LIVRÉ. Au compteur : le prix au Go n''est pas arrêté.'),
  ('api',           'API',                   'Accès programmatique et intégrations',            false, 'flat',       null,           9,
   'ANNONCÉ, NON LIVRÉ. Annoncé comme un différenciateur de Pro Business.')
on conflict (key) do nothing;

insert into public.discount_offers
  (code, label, kind, value_cents, duration_months, is_active,
   applies_to_plan, requires_commitment, commitment_months, note)
values
  ('FONDATEUR', 'Tarif fondateur', 'fixedMonthlyPrice', 4990, 12, true,
   'team', true, 12,
   'Décision du dirigeant : 49,90 €/mois HT pendant 12 MOIS, SUR L''OFFRE PRO (team) UNIQUEMENT, '
   'AVEC ENGAGEMENT sur ces douze mois, puis retour au tarif public de 79,90 € HT. '
   'L''à-vie a été écarté — une remise à vie sur un abonnement récurrent est une dette perpétuelle. '
   'La restriction d''offre existe parce qu''un prix imposé de 49,90 € posé sur Pro Business '
   '(139,90 €) offrirait 90 € par mois au lieu de 30, sans que rien ne le signale.')
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- 4.e Une offre neuve : Enterprise
-- ------------------------------------------------------------
-- La seule des quatre qui n'avait aucune ligne. Sur devis, donc sans
-- prix public : la contrainte du § 4.a l'oblige à porter un plancher et
-- rien d'autre.
--
-- `included_seats` RESTE NULL, ET C'EST LE BON ÉTAT. « Au-delà, sur
-- devis » veut dire que la capacité d'Enterprise se négocie, pas
-- qu'elle est fixée par la grille : le NULL dit « non décidé », il ne
-- dit pas « oublié ». Un relecteur qui le comblerait inventerait un
-- nombre que personne n'a donné.
insert into public.organization_plans
  (key, name, tagline, features, monthly_price_cents, max_users, position, is_active,
   is_quote_only, price_floor_cents, currency, seat_policy, extra_seat_monthly_price_cents)
values
  ('enterprise', 'Enterprise', 'Groupes, réseaux et multi-sites — sur devis',
   '["Tout Pro Business","Multi-entreprises","Accompagnement dédié","Engagement et SLA négociés"]'::jsonb,
   null, null, 4, true, true, 24900, 'EUR', 'billedBeyondIncluded', 990)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 4.f LE SEMIS DE LA GRILLE — une seule fois
-- ------------------------------------------------------------
-- POURQUOI UN MARQUEUR PLUTÔT QU'UN `update` FRANC. Ce bloc renomme des
-- offres et pose des prix. Rejoué après qu'un administrateur a changé un
-- tarif depuis l'écran, un `update` franc écraserait sa décision et la
-- remplacerait par celle d'un fichier de migration écrit des mois plus
-- tôt. Le marqueur — une ligne de `commercial_config` — rend le bloc
-- idempotent SANS être destructeur : il pose la grille initiale, puis ne
-- la touche plus jamais.
--
-- LA CORRESPONDANCE ENTRE LES QUATRE OFFRES DU DIRIGEANT ET LES QUATRE
-- CLÉS EXISTANTES, ET C'EST UNE DÉCISION À CONFIRMER :
--
--   solo     → PRO SOLO      39,90 / 399
--   team     → PRO           79,90 / 799   ← l'offre phare, best-seller
--   business → PRO BUSINESS 139,90 / 1 399
--   nursery  → DÉSACTIVÉE
--   enterprise (neuve) → à partir de 249 €, sur devis
--
-- POURQUOI `nursery` DISPARAÎT DE LA GRILLE. Le jour où Pépinière
-- devient un MODULE, une offre dont c'était toute la promesse vendrait
-- comme un forfait ce qui se vend désormais comme une option — deux prix
-- pour la même chose. Elle passe `is_active = false`, ce qui la retire
-- de `web-pro` (qui filtre là-dessus) sans casser la moindre clé
-- étrangère : une entreprise qui y serait abonnée le reste, et son
-- abonnement reste lisible.
--
-- Les CLÉS ne changent pas. Elles sont référencées par
-- `organization_subscriptions.plan`, et renommer une clé primaire
-- textuelle pour faire joli, c'est réécrire des données comptables pour
-- une question de vocabulaire.

do $$
declare
  v_deja boolean;
begin
  select true into v_deja from public.commercial_config
   where config_key = 'pricing.grid.0081';

  if v_deja is null then
    update public.organization_plans set
      name = 'Pro Solo',
      tagline = 'L''indépendant du paysage, équipé comme une entreprise',
      monthly_price_cents = 3990,
      yearly_price_cents = 39900,
      position = 1,
      is_active = true,
      seat_policy = 'billedBeyondIncluded',
      extra_seat_monthly_price_cents = 990,
      -- LES SIÈGES COMPRIS, tranchés par le dirigeant : « solo 1, pro 5
      -- et business 10, et au-delà sur devis ». `max_users` suit la
      -- même valeur : c'est l'indication que lit `web-pro` (« Ce
      -- forfait en prévoit N »), et la laisser en désaccord avec
      -- `included_seats` donnerait deux vérités, dont une invisible —
      -- l'écran muet sur la capacité pendant que la facturation en
      -- compte cinq.
      included_seats = 1,
      max_users = 1,
      features = '["CRM et clients","Devis et factures","Planning","Jardin connecté (capteurs, automatisations, jumeau numérique, IA)","1 utilisateur compris"]'::jsonb,
      updated_at = now()
    where key = 'solo';

    -- L'OFFRE PHARE. Le dirigeant vise 70 à 80 % des abonnements pros
    -- ici, et le jardin connecté y est ENTIER : capteurs,
    -- automatisations, jumeau numérique, IA du jardin. Ne pas le
    -- remonter en Business « parce que c'est avancé » — c'est le
    -- contraire de la stratégie.
    update public.organization_plans set
      name = 'Pro',
      tagline = 'Le système d''exploitation de l''entreprise de paysage',
      monthly_price_cents = 7990,
      yearly_price_cents = 79900,
      position = 2,
      is_active = true,
      badge = 'bestSeller',
      seat_policy = 'billedBeyondIncluded',
      extra_seat_monthly_price_cents = 990,
      included_seats = 5,
      max_users = 5,
      features = '["Tout Pro Solo","Équipe et permissions","5 utilisateurs compris","Planning d''équipe","Jardin connecté complet","Chantiers et suivi de rentabilité"]'::jsonb,
      updated_at = now()
    where key = 'team';

    -- Ce qui distingue Business, et RIEN D'AUTRE : le métier
    -- d'entreprise. Pépinière, stocks, production, fournisseurs,
    -- analytique avancée, API, exports comptables. Rien qui touche au
    -- jardin connecté, qui est déjà entier dans Pro.
    update public.organization_plans set
      name = 'Pro Business',
      tagline = 'Production, stocks et pilotage — le métier d''entreprise',
      monthly_price_cents = 13990,
      yearly_price_cents = 139900,
      position = 3,
      is_active = true,
      seat_policy = 'billedBeyondIncluded',
      extra_seat_monthly_price_cents = 990,
      included_seats = 10,
      max_users = 10,
      -- AU-DELÀ DE DIX, LE SIÈGE SUPPLÉMENTAIRE RESTE LA RÈGLE (9,90 €),
      -- comme dans les deux autres offres. « Au-delà, sur devis »
      -- désigne la bascule COMMERCIALE vers Enterprise, pas un plafond
      -- appliqué : `seat_policy` vaut `billedBeyondIncluded` ici, et
      -- rien en base n'empêchera de facturer un trentième siège sur
      -- Pro Business. La valeur `hardCap` existe dans la contrainte du
      -- § 4.a pour le jour où un plafond chiffré sera décidé ; il ne
      -- l'est pas.
      features = '["Tout Pro","10 utilisateurs compris","Module Pépinière compris","Module BioLab compris","Stocks, production, fournisseurs","Analytique avancée et exports comptables","API"]'::jsonb,
      updated_at = now()
    where key = 'business';

    update public.organization_plans set
      is_active = false,
      tagline = 'Offre retirée : la Pépinière est désormais un module, comprise dans Pro Business et en option sur Pro.',
      position = 90,
      updated_at = now()
    where key = 'nursery';

    -- LA MATRICE, TELLE QUE LE DIRIGEANT L'A ARRÊTÉE.
    --   BIOLAB     inclus dans Business · +20 €/mois sur Pro
    --   PÉPINIÈRE  inclus dans Business · +20 €/mois sur Pro
    -- (Le +29 € annoncé plus tôt est CORRIGÉ à 20 € et ne doit pas
    -- ressusciter.)
    insert into public.plan_modules (plan_key, module_key, availability, monthly_price_cents, yearly_price_cents)
    values
      ('team',     'biolab',  'optional', 2000, 20000),
      ('team',     'nursery', 'optional', 2000, 20000),
      ('business', 'biolab',  'included', null, null),
      ('business', 'nursery', 'included', null, null),
      -- L'API est annoncée comme un différenciateur de Pro Business.
      -- Le module n'est pas livré ; la case dit tout de même la
      -- promesse commerciale, et `is_delivered` empêche d'y souscrire.
      ('business', 'api',     'included', null, null)
    on conflict (plan_key, module_key) do update
      set availability = excluded.availability,
          monthly_price_cents = excluded.monthly_price_cents,
          yearly_price_cents = excluded.yearly_price_cents,
          updated_at = now();

    insert into public.commercial_config (config_key, config_value)
    values ('pricing.grid.0081', jsonb_build_object(
      'posee_le', now(),
      'note', 'Grille tarifaire initiale posée par la migration 0081. '
           || 'Ce marqueur empêche une reprise de migration d''écraser les prix '
           || 'qu''un administrateur aurait changés depuis le Control Center.'))
    on conflict (config_key) do nothing;
  end if;
end $$;

-- LE REMPLISSAGE « NON DÉCIDÉ », ET IL EST VOLONTAIREMENT EXHAUSTIF.
-- Chaque couple offre × module reçoit une case. Celles que le dirigeant
-- a arrêtées viennent d'être écrites juste au-dessus ; toutes les
-- autres — Pro Solo × BioLab, Enterprise × Pépinière, et les huit
-- modules non livrés sur les cinq offres — valent explicitement
-- « undecided ».
--
-- `on conflict do nothing` : ce bloc n'écrase JAMAIS une décision. Il
-- rattrape les cases neuves à chaque offre ou module ajouté, ce qui est
-- exactement ce qu'on veut d'un remplissage par défaut.
insert into public.plan_modules (plan_key, module_key, availability)
select p.key, m.key, 'undecided'
from public.organization_plans p
cross join public.platform_modules m
on conflict (plan_key, module_key) do nothing;

-- ------------------------------------------------------------
-- 4.g Écrire la grille — les seuls chemins
-- ------------------------------------------------------------
-- `organization_plans` n'avait, jusqu'ici, AUCUNE politique d'écriture :
-- une seule ligne dans `pg_policies`, « Anyone authenticated can read
-- plans ». On n'en ouvre pas : les prix sont ce que ce chantier crée de
-- plus précieux, et un prix changé sans motif ni trace est exactement ce
-- qu'on voudra comprendre le jour où le chiffre d'affaires bouge.

create or replace function public.admin_set_plan_pricing(
  p_plan_key text,
  p_monthly_price_cents bigint,
  p_yearly_price_cents bigint,
  p_reason text,
  p_included_seats integer default null,
  p_extra_seat_monthly_price_cents bigint default null,
  p_ai_monthly_quota integer default null,
  p_storage_gb integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_old jsonb;
  v_plan record;
begin
  if not public.platform_admin_can('billing.plans.write') then
    raise exception 'Accès refusé : permission billing.plans.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : un prix change ce que paient toutes les entreprises abonnées à cette offre.'
      using errcode = '23514';
  end if;

  select * into v_plan from public.organization_plans where key = p_plan_key;
  if v_plan.key is null then
    raise exception 'Offre inconnue : %.', coalesce(p_plan_key, '(vide)') using errcode = '23503';
  end if;

  -- UNE OFFRE SUR DEVIS N'A PAS DE PRIX PUBLIC. La contrainte de table
  -- le refuserait ; on le dit ici pour que le message soit lisible.
  if v_plan.is_quote_only and (p_monthly_price_cents is not null or p_yearly_price_cents is not null) then
    raise exception 'L''offre « % » est sur devis : son prix se négocie et se pose sur l''abonnement, pas sur la grille publique.', v_plan.name
      using errcode = '23514';
  end if;

  v_old := jsonb_build_object(
    'monthly', v_plan.monthly_price_cents,
    'yearly', v_plan.yearly_price_cents,
    'includedSeats', v_plan.included_seats,
    'extraSeat', v_plan.extra_seat_monthly_price_cents,
    'aiQuota', v_plan.ai_monthly_quota,
    'storageGb', v_plan.storage_gb);

  update public.organization_plans set
    monthly_price_cents = p_monthly_price_cents,
    yearly_price_cents = p_yearly_price_cents,
    -- `coalesce` sur les quatre paramètres facultatifs : les omettre
    -- veut dire « ne touche pas », pas « efface ». Un formulaire de
    -- prix qui viderait le quota IA au passage serait une mauvaise
    -- surprise.
    included_seats = coalesce(p_included_seats, included_seats),
    extra_seat_monthly_price_cents = coalesce(p_extra_seat_monthly_price_cents, extra_seat_monthly_price_cents),
    ai_monthly_quota = coalesce(p_ai_monthly_quota, ai_monthly_quota),
    storage_gb = coalesce(p_storage_gb, storage_gb),
    updated_at = now(),
    updated_by = auth.uid()
  where key = p_plan_key;

  return public.record_admin_event(
    'plan.pricingChanged', 'organization_plan', null, v_plan.name,
    v_old,
    jsonb_build_object(
      'monthly', p_monthly_price_cents,
      'yearly', p_yearly_price_cents,
      'includedSeats', coalesce(p_included_seats, v_plan.included_seats),
      'extraSeat', coalesce(p_extra_seat_monthly_price_cents, v_plan.extra_seat_monthly_price_cents),
      'aiQuota', coalesce(p_ai_monthly_quota, v_plan.ai_monthly_quota),
      'storageGb', coalesce(p_storage_gb, v_plan.storage_gb)),
    v_reason);
end;
$$;

create or replace function public.admin_set_plan_module(
  p_plan_key text,
  p_module_key text,
  p_availability text,
  p_monthly_price_cents bigint,
  p_yearly_price_cents bigint,
  p_reason text,
  p_metered_unit_price_cents bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_old jsonb;
  v_plan_name text;
  v_module_name text;
begin
  if not public.platform_admin_can('billing.plans.write') then
    raise exception 'Accès refusé : permission billing.plans.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : décider qu''un module est inclus ou payant, c''est décider d''un revenu.'
      using errcode = '23514';
  end if;

  if p_availability is null or p_availability not in ('included', 'optional', 'unavailable', 'undecided') then
    raise exception 'État de case inconnu : %. Les quatre états sont included, optional, unavailable, undecided.', coalesce(p_availability, '(vide)')
      using errcode = '23514';
  end if;

  select name into v_plan_name from public.organization_plans where key = p_plan_key;
  if v_plan_name is null then
    raise exception 'Offre inconnue : %.', coalesce(p_plan_key, '(vide)') using errcode = '23503';
  end if;
  select name into v_module_name from public.platform_modules where key = p_module_key;
  if v_module_name is null then
    raise exception 'Module inconnu : %.', coalesce(p_module_key, '(vide)') using errcode = '23503';
  end if;

  select jsonb_build_object('availability', pm.availability, 'monthly', pm.monthly_price_cents)
    into v_old
  from public.plan_modules pm
  where pm.plan_key = p_plan_key and pm.module_key = p_module_key;

  insert into public.plan_modules (plan_key, module_key, availability,
                                   monthly_price_cents, yearly_price_cents, metered_unit_price_cents,
                                   updated_at, updated_by)
  values (p_plan_key, p_module_key, p_availability,
          case when p_availability = 'optional' then p_monthly_price_cents end,
          case when p_availability = 'optional' then p_yearly_price_cents end,
          case when p_availability = 'optional' then p_metered_unit_price_cents end,
          now(), auth.uid())
  on conflict (plan_key, module_key) do update
    set availability = excluded.availability,
        monthly_price_cents = excluded.monthly_price_cents,
        yearly_price_cents = excluded.yearly_price_cents,
        metered_unit_price_cents = excluded.metered_unit_price_cents,
        updated_at = now(),
        updated_by = excluded.updated_by;

  return public.record_admin_event(
    'plan.moduleTermsChanged', 'organization_plan', null,
    v_plan_name || ' × ' || v_module_name,
    v_old,
    jsonb_build_object('availability', p_availability,
                       'monthly', case when p_availability = 'optional' then p_monthly_price_cents end),
    v_reason);
end;
$$;

-- ============================================================
-- 5. LES ABONNEMENTS PRO, ADMINISTRÉS À LA MAIN
-- ============================================================
--
-- IL FAUT LE DIRE À L'ÉCRAN, ET LE DIRE ICI : RIEN NE CRÉE
-- AUTOMATIQUEMENT UN ABONNEMENT. `organization_subscriptions` compte
-- zéro ligne, et la seule mention de la table dans tout le dépôt côté
-- produit est une LECTURE — `startCheckout` rend délibérément
-- « unavailable ». L'ADMINISTRATEUR EST DONC LA SOURCE : ce paragraphe
-- lui donne les sept gestes de la spec p.13, et pas un mécanisme
-- d'encaissement déguisé.

-- ------------------------------------------------------------
-- 5.a LA FAILLE, REFERMÉE
-- ------------------------------------------------------------
-- « Admins change their subscription », posée par 0060, est en
-- `cmd = ALL` avec `has_permission(organization_id,
-- 'organization.manageUsers')` en `using` ET en `with_check`.
-- `has_permission()` accorde cette permission à tout `owner` et tout
-- `admin` d'entreprise CLIENTE. Autrement dit : le propriétaire d'une
-- entreprise Pro peut, aujourd'hui, écrire lui-même sa ligne
-- d'abonnement — s'attribuer l'offre la plus chère, se remettre en
-- 'active' après une annulation, ou repousser `current_period_end`.
--
-- Personne n'en a profité parce qu'aucun prix n'existait et qu'aucune
-- facture n'était émise. Ce fichier crée les deux. La politique part
-- donc dans le même lot que les prix : on ne crée pas une valeur pour
-- la laisser voler.
--
-- CE QUI RESTE : « Members read their subscription ». Le client
-- continue de VOIR son abonnement — c'est le sien — il ne l'écrit plus.
drop policy if exists "Admins change their subscription" on public.organization_subscriptions;

-- ET CE QU'IL FAUT AJOUTER DANS LE MÊME GESTE, faute de quoi on
-- refermerait la porte sur nous-mêmes. Retirer la politique ci-dessus
-- ne laisse que « Members read their subscription » — et un
-- administrateur de plateforme n'est membre d'AUCUNE entreprise
-- cliente. La table centrale de ce lot deviendrait illisible pour le
-- rôle facturation, dont c'est pourtant le métier, alors que ses quatre
-- tables satellites (historique, modules, crédits, remises) portent
-- toutes `billing.subscriptions.read`.
--
-- LE PIÈGE, ET IL EST COMPLET : l'unique super-administrateur de
-- production EST membre de l'unique entreprise. L'écran aurait donc
-- marché chez celui qui le teste, et aurait été vide chez tous les
-- autres. C'est le mode de défaillance qui ne se voit qu'ailleurs.
drop policy if exists "Les habilités lisent les abonnements" on public.organization_subscriptions;
create policy "Les habilités lisent les abonnements" on public.organization_subscriptions
  for select using (public.platform_admin_can('billing.subscriptions.read'));

-- ------------------------------------------------------------
-- 5.b Ce qui manquait à `organization_subscriptions`
-- ------------------------------------------------------------
alter table public.organization_subscriptions
  -- LE CYCLE. Il n'existait nulle part, et 0075 le dit à l'endroit du
  -- calcul de l'ARR : « le schéma n'a aucune notion de cycle », d'où la
  -- multiplication par douze. Il vit sur l'ABONNEMENT et non sur
  -- l'offre : deux entreprises peuvent souscrire la même offre, l'une
  -- au mois, l'autre à l'année.
  add column if not exists billing_cycle text not null default 'monthly',

  -- LE PRIX NÉGOCIÉ, pour les offres sur devis uniquement. Une offre
  -- Enterprise n'a pas de prix public : celui-ci est le vrai, et c'est
  -- lui que la facture reprend.
  add column if not exists negotiated_monthly_price_cents bigint,
  add column if not exists negotiated_yearly_price_cents bigint,

  -- LES SIÈGES FACTURÉS EN PLUS. Saisis par un administrateur, jamais
  -- comptés automatiquement depuis `organization_members` : tant que
  -- `included_seats` n'est pas décidé sur les offres, un comptage
  -- automatique facturerait faux dans un sens ou dans l'autre. Le jour
  -- où le dirigeant aura tranché, ce champ pourra être alimenté par un
  -- calcul — et ce sera une décision, pas un effet de bord.
  add column if not exists billable_extra_seats integer not null default 0,

  add column if not exists trial_ends_at timestamptz,
  -- « Annuler à l'échéance » (spec p.13) : l'abonnement court jusqu'au
  -- bout de la période payée, puis s'arrête. Ce n'est pas la même chose
  -- qu'une annulation immédiate, et confondre les deux fait rembourser
  -- ou facturer à tort.
  add column if not exists cancel_at_period_end boolean not null default false,

  add column if not exists currency text not null default 'EUR',
  add column if not exists note text,
  add column if not exists managed_by uuid references auth.users (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organization_subscriptions_cycle_valid') then
    alter table public.organization_subscriptions add constraint organization_subscriptions_cycle_valid
      check (billing_cycle in ('monthly', 'yearly'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'organization_subscriptions_seats_not_negative') then
    alter table public.organization_subscriptions add constraint organization_subscriptions_seats_not_negative
      check (billable_extra_seats >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'organization_subscriptions_negotiated_not_negative') then
    alter table public.organization_subscriptions add constraint organization_subscriptions_negotiated_not_negative
      check (coalesce(negotiated_monthly_price_cents, 0) >= 0
         and coalesce(negotiated_yearly_price_cents, 0) >= 0);
  end if;
end $$;

-- UNE OFFRE SUR DEVIS NE SE SOUSCRIT PAS EN LIBRE-SERVICE, et la base
-- l'empêche plutôt que de laisser l'écran l'oublier. Un déclencheur
-- plutôt qu'une contrainte `check`, parce que la règle dépend d'une
-- AUTRE table (`organization_plans.is_quote_only`).
--
-- Le même déclencheur porte la seconde règle du § 4.b : un changement
-- d'offre RÉÉVALUE les modules en cours, et refuse si la nouvelle offre
-- ne sait pas les accueillir. Sans lui, une entreprise se retrouverait
-- avec un module actif dont la case vaut « indisponible » ou « non
-- décidé » — un module qu'on ne saurait ni facturer, ni retirer, ni
-- expliquer.
--
-- ET IL PORTE LE VOLET SYMÉTRIQUE DE LA RESTRICTION D'OFFRE DU § 4.c,
-- qui est la vraie fuite d'argent. `admin_set_subscription_plan` ne lit
-- aucune remise : sans ce contrôle, un client fondateur passe de Pro à
-- Pro Business en gardant son prix imposé de 49,90 €, et reçoit 90 €
-- par mois au lieu de 30 — en silence, la facture et le MRR étant
-- d'accord entre eux.
--
-- ET ENFIN L'ENGAGEMENT. Une résiliation avant terme est refusée ICI,
-- et pas seulement dans la fonction d'administration : toutes les
-- fonctions de ce fichier sont `security definer`, donc un contrôle
-- écrit dans l'une d'elles serait contourné par tout autre chemin —
-- l'éditeur SQL, un appel en `service_role`, et le libre-service qui
-- n'existe pas encore mais existera. Un déclencheur, lui, mord partout.
create or replace function public.organization_subscriptions_plan_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_plan record;
  v_bad text;
  v_disc record;
  v_resilie boolean;
begin
  select * into v_plan from public.organization_plans where key = new.plan;
  if v_plan.key is null then
    raise exception 'Offre inconnue : %.', new.plan using errcode = '23503';
  end if;

  if v_plan.is_quote_only
     and new.negotiated_monthly_price_cents is null
     and new.negotiated_yearly_price_cents is null then
    raise exception 'L''offre « % » est sur devis : elle ne se souscrit pas sans prix négocié. Renseignez negotiated_monthly_price_cents.', v_plan.name
      using errcode = '23514';
  end if;

  if not v_plan.is_quote_only
     and (new.negotiated_monthly_price_cents is not null or new.negotiated_yearly_price_cents is not null) then
    raise exception 'L''offre « % » a un prix public : un prix négocié à côté ferait deux vérités concurrentes sur la même facture.', v_plan.name
      using errcode = '23514';
  end if;

  -- La réévaluation des options, seulement quand l'offre CHANGE — et
  -- seulement si la table des modules souscrits existe déjà (elle est
  -- créée juste après, et ce fichier doit rester rejouable en tout
  -- point).
  if tg_op = 'UPDATE' and new.plan is distinct from old.plan
     and to_regclass('public.organization_subscription_modules') is not null then
    execute
      'select string_agg(m.name || '' ('' || coalesce(pm.availability, ''undecided'') || '')'', '', '')
         from public.organization_subscription_modules sm
         join public.platform_modules m on m.key = sm.module_key
         left join public.plan_modules pm on pm.module_key = sm.module_key and pm.plan_key = $1
        where sm.organization_id = $2
          and sm.cancelled_at is null
          and coalesce(pm.availability, ''undecided'') not in (''included'', ''optional'')'
      into v_bad using new.plan, new.organization_id;

    if v_bad is not null then
      raise exception 'Changement d''offre refusé : sur « % », ces modules souscrits ne sont ni inclus ni proposés en option — %. Retirez-les d''abord, ou décidez leur case dans la matrice.', v_plan.name, v_bad
        using errcode = '23514';
    end if;
  end if;

  -- ---- LES REMISES EN COURS -------------------------------------
  -- La même garde de rejouabilité que ci-dessus : la table des remises
  -- naît au § 4.c, donc AVANT ce paragraphe. La garde protège du jour
  -- où quelqu'un réordonnera les paragraphes.
  if to_regclass('public.subscription_discounts') is not null then

    -- 1. CHANGER D'OFFRE SOUS UNE REMISE QUI VISE L'ANCIENNE.
    if tg_op = 'UPDATE' and new.plan is distinct from old.plan then
      execute
        'select d.label || '' (jusqu''''au '' || to_char(d.ends_on, ''DD/MM/YYYY'') || '')''
           from public.subscription_discounts d
          where d.organization_id = $1
            and d.cancelled_at is null
            and d.applies_to_plan is not null
            and d.applies_to_plan is distinct from $2
            and d.ends_on > current_date
          order by d.starts_on desc
          limit 1'
        into v_bad using new.organization_id, new.plan;

      if v_bad is not null then
        raise exception 'Changement d''offre refusé : la remise « % » est réservée à une AUTRE offre. Retirez-la d''abord — la garder ici offrirait la différence de tarif en silence.', v_bad
          using errcode = '23514';
      end if;
    end if;

    -- 2. BASCULER AU CYCLE ANNUEL SOUS UN ENGAGEMENT. Sans ce refus, on
    -- souscrit au mois, on bascule à l'année, et on retombe sur la
    -- facture bancale que le § 4.c refuse d'écrire.
    if tg_op = 'UPDATE' and new.billing_cycle = 'yearly' and old.billing_cycle <> 'yearly' then
      execute
        'select d.label
           from public.subscription_discounts d
          where d.organization_id = $1
            and d.cancelled_at is null
            and d.commitment_ends_on is not null
            and d.commitment_ends_on > current_date
          limit 1'
        into v_bad using new.organization_id;

      if v_bad is not null then
        raise exception 'Passage au cycle ANNUEL refusé : la remise « % » engage cet abonnement et ne se vend qu''AU MOIS.', v_bad
          using errcode = '23514';
      end if;
    end if;

    -- 3. RÉSILIER AVANT LE TERME DE L'ENGAGEMENT.
    -- On ne refuse QUE LE SENS QUI RÉSILIE : `admin_reactivate_subscription`
    -- remet `cancelled_at` à nul et le statut à 'active', et ce geste-là
    -- est favorable au client — le bloquer serait un contresens.
    if tg_op = 'UPDATE' then
      v_resilie := (new.cancel_at_period_end and not old.cancel_at_period_end)
                or (new.cancelled_at is not null and old.cancelled_at is null)
                or (new.status = 'cancelled' and old.status is distinct from 'cancelled');

      if v_resilie then
        execute
          'select d.label || ''|'' || to_char(d.commitment_ends_on, ''DD/MM/YYYY'')
             from public.subscription_discounts d
            where d.organization_id = $1
              and d.cancelled_at is null
              and d.commitment_ends_on is not null
              and d.commitment_ends_on > current_date
            order by d.commitment_ends_on desc
            limit 1'
          into v_bad using new.organization_id;

        if v_bad is not null then
          raise exception 'Résiliation refusée : la remise « % » engage cet abonnement jusqu''au %. Un administrateur de plateforme peut passer outre avec un motif — la dérogation annule d''abord la remise, et la trace dit qui a levé quoi et pourquoi.',
            split_part(v_bad, '|', 1), split_part(v_bad, '|', 2)
            using errcode = '23514';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists organization_subscriptions_plan_guard on public.organization_subscriptions;
create trigger organization_subscriptions_plan_guard
  before insert or update on public.organization_subscriptions
  for each row execute function public.organization_subscriptions_plan_guard();

revoke all on function public.organization_subscriptions_plan_guard() from public;
revoke all on function public.organization_subscriptions_plan_guard() from anon;
revoke all on function public.organization_subscriptions_plan_guard() from authenticated;

-- ------------------------------------------------------------
-- 5.c L'HISTORIQUE, qui n'existait pas
-- ------------------------------------------------------------
-- `organization_subscriptions` a pour clé primaire `organization_id` :
-- UNE seule ligne par entreprise. `cancelled_at` est donc écrasé à
-- chaque changement, et il n'existe aucune trace des passages d'une
-- offre à l'autre. C'est la raison que 0075 donne pour rendre
-- `churn_30d_percent` inconnu, et elle est structurelle : ce n'est pas
-- que la donnée manque, c'est que le schéma ne peut pas la porter.
--
-- On pose donc une table d'événements EN AJOUT SEUL. Quelques octets
-- aujourd'hui contre une migration pénible plus tard sur des données
-- qui servent à calculer un chiffre d'affaires. Elle ne rend pas le
-- churn calculable tout de suite — il faut du temps et des lignes —
-- mais elle rend possible de le calculer un jour, ce qui est
-- exactement ce qu'on ne peut pas rattraper après coup.

create table if not exists public.organization_subscription_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  event text not null,
  plan_before text,
  plan_after text,
  status_before text,
  status_after text,
  old_value jsonb,
  new_value jsonb,

  actor_user_id uuid references auth.users (id) on delete set null,
  reason text,
  audit_event_id uuid references public.admin_audit_events (id) on delete set null,

  occurred_at timestamptz not null default now()
);

create index if not exists organization_subscription_events_org_idx
  on public.organization_subscription_events (organization_id, occurred_at desc);
create index if not exists organization_subscription_events_when_idx
  on public.organization_subscription_events (occurred_at desc);

alter table public.organization_subscription_events enable row level security;

drop policy if exists "L'entreprise et les habilités lisent l'historique d'abonnement" on public.organization_subscription_events;
create policy "L'entreprise et les habilités lisent l'historique d'abonnement" on public.organization_subscription_events
  for select using (
    public.is_organization_member(organization_id)
    or public.platform_admin_can('billing.subscriptions.read')
  );

-- AUCUNE politique d'écriture : ajout seul, par les fonctions du § 5.e.

-- ------------------------------------------------------------
-- 5.d Les modules souscrits
-- ------------------------------------------------------------
-- LA LIGNE NE PORTE AUCUN PRIX, et c'est tout l'intérêt. Le prix vient
-- de la matrice au moment de facturer : une entreprise Business ne paie
-- rien pour BioLab, et une entreprise Pro qui passe à Business cesse
-- d'être facturée sans qu'on touche à cette ligne.

create table if not exists public.organization_subscription_modules (
  organization_id uuid not null references public.business_organizations (id) on delete cascade,
  module_key text not null references public.platform_modules (key) on delete restrict,

  activated_at timestamptz not null default now(),
  activated_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  note text,

  primary key (organization_id, module_key)
);

create index if not exists organization_subscription_modules_active_idx
  on public.organization_subscription_modules (module_key) where cancelled_at is null;

alter table public.organization_subscription_modules enable row level security;

drop policy if exists "L'entreprise et les habilités lisent ses modules" on public.organization_subscription_modules;
create policy "L'entreprise et les habilités lisent ses modules" on public.organization_subscription_modules
  for select using (
    public.is_organization_member(organization_id)
    or public.platform_admin_can('billing.subscriptions.read')
  );

-- ------------------------------------------------------------
-- 5.e Les crédits accordés
-- ------------------------------------------------------------
-- « Accorder crédit » (spec p.13). Un crédit n'est pas un remboursement
-- et n'est pas une remise : c'est un avoir commercial qui se consomme
-- sur la prochaine facture. Il porte donc l'identifiant de la facture
-- qui l'a consommé, et une fois consommé il ne se réutilise pas.

create table if not exists public.saas_account_credits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.business_organizations (id) on delete cascade,

  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'EUR',
  reason text not null constraint saas_account_credits_reason_not_blank check (btrim(reason) <> ''),

  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz not null default now(),
  audit_event_id uuid references public.admin_audit_events (id) on delete set null,

  consumed_at timestamptz,
  consumed_invoice_id uuid,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,

  constraint saas_account_credits_consumption_coherent
    check ((consumed_at is null) = (consumed_invoice_id is null)),
  constraint saas_account_credits_not_both
    check (consumed_at is null or cancelled_at is null)
);

create index if not exists saas_account_credits_open_idx
  on public.saas_account_credits (organization_id)
  where consumed_at is null and cancelled_at is null;

alter table public.saas_account_credits enable row level security;

drop policy if exists "L'entreprise et les habilités lisent les crédits" on public.saas_account_credits;
create policy "L'entreprise et les habilités lisent les crédits" on public.saas_account_credits
  for select using (
    public.is_organization_member(organization_id)
    or public.platform_admin_can('billing.subscriptions.read')
  );

-- ------------------------------------------------------------
-- 5.f Une trace, deux tables, un seul geste
-- ------------------------------------------------------------
-- Chaque action d'abonnement écrit DEUX lignes : une dans
-- `admin_audit_events` (« qu'a fait l'équipe Oasis Care ») et une dans
-- `organization_subscription_events` (« qu'est-il arrivé à cet
-- abonnement »). Les deux répondent à des questions différentes, et la
-- seconde est celle qui rendra le churn calculable un jour.
--
-- Elles sont écrites par la même fonction, dans la même transaction :
-- il n'existe pas d'état « changé, tracé d'un seul côté ».
create or replace function public.record_subscription_event(
  p_organization_id uuid,
  p_event text,
  p_plan_before text,
  p_plan_after text,
  p_status_before text,
  p_status_after text,
  p_old jsonb,
  p_new jsonb,
  p_reason text,
  p_audit_event_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : seul un administrateur de la plateforme écrit l''historique d''un abonnement.'
      using errcode = '42501';
  end if;

  insert into public.organization_subscription_events
    (organization_id, event, plan_before, plan_after, status_before, status_after,
     old_value, new_value, actor_user_id, reason, audit_event_id)
  values
    (p_organization_id, p_event, p_plan_before, p_plan_after, p_status_before, p_status_after,
     p_old, p_new, auth.uid(), p_reason, p_audit_event_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- ------------------------------------------------------------
-- 5.g LES SEPT GESTES DE LA SPEC p.13
-- ------------------------------------------------------------
-- Plus un huitième que la spec ne nomme pas et sans lequel les sept
-- autres n'auraient rien à administrer : CRÉER l'abonnement. La table
-- est vide et rien ne l'écrit ; sans ce geste, l'écran « Abonnements »
-- serait une façade.

create or replace function public.admin_create_subscription(
  p_organization_id uuid,
  p_plan text,
  p_billing_cycle text,
  p_reason text,
  p_status text default 'trialing',
  p_trial_days integer default null,
  p_negotiated_monthly_price_cents bigint default null,
  p_negotiated_yearly_price_cents bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_org text;
  v_audit uuid;
  v_trial timestamptz;
begin
  if not public.platform_admin_can('billing.subscriptions.write') then
    raise exception 'Accès refusé : permission billing.subscriptions.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : un abonnement créé à la main engage une facturation.'
      using errcode = '23514';
  end if;

  if p_billing_cycle is null or p_billing_cycle not in ('monthly', 'yearly') then
    raise exception 'Cycle inconnu : %. Les deux cycles sont monthly et yearly.', coalesce(p_billing_cycle, '(vide)')
      using errcode = '23514';
  end if;
  if p_status is null or p_status not in ('trialing', 'active', 'pastDue', 'cancelled') then
    raise exception 'Statut inconnu : %.', coalesce(p_status, '(vide)') using errcode = '23514';
  end if;

  select o.name into v_org from public.business_organizations o where o.id = p_organization_id;
  if v_org is null then
    raise exception 'Entreprise inconnue : %.', p_organization_id using errcode = '23503';
  end if;

  if exists (select 1 from public.organization_subscriptions s where s.organization_id = p_organization_id) then
    raise exception 'Cette entreprise a déjà un abonnement : la table n''en porte qu''un par entreprise. Modifiez-le plutôt que d''en créer un second.'
      using errcode = '23505';
  end if;

  v_trial := case when p_trial_days is not null and p_trial_days > 0
                  then now() + make_interval(days => p_trial_days) end;

  insert into public.organization_subscriptions
    (organization_id, plan, provider, status, started_at, billing_cycle,
     trial_ends_at, negotiated_monthly_price_cents, negotiated_yearly_price_cents, managed_by)
  values
    -- `provider = 'manual'` dit la vérité : aucun encaissement n'est
    -- branché, c'est un administrateur qui a saisi cette ligne. Écrire
    -- 'web' laisserait croire à un paiement en ligne qui n'existe pas.
    (p_organization_id, p_plan, 'manual', p_status, now(), p_billing_cycle,
     v_trial, p_negotiated_monthly_price_cents, p_negotiated_yearly_price_cents, auth.uid());

  v_audit := public.record_admin_event(
    'subscription.created', 'organization', p_organization_id, v_org, null,
    jsonb_build_object('plan', p_plan, 'cycle', p_billing_cycle, 'status', p_status), v_reason);

  perform public.record_subscription_event(
    p_organization_id, 'created', null, p_plan, null, p_status, null,
    jsonb_build_object('plan', p_plan, 'cycle', p_billing_cycle, 'status', p_status),
    v_reason, v_audit);

  return v_audit;
end;
$$;

-- 1. CHANGER DE PLAN (et de cycle)
create or replace function public.admin_set_subscription_plan(
  p_organization_id uuid,
  p_plan text,
  p_reason text,
  p_billing_cycle text default null,
  p_negotiated_monthly_price_cents bigint default null,
  p_negotiated_yearly_price_cents bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_org text;
  v_sub record;
  v_cycle text;
  v_audit uuid;
begin
  if not public.platform_admin_can('billing.subscriptions.write') then
    raise exception 'Accès refusé : permission billing.subscriptions.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : un changement d''offre change ce que l''entreprise paie.'
      using errcode = '23514';
  end if;

  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;
  if v_sub.organization_id is null then
    raise exception 'Aucun abonnement pour cette entreprise.' using errcode = '23503';
  end if;

  v_cycle := coalesce(p_billing_cycle, v_sub.billing_cycle);
  if v_cycle not in ('monthly', 'yearly') then
    raise exception 'Cycle inconnu : %.', v_cycle using errcode = '23514';
  end if;

  select o.name into v_org from public.business_organizations o where o.id = p_organization_id;

  -- Le déclencheur du § 5.b réévalue ici les modules souscrits et
  -- refuse si la nouvelle offre ne sait pas les accueillir. On ne
  -- duplique pas ce contrôle : un seul endroit décide.
  update public.organization_subscriptions set
    plan = p_plan,
    billing_cycle = v_cycle,
    negotiated_monthly_price_cents = p_negotiated_monthly_price_cents,
    negotiated_yearly_price_cents = p_negotiated_yearly_price_cents,
    managed_by = auth.uid(),
    updated_at = now()
  where organization_id = p_organization_id;

  v_audit := public.record_admin_event(
    'subscription.planChanged', 'organization', p_organization_id, v_org,
    jsonb_build_object('plan', v_sub.plan, 'cycle', v_sub.billing_cycle),
    jsonb_build_object('plan', p_plan, 'cycle', v_cycle),
    v_reason);

  perform public.record_subscription_event(
    p_organization_id, 'planChanged', v_sub.plan, p_plan, v_sub.status, v_sub.status,
    jsonb_build_object('plan', v_sub.plan, 'cycle', v_sub.billing_cycle),
    jsonb_build_object('plan', p_plan, 'cycle', v_cycle),
    v_reason, v_audit);

  return v_audit;
end;
$$;

-- 2. AJOUTER DES JOURS D'ESSAI
create or replace function public.admin_extend_trial(
  p_organization_id uuid,
  p_days integer,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_sub record;
  v_org text;
  v_new timestamptz;
  v_audit uuid;
begin
  if not public.platform_admin_can('billing.subscriptions.write') then
    raise exception 'Accès refusé : permission billing.subscriptions.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : offrir des jours d''essai, c''est offrir du chiffre d''affaires.'
      using errcode = '23514';
  end if;

  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Entre 1 et 365 jours : % demandé.', coalesce(p_days, 0) using errcode = '23514';
  end if;

  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;
  if v_sub.organization_id is null then
    raise exception 'Aucun abonnement pour cette entreprise.' using errcode = '23503';
  end if;

  -- On prolonge à partir de la fin d'essai EXISTANTE quand elle est
  -- encore devant : sinon deux prolongations de 15 jours données le
  -- même jour n'en feraient que 15.
  v_new := greatest(coalesce(v_sub.trial_ends_at, now()), now()) + make_interval(days => p_days);

  select o.name into v_org from public.business_organizations o where o.id = p_organization_id;

  update public.organization_subscriptions
     set trial_ends_at = v_new,
         status = case when status = 'cancelled' then status else 'trialing' end,
         managed_by = auth.uid(),
         updated_at = now()
   where organization_id = p_organization_id;

  v_audit := public.record_admin_event(
    'subscription.trialExtended', 'organization', p_organization_id, v_org,
    jsonb_build_object('trialEndsAt', v_sub.trial_ends_at),
    jsonb_build_object('trialEndsAt', v_new, 'days', p_days),
    v_reason);

  perform public.record_subscription_event(
    p_organization_id, 'trialExtended', v_sub.plan, v_sub.plan, v_sub.status, 'trialing',
    jsonb_build_object('trialEndsAt', v_sub.trial_ends_at),
    jsonb_build_object('trialEndsAt', v_new), v_reason, v_audit);

  return v_audit;
end;
$$;

-- 2 bis. SAISIR LES SIÈGES FACTURÉS EN PLUS
--
-- POURQUOI CETTE FONCTION EXISTE : sans elle, le prix du siège
-- supplémentaire (9,90 €) était semé sur les quatre offres, publié sur
-- la grille, lu par la ligne de facture et compté par le MRR — et
-- AUCUN chemin ne permettait de l'appliquer à qui que ce soit.
-- `billable_extra_seats` n'était écrit par rien. Un prix affiché que
-- personne ne peut facturer est une promesse sans mécanisme ; il
-- fallait soit retirer le prix, soit ouvrir le geste.
--
-- LE NOMBRE SAISI EST L'EXCÉDENT, pas le nombre de membres, et il
-- reste SAISI. Le dirigeant a désormais tranché les sièges compris —
-- 1, 5 et 10 — donc l'excédent SE CALCULE : c'est ce que rend
-- `subscription_billable_extra_seats()` juste en dessous. Mais brancher
-- ce calcul directement sur la facture ferait varier un montant
-- facturé au rythme des arrivées et des départs, sans qu'aucun
-- administrateur ne l'ait décidé ni daté. La fonction PROPOSE, le geste
-- ci-dessous DISPOSE, et la trace dit qui a validé le chiffre.

-- LE COMPTE JUSTE, pour que personne ne le refasse à sa façon.
-- `included_seats` À NULL REND NULL — « non décidé » n'est pas
-- « illimité », et un excédent de zéro ferait passer une offre
-- indécise pour une offre sans surcoût.
create or replace function public.subscription_billable_extra_seats(
  p_organization_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub record;
  v_plan record;
  v_membres integer;
begin
  -- `security definer` pour voir l'abonnement et les membres — un
  -- administrateur n'est membre d'aucune entreprise cliente — donc la
  -- garde est À L'INTÉRIEUR : le client compte ses propres sièges, les
  -- habilités comptent ceux de tout le monde, et personne d'autre.
  if not (public.is_organization_member(p_organization_id)
          or public.platform_admin_can('billing.subscriptions.read')) then
    raise exception 'Accès refusé : ce compte de sièges se lit depuis l''entreprise, ou avec billing.subscriptions.read.'
      using errcode = '42501';
  end if;

  select * into v_sub from public.organization_subscriptions
   where organization_id = p_organization_id;
  if v_sub.organization_id is null then
    return null;
  end if;

  select * into v_plan from public.organization_plans where key = v_sub.plan;
  if v_plan.key is null or v_plan.included_seats is null then
    return null;
  end if;

  -- Les membres ARCHIVÉS ne comptent pas : ils n'occupent plus de
  -- siège, et les facturer ferait payer des départs.
  select count(*) into v_membres
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.archived_at is null;

  return greatest(v_membres - v_plan.included_seats, 0);
end;
$$;

comment on function public.subscription_billable_extra_seats(uuid) is
  'Combien de sièges DEVRAIENT être facturés en plus : membres actifs moins included_seats, jamais négatif. '
  'Rend NULL quand l''offre n''a pas décidé ses sièges compris. Ne facture rien par elle-même : admin_set_billable_seats reste le geste.';

create or replace function public.admin_set_billable_seats(
  p_organization_id uuid,
  p_seats integer,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_sub record;
  v_org text;
  v_audit uuid;
begin
  if not public.platform_admin_can('billing.subscriptions.write') then
    raise exception 'Accès refusé : permission billing.subscriptions.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : un siège facturé en plus est une ligne de facture, et elle se justifie.'
      using errcode = '23514';
  end if;

  if p_seats is null or p_seats < 0 or p_seats > 10000 then
    raise exception 'Nombre de sièges supplémentaires invalide : % (attendu entre 0 et 10000).', coalesce(p_seats::text, '(vide)')
      using errcode = '23514';
  end if;

  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;
  if v_sub.organization_id is null then
    raise exception 'Aucun abonnement pour cette entreprise.' using errcode = '23503';
  end if;

  select o.name into v_org from public.business_organizations o where o.id = p_organization_id;

  update public.organization_subscriptions
     set billable_extra_seats = p_seats,
         managed_by = auth.uid(),
         updated_at = now()
   where organization_id = p_organization_id;

  v_audit := public.record_admin_event(
    'subscription.billableSeatsSet', 'organization', p_organization_id, v_org,
    jsonb_build_object('billableExtraSeats', v_sub.billable_extra_seats),
    jsonb_build_object('billableExtraSeats', p_seats),
    v_reason);

  perform public.record_subscription_event(
    p_organization_id, 'seatsChanged', v_sub.plan, v_sub.plan, v_sub.status, v_sub.status,
    jsonb_build_object('billableExtraSeats', v_sub.billable_extra_seats),
    jsonb_build_object('billableExtraSeats', p_seats), v_reason, v_audit);

  return v_audit;
end;
$$;

-- 3. ACCORDER UN CRÉDIT
create or replace function public.admin_grant_credit(
  p_organization_id uuid,
  p_amount_cents bigint,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_org text;
  v_audit uuid;
begin
  if not public.platform_admin_can('billing.subscriptions.write') then
    raise exception 'Accès refusé : permission billing.subscriptions.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : un crédit est de l''argent rendu, et il se justifie.'
      using errcode = '23514';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Un crédit se compte en centimes strictement positifs.' using errcode = '23514';
  end if;

  select o.name into v_org from public.business_organizations o where o.id = p_organization_id;
  if v_org is null then
    raise exception 'Entreprise inconnue : %.', p_organization_id using errcode = '23503';
  end if;

  v_audit := public.record_admin_event(
    'subscription.creditGranted', 'organization', p_organization_id, v_org, null,
    jsonb_build_object('amountCents', p_amount_cents), v_reason);

  insert into public.saas_account_credits
    (organization_id, amount_cents, reason, granted_by, audit_event_id)
  values (p_organization_id, p_amount_cents, v_reason, auth.uid(), v_audit);

  perform public.record_subscription_event(
    p_organization_id, 'creditGranted', null, null, null, null, null,
    jsonb_build_object('amountCents', p_amount_cents), v_reason, v_audit);

  return v_audit;
end;
$$;

-- 4 et 5. ACTIVER / DÉSACTIVER UN MODULE
-- La spec p.13 dit « activer entitlement / désactiver entitlement ».
-- Côté Pro, un entitlement EST un module : c'est ce qui s'achète et ce
-- qui se facture. Côté mobile, les entitlements viennent d'Apple
-- (`subscription_entitlements`, alimentée par le webhook) et ne
-- s'administrent pas ici — les toucher à la main désynchroniserait le
-- droit de ce qu'Apple a réellement encaissé.
create or replace function public.admin_set_subscription_module(
  p_organization_id uuid,
  p_module_key text,
  p_active boolean,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_org text;
  v_sub record;
  v_terms record;
  v_module text;
  v_was boolean;
  v_audit uuid;
begin
  if not public.platform_admin_can('billing.subscriptions.write') then
    raise exception 'Accès refusé : permission billing.subscriptions.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;
  if v_sub.organization_id is null then
    raise exception 'Aucun abonnement pour cette entreprise : un module se souscrit par-dessus une offre.'
      using errcode = '23503';
  end if;

  select m.name into v_module from public.platform_modules m where m.key = p_module_key;
  if v_module is null then
    raise exception 'Module inconnu : %.', coalesce(p_module_key, '(vide)') using errcode = '23503';
  end if;

  select o.name into v_org from public.business_organizations o where o.id = p_organization_id;

  select * into v_terms from public.plan_module_terms(v_sub.plan, p_module_key);

  if p_active then
    -- ON NE VEND PAS CE QU'ON N'A PAS CONSTRUIT.
    if not v_terms.is_delivered then
      raise exception 'Le module « % » est annoncé mais pas livré : on ne le souscrit pas.', v_module
        using errcode = '23514';
    end if;
    -- « Non décidé » BLOQUE, et c'est le point de cet état. Une case
    -- vide qui se comporterait comme « inclus » ou comme
    -- « indisponible » sans qu'on l'ait choisi serait le défaut qu'on
    -- cherche à éviter.
    if v_terms.availability = 'undecided' then
      raise exception 'La case « % × % » n''est pas décidée : le dirigeant n''a pas dit si ce module est compris, en option ou indisponible sur cette offre. Décidez-la avant de souscrire.', v_sub.plan, v_module
        using errcode = '23514';
    end if;
    if v_terms.availability = 'unavailable' then
      raise exception 'Le module « % » n''est pas proposé sur l''offre « % ».', v_module, v_sub.plan
        using errcode = '23514';
    end if;
  end if;

  select (sm.cancelled_at is null) into v_was
  from public.organization_subscription_modules sm
  where sm.organization_id = p_organization_id and sm.module_key = p_module_key;

  if p_active then
    insert into public.organization_subscription_modules
      (organization_id, module_key, activated_at, activated_by)
    values (p_organization_id, p_module_key, now(), auth.uid())
    on conflict (organization_id, module_key) do update
      set cancelled_at = null, cancelled_by = null,
          activated_at = now(), activated_by = excluded.activated_by;
  else
    if coalesce(v_was, false) = false then
      raise exception 'Ce module n''est pas actif chez cette entreprise : rien à retirer.'
        using errcode = '23503';
    end if;
    update public.organization_subscription_modules
       set cancelled_at = now(), cancelled_by = auth.uid()
     where organization_id = p_organization_id and module_key = p_module_key;
  end if;

  v_audit := public.record_admin_event(
    case when p_active then 'subscription.moduleActivated' else 'subscription.moduleDeactivated' end,
    'organization', p_organization_id, v_org,
    jsonb_build_object('module', p_module_key, 'active', coalesce(v_was, false)),
    jsonb_build_object('module', p_module_key, 'active', p_active,
                       'availability', v_terms.availability),
    v_reason);

  perform public.record_subscription_event(
    p_organization_id,
    case when p_active then 'moduleActivated' else 'moduleDeactivated' end,
    v_sub.plan, v_sub.plan, v_sub.status, v_sub.status,
    jsonb_build_object('module', p_module_key, 'active', coalesce(v_was, false)),
    jsonb_build_object('module', p_module_key, 'active', p_active),
    v_reason, v_audit);

  return v_audit;
end;
$$;

-- 6. ANNULER À L'ÉCHÉANCE
--
-- LE VERROU D'ENGAGEMENT EST DANS LE DÉCLENCHEUR (§ 5.b) ; LE CONTRÔLE
-- CI-DESSOUS EST CE QUE L'ADMINISTRATEUR LIT. Les deux sont nécessaires :
-- sans le déclencheur, un `update` tapé dans l'éditeur SQL passerait ;
-- sans ce contrôle, l'écran afficherait une erreur de contrainte brute
-- au lieu d'une phrase qui nomme la date de fin.
--
-- LA DÉROGATION N'INVENTE AUCUNE PERMISSION NEUVE : le catalogue des
-- clés est déclaré en double, ici et dans `web-admin/lib/auth/roles.ts`,
-- et un test compare les deux listes (voir § 1.a). Elle se contente donc
-- de `billing.subscriptions.write`, du second facteur et d'un motif —
-- comme tous les gestes irréversibles de ce fichier.
--
-- ET ELLE ANNULE LA REMISE D'ABORD. C'est le seul moyen propre
-- d'informer le déclencheur sans variable de session : le verrou tombe
-- de lui-même, et la trace dit qui a levé quoi, quand et pourquoi.
drop function if exists public.admin_cancel_subscription_at_period_end(uuid, text);

create or replace function public.admin_cancel_subscription_at_period_end(
  p_organization_id uuid,
  p_reason text,
  p_override_commitment boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_sub record;
  v_org text;
  v_audit uuid;
  v_commit record;
  v_leve uuid;
begin
  if not public.platform_admin_can('billing.subscriptions.write') then
    raise exception 'Accès refusé : permission billing.subscriptions.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : savoir POURQUOI un client part est la donnée la plus utile de cette table.'
      using errcode = '23514';
  end if;

  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;
  if v_sub.organization_id is null then
    raise exception 'Aucun abonnement pour cette entreprise.' using errcode = '23503';
  end if;
  if v_sub.status = 'cancelled' then
    raise exception 'Cet abonnement est déjà annulé.' using errcode = '23505';
  end if;

  select o.name into v_org from public.business_organizations o where o.id = p_organization_id;

  -- ---- L'ENGAGEMENT ----------------------------------------------
  select * into v_commit
  from public.subscription_discounts d
  where d.organization_id = p_organization_id
    and d.cancelled_at is null
    and d.commitment_ends_on is not null
    and d.commitment_ends_on > current_date
  order by d.commitment_ends_on desc
  limit 1;

  if v_commit.id is not null then
    if not p_override_commitment then
      raise exception 'Résiliation refusée : « % » est engagée jusqu''au % par la remise « % ». Un administrateur peut passer outre en le demandant explicitement, avec un motif — et la dérogation annulera cette remise.',
        v_org, to_char(v_commit.commitment_ends_on, 'DD/MM/YYYY'), v_commit.label
        using errcode = '23514';
    end if;

    -- LA DÉROGATION, TRACÉE POUR ELLE-MÊME. Un événement distinct, et
    -- non une mention dans celui de la résiliation : c'est le geste
    -- qu'on voudra retrouver, pas la résiliation qui l'a suivi.
    v_leve := public.record_admin_event(
      'subscription.commitmentOverridden', 'organization', p_organization_id, v_org,
      jsonb_build_object('discount', v_commit.label, 'code', v_commit.code,
                         'commitmentEndsOn', v_commit.commitment_ends_on),
      jsonb_build_object('commitmentEndsOn', null, 'discountCancelled', true),
      v_reason);

    update public.subscription_discounts
       set cancelled_at = now(),
           cancelled_by = auth.uid(),
           cancelled_reason = 'Dérogation à l''engagement, résiliation anticipée : ' || v_reason
     where id = v_commit.id;
  end if;

  -- LE STATUT NE PASSE PAS À 'cancelled' TOUT DE SUITE, et c'est le
  -- sens même de « à l'échéance » : le client a payé jusqu'au bout de
  -- sa période, il en garde l'usage. `cancelled_at` date la DÉCISION,
  -- pas la fin du service.
  update public.organization_subscriptions
     set cancel_at_period_end = true,
         cancelled_at = now(),
         managed_by = auth.uid(),
         updated_at = now()
   where organization_id = p_organization_id;

  v_audit := public.record_admin_event(
    'subscription.cancelledAtPeriodEnd', 'organization', p_organization_id, v_org,
    jsonb_build_object('cancelAtPeriodEnd', v_sub.cancel_at_period_end, 'status', v_sub.status),
    jsonb_build_object('cancelAtPeriodEnd', true, 'status', v_sub.status,
                       'periodEnd', v_sub.current_period_end,
                       'commitmentOverridden', (v_commit.id is not null)),
    v_reason);

  perform public.record_subscription_event(
    p_organization_id, 'cancelledAtPeriodEnd', v_sub.plan, v_sub.plan, v_sub.status, v_sub.status,
    jsonb_build_object('cancelAtPeriodEnd', v_sub.cancel_at_period_end),
    jsonb_build_object('cancelAtPeriodEnd', true), v_reason, v_audit);

  return v_audit;
end;
$$;

-- 7. RÉACTIVER
create or replace function public.admin_reactivate_subscription(
  p_organization_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_sub record;
  v_org text;
  v_audit uuid;
begin
  if not public.platform_admin_can('billing.subscriptions.write') then
    raise exception 'Accès refusé : permission billing.subscriptions.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;
  if v_sub.organization_id is null then
    raise exception 'Aucun abonnement pour cette entreprise.' using errcode = '23503';
  end if;
  if not v_sub.cancel_at_period_end and v_sub.status <> 'cancelled' then
    raise exception 'Cet abonnement n''est ni annulé ni en cours d''annulation : rien à réactiver.'
      using errcode = '23505';
  end if;

  select o.name into v_org from public.business_organizations o where o.id = p_organization_id;

  update public.organization_subscriptions
     set cancel_at_period_end = false,
         cancelled_at = null,
         status = 'active',
         managed_by = auth.uid(),
         updated_at = now()
   where organization_id = p_organization_id;

  v_audit := public.record_admin_event(
    'subscription.reactivated', 'organization', p_organization_id, v_org,
    jsonb_build_object('status', v_sub.status, 'cancelAtPeriodEnd', v_sub.cancel_at_period_end),
    jsonb_build_object('status', 'active', 'cancelAtPeriodEnd', false),
    v_reason);

  perform public.record_subscription_event(
    p_organization_id, 'reactivated', v_sub.plan, v_sub.plan, v_sub.status, 'active',
    jsonb_build_object('status', v_sub.status),
    jsonb_build_object('status', 'active'), v_reason, v_audit);

  return v_audit;
end;
$$;

-- 8. APPLIQUER UNE REMISE DATÉE
--
-- ELLE LIT DÉSORMAIS L'ABONNEMENT, ce qu'elle ne faisait pas : sans
-- cela, elle acceptait de poser FONDATEUR sur un abonnement Business,
-- sur un abonnement annuel, et même sur une entreprise SANS abonnement.
-- Le couplage est neuf et assumé : une remise réservée à une offre ne
-- peut pas être accordée avant qu'on sache à quelle offre l'entreprise
-- est abonnée. Une remise sans restriction ni engagement, elle, reste
-- posable comme avant.
--
-- LES DEUX PARAMÈTRES DE PREUVE sont facultatifs dans la signature et
-- OBLIGATOIRES dès que l'offre engage : les rendre obligatoires pour
-- toutes casserait les remises ordinaires, les rendre facultatifs pour
-- toutes ferait de la preuve une option — c'est précisément le défaut
-- qu'on corrige.
drop function if exists public.admin_apply_discount(uuid, text, text, date);

create or replace function public.admin_apply_discount(
  p_organization_id uuid,
  p_code text,
  p_reason text,
  p_starts_on date default null,
  p_terms_text text default null,
  p_terms_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_offer record;
  v_org text;
  v_start date := coalesce(p_starts_on, current_date);
  v_end date;
  v_audit uuid;
  v_sub record;
  v_plan record;
  v_commit_end date;
  v_disc_id uuid;
  v_terms text;
  v_version text;
begin
  if not public.platform_admin_can('billing.plans.write') then
    raise exception 'Accès refusé : permission billing.plans.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : une remise est un revenu auquel on renonce.'
      using errcode = '23514';
  end if;

  select * into v_offer from public.discount_offers where code = upper(btrim(coalesce(p_code, '')));
  if v_offer.code is null then
    raise exception 'Offre de remise inconnue : %.', coalesce(p_code, '(vide)') using errcode = '23503';
  end if;
  if not v_offer.is_active then
    raise exception 'L''offre de remise « % » n''est plus proposée.', v_offer.code using errcode = '23514';
  end if;
  if v_offer.available_until is not null and v_start > v_offer.available_until then
    raise exception 'L''offre « % » n''était souscriptible que jusqu''au %.', v_offer.code, v_offer.available_until
      using errcode = '23514';
  end if;

  select o.name into v_org from public.business_organizations o where o.id = p_organization_id;
  if v_org is null then
    raise exception 'Entreprise inconnue : %.', p_organization_id using errcode = '23503';
  end if;

  select * into v_sub from public.organization_subscriptions
   where organization_id = p_organization_id;

  -- ---- L'OFFRE VISÉE ET LE CYCLE --------------------------------
  if v_offer.applies_to_plan is not null or v_offer.requires_commitment then
    if v_sub.organization_id is null then
      raise exception 'La remise « % » vise une offre précise, ou engage : elle ne se pose pas sur une entreprise sans abonnement.', v_offer.code
        using errcode = '23503';
    end if;
  end if;

  if v_offer.applies_to_plan is not null
     and v_sub.plan is distinct from v_offer.applies_to_plan then
    select * into v_plan from public.organization_plans where key = v_offer.applies_to_plan;
    raise exception 'La remise « % » est réservée à l''offre « % ». « % » est abonnée à « % » : posée ici, elle offrirait la différence de tarif sans que rien ne le signale.',
      v_offer.code, coalesce(v_plan.name, v_offer.applies_to_plan), v_org, v_sub.plan
      using errcode = '23514';
  end if;

  -- L'ENGAGEMENT SE PAIE AU MOIS — la règle est arrêtée, voir § 4.c.
  if v_offer.requires_commitment and v_sub.billing_cycle = 'yearly' then
    raise exception 'La remise « % » engage sur % mois et ne se vend qu''AU MOIS. L''abonnement de « % » est ANNUEL : basculez-le au mois, ou renoncez à cette remise.',
      v_offer.code, v_offer.commitment_months, v_org
      using errcode = '23514';
  end if;

  -- LA FIN EST CALCULÉE, PAS SAISIE. C'est la durée qui est promise —
  -- « 49,90 € pendant 12 mois » — et une date de fin saisie à la main
  -- serait la première à dériver.
  v_end := (v_start + make_interval(months => v_offer.duration_months))::date;

  if v_offer.requires_commitment then
    v_commit_end := (v_start + make_interval(months => v_offer.commitment_months))::date;

    -- ---- LA PREUVE, ET ELLE N'EST PAS FACULTATIVE ----------------
    -- PAS D'`ai_clean_text` SUR LE TEXTE : cette fonction remplace les
    -- caractères de contrôle par des espaces, et écraserait les retours
    -- à la ligne d'un texte contractuel. On garde ce qui a été affiché,
    -- à la ligne près ; on se contente de refuser le vide.
    v_terms := nullif(btrim(coalesce(p_terms_text, '')), '');
    v_version := public.ai_clean_text(p_terms_version, 60);
    if v_terms is null or v_version is null then
      raise exception 'La remise « % » engage sur % mois : le TEXTE exact affiché à l''abonné et sa version sont obligatoires. Une trace qui dit « a accepté » sans conserver ce qu''il a lu ne vaut rien le jour où l''écran aura changé.',
        v_offer.code, v_offer.commitment_months
        using errcode = '23514';
    end if;

    select * into v_plan from public.organization_plans where key = v_offer.applies_to_plan;
    if v_plan.monthly_price_cents is null then
      raise exception 'L''offre « % » n''a pas de tarif mensuel public : le prix d''APRÈS l''engagement ne peut pas être annoncé, donc l''engagement ne peut pas être accepté.',
        coalesce(v_plan.name, v_offer.applies_to_plan)
        using errcode = '23514';
    end if;
  end if;

  insert into public.subscription_discounts
    (organization_id, code, label, kind, value_cents, percent, applies_to_plan,
     starts_on, ends_on, commitment_ends_on, granted_by, reason)
  values (p_organization_id, v_offer.code, v_offer.label, v_offer.kind,
          v_offer.value_cents, v_offer.percent, v_offer.applies_to_plan,
          v_start, v_end, v_commit_end, auth.uid(), v_reason)
  returning id into v_disc_id;

  v_audit := public.record_admin_event(
    'subscription.discountApplied', 'organization', p_organization_id, v_org, null,
    jsonb_build_object('code', v_offer.code, 'kind', v_offer.kind,
                       'valueCents', v_offer.value_cents, 'percent', v_offer.percent,
                       'appliesToPlan', v_offer.applies_to_plan,
                       'startsOn', v_start, 'endsOn', v_end,
                       'commitmentEndsOn', v_commit_end),
    v_reason);

  update public.subscription_discounts set audit_event_id = v_audit
   where id = v_disc_id;

  if v_offer.requires_commitment then
    insert into public.subscription_commitment_acceptances
      (organization_id, discount_code, subscription_discount_id, accepted_by,
       commitment_months, monthly_price_during_cents, monthly_price_after_cents,
       plan_key, terms_text, terms_version, audit_event_id)
    values (p_organization_id, v_offer.code, v_disc_id, auth.uid(),
            v_offer.commitment_months, v_offer.value_cents, v_plan.monthly_price_cents,
            v_offer.applies_to_plan, v_terms, v_version, v_audit);
  end if;

  perform public.record_subscription_event(
    p_organization_id, 'discountApplied', null, null, null, null, null,
    jsonb_build_object('code', v_offer.code, 'endsOn', v_end,
                       'commitmentEndsOn', v_commit_end), v_reason, v_audit);

  return v_audit;
end;
$$;

comment on function public.admin_apply_discount(uuid, text, text, date, text, text) is
  'Pose une remise datée sur un abonnement. Refuse une offre non visée, un cycle annuel sous engagement, '
  'et une entreprise sans abonnement dès que la remise vise une offre. Sous engagement, elle EXIGE le texte '
  'affiché et sa version, et en conserve une copie morte dans subscription_commitment_acceptances.';

-- ============================================================
-- 6. LA FACTURATION SaaS
-- ============================================================
--
-- CE QUE CES TABLES SONT, ET CE QU'ELLES NE SONT PAS. Elles portent les
-- factures qu'OASIS CARE émet À SES ENTREPRISES CLIENTES. Elles n'ont
-- RIEN à voir avec `public.invoices` (0054), qui porte les factures
-- qu'une entreprise cliente émet à SES propres clients — celle-là a un
-- `organization_id` ET un `customer_id`, et son émetteur est le client.
-- Mélanger les deux serait une faute comptable : deux séquences de
-- numérotation dans la même table, deux émetteurs, deux régimes de TVA,
-- et un export comptable inexploitable. D'où le préfixe `saas_`, qui
-- rend la confusion impossible à l'œil.
--
-- ON REPREND LEURS CONVENTIONS, PAS LEURS TABLES : montants en centimes
-- entiers, TVA groupée PAR TAUX avant arrondi et jamais ligne à ligne
-- (correctif 0064 — seize centimes d'écart sur une facture de quarante
-- lignes, et surtout un document qui ne fait pas son propre total), une
-- facture émise qui ne se modifie plus, et la correction par avoir.
--
-- RIEN POUR APPLE. Le canal mobile est facturé par Apple, qui encaisse,
-- facture et rembourse. Construire une facture de ce côté reviendrait à
-- facturer deux fois.
--
-- ============================================================
-- LE POINT DUR : LA NUMÉROTATION
-- ============================================================
--
-- En France, une facture porte un numéro SÉQUENTIEL, SANS TROU et SANS
-- DOUBLON. Un trou dans la séquence est la première chose qu'un
-- contrôle regarde.
--
-- POURQUOI UN COMPTEUR EN TABLE ET PAS UNE SÉQUENCE POSTGRES. `nextval()`
-- n'est pas transactionnel : il ne revient pas en arrière quand la
-- transaction échoue. Une émission qui échoue à mi-chemin laisserait
-- donc un numéro consommé et jamais écrit — un trou, à chaque incident.
-- Le compteur en table, lui, est écrit DANS la transaction : si
-- l'émission échoue, l'incrément disparaît avec elle. C'est le patron
-- déjà éprouvé du dépôt (`document_counters` / `next_document_number`,
-- 0053), transposé.
--
-- CE QU'IL FAUT CHANGER À CE PATRON : il compte PAR ORGANISATION, parce
-- que chaque entreprise cliente est son propre émetteur. Ici il n'y a
-- qu'UN émetteur — Oasis Care — donc le compteur est GLOBAL par nature
-- de document et par année.
--
-- ET LA QUESTION QUI SE POSE VRAIMENT : que faire d'une facture émise
-- qu'on veut défaire ? Un trou, ou une facture annulée qui garde son
-- numéro ? LA RÉPONSE COMPTABLE EST LA SECONDE, et c'est celle qui est
-- codée ici : une facture annulée conserve son numéro, son rang dans la
-- séquence et son contenu ; elle porte un statut « annulée » et, si elle
-- avait déjà quitté nos mains, un AVOIR qui la neutralise. On ne
-- supprime jamais une ligne de cette table.
--
-- Le corollaire est le § 6.f : le numéro n'est attribué QU'À
-- L'ÉMISSION. Un brouillon abandonné ne consomme rien.

-- ------------------------------------------------------------
-- 6.a L'ÉMETTEUR — Oasis Care lui-même
-- ------------------------------------------------------------
-- Son identité n'était NULLE PART dans cette base : `business_organizations`
-- décrit les CLIENTS. Elle ne peut pas non plus vivre dans des
-- constantes TypeScript — une facture dont on ne peut plus corriger le
-- SIRET sans déploiement est une facture qu'on n'osera pas corriger.
--
-- TOUS LES CHAMPS SONT NULLABLES, et c'est volontaire : personne dans ce
-- chantier ne connaît ces valeurs. La complétude n'est pas imposée par
-- des `not null` — qui empêcheraient de poser la ligne — mais par
-- `saas_billing_issuer_missing_fields()`, que l'émission consulte. Tant
-- qu'il manque quelque chose, AUCUNE facture ne part, et l'écran dit
-- quoi demander.

create table if not exists public.saas_billing_issuer (
  id boolean primary key default true check (id),

  legal_name text,
  legal_form text,
  siret text,
  siren text,
  vat_number text,
  rcs_city text,
  share_capital_cents bigint,

  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  country text not null default 'FR',

  email text,
  phone text,
  website text,

  -- LE VIREMENT SEPA CONTRE FACTURE : compte Revolut Business, aucune
  -- commission. C'est le moyen de règlement par défaut, et il est
  -- inutilisable sans ces trois lignes sur le document.
  iban text,
  bic text,
  bank_name text,

  -- MENTIONS OBLIGATOIRES. Les pénalités de retard et l'indemnité
  -- forfaitaire de recouvrement doivent figurer sur toute facture entre
  -- professionnels ; leur absence est sanctionnée. Le montant de
  -- l'indemnité est en centimes et se règle ici plutôt que d'être codé
  -- en dur : il a déjà changé une fois, il changera encore.
  payment_terms_days integer not null default 30,
  late_penalty_terms text,
  recovery_indemnity_cents bigint not null default 4000,
  invoice_footer text,

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  constraint saas_billing_issuer_terms_sane
    check (payment_terms_days between 0 and 120 and recovery_indemnity_cents >= 0)
);

insert into public.saas_billing_issuer (id) values (true) on conflict (id) do nothing;

alter table public.saas_billing_issuer enable row level security;

drop policy if exists "Les habilités lisent l'identité de l'émetteur" on public.saas_billing_issuer;
create policy "Les habilités lisent l'identité de l'émetteur" on public.saas_billing_issuer
  for select using (
    public.platform_admin_can('billing.invoices.read')
    or public.platform_admin_can('billing.plans.read')
  );

-- CE QUI MANQUE POUR ÉMETTRE, nommé champ par champ. Rendre un simple
-- booléen « incomplet » obligerait l'exploitant à deviner ce qu'on
-- attend de lui.
create or replace function public.saas_billing_issuer_missing_fields()
returns text[]
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(champ order by champ), array[]::text[])
  from (
    select unnest(array[
      case when nullif(btrim(coalesce(i.legal_name, '')), '') is null then 'legal_name' end,
      case when nullif(btrim(coalesce(i.siret, '')), '') is null then 'siret' end,
      case when nullif(btrim(coalesce(i.vat_number, '')), '') is null then 'vat_number' end,
      case when nullif(btrim(coalesce(i.address_line1, '')), '') is null then 'address_line1' end,
      case when nullif(btrim(coalesce(i.postal_code, '')), '') is null then 'postal_code' end,
      case when nullif(btrim(coalesce(i.city, '')), '') is null then 'city' end,
      case when nullif(btrim(coalesce(i.iban, '')), '') is null then 'iban' end,
      case when nullif(btrim(coalesce(i.late_penalty_terms, '')), '') is null then 'late_penalty_terms' end
    ]) as champ
    from public.saas_billing_issuer i where i.id
  ) t
  where champ is not null;
$$;

comment on function public.saas_billing_issuer_missing_fields() is
  'Les mentions obligatoires manquantes chez l''émetteur. Tableau VIDE = on peut émettre. '
  'L''émission consulte cette fonction : une facture sans SIRET, sans numéro de TVA, sans IBAN ou sans clause de pénalités ne part pas.';

create or replace function public.admin_set_billing_issuer(
  p_fields jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_old jsonb;
  v_cle text;
  v_permises text[] := array[
    'legal_name','legal_form','siret','siren','vat_number','rcs_city','share_capital_cents',
    'address_line1','address_line2','postal_code','city','country',
    'email','phone','website','iban','bic','bank_name',
    'payment_terms_days','late_penalty_terms','recovery_indemnity_cents','invoice_footer'];
begin
  if not public.platform_admin_can('billing.issuer.write') then
    raise exception 'Accès refusé : seul le super-administrateur modifie l''identité légale de l''émetteur.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : ces mentions figurent sur des documents opposables.'
      using errcode = '23514';
  end if;

  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'Rien à écrire.' using errcode = '23514';
  end if;

  -- Liste blanche des clés. Sans elle, un `jsonb_populate_record` sur
  -- une entrée libre laisserait écrire `id` — et fabriquer une seconde
  -- identité d'émetteur.
  for v_cle in select jsonb_object_keys(p_fields) loop
    if not (v_cle = any (v_permises)) then
      raise exception 'Champ inconnu ou non modifiable : %.', v_cle using errcode = '23514';
    end if;
  end loop;

  select to_jsonb(i) - 'id' into v_old from public.saas_billing_issuer i where i.id;

  update public.saas_billing_issuer i
     set legal_name = coalesce(p_fields ->> 'legal_name', i.legal_name),
         legal_form = coalesce(p_fields ->> 'legal_form', i.legal_form),
         siret = coalesce(p_fields ->> 'siret', i.siret),
         siren = coalesce(p_fields ->> 'siren', i.siren),
         vat_number = coalesce(p_fields ->> 'vat_number', i.vat_number),
         rcs_city = coalesce(p_fields ->> 'rcs_city', i.rcs_city),
         share_capital_cents = coalesce((p_fields ->> 'share_capital_cents')::bigint, i.share_capital_cents),
         address_line1 = coalesce(p_fields ->> 'address_line1', i.address_line1),
         address_line2 = coalesce(p_fields ->> 'address_line2', i.address_line2),
         postal_code = coalesce(p_fields ->> 'postal_code', i.postal_code),
         city = coalesce(p_fields ->> 'city', i.city),
         country = coalesce(p_fields ->> 'country', i.country),
         email = coalesce(p_fields ->> 'email', i.email),
         phone = coalesce(p_fields ->> 'phone', i.phone),
         website = coalesce(p_fields ->> 'website', i.website),
         iban = coalesce(p_fields ->> 'iban', i.iban),
         bic = coalesce(p_fields ->> 'bic', i.bic),
         bank_name = coalesce(p_fields ->> 'bank_name', i.bank_name),
         payment_terms_days = coalesce((p_fields ->> 'payment_terms_days')::integer, i.payment_terms_days),
         late_penalty_terms = coalesce(p_fields ->> 'late_penalty_terms', i.late_penalty_terms),
         recovery_indemnity_cents = coalesce((p_fields ->> 'recovery_indemnity_cents')::bigint, i.recovery_indemnity_cents),
         invoice_footer = coalesce(p_fields ->> 'invoice_footer', i.invoice_footer),
         updated_at = now(),
         updated_by = auth.uid()
   where i.id;

  return public.record_admin_event(
    'billing.issuerChanged', 'platform', null, 'Identité de l''émetteur',
    v_old,
    (select to_jsonb(i) - 'id' from public.saas_billing_issuer i where i.id),
    v_reason);
end;
$$;

-- ------------------------------------------------------------
-- 6.b LA TVA — et le cas qu'on refuse de deviner
-- ------------------------------------------------------------
-- LA TVA D'UN ABONNEMENT LOGICIEL DÉPEND DU CLIENT, pas du produit.
-- Trois cas au moins, et un quatrième qu'on ne sait pas trancher :
--
--   • ENTREPRISE FRANÇAISE : taux national, lu dans `saas_vat_rates` et
--     jamais codé en dur — il a changé, il rechangera.
--   • ENTREPRISE DE L'UNION avec un numéro de TVA intracommunautaire
--     VALIDÉ : autoliquidation, 0 %, avec la mention obligatoire sur la
--     facture.
--   • HORS UNION : prestation de service hors champ de la TVA
--     française, 0 %.
--   • ENTREPRISE DE L'UNION SANS NUMÉRO RENSEIGNÉ OU NON VALIDÉ : JE NE
--     SAIS PAS. Ce n'est pas un cas rare et ce n'est pas un détail —
--     facturer 0 % à un non-assujetti, c'est de la TVA non collectée
--     dont Oasis Care reste redevable. Le régime rend « unknown »,
--     l'émission est REFUSÉE, et l'écran demande de valider le numéro.
--     Supposer 20 % serait tout aussi faux dans l'autre sens.
--
-- LA TVA EST CALCULÉE PAR OASIS CARE, PAS PAR LE PRESTATAIRE
-- D'ENCAISSEMENT. C'est une décision du dirigeant, et elle est déjà ce
-- que fait ce paragraphe : le taux vient de NOS tables, le régime est
-- déduit de NOTRE lecture du client, et un régime inconnu bloque au
-- lieu de supposer. Écrit ici pour qu'un second moteur de taxe — celui
-- d'un Stripe ou d'un autre — ne vienne pas se brancher à côté plus
-- tard : deux moteurs qui calculent la même TVA finissent toujours par
-- ne pas dire le même chiffre, et c'est le nôtre qui est opposable.
-- TOUS LES MONTANTS DE CE FICHIER SONT HORS TAXES : la TVA s'AJOUTE,
-- elle ne s'extrait jamais d'un prix affiché.

create table if not exists public.saas_eu_countries (
  code text primary key check (code = upper(code) and length(code) = 2),
  name text not null
);

insert into public.saas_eu_countries (code, name) values
  ('AT','Autriche'),('BE','Belgique'),('BG','Bulgarie'),('CY','Chypre'),
  ('CZ','Tchéquie'),('DE','Allemagne'),('DK','Danemark'),('EE','Estonie'),
  ('ES','Espagne'),('FI','Finlande'),('FR','France'),('GR','Grèce'),
  ('HR','Croatie'),('HU','Hongrie'),('IE','Irlande'),('IT','Italie'),
  ('LT','Lituanie'),('LU','Luxembourg'),('LV','Lettonie'),('MT','Malte'),
  ('NL','Pays-Bas'),('PL','Pologne'),('PT','Portugal'),('RO','Roumanie'),
  ('SE','Suède'),('SI','Slovénie'),('SK','Slovaquie')
on conflict (code) do nothing;

alter table public.saas_eu_countries enable row level security;
drop policy if exists "Tout compte connecté lit la liste des pays de l'Union" on public.saas_eu_countries;
create policy "Tout compte connecté lit la liste des pays de l'Union" on public.saas_eu_countries
  for select using (auth.uid() is not null);

create table if not exists public.saas_vat_rates (
  country_code text primary key check (country_code = upper(country_code) and length(country_code) = 2),
  standard_rate numeric(5, 2) not null check (standard_rate >= 0 and standard_rate <= 100),
  note text,
  updated_at timestamptz not null default now()
);

-- LA FRANCE SEULE EST SEMÉE, et c'est un choix. Oasis Care n'est établi
-- qu'en France : le taux d'un autre pays ne servirait qu'en cas de
-- vente à distance à un non-assujetti étranger, un cas qui ne se pose
-- pas encore et dont les seuils demandent une décision fiscale, pas une
-- ligne de migration. Un pays absent de cette table rend le régime
-- « unknown » — ce qui bloque l'émission au lieu d'inventer un taux.
insert into public.saas_vat_rates (country_code, standard_rate, note) values
  ('FR', 20.00, 'Taux normal français. Réglé en base et non codé en dur : il a déjà changé.')
on conflict (country_code) do nothing;

alter table public.saas_vat_rates enable row level security;
drop policy if exists "Les habilités lisent les taux de TVA" on public.saas_vat_rates;
create policy "Les habilités lisent les taux de TVA" on public.saas_vat_rates
  for select using (public.platform_admin_can('billing.plans.read'));

-- LE NUMÉRO DE TVA A-T-IL ÉTÉ VALIDÉ ? `business_organizations.vat_number`
-- existe, mais rien ne dit s'il a été VÉRIFIÉ auprès du service européen
-- VIES, et rien ne distingue un assujetti d'un non-assujetti. On ne
-- touche pas à cette table partagée : on porte l'information à côté.
create table if not exists public.saas_customer_tax_profiles (
  organization_id uuid primary key references public.business_organizations (id) on delete cascade,

  -- « L'entreprise est-elle assujettie ? » Trois états, et le NULL en
  -- est un : inconnu. Un booléen à deux états forcerait à choisir entre
  -- deux mensonges.
  is_vat_registered boolean,
  vat_number_validated_at timestamptz,
  validation_source text check (validation_source is null or validation_source in ('vies', 'manual', 'document')),

  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  constraint saas_customer_tax_profiles_validation_coherent
    check ((vat_number_validated_at is null) = (validation_source is null))
);

alter table public.saas_customer_tax_profiles enable row level security;

drop policy if exists "L'entreprise et les habilités lisent son régime de TVA" on public.saas_customer_tax_profiles;
create policy "L'entreprise et les habilités lisent son régime de TVA" on public.saas_customer_tax_profiles
  for select using (
    public.is_organization_member(organization_id)
    or public.platform_admin_can('billing.invoices.read')
  );

-- `security definer`, ET C'EST UNE CORRECTION QUE LE TEST A IMPOSÉE.
-- Écrite en `security invoker`, cette fonction lisait
-- `business_organizations` sous le jeton de l'appelant — or un
-- administrateur de plateforme n'est membre d'AUCUNE entreprise, la RLS
-- lui rendait zéro ligne, et le régime tombait sur « unknown : entreprise
-- inconnue ». Le refus aurait eu l'air d'une règle de prudence alors
-- qu'il n'était qu'une barrière mal franchie : le pire des bogues, celui
-- qui ressemble à une décision.
create or replace function public.saas_vat_regime(p_organization_id uuid)
returns table (regime text, rate numeric, reason text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_country text;
  v_vat text;
  v_in_eu boolean;
  v_rate numeric;
  v_validated timestamptz;
begin
  -- Franchir la RLS oblige à refaire le contrôle ici : c'est la règle R3
  -- de 0075, « posséder la clé n'est pas être autorisé ».
  if not (public.platform_admin_can('billing.invoices.read')
          or public.platform_admin_can('billing.plans.read')) then
    raise exception 'Accès refusé : le régime de TVA d''un client se lit avec billing.invoices.read ou billing.plans.read.'
      using errcode = '42501';
  end if;

  select upper(btrim(o.country)), nullif(btrim(coalesce(o.vat_number, '')), '')
    into v_country, v_vat
  from public.business_organizations o where o.id = p_organization_id;

  if v_country is null then
    return query select 'unknown'::text, null::numeric,
      'Entreprise inconnue : aucun pays, donc aucun régime de TVA.'::text;
    return;
  end if;

  select true into v_in_eu from public.saas_eu_countries where code = v_country;
  select r.standard_rate into v_rate from public.saas_vat_rates r where r.country_code = v_country;
  select t.vat_number_validated_at into v_validated
    from public.saas_customer_tax_profiles t where t.organization_id = p_organization_id;

  if v_country = 'FR' then
    if v_rate is null then
      return query select 'unknown'::text, null::numeric,
        'Aucun taux normal enregistré pour la France dans saas_vat_rates.'::text;
    else
      return query select 'france'::text, v_rate,
        null::text;
    end if;
    return;
  end if;

  if coalesce(v_in_eu, false) then
    if v_vat is not null and v_validated is not null then
      -- Autoliquidation : la TVA est due par le preneur. Mention
      -- obligatoire sur la facture, portée au § 6.d.
      return query select 'euReverseCharge'::text, 0::numeric, null::text;
    else
      return query select 'unknown'::text, null::numeric,
        ('Entreprise de l''Union (' || v_country || ') dont le numéro de TVA intracommunautaire est '
         || case when v_vat is null then 'absent' else 'non validé' end
         || '. On ne sait pas si elle est assujettie : facturer 0 % laisserait Oasis Care redevable de la TVA, '
         || 'et supposer le taux français serait faux dans l''autre sens. Validez le numéro avant d''émettre.')::text;
    end if;
    return;
  end if;

  -- Hors Union : prestation de service B2B hors champ de la TVA
  -- française.
  return query select 'outsideEu'::text, 0::numeric, null::text;
end;
$$;

create or replace function public.admin_set_customer_tax_profile(
  p_organization_id uuid,
  p_is_vat_registered boolean,
  p_validated boolean,
  p_validation_source text,
  p_reason text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_org text;
  v_old jsonb;
begin
  if not public.platform_admin_can('billing.invoices.write') then
    raise exception 'Accès refusé : permission billing.invoices.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : déclarer un numéro de TVA validé décide du taux facturé.'
      using errcode = '23514';
  end if;

  if p_validated and (p_validation_source is null or p_validation_source not in ('vies', 'manual', 'document')) then
    raise exception 'Source de validation manquante ou inconnue : dites COMMENT le numéro a été vérifié (vies, manual, document).'
      using errcode = '23514';
  end if;

  select o.name into v_org from public.business_organizations o where o.id = p_organization_id;
  if v_org is null then
    raise exception 'Entreprise inconnue : %.', p_organization_id using errcode = '23503';
  end if;

  select to_jsonb(t) into v_old from public.saas_customer_tax_profiles t
   where t.organization_id = p_organization_id;

  insert into public.saas_customer_tax_profiles
    (organization_id, is_vat_registered, vat_number_validated_at, validation_source, note, updated_by)
  values (p_organization_id, p_is_vat_registered,
          case when p_validated then now() end,
          case when p_validated then p_validation_source end,
          public.ai_clean_text(p_note, 500), auth.uid())
  on conflict (organization_id) do update
    set is_vat_registered = excluded.is_vat_registered,
        vat_number_validated_at = excluded.vat_number_validated_at,
        validation_source = excluded.validation_source,
        note = coalesce(excluded.note, public.saas_customer_tax_profiles.note),
        updated_at = now(),
        updated_by = excluded.updated_by;

  return public.record_admin_event(
    'billing.taxProfileChanged', 'organization', p_organization_id, v_org, v_old,
    (select to_jsonb(t) from public.saas_customer_tax_profiles t where t.organization_id = p_organization_id),
    v_reason);
end;
$$;

-- ------------------------------------------------------------
-- 6.c LE COMPTEUR
-- ------------------------------------------------------------
create table if not exists public.saas_document_counters (
  kind text not null,
  year integer not null,
  last_number integer not null default 0 check (last_number >= 0),
  primary key (kind, year)
);

alter table public.saas_document_counters enable row level security;
-- AUCUNE politique, même en lecture : le compteur n'est pas une donnée
-- de gestion, c'est un rouage. Le lire depuis un navigateur n'aurait
-- aucun usage et donnerait le prochain numéro à qui le demande.

create or replace function public.saas_next_document_number(
  p_kind text,
  p_prefix text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  y integer := extract(year from current_date);
  n integer;
begin
  -- UNE SEULE INSTRUCTION. `insert … on conflict do update … returning`
  -- verrouille la ligne du couple (nature, année) : deux émissions
  -- simultanées ne peuvent pas obtenir le même numéro, la seconde
  -- attend et reçoit n+1. Un « max(numero) + 1 » applicatif produirait
  -- un doublon au premier appel concurrent, et un doublon sur une
  -- facture est aussi grave qu'un trou.
  insert into public.saas_document_counters (kind, year, last_number)
  values (p_kind, y, 1)
  on conflict (kind, year) do update
    set last_number = public.saas_document_counters.last_number + 1
  returning last_number into n;

  -- Le millésime dans le numéro : la séquence repart à 1 chaque année,
  -- ce qui est admis et ce que fait déjà le reste du dépôt.
  return p_prefix || '-' || y::text || '-' || lpad(n::text, 5, '0');
end;
$$;

revoke all on function public.saas_next_document_number(text, text) from public;
revoke all on function public.saas_next_document_number(text, text) from anon;
revoke all on function public.saas_next_document_number(text, text) from authenticated;

-- ------------------------------------------------------------
-- 6.d LES FACTURES
-- ------------------------------------------------------------
-- LES IDENTITÉS SONT RECOPIÉES SUR LE DOCUMENT AU MOMENT DE L'ÉMISSION,
-- et c'est la décision la moins évidente de ce paragraphe. Une facture
-- n'est pas une jointure : elle dit ce qui était vrai le jour où elle
-- est partie. Un client qui déménage, un émetteur qui change de RIB, une
-- entreprise renommée — et une facture reconstituée par jointure
-- afficherait rétroactivement des mentions que le client n'a jamais
-- reçues. On fige donc.

create table if not exists public.saas_invoices (
  id uuid primary key default gen_random_uuid(),

  -- `on delete restrict` : une facture ne disparaît pas avec son
  -- client. C'est un document à conserver, et la spec p.29 le rappelle
  -- au sujet de la suppression de compte — « ne pas supprimer
  -- aveuglément les documents qui doivent être conservés ».
  organization_id uuid not null references public.business_organizations (id) on delete restrict,

  -- NUL TANT QUE C'EST UN BROUILLON. Un numéro attribué puis abandonné
  -- ferait un trou dans la séquence.
  number text,

  -- 'overdue' N'EST PAS DANS CETTE LISTE, exprès : le retard se DÉDUIT
  -- de l'échéance et de ce qui a été encaissé, il ne se saisit pas. Un
  -- statut « en retard » stocké serait faux le lendemain du jour où on
  -- l'a écrit. Voir la vue `saas_invoice_state`.
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'paid', 'cancelled', 'credited')),

  -- La période facturée. C'est aussi la clé de l'idempotence de la
  -- génération (index unique plus bas).
  period_start date not null,
  period_end date not null,
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly')),

  issued_on date,
  due_on date,
  -- L'instant du verrouillage. Sa PRÉSENCE, et non le statut, est ce
  -- que le déclencheur regarde : un statut se change, un fait daté non.
  issued_at timestamptz,

  currency text not null default 'EUR',

  -- ---- Le régime de TVA, figé au moment de l'émission -------------
  vat_regime text not null default 'unknown'
    check (vat_regime in ('france', 'euReverseCharge', 'outsideEu', 'unknown')),
  vat_rate numeric(5, 2),
  vat_note text,

  -- ---- L'émetteur, recopié ----------------------------------------
  issuer_legal_name text,
  issuer_legal_form text,
  issuer_siret text,
  issuer_vat_number text,
  issuer_rcs_city text,
  issuer_share_capital_cents bigint,
  issuer_address text,
  issuer_email text,
  issuer_iban text,
  issuer_bic text,
  issuer_late_penalty_terms text,
  issuer_recovery_indemnity_cents bigint,
  issuer_footer text,

  -- ---- Le client, recopié ------------------------------------------
  customer_name text,
  customer_legal_name text,
  customer_legal_form text,
  customer_siret text,
  customer_vat_number text,
  customer_address text,
  customer_country text,
  customer_email text,

  -- ---- Le règlement -------------------------------------------------
  -- Deux moyens, et un seul est branché. « provider » existe parce que
  -- le prestataire arrive au chantier suivant, et qu'ajouter une valeur
  -- à une contrainte `check` sur une table de documents comptables
  -- déjà remplie est une migration qu'on préfère ne pas écrire.
  payment_method text not null default 'transfer'
    check (payment_method in ('transfer', 'provider')),
  -- LA RÉFÉRENCE DE PAIEMENT, la nôtre. Sans elle, un virement arrive
  -- sur le compte sans qu'on sache à quelle facture il correspond, et le
  -- rapprochement se fait à l'œil.
  payment_reference text,
  -- L'identifiant du paiement CHEZ LE PRESTATAIRE. Nullable, et vide
  -- pour longtemps.
  external_payment_reference text,

  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancellation_reason text,

  internal_notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- LA SÉQUENCE, DÉFENDUE PAR LA BASE. Unicité globale : il n'y a qu'un
  -- émetteur, donc qu'une séquence.
  constraint saas_invoices_number_unique unique (number),
  -- Une facture émise a FORCÉMENT un numéro. Recopié de 0054, pour la
  -- même raison.
  constraint saas_invoices_issued_has_number
    check (issued_at is null or number is not null),
  constraint saas_invoices_period_ordered check (period_end > period_start),
  constraint saas_invoices_status_coherent check (
    (status = 'draft' and issued_at is null)
    or (status <> 'draft' and (issued_at is not null or status = 'cancelled'))
  ),
  constraint saas_invoices_cancellation_coherent
    check ((status = 'cancelled') = (cancelled_at is not null))
);

-- L'IDEMPOTENCE DE LA GÉNÉRATION, TENUE PAR UN INDEX ET NON PAR DU CODE.
-- Relancer la génération sur le même mois ne peut PAS créer une seconde
-- facture : la base la refuse. Les factures annulées sortent de l'index,
-- pour qu'une erreur annulée puisse être refaite.
create unique index if not exists saas_invoices_one_per_period_idx
  on public.saas_invoices (organization_id, period_start, period_end)
  where status <> 'cancelled';

create index if not exists saas_invoices_org_idx
  on public.saas_invoices (organization_id, period_start desc);
create index if not exists saas_invoices_due_idx
  on public.saas_invoices (due_on) where status = 'issued';
create index if not exists saas_invoices_status_idx
  on public.saas_invoices (status, issued_on desc);

alter table public.saas_invoices enable row level security;

-- LE CLIENT VOIT SES FACTURES ÉMISES, jamais nos brouillons. Un
-- brouillon est un travail en cours ; le montrer serait annoncer un
-- montant qu'on peut encore corriger.
drop policy if exists "Le client lit ses factures émises, les habilités toutes" on public.saas_invoices;
create policy "Le client lit ses factures émises, les habilités toutes" on public.saas_invoices
  for select using (
    (issued_at is not null and public.is_organization_member(organization_id))
    or public.platform_admin_can('billing.invoices.read')
  );

create table if not exists public.saas_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.saas_invoices (id) on delete cascade,

  position integer not null default 0,
  -- La nature de la ligne : elle sert à relire une facture et à
  -- construire les statistiques de revenu par origine (offre, sièges,
  -- module, remise, crédit).
  kind text not null default 'plan'
    check (kind in ('plan', 'seats', 'module', 'discount', 'credit', 'other')),
  module_key text references public.platform_modules (key) on delete set null,

  description text not null,
  quantity numeric(14, 3) not null default 1,
  -- NÉGATIF AUTORISÉ : une remise et un crédit sont des lignes, pas des
  -- champs à part. Les mettre à part obligerait à les rejouer dans
  -- chaque calcul de total, et l'un des deux finirait par être oublié.
  --
  -- ET NULLABLE, pour la raison qui a coûté quatre correctifs à ce
  -- produit : un prix ABSENT n'est pas un prix de zéro. La génération
  -- coalescait un prix inconnu à 0 ; le brouillon portait alors une
  -- ligne à 0,00 €, son total valait 0, et rien n'empêchait de l'ÉMETTRE
  -- — une facture française numérotée, opposable, immuable, à zéro euro,
  -- ayant consommé un numéro de séquence. NULL remonte désormais
  -- jusqu'au total, qui devient inconnu, et l'émission le refuse comme
  -- elle refuse déjà un taux de TVA manquant.
  unit_price_cents bigint,
  -- NULLABLE = TAUX INCONNU. La vue des totaux rend alors NULL au lieu
  -- d'un montant faux, et l'émission est refusée.
  vat_rate numeric(5, 2),

  -- CE QUI EMPÊCHE D'ÉMETTRE, ÉCRIT SUR LA LIGNE FAUTIVE. Le motif était
  -- calculé à la génération, servait à décider d'émettre dans le MÊME
  -- appel, puis était perdu : rouvrir le brouillon le lendemain ne
  -- disait plus rien. Il est maintenant stocké, l'émission le relit, et
  -- l'écran l'affiche en face de la ligne.
  blocking_reason text,

  total_cents bigint generated always as (
    round(quantity * unit_price_cents)::bigint
  ) stored,

  created_at timestamptz not null default now()
);

-- Idempotence : sur une base où la table existe déjà au format
-- précédent, on relâche la contrainte et on ajoute la colonne.
alter table public.saas_invoice_lines
  alter column unit_price_cents drop not null,
  alter column unit_price_cents drop default,
  add column if not exists blocking_reason text;

create index if not exists saas_invoice_lines_invoice_idx
  on public.saas_invoice_lines (invoice_id, position);

alter table public.saas_invoice_lines enable row level security;

drop policy if exists "Les lignes suivent la facture" on public.saas_invoice_lines;
create policy "Les lignes suivent la facture" on public.saas_invoice_lines
  for select using (
    exists (
      select 1 from public.saas_invoices i
      where i.id = invoice_id
        and ((i.issued_at is not null and public.is_organization_member(i.organization_id))
             or public.platform_admin_can('billing.invoices.read'))
    )
  );

-- ------------------------------------------------------------
-- 6.e LES ENCAISSEMENTS
-- ------------------------------------------------------------
-- UNE TABLE ET NON DEUX COLONNES SUR LA FACTURE. Un acompte suivi d'un
-- solde, un virement qui arrive en deux fois, une régularisation : deux
-- colonnes « payé le / montant » rendraient la moitié des situations
-- réelles inexprimables, et la seconde écraserait la première. C'est la
-- leçon de 0054, transposée.
--
-- PAS D'IMPORTATION BANCAIRE, PAS DE RAPPROCHEMENT AUTOMATIQUE. Le geste
-- est MANUEL dans ce jalon : un administrateur lit son relevé et saisit.
-- L'écran doit le dire plutôt que de le laisser deviner.

create table if not exists public.saas_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.saas_invoices (id) on delete restrict,

  amount_cents bigint not null check (amount_cents > 0),
  received_on date not null default current_date,
  method text not null default 'transfer'
    check (method in ('transfer', 'provider', 'other')),
  external_reference text,
  note text,

  recorded_by uuid references auth.users (id) on delete set null,
  audit_event_id uuid references public.admin_audit_events (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists saas_invoice_payments_invoice_idx
  on public.saas_invoice_payments (invoice_id, received_on);

alter table public.saas_invoice_payments enable row level security;

drop policy if exists "Les encaissements suivent la facture" on public.saas_invoice_payments;
create policy "Les encaissements suivent la facture" on public.saas_invoice_payments
  for select using (
    exists (
      select 1 from public.saas_invoices i
      where i.id = invoice_id
        and ((i.issued_at is not null and public.is_organization_member(i.organization_id))
             or public.platform_admin_can('billing.invoices.read'))
    )
  );

-- ------------------------------------------------------------
-- 6.f LES AVOIRS
-- ------------------------------------------------------------
-- « Une facture émise ne se modifie plus — on l'annule par un avoir. »
-- C'est la règle comptable, et elle est portée par le déclencheur du
-- § 6.h, pas par la politesse de l'interface.
--
-- L'avoir a sa PROPRE séquence, elle aussi sans trou. Mélanger avoirs et
-- factures dans une seule numérotation rendrait les deux illisibles.

create table if not exists public.saas_credit_notes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.saas_invoices (id) on delete restrict,
  organization_id uuid not null references public.business_organizations (id) on delete restrict,

  number text,
  reason text not null constraint saas_credit_notes_reason_not_blank check (btrim(reason) <> ''),
  issued_on date,
  issued_at timestamptz,

  created_by uuid references auth.users (id) on delete set null,
  audit_event_id uuid references public.admin_audit_events (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint saas_credit_notes_number_unique unique (number),
  constraint saas_credit_notes_issued_has_number
    check (issued_at is null or number is not null)
);

create index if not exists saas_credit_notes_invoice_idx
  on public.saas_credit_notes (invoice_id);

alter table public.saas_credit_notes enable row level security;

drop policy if exists "Les avoirs suivent la facture" on public.saas_credit_notes;
create policy "Les avoirs suivent la facture" on public.saas_credit_notes
  for select using (
    (issued_at is not null and public.is_organization_member(organization_id))
    or public.platform_admin_can('billing.invoices.read')
  );

create table if not exists public.saas_credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  credit_note_id uuid not null references public.saas_credit_notes (id) on delete cascade,

  position integer not null default 0,
  description text not null,
  quantity numeric(14, 3) not null default 1,
  unit_price_cents bigint not null default 0,
  vat_rate numeric(5, 2),

  total_cents bigint generated always as (
    round(quantity * unit_price_cents)::bigint
  ) stored,

  created_at timestamptz not null default now()
);

create index if not exists saas_credit_note_lines_note_idx
  on public.saas_credit_note_lines (credit_note_id, position);

alter table public.saas_credit_note_lines enable row level security;

drop policy if exists "Les lignes d'avoir suivent l'avoir" on public.saas_credit_note_lines;
create policy "Les lignes d'avoir suivent l'avoir" on public.saas_credit_note_lines
  for select using (
    exists (
      select 1 from public.saas_credit_notes n
      where n.id = credit_note_id
        and ((n.issued_at is not null and public.is_organization_member(n.organization_id))
             or public.platform_admin_can('billing.invoices.read'))
    )
  );

-- ------------------------------------------------------------
-- 6.g LES TOTAUX — TVA PAR TAUX, jamais ligne à ligne
-- ------------------------------------------------------------
-- Le correctif 0064 en donne la raison chiffrée : quarante lignes à
-- 1,67 € à 20 % font 13,20 € de TVA arrondie ligne à ligne et 13,36 €
-- par taux. Ce ne sont pas seize centimes qui sont graves, c'est que le
-- document affiche une ventilation par taux au-dessus d'un total
-- calculé autrement : la facture ne fait pas son propre total.
-- ET LE PIÈGE DE `sum()` : en SQL, `sum()` IGNORE les NULL. Une ligne
-- dont le prix est inconnu serait donc silencieusement sautée, et le
-- total rendu SANS elle — un chiffre trop bas qui a l'air d'un chiffre,
-- c'est-à-dire le pire des trois cas possibles. Chaque agrégat est donc
-- gardé par un `bool_or(... is null)` qui fait remonter l'inconnu.
create or replace view public.saas_invoice_totals as
with par_taux as (
  select l.invoice_id, l.vat_rate,
         case when bool_or(l.total_cents is null) then null
              else sum(l.total_cents)::bigint end as base_cents
  from public.saas_invoice_lines l
  group by l.invoice_id, l.vat_rate
),
cumul as (
  select invoice_id,
         case when bool_or(base_cents is null) then null
              else sum(base_cents)::bigint end as ht,
         -- Un seul taux inconnu — ou un seul prix inconnu — rend TOUTE
         -- la TVA inconnue. La rendre partiellement calculée serait
         -- pire : un montant qui a l'air d'un chiffre.
         case when bool_or(vat_rate is null) or bool_or(base_cents is null) then null
              else sum(round(base_cents * vat_rate / 100.0))::bigint end as tva
  from par_taux
  group by invoice_id
)
select
  i.id as invoice_id,
  case when c.invoice_id is null then 0::bigint else c.ht end as total_excluding_vat_cents,
  case when c.invoice_id is null then 0::bigint else c.tva end as total_vat_cents,
  case when c.invoice_id is null then 0::bigint
       when c.ht is null or c.tva is null then null
       else (c.ht + c.tva)::bigint end as total_including_vat_cents
from public.saas_invoices i
left join cumul c on c.invoice_id = i.id;

alter view public.saas_invoice_totals set (security_invoker = true);

create or replace view public.saas_invoice_balance as
with avoirs as (
  select n.invoice_id, l.vat_rate, sum(l.total_cents)::bigint as base_cents
  from public.saas_credit_notes n
  join public.saas_credit_note_lines l on l.credit_note_id = n.id
  where n.issued_at is not null
  group by n.invoice_id, l.vat_rate
),
avoirs_total as (
  select invoice_id,
         case when bool_or(vat_rate is null) then null
              else (sum(base_cents) + sum(round(base_cents * vat_rate / 100.0)))::bigint end as credited_cents
  from avoirs group by invoice_id
),
regle as (
  select invoice_id, sum(amount_cents)::bigint as paid_cents
  from public.saas_invoice_payments group by invoice_id
)
select
  t.invoice_id,
  t.total_including_vat_cents,
  coalesce(p.paid_cents, 0)::bigint as paid_cents,
  coalesce(a.credited_cents, 0)::bigint as credited_cents,
  case when t.total_including_vat_cents is null then null
       else (t.total_including_vat_cents - coalesce(p.paid_cents, 0) - coalesce(a.credited_cents, 0))::bigint
  end as outstanding_cents
from public.saas_invoice_totals t
left join regle p on p.invoice_id = t.invoice_id
left join avoirs_total a on a.invoice_id = t.invoice_id;

alter view public.saas_invoice_balance set (security_invoker = true);

-- L'ÉTAT EFFECTIF. « En retard » se DÉDUIT — de l'échéance et de ce qui
-- reste dû — et ne se saisit jamais. Un statut « overdue » stocké serait
-- faux dès le lendemain du jour où on l'a écrit, et il faudrait un
-- traitement planifié pour le tenir à jour : un traitement de plus à
-- surveiller, pour une information que la base sait déduire.
create or replace view public.saas_invoice_state as
select
  i.id as invoice_id,
  i.organization_id,
  i.number,
  i.status as stored_status,
  case
    when i.status = 'cancelled' then 'cancelled'
    when i.status = 'credited' then 'credited'
    when i.status = 'draft' then 'draft'
    when b.outstanding_cents is not null and b.outstanding_cents <= 0 then 'paid'
    when b.paid_cents > 0 then
      case when i.due_on is not null and i.due_on < current_date then 'partiallyPaidOverdue'
           else 'partiallyPaid' end
    when i.due_on is not null and i.due_on < current_date then 'overdue'
    else 'issued'
  end as effective_status,
  i.due_on,
  case when i.due_on is null then null else (current_date - i.due_on) end as days_late,
  b.total_including_vat_cents,
  b.paid_cents,
  b.credited_cents,
  b.outstanding_cents
from public.saas_invoices i
left join public.saas_invoice_balance b on b.invoice_id = i.id;

alter view public.saas_invoice_state set (security_invoker = true);

-- ------------------------------------------------------------
-- 6.h UNE FACTURE ÉMISE NE BOUGE PLUS
-- ------------------------------------------------------------
-- LA RÈGLE CENTRALE, TENUE PAR LA BASE. Une interface se contourne ; une
-- facture modifiée après remise au client est un document qui ne
-- correspond plus à ce qu'il a reçu.
--
-- CE QUI RESTE MODIFIABLE APRÈS ÉMISSION, et rien d'autre : le statut
-- (il suit les encaissements et les décisions), les notes internes, la
-- référence externe de paiement (elle arrive du prestataire APRÈS), et
-- les champs d'annulation. Tout le reste est figé — y compris les
-- identités recopiées, car c'est précisément ce que le client a reçu.
create or replace function public.protect_issued_saas_invoice()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.issued_at is null then
    return new;
  end if;

  if new.number is distinct from old.number
     or new.issued_on is distinct from old.issued_on
     or new.issued_at is distinct from old.issued_at
     or new.organization_id is distinct from old.organization_id
     or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end
     or new.billing_cycle is distinct from old.billing_cycle
     or new.currency is distinct from old.currency
     or new.vat_regime is distinct from old.vat_regime
     or new.vat_rate is distinct from old.vat_rate
     or new.issuer_legal_name is distinct from old.issuer_legal_name
     or new.issuer_siret is distinct from old.issuer_siret
     or new.issuer_vat_number is distinct from old.issuer_vat_number
     or new.issuer_iban is distinct from old.issuer_iban
     or new.customer_legal_name is distinct from old.customer_legal_name
     or new.customer_siret is distinct from old.customer_siret
     or new.customer_vat_number is distinct from old.customer_vat_number
     or new.customer_address is distinct from old.customer_address
     or new.payment_reference is distinct from old.payment_reference
     or new.due_on is distinct from old.due_on
  then
    raise exception 'Facture % déjà émise : son contenu ne se modifie plus. Le mécanisme de correction est l''avoir.', old.number
      using errcode = '23514';
  end if;

  -- Une facture émise ne redevient JAMAIS un brouillon.
  if new.status = 'draft' then
    raise exception 'Facture % déjà émise : elle ne redevient pas un brouillon. Émettez un avoir.', old.number
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_issued_saas_invoice on public.saas_invoices;
create trigger trg_protect_issued_saas_invoice before update on public.saas_invoices
  for each row execute function public.protect_issued_saas_invoice();

create or replace function public.protect_issued_saas_invoice_lines()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_number text;
begin
  select i.number into v_number from public.saas_invoices i
   where i.id = coalesce(new.invoice_id, old.invoice_id) and i.issued_at is not null;

  if v_number is not null then
    raise exception 'Facture % déjà émise : ses lignes ne se modifient plus, ni ne s''ajoutent, ni ne se suppriment. Émettez un avoir.', v_number
      using errcode = '23514';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_protect_issued_saas_invoice_lines on public.saas_invoice_lines;
create trigger trg_protect_issued_saas_invoice_lines
  before insert or update or delete on public.saas_invoice_lines
  for each row execute function public.protect_issued_saas_invoice_lines();

-- ET ON NE SUPPRIME PAS UNE FACTURE ÉMISE. C'est la contrepartie du
-- choix « pas de trou dans la séquence » : le document reste, annulé.
create or replace function public.protect_saas_invoice_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.issued_at is not null then
    raise exception 'Facture % : une facture émise ne se supprime pas, elle s''annule et garde son numéro. Un trou dans la séquence est un défaut grave.', old.number
      using errcode = '23514';
  end if;

  -- SUPPRIMER UN BROUILLON REND SES CRÉDITS. La clé étrangère du crédit
  -- porte `on delete set null`, ce qui viderait `consumed_invoice_id`
  -- en laissant `consumed_at` daté — et la contrainte de cohérence de
  -- la table refuserait, avec un message que personne ne relierait à un
  -- crédit. On les rend donc AVANT, dans le même geste que
  -- `saas_cancel_invoice` : un brouillon n'immobilise pas l'argent d'un
  -- client, et sa disparition ne le fait pas disparaître avec lui.
  update public.saas_account_credits c
     set consumed_at = null, consumed_invoice_id = null
   where c.consumed_invoice_id = old.id;

  return old;
end;
$$;

drop trigger if exists trg_protect_saas_invoice_delete on public.saas_invoices;
create trigger trg_protect_saas_invoice_delete before delete on public.saas_invoices
  for each row execute function public.protect_saas_invoice_delete();

do $$
declare f text;
begin
  foreach f in array array[
    'public.protect_issued_saas_invoice()',
    'public.protect_issued_saas_invoice_lines()',
    'public.protect_saas_invoice_delete()'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from authenticated', f);
  end loop;
end $$;

-- La clé étrangère du crédit vers la facture qui l'a consommé n'a pu
-- être posée au § 5.e : la table des factures n'existait pas encore.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'saas_account_credits_invoice_fk') then
    alter table public.saas_account_credits
      add constraint saas_account_credits_invoice_fk
      foreign key (consumed_invoice_id) references public.saas_invoices (id) on delete set null;
  end if;
end $$;

-- ------------------------------------------------------------
-- 6.i CE QU'UN ABONNEMENT DOIT, POUR UNE PÉRIODE
-- ------------------------------------------------------------
-- LA FONCTION QUI FAIT LE CALCUL, ET LA SEULE. L'écran d'abonnement s'en
-- sert pour montrer ce qui sera facturé ; le générateur s'en sert pour
-- écrire les lignes. Deux calculs séparés auraient divergé au premier
-- changement de grille.
--
-- ELLE NE LÈVE JAMAIS SUR UN CAS INDÉCIDABLE : elle rend une ligne
-- portant un `blocking_reason`. Lever ferait échouer la génération
-- entière à cause d'une seule entreprise mal renseignée ; rendre un
-- montant faux serait pire. La ligne existe, elle dit ce qui manque, et
-- l'émission la refuse.
create or replace function public.saas_subscription_billing_lines(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date
)
returns table (
  -- `line_position` et non `position` : `position` est un mot réservé du
  -- SQL et ne peut pas nommer une colonne dans un `returns table`.
  line_position integer,
  kind text,
  module_key text,
  description text,
  quantity numeric,
  unit_price_cents bigint,
  vat_rate numeric,
  blocking_reason text
)
language plpgsql
stable
-- `security definer`, pour la même raison que `saas_vat_regime` juste
-- au-dessus : un administrateur n'est membre d'aucune entreprise, et en
-- `security invoker` cette fonction ne voyait NI l'abonnement, NI les
-- modules souscrits, NI la remise. Elle rendait alors zéro ligne — un
-- écran vide qui se serait lu « cette entreprise ne doit rien ».
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub record;
  v_plan record;
  v_regime record;
  v_rate numeric;
  v_regime_block text;
  v_base bigint;
  v_pos integer := 0;
  v_disc record;
  v_remise bigint;
  v_mod record;
  v_terms record;
  v_prix bigint;
  v_annuel boolean;
begin
  if not (public.platform_admin_can('billing.subscriptions.read')
          or public.platform_admin_can('billing.invoices.read')) then
    raise exception 'Accès refusé : ce calcul se lit avec billing.subscriptions.read ou billing.invoices.read.'
      using errcode = '42501';
  end if;

  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;
  if v_sub.organization_id is null then
    return;
  end if;

  select * into v_plan from public.organization_plans where key = v_sub.plan;
  v_annuel := (v_sub.billing_cycle = 'yearly');

  select * into v_regime from public.saas_vat_regime(p_organization_id);
  v_rate := v_regime.rate;
  if v_regime.regime = 'unknown' then
    v_regime_block := coalesce(v_regime.reason, 'Régime de TVA inconnu.');
  end if;

  -- ---- 1. L'offre ------------------------------------------------
  if v_plan.is_quote_only then
    v_base := case when v_annuel then v_sub.negotiated_yearly_price_cents
                   else v_sub.negotiated_monthly_price_cents end;
  else
    v_base := case when v_annuel then v_plan.yearly_price_cents
                   else v_plan.monthly_price_cents end;
  end if;

  v_pos := v_pos + 1;
  return query select
    v_pos, 'plan'::text, null::text,
    (v_plan.name || ' — ' || case when v_annuel then 'abonnement annuel' else 'abonnement mensuel' end
      || ' du ' || to_char(p_period_start, 'DD/MM/YYYY') || ' au ' || to_char(p_period_end - 1, 'DD/MM/YYYY'))::text,
    1::numeric,
    -- PAS DE `coalesce(..., 0)`. Un prix absent reste NULL jusqu'au
    -- total, qui devient inconnu, et l'émission le refuse. Coalescé à
    -- zéro, il produisait un brouillon à 0,00 € que rien n'empêchait
    -- d'émettre : une facture française numérotée, opposable et
    -- immuable, à zéro euro.
    v_base,
    v_rate,
    coalesce(
      v_regime_block,
      case when v_base is null then
        'L''offre « ' || v_plan.name || ' » n''a pas de prix ' ||
        case when v_annuel then 'annuel' else 'mensuel' end ||
        case when v_plan.is_quote_only then ' négocié sur cet abonnement.' else ' dans la grille.' end
      end);

  -- ---- 2. La remise, si elle couvre le début de période -----------
  select * into v_disc
  from public.subscription_discounts d
  where d.organization_id = p_organization_id
    and d.cancelled_at is null
    and daterange(d.starts_on, d.ends_on, '[)') @> p_period_start
  order by d.starts_on desc
  limit 1;

  -- L'ASSERTION DÉFENSIVE, ET ELLE N'EST PAS DE LA DÉFIANCE ENVERS LES
  -- DÉCLENCHEURS. Ceux du § 4.c et du § 5.b garantissent qu'une remise
  -- restreinte ne peut pas se retrouver sur une autre offre ; ce
  -- contrôle-ci couvre ce qu'ils ne couvrent pas — une ligne écrite
  -- AVANT eux, ou une restauration de sauvegarde. Il BLOQUE plutôt
  -- qu'il n'ignore la remise : appliquer le plein tarif en silence
  -- ferait payer 90 € de plus sans dire pourquoi.
  if v_disc.id is not null
     and v_disc.applies_to_plan is not null
     and v_disc.applies_to_plan is distinct from v_sub.plan then
    v_pos := v_pos + 1;
    return query select v_pos, 'discount'::text, null::text,
      ('Remise « ' || v_disc.label || ' »')::text,
      1::numeric, null::bigint, v_rate,
      ('La remise « ' || v_disc.label || ' » est réservée à l''offre « ' || v_disc.applies_to_plan
       || ' » et cet abonnement est en « ' || v_sub.plan || ' ». La base refuse cette combinaison depuis '
       || 'la migration 0081 : cette ligne est donc antérieure au verrou. Retirez la remise, ou remettez '
       || 'l''abonnement sur son offre.')::text;

  elsif v_disc.id is not null and v_base is not null then
    v_remise := null;
    if v_disc.kind = 'fixedMonthlyPrice' then
      if v_annuel then
        -- LA RÈGLE EST ARRÊTÉE : une remise à prix mensuel imposé NE SE
        -- VEND QU'AU MOIS (§ 4.c). Ce cas n'est donc plus indécidable,
        -- il est IMPOSSIBLE — on n'y arrive que par une donnée
        -- antérieure au verrou, ou par un abonnement basculé en annuel
        -- avant que le déclencheur du § 5.b n'existe. On refuse la
        -- facture plutôt que d'inventer un équivalent annuel que
        -- personne n'a fixé.
        v_pos := v_pos + 1;
        return query select v_pos, 'discount'::text, null::text,
          ('Remise « ' || v_disc.label || ' » — jusqu''au ' || to_char(v_disc.ends_on, 'DD/MM/YYYY'))::text,
          1::numeric, null::bigint, v_rate,
          ('La remise « ' || v_disc.label || ' » est libellée en prix MENSUEL et ne se vend qu''au mois ; '
           || 'cet abonnement est ANNUEL. Son équivalent annuel n''existe pas et ne sera pas inventé : '
           || 'basculez l''abonnement au mois, ou retirez la remise.')::text;
      else
        v_remise := greatest(v_base - v_disc.value_cents, 0);
      end if;
    elsif v_disc.kind = 'percentOff' then
      v_remise := round(v_base * v_disc.percent / 100.0)::bigint;
    elsif v_disc.kind = 'amountOff' then
      v_remise := least(v_disc.value_cents, v_base);
    end if;

    if v_remise is not null and v_remise > 0 then
      v_pos := v_pos + 1;
      return query select v_pos, 'discount'::text, null::text,
        ('Remise « ' || v_disc.label || ' » — jusqu''au ' || to_char(v_disc.ends_on, 'DD/MM/YYYY'))::text,
        1::numeric, (-v_remise)::bigint, v_rate, v_regime_block;
    end if;
  end if;

  -- ---- 3. Les sièges facturés en plus -----------------------------
  if coalesce(v_sub.billable_extra_seats, 0) > 0 then
    v_pos := v_pos + 1;
    if v_annuel then
      return query select v_pos, 'seats'::text, null::text,
        ('Sièges supplémentaires (' || v_sub.billable_extra_seats || ')')::text,
        v_sub.billable_extra_seats::numeric, null::bigint, v_rate,
        'Le prix du siège supplémentaire est fixé au MOIS (9,90 €). Son équivalent ANNUEL n''a pas été décidé : on ne l''invente pas.'::text;
    else
      return query select v_pos, 'seats'::text, null::text,
        ('Sièges supplémentaires (' || v_sub.billable_extra_seats || ')')::text,
        v_sub.billable_extra_seats::numeric,
        v_plan.extra_seat_monthly_price_cents,
        v_rate,
        coalesce(v_regime_block,
          case when v_plan.extra_seat_monthly_price_cents is null
               then 'L''offre « ' || v_plan.name || ' » n''a pas de prix de siège supplémentaire.' end);
    end if;
  end if;

  -- ---- 4. Les modules ---------------------------------------------
  -- LE PRIX VIENT DE LA MATRICE, JAMAIS DE LA LIGNE D'ABONNEMENT. C'est
  -- ce qui fait qu'un module inclus dans l'offre ne produit AUCUNE
  -- ligne, et qu'un passage de Pro à Pro Business cesse de facturer
  -- BioLab sans qu'on touche à quoi que ce soit.
  for v_mod in
    select sm.module_key, m.name, m.pricing_model, m.metered_unit
    from public.organization_subscription_modules sm
    join public.platform_modules m on m.key = sm.module_key
    where sm.organization_id = p_organization_id and sm.cancelled_at is null
    order by m.position
  loop
    select * into v_terms from public.plan_module_terms(v_sub.plan, v_mod.module_key);

    if v_terms.availability = 'included' then
      continue;  -- compris dans l'offre : rien à facturer, et c'est le point.
    end if;

    v_pos := v_pos + 1;

    if v_terms.availability <> 'optional' then
      return query select v_pos, 'module'::text, v_mod.module_key,
        ('Module ' || v_mod.name)::text, 1::numeric, null::bigint, v_rate,
        ('La case « ' || v_sub.plan || ' × ' || v_mod.name || ' » vaut « ' || v_terms.availability
         || ' » : ce module est souscrit mais l''offre ne dit pas à quel prix.')::text;
    elsif v_mod.pricing_model = 'metered' then
      return query select v_pos, 'module'::text, v_mod.module_key,
        ('Module ' || v_mod.name)::text, 1::numeric, null::bigint, v_rate,
        ('Le module « ' || v_mod.name || ' » se facture au compteur (' || coalesce(v_mod.metered_unit, 'unité')
         || ') et aucune table n''enregistre la consommation. Le montant est INCONNU.')::text;
    else
      v_prix := case when v_annuel then v_terms.yearly_price_cents else v_terms.monthly_price_cents end;
      return query select v_pos, 'module'::text, v_mod.module_key,
        ('Module ' || v_mod.name)::text, 1::numeric, v_prix, v_rate,
        coalesce(v_regime_block,
          case when v_prix is null then
            'La case « ' || v_sub.plan || ' × ' || v_mod.name || ' » n''a pas de prix '
            || case when v_annuel then 'annuel' else 'mensuel' end || '.' end);
    end if;
  end loop;
end;
$$;

comment on function public.saas_subscription_billing_lines(uuid, date, date) is
  'Ce qu''un abonnement doit pour une période. Consulte TOUJOURS la matrice offre × module pour le prix d''un module. '
  'Ne lève jamais : un cas indécidable rend une ligne portant un blocking_reason, et l''émission la refuse.';

-- ------------------------------------------------------------
-- 6.j ÉMETTRE
-- ------------------------------------------------------------
create or replace function public.saas_issue_invoice(
  p_invoice_id uuid,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_inv record;
  v_issuer record;
  v_org record;
  v_manque text[];
  v_number text;
  v_lines integer;
  v_sans_taux integer;
  v_bloc text;
  v_due date;
begin
  if not public.platform_admin_can('billing.invoices.write') then
    raise exception 'Accès refusé : permission billing.invoices.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : émettre une facture, c''est produire un document opposable.'
      using errcode = '23514';
  end if;

  -- `for update` — ET C'EST CE QUI TIENT LA PROMESSE DU FICHIER.
  -- Sans verrou, deux appels réellement simultanés sur le MÊME brouillon
  -- passaient tous deux le test d'idempotence ci-dessous (leurs `select`
  -- précédant le premier `commit`), puis se sérialisaient sur le
  -- compteur : le premier obtenait 00001, le second 00002 et écrasait le
  -- numéro. Le compteur valait 2, la facture portait 00002, et
  -- FS-AAAA-00001 n'existait sur aucun document — un TROU, c'est-à-dire
  -- le défaut que toute cette section existe pour rendre impossible.
  -- Avec le verrou, la seconde transaction attend, relit `issued_at`
  -- déjà renseigné et sort par le chemin idempotent sans consommer de
  -- numéro.
  select * into v_inv from public.saas_invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Facture introuvable.' using errcode = '23503';
  end if;
  if v_inv.issued_at is not null then
    -- IDEMPOTENT. Réémettre ne consomme pas un second numéro : c'est
    -- exactement le genre d'appel qu'un double clic produit.
    return v_inv.number;
  end if;
  if v_inv.status = 'cancelled' then
    raise exception 'Cette facture est annulée : elle ne s''émet pas.' using errcode = '23514';
  end if;

  -- 1. L'ÉMETTEUR DOIT ÊTRE COMPLET. Une facture sans SIRET, sans numéro
  -- de TVA, sans IBAN ou sans clause de pénalités est irrégulière.
  v_manque := public.saas_billing_issuer_missing_fields();
  if array_length(v_manque, 1) > 0 then
    raise exception 'Identité de l''émetteur incomplète : il manque %. Une facture ne part pas sans ses mentions obligatoires.', array_to_string(v_manque, ', ')
      using errcode = '23514';
  end if;

  -- 2. LE RÉGIME DE TVA DOIT ÊTRE CONNU. C'est le refus le plus
  -- important du fichier : on n'invente pas un taux.
  if v_inv.vat_regime = 'unknown' then
    raise exception 'Régime de TVA inconnu pour cette entreprise : %. Tranchez-le avant d''émettre — supposer 20 %% ou 0 %% serait faux dans un sens ou dans l''autre.', coalesce(v_inv.vat_note, 'motif non enregistré')
      using errcode = '23514';
  end if;

  select count(*), count(*) filter (where l.vat_rate is null)
    into v_lines, v_sans_taux
  from public.saas_invoice_lines l where l.invoice_id = p_invoice_id;

  if v_lines = 0 then
    raise exception 'Une facture sans ligne ne s''émet pas.' using errcode = '23514';
  end if;
  if v_sans_taux > 0 then
    raise exception 'Au moins une ligne n''a pas de taux de TVA : le total serait inconnu, et un document dont on ne sait pas faire le total ne s''émet pas.'
      using errcode = '23514';
  end if;

  -- 2 ter. AUCUN PRIX INCONNU, ET AUCUN MOTIF DE BLOCAGE RESTANT.
  --
  -- C'est le contrôle qui manquait, et son absence laissait émettre une
  -- facture opposable à 0,00 € : la génération coalesçait un prix
  -- absent à zéro, écrivait le motif dans une colonne de retour que
  -- personne n'enregistrait, et l'émission unitaire — celle du bouton
  -- de l'écran — ne regardait jamais les prix. Le motif est désormais
  -- STOCKÉ sur la ligne fautive, et on le relit ici.
  select string_agg(distinct coalesce(l.blocking_reason,
           'Prix inconnu sur la ligne « ' || l.description || ' »'), ' | ')
    into v_bloc
  from public.saas_invoice_lines l
  where l.invoice_id = p_invoice_id
    and (l.blocking_reason is not null or l.unit_price_cents is null);

  if v_bloc is not null then
    raise exception 'Cette facture ne peut pas être émise : %. Un montant inconnu ne devient pas zéro parce qu''on l''a imprimé.', v_bloc
      using errcode = '23514';
  end if;

  select * into v_issuer from public.saas_billing_issuer where id;
  select * into v_org from public.business_organizations where id = v_inv.organization_id;

  -- 2 bis. LE CLIENT AUSSI DOIT ÊTRE IDENTIFIABLE. Une facture entre
  -- professionnels porte l'identité des DEUX parties. Tous ces champs
  -- sont nullables sur `business_organizations` — une entreprise peut
  -- s'inscrire sans les renseigner — donc c'est ici, et seulement ici,
  -- qu'on refuse. L'autoliquidation exige en plus le numéro
  -- intracommunautaire du preneur : c'est lui qui porte la mention.
  if nullif(btrim(coalesce(v_org.legal_name, v_org.name, '')), '') is null then
    raise exception 'Le client n''a pas de raison sociale : une facture ne peut pas être adressée à personne.'
      using errcode = '23514';
  end if;
  if v_inv.vat_regime = 'france'
     and nullif(btrim(coalesce(v_org.siret, '')), '') is null then
    raise exception 'Le client « % » n''a pas de SIRET : une facture à un professionnel français doit le porter.', coalesce(v_org.legal_name, v_org.name)
      using errcode = '23514';
  end if;
  if v_inv.vat_regime = 'euReverseCharge'
     and nullif(btrim(coalesce(v_org.vat_number, '')), '') is null then
    raise exception 'Autoliquidation sans numéro de TVA intracommunautaire du client : la mention obligatoire serait incomplète.'
      using errcode = '23514';
  end if;

  -- 3. LE NUMÉRO, ET SEULEMENT MAINTENANT. Attribué dans la même
  -- transaction que le reste : si quoi que ce soit échoue en dessous,
  -- l'incrément du compteur disparaît avec, et il n'y a pas de trou.
  v_number := public.saas_next_document_number('invoice', 'FS');

  v_due := current_date + coalesce(v_issuer.payment_terms_days, 30);

  update public.saas_invoices set
    number = v_number,
    status = 'issued',
    issued_on = current_date,
    issued_at = now(),
    due_on = v_due,

    issuer_legal_name = v_issuer.legal_name,
    issuer_legal_form = v_issuer.legal_form,
    issuer_siret = v_issuer.siret,
    issuer_vat_number = v_issuer.vat_number,
    issuer_rcs_city = v_issuer.rcs_city,
    issuer_share_capital_cents = v_issuer.share_capital_cents,
    issuer_address = nullif(concat_ws(', ', v_issuer.address_line1, v_issuer.address_line2,
                                      concat_ws(' ', v_issuer.postal_code, v_issuer.city),
                                      v_issuer.country), ''),
    issuer_email = v_issuer.email,
    issuer_iban = v_issuer.iban,
    issuer_bic = v_issuer.bic,
    issuer_late_penalty_terms = v_issuer.late_penalty_terms,
    issuer_recovery_indemnity_cents = v_issuer.recovery_indemnity_cents,
    issuer_footer = v_issuer.invoice_footer,

    customer_name = v_org.name,
    customer_legal_name = v_org.legal_name,
    customer_legal_form = v_org.legal_form,
    customer_siret = v_org.siret,
    customer_vat_number = v_org.vat_number,
    customer_address = nullif(concat_ws(', ', v_org.address_line1, v_org.address_line2,
                                        concat_ws(' ', v_org.postal_code, v_org.city)), ''),
    customer_country = v_org.country,
    customer_email = v_org.email,

    -- LA RÉFÉRENCE DE PAIEMENT. Sans elle, un virement arrive sans qu'on
    -- sache à quelle facture il correspond. Dérivée du numéro : le
    -- client n'a rien de plus à recopier.
    payment_reference = 'OC' || replace(v_number, '-', ''),

    updated_at = now()
  where id = p_invoice_id;

  perform public.record_admin_event(
    'saasInvoice.issued', 'saas_invoice', p_invoice_id, v_number,
    jsonb_build_object('status', v_inv.status),
    jsonb_build_object('status', 'issued', 'number', v_number, 'dueOn', v_due,
                       'vatRegime', v_inv.vat_regime),
    v_reason);

  return v_number;
end;
$$;

-- ------------------------------------------------------------
-- 6.k ENCAISSER — À LA MAIN, ET L'ÉCRAN LE DIT
-- ------------------------------------------------------------
create or replace function public.saas_record_invoice_payment(
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_received_on date,
  p_method text,
  p_reason text,
  p_note text default null,
  p_external_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_inv record;
  v_audit uuid;
  v_reste bigint;
begin
  if not public.platform_admin_can('billing.invoices.write') then
    raise exception 'Accès refusé : permission billing.invoices.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : un encaissement saisi à la main se relit.'
      using errcode = '23514';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Un encaissement se compte en centimes strictement positifs.' using errcode = '23514';
  end if;
  if p_method is null or p_method not in ('transfer', 'provider', 'other') then
    raise exception 'Moyen de règlement inconnu : %.', coalesce(p_method, '(vide)') using errcode = '23514';
  end if;

  select * into v_inv from public.saas_invoices where id = p_invoice_id;
  if v_inv.id is null then
    raise exception 'Facture introuvable.' using errcode = '23503';
  end if;
  if v_inv.issued_at is null then
    raise exception 'Cette facture n''est pas émise : on n''encaisse pas un brouillon.' using errcode = '23514';
  end if;

  v_audit := public.record_admin_event(
    'saasInvoice.paymentRecorded', 'saas_invoice', p_invoice_id, v_inv.number, null,
    jsonb_build_object('amountCents', p_amount_cents, 'receivedOn', coalesce(p_received_on, current_date),
                       'method', p_method, 'externalReference', p_external_reference),
    v_reason);

  insert into public.saas_invoice_payments
    (invoice_id, amount_cents, received_on, method, external_reference, note, recorded_by, audit_event_id)
  values (p_invoice_id, p_amount_cents, coalesce(p_received_on, current_date), p_method,
          p_external_reference, public.ai_clean_text(p_note, 500), auth.uid(), v_audit);

  -- LE STATUT SUIT L'ARGENT, il ne se saisit pas. On le recalcule à
  -- partir du solde : un statut « payée » posé à la main sur une
  -- facture partiellement réglée serait la première erreur du premier
  -- jour.
  select b.outstanding_cents into v_reste
  from public.saas_invoice_balance b where b.invoice_id = p_invoice_id;

  if v_reste is not null and v_reste <= 0 and v_inv.status = 'issued' then
    update public.saas_invoices
       set status = 'paid',
           external_payment_reference = coalesce(p_external_reference, external_payment_reference),
           updated_at = now()
     where id = p_invoice_id;
  elsif p_external_reference is not null then
    update public.saas_invoices
       set external_payment_reference = p_external_reference, updated_at = now()
     where id = p_invoice_id;
  end if;

  return v_audit;
end;
$$;

-- ------------------------------------------------------------
-- 6.l ANNULER UN BROUILLON — et corriger une facture émise
-- ------------------------------------------------------------
-- DEUX CHEMINS, PARCE QUE CE SONT DEUX ACTES DIFFÉRENTS.
--
--   • UN BROUILLON s'annule. Il n'a pas de numéro, il n'a jamais quitté
--     nos mains, personne ne l'a reçu : rien à corriger, rien à
--     conserver au titre de la séquence.
--   • UNE FACTURE ÉMISE ne s'annule pas, elle se CRÉDITE. Elle garde son
--     numéro et son rang — un trou dans la séquence est un défaut
--     grave — et un avoir la neutralise. C'est plus lourd, et c'est le
--     but : un document remis à un client reste ce qu'il a reçu.
create or replace function public.saas_cancel_invoice(
  p_invoice_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_inv record;
begin
  if not public.platform_admin_can('billing.invoices.write') then
    raise exception 'Accès refusé : permission billing.invoices.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  select * into v_inv from public.saas_invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Facture introuvable.' using errcode = '23503';
  end if;

  if v_inv.issued_at is not null then
    raise exception 'Facture % déjà émise : elle ne s''annule pas, elle se corrige par un avoir (saas_credit_invoice). Elle garde son numéro : un trou dans la séquence est un défaut grave.', v_inv.number
      using errcode = '23514';
  end if;
  if v_inv.status = 'cancelled' then
    raise exception 'Ce brouillon est déjà annulé.' using errcode = '23505';
  end if;

  -- ---- ON REND SES CRÉDITS AU CLIENT -----------------------------
  -- La génération marque un crédit « consommé » dès le BROUILLON.
  -- Annuler le brouillon sans le rendre le faisait disparaître pour
  -- toujours : l'index partiel des crédits ouverts l'excluait, aucune
  -- fonction du fichier ne savait remettre `consumed_at` à null, et la
  -- table n'a aucune politique d'écriture — l'argent du client
  -- n'était récupérable que par un `update` tapé dans l'éditeur SQL.
  --
  -- Le défaut se combinait avec le pire : annuler puis régénérer est
  -- justement la manœuvre qu'on emploie pour corriger un brouillon
  -- périmé, et elle mangeait le crédit au passage. Un brouillon est un
  -- travail en cours ; il n'immobilise plus rien.
  --
  -- La contrainte `saas_account_credits_consumption_coherent` impose de
  -- remettre les DEUX colonnes à null ensemble.
  update public.saas_account_credits
     set consumed_at = null, consumed_invoice_id = null
   where consumed_invoice_id = p_invoice_id;

  update public.saas_invoices
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
         cancellation_reason = v_reason, updated_at = now()
   where id = p_invoice_id;

  return public.record_admin_event(
    'saasInvoice.draftCancelled', 'saas_invoice', p_invoice_id,
    coalesce(v_inv.number, 'brouillon'),
    jsonb_build_object('status', v_inv.status), jsonb_build_object('status', 'cancelled'),
    v_reason);
end;
$$;

create or replace function public.saas_credit_invoice(
  p_invoice_id uuid,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_inv record;
  v_note_id uuid;
  v_number text;
begin
  if not public.platform_admin_can('billing.invoices.write') then
    raise exception 'Accès refusé : permission billing.invoices.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : un avoir dit ce qu''on corrige, et c''est ce que lira le comptable.'
      using errcode = '23514';
  end if;

  -- `for update` pour la même raison qu'à l'émission : l'avoir consomme
  -- lui aussi un numéro de séquence, par le même patron.
  select * into v_inv from public.saas_invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Facture introuvable.' using errcode = '23503';
  end if;
  if v_inv.issued_at is null then
    raise exception 'Cette facture n''est pas émise : annulez le brouillon (saas_cancel_invoice) plutôt que d''émettre un avoir.'
      using errcode = '23514';
  end if;
  if v_inv.status = 'credited' then
    raise exception 'Facture % déjà créditée.', v_inv.number using errcode = '23505';
  end if;

  v_number := public.saas_next_document_number('creditNote', 'AV');

  insert into public.saas_credit_notes
    (invoice_id, organization_id, number, reason, issued_on, issued_at, created_by)
  values (p_invoice_id, v_inv.organization_id, v_number, v_reason, current_date, now(), auth.uid())
  returning id into v_note_id;

  -- L'AVOIR REPREND LES LIGNES À L'IDENTIQUE, en négatif. Un avoir
  -- partiel se saisirait ligne à ligne ; celui-ci neutralise la facture
  -- entière, qui est le cas réel d'une erreur d'émission.
  insert into public.saas_credit_note_lines
    (credit_note_id, position, description, quantity, unit_price_cents, vat_rate)
  select v_note_id, l.position, l.description, l.quantity, l.unit_price_cents, l.vat_rate
  from public.saas_invoice_lines l where l.invoice_id = p_invoice_id
  order by l.position;

  update public.saas_invoices set status = 'credited', updated_at = now()
   where id = p_invoice_id;

  update public.saas_credit_notes set audit_event_id = public.record_admin_event(
    'saasInvoice.credited', 'saas_invoice', p_invoice_id, v_inv.number,
    jsonb_build_object('status', v_inv.status),
    jsonb_build_object('status', 'credited', 'creditNote', v_number),
    v_reason)
   where id = v_note_id;

  return v_number;
end;
$$;

-- ------------------------------------------------------------
-- 6.m LA GÉNÉRATION, IDEMPOTENTE
-- ------------------------------------------------------------
-- CE QU'ELLE FAIT : pour une période et un cycle donnés, elle produit
-- les factures des abonnements en cours. Elle ne les ÉMET que si on le
-- lui demande ET que rien ne bloque — un régime de TVA inconnu, un prix
-- absent, une case de matrice non décidée.
--
-- POURQUOI DES BROUILLONS PAR DÉFAUT. Un document opposable ne doit pas
-- partir sans qu'un humain ait pu regarder la première fois. Le jour où
-- la confiance est acquise, l'appel se fait avec `p_issue => true` et
-- rien d'autre ne change.
--
-- CE QUI REND LA RELANCE SANS DANGER : l'index unique partiel
-- `saas_invoices_one_per_period_idx`. Ce n'est pas cette fonction qui
-- promet de ne pas doublonner, c'est la BASE qui le lui interdit.
--
-- IL N'Y A PAS DE PLANIFICATEUR. Personne n'appelle encore cette
-- fonction : le déclenchement viendra avec le chantier suivant.
create or replace function public.saas_generate_invoices(
  p_billing_cycle text,
  p_period_start date,
  p_period_end date,
  p_reason text,
  p_issue boolean default false
)
returns table (
  organization_id uuid,
  organization_name text,
  invoice_id uuid,
  invoice_number text,
  outcome text,
  total_including_vat_cents bigint,
  blocking_reason text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_sub record;
  v_inv_id uuid;
  v_existing record;
  v_regime record;
  v_bloc text;
  v_pos integer;
  v_credit record;
  v_ttc bigint;
  v_number text;
  v_outcome text;
begin
  if not public.platform_admin_can('billing.invoices.write') then
    raise exception 'Accès refusé : permission billing.invoices.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  if p_billing_cycle is null or p_billing_cycle not in ('monthly', 'yearly') then
    raise exception 'Cycle inconnu : %.', coalesce(p_billing_cycle, '(vide)') using errcode = '23514';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end <= p_period_start then
    raise exception 'Période invalide : la fin doit suivre le début.' using errcode = '23514';
  end if;

  for v_sub in
    select s.*, o.name as org_name
    from public.organization_subscriptions s
    join public.business_organizations o
      on o.id = s.organization_id and o.archived_at is null
    where s.billing_cycle = p_billing_cycle
      -- 'trialing' n'est pas facturé : c'est le sens d'un essai.
      -- 'pastDue' l'est — un impayé ne suspend pas l'abonnement, il
      -- s'ajoute à ce qui est dû.
      and s.status in ('active', 'pastDue')
    order by o.name
  loop
    -- ---- Déjà facturé ? ------------------------------------------
    select i.id, i.number, i.status, i.issued_at into v_existing
    from public.saas_invoices i
    where i.organization_id = v_sub.organization_id
      and i.period_start = p_period_start
      and i.period_end = p_period_end
      and i.status <> 'cancelled';

    v_inv_id := null;
    v_outcome := 'draft';

    if v_existing.id is not null then
      if v_existing.issued_at is not null then
        -- ÉMISE : intouchable, et c'est tout le sens du § 6.h.
        select b.total_including_vat_cents into v_ttc
        from public.saas_invoice_balance b where b.invoice_id = v_existing.id;
        return query select v_sub.organization_id, v_sub.org_name, v_existing.id, v_existing.number,
          'alreadyBilled'::text, v_ttc, null::text;
        continue;
      end if;

      -- ---- BROUILLON : ON LE RECALCULE ----------------------------
      -- LE DÉFAUT QUE CE BLOC REFERME. La fonction se contentait de
      -- CONSTATER l'existence et repartait sans rien recalculer. Toute
      -- modification de l'abonnement survenue depuis — changement
      -- d'offre, module activé ou retiré, remise, sièges — était
      -- ignorée, et c'est ce brouillon PÉRIMÉ qui était ensuite émis,
      -- numéroté et envoyé.
      --
      -- Mesuré : une entreprise passée de Pro à Pro Business (qui
      -- COMPREND BioLab) gardait sa ligne « module BioLab 20,00 € » et
      -- payait deux fois ce que son offre inclut ; dans l'autre sens,
      -- une descente de gamme laissait partir une facture opposable de
      -- 48,00 € de trop.
      --
      -- Un brouillon n'est pas un document : c'est un calcul en attente
      -- de relecture. Le relancer doit donc le REFAIRE.
      v_inv_id := v_existing.id;
      v_outcome := 'refreshed';

      -- Les crédits que ce brouillon avait immobilisés sont rendus
      -- avant de reconstruire : ils seront reconsommés plus bas si le
      -- nouveau calcul les reprend, et resteront ouverts sinon.
      -- `c.` et `l.` partout : cette fonction a un paramètre de SORTIE
      -- nommé `invoice_id`, qui masquerait la colonne du même nom.
      update public.saas_account_credits c
         set consumed_at = null, consumed_invoice_id = null
       where c.consumed_invoice_id = v_inv_id;

      delete from public.saas_invoice_lines l where l.invoice_id = v_inv_id;
    end if;

    select * into v_regime from public.saas_vat_regime(v_sub.organization_id);

    if v_inv_id is null then
      insert into public.saas_invoices
        (organization_id, period_start, period_end, billing_cycle, currency,
         vat_regime, vat_rate, vat_note, payment_method, created_by)
      values (v_sub.organization_id, p_period_start, p_period_end, p_billing_cycle,
              coalesce(v_sub.currency, 'EUR'),
              v_regime.regime, v_regime.rate, v_regime.reason, 'transfer', auth.uid())
      returning id into v_inv_id;
    else
      -- Le régime de TVA du client a pu être tranché entre-temps : le
      -- brouillon doit en profiter, sans quoi il resterait bloqué pour
      -- une raison réglée depuis.
      update public.saas_invoices
         set vat_regime = v_regime.regime,
             vat_rate = v_regime.rate,
             vat_note = v_regime.reason,
             currency = coalesce(v_sub.currency, 'EUR'),
             updated_at = now()
       where id = v_inv_id;
    end if;

    v_bloc := null;
    v_pos := 0;

    insert into public.saas_invoice_lines
      (invoice_id, position, kind, module_key, description, quantity, unit_price_cents, vat_rate, blocking_reason)
    select v_inv_id, l.line_position, l.kind, l.module_key, l.description, l.quantity, l.unit_price_cents, l.vat_rate, l.blocking_reason
    from public.saas_subscription_billing_lines(v_sub.organization_id, p_period_start, p_period_end) l;

    select string_agg(distinct l.blocking_reason, ' | '), max(l.line_position)
      into v_bloc, v_pos
    from public.saas_subscription_billing_lines(v_sub.organization_id, p_period_start, p_period_end) l
    where l.blocking_reason is not null;

    if v_pos is null then
      select max(l.line_position) into v_pos
      from public.saas_subscription_billing_lines(v_sub.organization_id, p_period_start, p_period_end) l;
    end if;

    -- ---- Les crédits ouverts, consommés sur cette facture ---------
    -- Un crédit accordé se déduit ici, une seule fois : la ligne porte
    -- `consumed_invoice_id`, et la contrainte de la table empêche de le
    -- consommer deux fois.
    for v_credit in
      select c.* from public.saas_account_credits c
      where c.organization_id = v_sub.organization_id
        and c.consumed_at is null and c.cancelled_at is null
      order by c.granted_at
    loop
      v_pos := coalesce(v_pos, 0) + 1;
      insert into public.saas_invoice_lines
        (invoice_id, position, kind, description, quantity, unit_price_cents, vat_rate)
      values (v_inv_id, v_pos, 'credit',
              'Avoir commercial — ' || v_credit.reason, 1, -v_credit.amount_cents, v_regime.rate);

      update public.saas_account_credits
         set consumed_at = now(), consumed_invoice_id = v_inv_id
       where id = v_credit.id;
    end loop;

    select b.total_including_vat_cents into v_ttc
    from public.saas_invoice_balance b where b.invoice_id = v_inv_id;

    v_number := null;

    if p_issue and v_bloc is null then
      v_number := public.saas_issue_invoice(v_inv_id, v_reason);
      v_outcome := 'issued';
    elsif p_issue then
      v_outcome := 'blocked';
    end if;

    return query select v_sub.organization_id, v_sub.org_name, v_inv_id, v_number,
      v_outcome, v_ttc, v_bloc;
  end loop;
end;
$$;

comment on function public.saas_generate_invoices(text, date, date, text, boolean) is
  'Produit les factures d''abonnement d''une période. IDEMPOTENTE — la relancer sur la même période ne crée pas de doublon, '
  'et c''est un index unique partiel qui l''interdit, pas la politesse de la fonction. '
  'La relancer RECALCULE les brouillons (outcome « refreshed ») : un brouillon est un calcul en attente, pas un document. '
  'Une facture ÉMISE, elle, ne bouge jamais (outcome « alreadyBilled »). '
  'Aucun planificateur ne l''appelle : le déclenchement viendra avec le chantier suivant.';

-- ============================================================
-- 7. LES DRAPEAUX DE FONCTIONNALITÉ
-- ============================================================
--
-- LA TABLE EXISTE DÉJÀ, ET ON NE LA DUPLIQUE PAS. `public.feature_flags`
-- est posée par 0041 (`flag_key`, `is_enabled`, `updated_at`), compte
-- quatre lignes en production, et est LUE par l'application iOS via la
-- politique « Anyone authenticated can read feature flags ». Poser une
-- seconde table de drapeaux ferait deux vérités dont l'app ne lirait
-- que l'ancienne.
--
-- CE QUI MANQUE, C'EST L'ÉCRITURE. Le commentaire de 0041 le dit :
-- « only ever edited directly by the developer in the SQL Editor ». Un
-- écran de bascule est donc utile et vrai — mais son écriture passe par
-- une fonction journalisée, pas par une politique ouverte : basculer
-- `aiDiagnosisEnabled` change ce que voient tous les utilisateurs de
-- l'iPhone, et on veut savoir qui l'a fait et pourquoi.
--
-- CE QU'ON NE CONSTRUIT PAS : LE CIBLAGE. Plan, organisation,
-- utilisateur, pays, cohorte bêta, déploiement à 10 % (spec p.22).
-- `feature_flags` ne porte qu'un booléen GLOBAL, et son lecteur est
-- l'app iOS, qui ne sait lire que ça. Livrer une interface de ciblage
-- supposerait de changer le contrat de lecture côté iOS — hors périmètre
-- de ce fichier, et surtout : un ciblage que le lecteur ignore serait un
-- réglage sans effet, c'est-à-dire un mensonge à l'écran.

create or replace function public.admin_set_feature_flag(
  p_flag_key text,
  p_enabled boolean,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_key text;
  v_old boolean;
begin
  if not public.platform_admin_can('product.flags.write') then
    raise exception 'Accès refusé : permission product.flags.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : un drapeau bascule ce que voient tous les utilisateurs.'
      using errcode = '23514';
  end if;

  v_key := public.ai_clean_text(p_flag_key, 100);
  if v_key is null then
    raise exception 'Clé de drapeau vide.' using errcode = '23514';
  end if;
  if p_enabled is null then
    raise exception 'Un drapeau est allumé ou éteint : « peut-être » n''est pas un état.'
      using errcode = '23514';
  end if;

  -- ON NE CRÉE PAS UN DRAPEAU DEPUIS L'ÉCRAN. Un drapeau que personne
  -- ne lit dans le code est un interrupteur branché sur rien : il donne
  -- l'illusion d'agir. Les drapeaux naissent avec la fonctionnalité
  -- qu'ils commandent, dans une migration.
  select f.is_enabled into v_old from public.feature_flags f where f.flag_key = v_key;
  if v_old is null then
    raise exception 'Drapeau inconnu : %. Un drapeau se crée avec la fonctionnalité qu''il commande, pas depuis l''écran d''administration — sinon c''est un interrupteur branché sur rien.', v_key
      using errcode = '23503';
  end if;

  update public.feature_flags
     set is_enabled = p_enabled, updated_at = now()
   where flag_key = v_key;

  return public.record_admin_event(
    'featureFlag.toggled', 'feature_flag', null, v_key,
    jsonb_build_object('enabled', v_old),
    jsonb_build_object('enabled', p_enabled),
    v_reason);
end;
$$;

-- `commercial_config` suit exactement le même patron : une table de
-- réglages, aucune politique d'écriture, un seul chemin journalisé.
create or replace function public.admin_set_commercial_config(
  p_config_key text,
  p_value jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_key text;
  v_old jsonb;
begin
  if not public.platform_admin_can('product.flags.write') then
    raise exception 'Accès refusé : permission product.flags.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  v_key := public.ai_clean_text(p_config_key, 100);
  if v_key is null or p_value is null then
    raise exception 'Clé ou valeur manquante.' using errcode = '23514';
  end if;

  -- Le marqueur de la grille tarifaire (§ 4.f) n'est pas un réglage :
  -- l'effacer ferait rejouer le semis et écraserait les prix courants à
  -- la prochaine reprise de migration.
  if v_key like 'pricing.grid.%' then
    raise exception 'La clé « % » est un marqueur de migration, pas un réglage : la modifier ferait réécrire la grille tarifaire.', v_key
      using errcode = '42501';
  end if;

  select c.config_value into v_old from public.commercial_config c where c.config_key = v_key;

  insert into public.commercial_config (config_key, config_value, updated_at)
  values (v_key, p_value, now())
  on conflict (config_key) do update
    set config_value = excluded.config_value, updated_at = now();

  return public.record_admin_event(
    'commercialConfig.changed', 'commercial_config', null, v_key,
    v_old, p_value, v_reason);
end;
$$;

-- ============================================================
-- 8. LE SUPPORT
-- ============================================================
--
-- ============================================================
-- 8.a LES TICKETS — ET LE CANAL D'ENTRÉE, QUI EST LE VRAI SUJET
-- ============================================================
--
-- LE CONSTAT PRÉALABLE À CE CHANTIER DISAIT DE NE PAS LIVRER L'ÉCRAN, ET
-- IL AVAIT RAISON SUR CE POINT PRÉCIS : ce qui manquait n'était pas la
-- table, c'était le CANAL D'ENTRÉE. Ni l'app iOS ni Oasis Care Pro
-- n'offrent d'ouvrir un ticket ; une table sans porte d'entrée reste
-- vide à vie, et aucun geste d'administrateur ne peut la remplir —
-- contrairement aux abonnements, dont l'administrateur EST la source.
--
-- CE QUE CE FICHIER PEUT FAIRE, ET FAIT : poser la table ET LA PORTE.
-- `open_support_ticket()` est appelable par n'importe quel compte
-- connecté et crée son propre ticket. Le formulaire qui l'appellera vit
-- dans `OasisCare/` et `web-pro/`, hors du périmètre de ce fichier ;
-- mais il n'aura qu'un appel à écrire, et non un schéma à négocier.
-- Livrer la moitié qui manque n'est pas livrer une façade : c'est
-- livrer la moitié qui manque.
--
-- POURQUOI UNE FONCTION ET NON UNE POLITIQUE `insert`. Une politique
-- laisserait le client choisir sa priorité, son statut, son
-- organisation, et signer le ticket au nom d'un autre. La fonction
-- impose l'auteur (`auth.uid()`), vérifie l'appartenance à
-- l'organisation déclarée, et fixe le statut initial.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),

  -- Un ticket a un AUTEUR, et parfois une entreprise. Un particulier de
  -- l'app iPhone n'a pas d'entreprise ; un salarié Pro en a une, et
  -- c'est ce qui permet au support de voir le contexte.
  user_id uuid references auth.users (id) on delete set null,
  organization_id uuid references public.business_organizations (id) on delete set null,

  subject text not null constraint support_tickets_subject_not_blank check (btrim(subject) <> ''),

  -- Par quel produit et par quel canal la demande est arrivée. Le
  -- support ne répond pas la même chose à un particulier sur iPhone et
  -- à une pépinière sur le web.
  product text not null default 'unknown'
    check (product in ('mobile', 'pro', 'controlCenter', 'unknown')),
  channel text not null default 'inApp'
    check (channel in ('inApp', 'email', 'admin')),

  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open'
    check (status in ('open', 'pending', 'resolved', 'closed')),

  -- Le contexte technique, recopié à l'ouverture : c'est la « version
  -- application / plateforme » de la spec p.19, et c'est ce qui manque
  -- toujours quand on demande au client de le retrouver.
  app_version text,
  app_build text,
  platform text,
  os_version text,

  assigned_to uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,

  -- Un ticket sans auteur ET sans entreprise n'est rattachable à
  -- personne : le support ne saurait pas à qui répondre.
  constraint support_tickets_has_a_source
    check (user_id is not null or organization_id is not null)
);

create index if not exists support_tickets_open_idx
  on public.support_tickets (status, priority, created_at desc)
  where status in ('open', 'pending');
create index if not exists support_tickets_user_idx on public.support_tickets (user_id, created_at desc);
create index if not exists support_tickets_org_idx on public.support_tickets (organization_id, created_at desc);

alter table public.support_tickets enable row level security;

drop policy if exists "Chacun lit ses demandes, le support les lit toutes" on public.support_tickets;
create policy "Chacun lit ses demandes, le support les lit toutes" on public.support_tickets
  for select using (
    user_id = auth.uid()
    or (organization_id is not null and public.is_organization_member(organization_id))
    or public.platform_admin_can('support.tickets.read')
  );

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,

  author_user_id uuid references auth.users (id) on delete set null,
  -- Qui parle. Recopié plutôt que déduit : un salarié d'Oasis Care peut
  -- aussi être client, et l'affichage ne doit pas hésiter.
  author_kind text not null check (author_kind in ('customer', 'admin', 'system')),

  body text not null constraint support_ticket_messages_body_not_blank check (btrim(body) <> ''),

  -- UNE NOTE INTERNE NE SORT JAMAIS. La politique de lecture ci-dessous
  -- la réserve aux administrateurs : c'est la seule protection, et elle
  -- est en base, pas dans l'affichage.
  is_internal boolean not null default false,

  created_at timestamptz not null default now(),

  constraint support_ticket_messages_internal_is_admin
    check (not is_internal or author_kind = 'admin')
);

create index if not exists support_ticket_messages_ticket_idx
  on public.support_ticket_messages (ticket_id, created_at);

alter table public.support_ticket_messages enable row level security;

drop policy if exists "Les messages suivent le ticket, les notes internes restent internes" on public.support_ticket_messages;
create policy "Les messages suivent le ticket, les notes internes restent internes" on public.support_ticket_messages
  for select using (
    public.platform_admin_can('support.tickets.read')
    or (not is_internal and exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id
        and (t.user_id = auth.uid()
             or (t.organization_id is not null and public.is_organization_member(t.organization_id)))
    ))
  );

-- LA PORTE D'ENTRÉE. Appelable par tout compte connecté.
create or replace function public.open_support_ticket(
  p_subject text,
  p_body text,
  p_organization_id uuid default null,
  p_product text default 'unknown',
  p_app_version text default null,
  p_app_build text default null,
  p_platform text default null,
  p_os_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_subject text;
  v_body text;
  v_id uuid;
  v_product text := coalesce(p_product, 'unknown');
begin
  if v_uid is null then
    raise exception 'Il faut être connecté pour ouvrir une demande d''assistance.'
      using errcode = '42501';
  end if;

  v_subject := public.ai_clean_text(p_subject, 200);
  v_body := public.ai_clean_text(p_body, 5000);
  if v_subject is null or v_body is null then
    raise exception 'Un objet et un message sont nécessaires : une demande vide ne se traite pas.'
      using errcode = '23514';
  end if;

  if v_product not in ('mobile', 'pro', 'controlCenter', 'unknown') then
    v_product := 'unknown';
  end if;

  -- L'ORGANISATION DÉCLARÉE DOIT ÊTRE LA SIENNE. Sans ce contrôle, un
  -- client rattacherait sa demande à l'entreprise d'un autre et
  -- verrait, par la politique de lecture, les demandes de celui-ci.
  if p_organization_id is not null and not public.is_organization_member(p_organization_id) then
    raise exception 'Vous n''êtes pas membre de cette entreprise.' using errcode = '42501';
  end if;

  insert into public.support_tickets
    (user_id, organization_id, subject, product, channel,
     app_version, app_build, platform, os_version)
  values (v_uid, p_organization_id, v_subject, v_product, 'inApp',
          public.ai_clean_text(p_app_version, 40),
          public.ai_clean_text(p_app_build, 40),
          public.ai_clean_text(p_platform, 40),
          public.ai_clean_text(p_os_version, 40))
  returning id into v_id;

  insert into public.support_ticket_messages (ticket_id, author_user_id, author_kind, body)
  values (v_id, v_uid, 'customer', v_body);

  return v_id;
end;
$$;

-- Répondre, assigner, changer le statut. Journalisé : la spec p.31
-- demande que toute action administrative importante le soit, et
-- répondre au nom d'Oasis Care en est une.
create or replace function public.admin_reply_support_ticket(
  p_ticket_id uuid,
  p_body text,
  p_reason text,
  p_is_internal boolean default false,
  p_status text default null,
  p_assign_to_me boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_body text;
  v_ticket record;
  v_status text;
begin
  if not public.platform_admin_can('support.tickets.write') then
    raise exception 'Accès refusé : permission support.tickets.write manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  v_body := public.ai_clean_text(p_body, 5000);
  if v_body is null then
    raise exception 'Une réponse vide n''est pas une réponse.' using errcode = '23514';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if v_ticket.id is null then
    raise exception 'Demande introuvable.' using errcode = '23503';
  end if;

  v_status := coalesce(p_status, v_ticket.status);
  if v_status not in ('open', 'pending', 'resolved', 'closed') then
    raise exception 'Statut inconnu : %.', v_status using errcode = '23514';
  end if;

  insert into public.support_ticket_messages
    (ticket_id, author_user_id, author_kind, body, is_internal)
  values (p_ticket_id, auth.uid(), 'admin', v_body, coalesce(p_is_internal, false));

  update public.support_tickets set
    status = v_status,
    -- La première réponse ne se date qu'une fois : c'est le délai de
    -- première réponse, et l'écraser à chaque message le rendrait
    -- toujours excellent.
    first_response_at = case
      when first_response_at is null and not coalesce(p_is_internal, false) then now()
      else first_response_at end,
    resolved_at = case when v_status = 'resolved' and resolved_at is null then now()
                       when v_status not in ('resolved', 'closed') then null
                       else resolved_at end,
    closed_at = case when v_status = 'closed' and closed_at is null then now()
                     when v_status <> 'closed' then null
                     else closed_at end,
    assigned_to = case when coalesce(p_assign_to_me, false) then auth.uid() else assigned_to end,
    updated_at = now()
  where id = p_ticket_id;

  return public.record_admin_event(
    'supportTicket.replied', 'support_ticket', p_ticket_id, v_ticket.subject,
    jsonb_build_object('status', v_ticket.status),
    jsonb_build_object('status', v_status, 'internal', coalesce(p_is_internal, false)),
    v_reason);
end;
$$;

-- ============================================================
-- 8.b LES SESSIONS D'ASSISTANCE — la partie la plus sensible
-- ============================================================
--
-- LA SPEC EST CATÉGORIQUE (p.19-21) : « Ne PAS permettre à un
-- administrateur de naviguer librement dans toutes les données privées
-- d'un client. » Par défaut : NO BUSINESS DATA ACCESS. Si nécessaire :
-- accès en LECTURE SEULE, temporaire, motivé, consenti quand requis,
-- entièrement audité, avec bannière permanente. Et surtout : NE PAS
-- créer de bouton caché « Login as customer ».
--
-- LE PROBLÈME QUE LE CONSTAT A POSÉ, ET QU'IL FAUT RÉSOUDRE ICI. Une
-- session d'assistance n'a de sens que si elle ENCADRE un accès qui
-- existe. Or aucun écran du Control Center n'ouvre les données métier
-- d'un client, et `customer.data.read` n'est portée par AUCUN rôle de
-- travail. Poser la table sans la cible, c'est livrer le garde-fou sans
-- le droit qu'il encadre ; poser la cible d'abord, c'est ouvrir la porte
-- avant le garde-fou.
--
-- LA SORTIE : ON NOMME LES ACCÈS, UN PAR UN, DANS UNE TABLE. Un « niveau
-- d'accès » n'est pas un mot dans une colonne, c'est une LISTE DE
-- RESSOURCES nommées. « Les données du client » n'est pas un niveau
-- d'accès — c'est l'absence de décision.
--
-- CE QUI EST OUVERT AUJOURD'HUI :
--   • `none` — le défaut. AUCUNE ressource. Une session à ce niveau
--     n'ouvre rien du tout ; elle sert à tracer qu'un administrateur a
--     regardé le dossier, ce qui est déjà utile.
--   • `diagnostics` — une liste courte et technique : version
--     d'application installée, consommation d'IA, compteurs de quota.
--     AUCUNE donnée métier : ni plante, ni devis, ni photo, ni client
--     final. C'est ce qu'il faut pour répondre à « pourquoi mon IA
--     s'est arrêtée hier ».
--
-- CE QUI N'EST PAS OUVERT, ET QUI EST DÉCLARÉ POUR QUE LE REFUS SOIT
-- VISIBLE :
--   • `businessReadOnly` — `is_grantable = false`, aucune ressource. Le
--     jour où l'on voudra l'ouvrir, il faudra NOMMER les tables, une par
--     une, et ce sera une décision prise exprès. Tant que la liste est
--     vide, la base refuse d'ouvrir une session à ce niveau : le refus
--     est dans les données, pas dans un commentaire.
--
-- ET LE POINT QUI COMPTE PLUS QUE TOUS LES AUTRES : L'EXPIRATION SE
-- VÉRIFIE EN SQL, dans `support_session_record_access()`, qui est le
-- seul chemin d'accès. La bannière « expire dans 18 min » de la spec
-- p.21 est un AFFICHAGE. Un compte à rebours dans le navigateur n'est
-- pas une sécurité : il suffit de ne pas rafraîchir la page.

create table if not exists public.support_access_levels (
  key text primary key,
  label text not null,
  -- Ce niveau ouvre-t-il des données métier ? La colonne existe pour
  -- qu'un écran puisse afficher un avertissement différent, et pour
  -- qu'on puisse compter les sessions qui en ouvrent.
  opens_business_data boolean not null default false,
  -- Peut-on réellement ouvrir une session à ce niveau ? Un niveau
  -- déclaré mais non accordable dit « on y a pensé, on n'a pas décidé »,
  -- ce qui vaut mieux qu'un niveau absent que quelqu'un réinventera.
  is_grantable boolean not null default false,
  -- Durée maximale d'une session à ce niveau. Plus l'accès est large,
  -- plus la fenêtre est courte.
  max_minutes integer not null default 30 check (max_minutes between 5 and 240),
  requires_consent boolean not null default true,
  note text
);

alter table public.support_access_levels enable row level security;
drop policy if exists "Les administrateurs lisent les niveaux d'accès" on public.support_access_levels;
create policy "Les administrateurs lisent les niveaux d'accès" on public.support_access_levels
  for select using (public.is_platform_admin());

create table if not exists public.support_access_level_resources (
  level_key text not null references public.support_access_levels (key) on delete cascade,
  -- Le nom d'une table de `public`, et rien d'autre. Pas un domaine, pas
  -- une catégorie, pas « les données du client » : une table.
  resource text not null,
  note text,
  primary key (level_key, resource)
);

-- LA COLONNE DE RATTACHEMENT, sans laquelle une session « entreprise A »
-- ouvrait la ligne d'un client B.
--
-- Le gardien vérifiait que la RESSOURCE figurait dans la liste du
-- niveau, jamais que la LIGNE demandée appartenait au client nommé par
-- la session. Une session motivée, affichée « entreprise A »,
-- consentie, laissait donc passer — et journalisait comme légitime —
-- l'accès à la ligne d'un tout autre client de la même table. Le motif
-- écrit au client, la bannière et le journal que le client peut relire
-- disaient tous « A », et la fonction autorisait « B ». C'est
-- exactement « une session qui donne plus que ce qu'elle annonce ».
--
-- On rend donc la ressource porteuse de sa colonne de rattachement.
-- NULL veut dire « on ne sait pas rattacher cette table à un client » —
-- et dans ce cas le gardien REFUSE une cible nommée plutôt que de la
-- journaliser sans l'avoir vérifiée : une trace qui affirme une
-- appartenance qu'on n'a pas contrôlée est pire qu'une trace absente,
-- parce que c'est elle qu'on relira le jour d'un litige.
alter table public.support_access_level_resources
  add column if not exists tenant_column text
    check (tenant_column is null or tenant_column in ('organization_id', 'user_id')),
  -- La colonne qui IDENTIFIE une ligne de cette table. `ai_pro_usage`
  -- n'en a pas — sa clé est composite — donc on ne peut pas y désigner
  -- une ligne, et le gardien refusera une cible nommée sur elle. Mieux
  -- vaut un refus net qu'un contrôle qu'on n'a pas les moyens de faire.
  add column if not exists identity_column text
    check (identity_column is null or identity_column = 'id');

alter table public.support_access_level_resources enable row level security;
drop policy if exists "Les administrateurs lisent les ressources des niveaux" on public.support_access_level_resources;
create policy "Les administrateurs lisent les ressources des niveaux" on public.support_access_level_resources
  for select using (public.is_platform_admin());

insert into public.support_access_levels (key, label, opens_business_data, is_grantable, max_minutes, requires_consent, note) values
  ('none', 'Aucun accès aux données', false, true, 60, false,
   'Le défaut. N''ouvre RIEN. Sert à tracer qu''un administrateur travaille sur un dossier — ce qui est déjà une information utile au client.'),
  ('diagnostics', 'Diagnostic technique', false, true, 30, false,
   'Version d''application installée, consommation d''IA, compteurs de quota. AUCUNE donnée métier : ni plante, ni devis, ni photo, ni client final.'),
  ('businessReadOnly', 'Données métier en lecture seule', true, false, 15, true,
   'NON ACCORDABLE. Aucune table n''a été nommée : « les données du client » n''est pas un niveau d''accès, c''est l''absence de décision. Le jour où on l''ouvrira, il faudra lister les tables une par une — et ce sera un geste délibéré.')
on conflict (key) do nothing;

insert into public.support_access_level_resources (level_key, resource, tenant_column, identity_column, note) values
  ('diagnostics', 'mobile_app_installations', 'user_id',         'id',  'Version et plateforme de l''application installée (spec p.19, fiche ticket).'),
  ('diagnostics', 'ai_usage_events',          'organization_id', 'id',  'Appels IA : agent, modèle, durée, succès. Répond à « pourquoi mon IA s''est arrêtée ».'),
  ('diagnostics', 'ai_pro_usage',             'organization_id', null,  'Compteur de requêtes IA du mois pour l''entreprise. Clé composite : aucune ligne ne s''y désigne par un identifiant, et le gardien refuse donc une cible nommée.'),
  ('diagnostics', 'usage_counters',           'user_id',         'id',  'Compteur de requêtes IA du mois côté mobile.')
on conflict (level_key, resource) do update
  set tenant_column   = excluded.tenant_column,
      identity_column = excluded.identity_column,
      note            = excluded.note;

create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),

  admin_user_id uuid not null references auth.users (id) on delete cascade,
  -- Le rôle AU MOMENT DE L'OUVERTURE, recopié comme dans
  -- `admin_audit_events` : le journal doit dire sous quelle casquette la
  -- personne a regardé, pas sous laquelle elle est aujourd'hui.
  admin_role text not null,

  organization_id uuid references public.business_organizations (id) on delete cascade,
  customer_user_id uuid references auth.users (id) on delete cascade,

  reason text not null constraint support_sessions_reason_not_blank check (btrim(reason) <> ''),
  access_level text not null references public.support_access_levels (key),
  ticket_id uuid references public.support_tickets (id) on delete set null,

  started_at timestamptz not null default now(),
  -- OBLIGATOIRE. Une session sans fin n'est pas temporaire ; et une
  -- colonne nullable finirait par recevoir un NULL un jour de hâte.
  expires_at timestamptz not null,

  consent_required boolean not null default false,
  consent_given_at timestamptz,
  consent_given_by uuid references auth.users (id) on delete set null,

  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoked_reason text,

  audit_event_id uuid references public.admin_audit_events (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint support_sessions_has_a_target
    check (organization_id is not null or customer_user_id is not null),
  constraint support_sessions_expiry_after_start
    check (expires_at > started_at),
  -- QUATRE HEURES AU GRAND MAXIMUM, quel que soit le niveau. La borne
  -- par niveau est plus serrée encore (`max_minutes`) ; celle-ci est le
  -- garde-fou de dernier recours, celui qui survivrait à une ligne mal
  -- semée dans `support_access_levels`.
  constraint support_sessions_not_a_standing_access
    check (expires_at <= started_at + interval '4 hours'),
  constraint support_sessions_consent_coherent
    check ((consent_given_at is null) = (consent_given_by is null))
);

create index if not exists support_sessions_open_idx
  on public.support_sessions (admin_user_id, expires_at desc) where revoked_at is null;
create index if not exists support_sessions_org_idx
  on public.support_sessions (organization_id, started_at desc);

alter table public.support_sessions enable row level security;

-- LE CLIENT VOIT QU'ON EST ENTRÉ CHEZ LUI. C'est la contrepartie de
-- l'accès, et ce n'est pas une faveur : une session d'assistance qui ne
-- serait visible que de l'équipe Oasis Care serait une surveillance.
drop policy if exists "L'admin, le client concerné et la sécurité lisent les sessions" on public.support_sessions;
create policy "L'admin, le client concerné et la sécurité lisent les sessions" on public.support_sessions
  for select using (
    admin_user_id = auth.uid()
    or customer_user_id = auth.uid()
    or (organization_id is not null and public.is_organization_member(organization_id))
    or public.platform_admin_can('support.sessions.read')
  );

-- LE JOURNAL D'ACCÈS. Une ligne PAR USAGE, pas une par session : « il a
-- ouvert une session » ne dit pas ce qu'il a regardé.
create table if not exists public.support_access_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.support_sessions (id) on delete cascade,
  admin_user_id uuid references auth.users (id) on delete set null,
  resource text not null,
  target_id uuid,
  detail jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists support_access_log_session_idx
  on public.support_access_log (session_id, occurred_at desc);

alter table public.support_access_log enable row level security;

drop policy if exists "Le journal d'accès se lit comme la session" on public.support_access_log;
create policy "Le journal d'accès se lit comme la session" on public.support_access_log
  for select using (
    exists (
      select 1 from public.support_sessions s
      where s.id = session_id
        and (s.admin_user_id = auth.uid()
             or s.customer_user_id = auth.uid()
             or (s.organization_id is not null and public.is_organization_member(s.organization_id))
             or public.platform_admin_can('support.sessions.read'))
    )
  );

-- ------------------------------------------------------------
-- 8.b bis PERDRE SES DROITS FERME SES FENÊTRES — les quatre chemins
-- ------------------------------------------------------------
-- `admin_revoke_platform_admin()` refermait déjà les sessions ouvertes,
-- et le commentaire y énonce le risque : « un administrateur révoqué à
-- 10 h garderait jusqu'à midi une fenêtre ouverte sur les données d'un
-- client ». Mais la révocation est UN des quatre chemins par lesquels
-- on perd ses droits. Les trois autres ne fermaient rien :
--
--   • la RÉTROGRADATION (`admin_change_platform_admin_role`) — un
--     `support` passé `read_only_analyst` gardait sa session ouverte et
--     continuait d'accéder ;
--   • la DÉSACTIVATION tapée dans l'éditeur SQL (`update platform_admins
--     set is_active = false`) — `is_platform_admin()` rendait faux, et
--     le gardien laissait pourtant passer ;
--   • la SUPPRESSION de la fiche — le gardien écrivait alors une ligne
--     de journal au nom de quelqu'un qui n'était plus administrateur du
--     tout.
--
-- On double donc le geste, exactement comme le § 3 double ses trois
-- garde-fous d'enfermement : la fonction fait sa part, et un
-- déclencheur `after` attrape tout le reste — y compris l'`update`
-- lancé à la main un vendredi soir.
create or replace function public.close_support_sessions_on_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_motif text;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id;
    v_motif := 'Fiche d''administrateur supprimée';
  elsif not new.is_active or new.revoked_at is not null then
    v_user := new.user_id;
    v_motif := 'Administrateur désactivé ou révoqué';
  elsif new.role is distinct from old.role then
    -- On ne cherche pas à savoir si le NOUVEAU rôle porte encore
    -- `support.sessions.manage` : une session est motivée sous une
    -- casquette précise, et changer de casquette est un fait nouveau.
    -- Rouvrir prend dix secondes et laisse une trace ; laisser courir
    -- ne laisse rien.
    v_user := new.user_id;
    v_motif := 'Rôle changé pendant la session';
  else
    return null;
  end if;

  update public.support_sessions
     set revoked_at = now(),
         revoked_by = auth.uid(),
         revoked_reason = v_motif
   where admin_user_id = v_user
     and revoked_at is null
     and expires_at > now();

  return null;
end;
$$;

drop trigger if exists close_support_sessions_on_admin_change on public.platform_admins;
create trigger close_support_sessions_on_admin_change
  after update or delete on public.platform_admins
  for each row execute function public.close_support_sessions_on_admin_change();

revoke all on function public.close_support_sessions_on_admin_change() from public;
revoke all on function public.close_support_sessions_on_admin_change() from anon;
revoke all on function public.close_support_sessions_on_admin_change() from authenticated;

-- ------------------------------------------------------------
-- 8.c OUVRIR UNE SESSION
-- ------------------------------------------------------------
create or replace function public.admin_start_support_session(
  p_access_level text,
  p_reason text,
  p_organization_id uuid default null,
  p_customer_user_id uuid default null,
  p_minutes integer default null,
  p_ticket_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_level record;
  v_minutes integer;
  v_role text;
  v_label text;
  v_id uuid;
  v_audit uuid;
begin
  if not public.platform_admin_can('support.sessions.manage') then
    raise exception 'Accès refusé : permission support.sessions.manage manquante.'
      using errcode = '42501';
  end if;
  perform public.platform_admin_require_mfa();

  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire : entrer dans le dossier d''un client sans dire pourquoi, c''est exactement ce que la spec p.19 interdit.'
      using errcode = '23514';
  end if;

  if p_organization_id is null and p_customer_user_id is null then
    raise exception 'Une session vise une entreprise ou une personne : elle ne flotte pas.'
      using errcode = '23514';
  end if;

  select * into v_level from public.support_access_levels where key = p_access_level;
  if v_level.key is null then
    raise exception 'Niveau d''accès inconnu : %.', coalesce(p_access_level, '(vide)') using errcode = '23503';
  end if;

  -- LE REFUS EST DANS LES DONNÉES. `businessReadOnly` est déclaré et non
  -- accordable tant que personne n'a nommé les tables qu'il ouvre.
  if not v_level.is_grantable then
    raise exception 'Le niveau « % » n''est pas accordable : %', v_level.label, coalesce(v_level.note, 'aucune ressource ne lui a été attribuée.')
      using errcode = '42501';
  end if;

  -- ET LA SECONDE MOITIÉ DU MÊME REFUS : un niveau qui prétend ouvrir
  -- des données métier sans qu'AUCUNE ressource ne lui soit rattachée
  -- serait un chèque en blanc. On vérifie la liste, pas l'intention.
  if v_level.opens_business_data
     and not exists (select 1 from public.support_access_level_resources r where r.level_key = v_level.key) then
    raise exception 'Le niveau « % » prétend ouvrir des données métier mais aucune ressource ne lui est rattachée. « Les données du client » n''est pas un niveau d''accès.', v_level.label
      using errcode = '42501';
  end if;

  v_minutes := least(coalesce(p_minutes, v_level.max_minutes), v_level.max_minutes);
  if v_minutes < 1 then
    raise exception 'Une session dure au moins une minute.' using errcode = '23514';
  end if;

  select pa.role into v_role from public.platform_admins pa where pa.user_id = auth.uid();

  if p_organization_id is not null then
    select o.name into v_label from public.business_organizations o where o.id = p_organization_id;
    if v_label is null then
      raise exception 'Entreprise inconnue : %.', p_organization_id using errcode = '23503';
    end if;
  else
    select u.email::text into v_label from auth.users u where u.id = p_customer_user_id;
    if v_label is null then
      raise exception 'Compte inconnu : %.', p_customer_user_id using errcode = '23503';
    end if;
  end if;

  insert into public.support_sessions
    (admin_user_id, admin_role, organization_id, customer_user_id, reason,
     access_level, ticket_id, started_at, expires_at, consent_required)
  values (auth.uid(), v_role, p_organization_id, p_customer_user_id, v_reason,
          v_level.key, p_ticket_id, now(), now() + make_interval(mins => v_minutes),
          v_level.requires_consent)
  returning id into v_id;

  v_audit := public.record_admin_event(
    'supportSession.started', 'support_session', v_id, v_label, null,
    jsonb_build_object('accessLevel', v_level.key, 'minutes', v_minutes,
                       'organizationId', p_organization_id,
                       'customerUserId', p_customer_user_id,
                       'consentRequired', v_level.requires_consent),
    v_reason);

  update public.support_sessions set audit_event_id = v_audit where id = v_id;

  return v_id;
end;
$$;

create or replace function public.admin_revoke_support_session(
  p_session_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
  v_session record;
begin
  v_reason := public.ai_clean_text(p_reason, 500);
  if v_reason is null then
    raise exception 'Motif obligatoire.' using errcode = '23514';
  end if;

  -- L'ORDRE DES CONTRÔLES COMPTE. La lecture précédait l'autorisation :
  -- n'importe quel compte connecté distinguait alors un identifiant de
  -- session existant d'un identifiant inventé, par la seule différence
  -- entre « introuvable » et « accès refusé ». Le gardien
  -- (`support_session_record_access`) prend justement soin de rendre le
  -- même message dans les deux cas ; on aligne.
  --
  -- CE GESTE N'EXIGE PAS DE SECOND FACTEUR, ET C'EST LA SECONDE
  -- EXCEPTION DU FICHIER, avec `admin_set_mfa_policy()`. La raison est
  -- la même dans les deux cas : couper un accès ne doit jamais pouvoir
  -- être empêché. Exiger ici le second facteur laisserait une session
  -- ouverte sur les données d'un client parce que le téléphone de
  -- l'administrateur est resté dans sa voiture.
  if not (public.is_platform_admin()) then
    raise exception 'Accès refusé : seul un administrateur de la plateforme ferme une session d''assistance.'
      using errcode = '42501';
  end if;

  select * into v_session from public.support_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'Aucune session d''assistance sous cet identifiant.' using errcode = '23503';
  end if;

  -- TROIS PERSONNES PEUVENT FERMER UNE SESSION : celui qui l'a ouverte
  -- (il a fini), un habilité à conduire l'assistance, et la SÉCURITÉ —
  -- qui surveille sans ouvrir. C'est le seul geste que `security_admin`
  -- peut faire sur une session, et c'est délibéré : couper doit être
  -- plus facile qu'ouvrir.
  if not (v_session.admin_user_id = auth.uid()
          or public.platform_admin_can('support.sessions.manage')
          or public.platform_admin_can('support.sessions.read')) then
    raise exception 'Accès refusé : cette session n''est pas la vôtre et vous ne surveillez pas les sessions d''assistance.'
      using errcode = '42501';
  end if;

  if v_session.revoked_at is not null then
    raise exception 'Cette session est déjà fermée.' using errcode = '23505';
  end if;

  update public.support_sessions
     set revoked_at = now(), revoked_by = auth.uid(), revoked_reason = v_reason
   where id = p_session_id;

  return public.record_admin_event(
    'supportSession.revoked', 'support_session', p_session_id, v_session.access_level,
    jsonb_build_object('expiresAt', v_session.expires_at),
    jsonb_build_object('revokedAt', now()),
    v_reason);
end;
$$;

-- LE CONSENTEMENT EST DONNÉ PAR LE CLIENT, PAS PAR NOUS. C'est tout le
-- sens du mot. Un administrateur qui pourrait cocher « consenti » à la
-- place du client aurait transformé la garantie en formalité.
create or replace function public.grant_support_session_consent(
  p_session_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session record;
begin
  select * into v_session from public.support_sessions where id = p_session_id;

  -- MÊME MESSAGE POUR « N'EXISTE PAS » ET « PAS LA VÔTRE ». Sans cela,
  -- n'importe quel compte connecté pouvait sonder l'existence d'une
  -- session en comparant les deux erreurs — la même précaution que
  -- prend le gardien quelques lignes plus bas.
  if v_session.id is null
     or not (
       (v_session.customer_user_id is not null and v_session.customer_user_id = auth.uid())
       or (v_session.organization_id is not null
           and public.has_permission(v_session.organization_id, 'organization.manageUsers'))
     ) then
    raise exception 'Aucune session d''assistance vous concernant sous cet identifiant : seul le client visé consent à une session sur ses données.'
      using errcode = '42501';
  end if;

  if v_session.revoked_at is not null or v_session.expires_at <= now() then
    raise exception 'Cette session est terminée : il n''y a plus rien à autoriser.'
      using errcode = '23514';
  end if;

  update public.support_sessions
     set consent_given_at = now(), consent_given_by = auth.uid()
   where id = p_session_id;

  return true;
end;
$$;

-- ------------------------------------------------------------
-- 8.d LE GARDIEN — le seul chemin, et il trace
-- ------------------------------------------------------------
-- CETTE FONCTION EST LA SÉCURITÉ. Tout écran qui ouvrira un jour une
-- donnée sous couvert d'une session d'assistance DOIT l'appeler d'abord,
-- et se fier à son refus. Elle est écrite pour que la trace ne soit pas
-- un effet de bord de l'accès mais sa CONDITION : elle rend
-- l'identifiant de la ligne de journal, et si le journal n'est pas
-- écrit, rien n'est ouvert.
--
-- CE QU'ELLE VÉRIFIE, DANS CET ORDRE :
--   0. L'APPELANT EST ENCORE HABILITÉ À CONDUIRE UNE ASSISTANCE. Ce
--      contrôle-ci porte sur la PERSONNE et non sur la session, d'où sa
--      place en premier. Sans lui, un jeton encore valide continuait
--      d'ouvrir la fenêtre après une rétrogradation, une désactivation
--      tapée dans l'éditeur SQL, ou la suppression pure et simple de la
--      fiche `platform_admins` — trois des quatre façons de perdre ses
--      droits, dont aucune ne passait par la seule qui refermait les
--      sessions ;
--   1. la session appartient à l'appelant — on ne se sert pas de la
--      session d'un collègue ;
--   2. elle n'est pas révoquée ;
--   3. ELLE N'EST PAS EXPIRÉE. En SQL, ici, à chaque accès. Une session
--      ouverte hier ne sert pas aujourd'hui, et aucune bannière de
--      navigateur ne décide de ça ;
--   4. le consentement a été donné s'il était requis ;
--   5. la ressource demandée figure dans la liste NOMMÉE du niveau ;
--   6. ET LA LIGNE DEMANDÉE APPARTIENT AU CLIENT QUE LA SESSION NOMME.
--      Une session ouverte « sur l'entreprise A » n'ouvre pas la ligne
--      d'un client B, fût-elle dans une table autorisée.
--
-- ET CE QU'ELLE NE FAIT JAMAIS : ouvrir une écriture. Il n'existe aucune
-- variante « support_session_record_write ». L'assistance regarde.
create or replace function public.support_session_record_access(
  p_session_id uuid,
  p_resource text,
  p_target_id uuid default null,
  p_detail jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session record;
  v_res record;
  v_owner uuid;
  v_expected uuid;
  v_id uuid;
begin
  -- 0. LA PERSONNE, AVANT LA SESSION. Une session est une autorisation
  -- accordée à quelqu'un ; si ce quelqu'un n'est plus habilité, la
  -- session ne vaut rien, quoi qu'en dise sa date d'expiration. Un
  -- déclencheur ferme désormais les sessions vivantes dès qu'un
  -- administrateur est révoqué, rétrogradé, désactivé ou supprimé
  -- (§ 8.b bis) — mais ce contrôle-ci est la ceinture : un jeton reste
  -- valide jusqu'à son échéance, et cet appel arrive par PostgREST sans
  -- traverser la moindre garde d'interface.
  if not public.platform_admin_can('support.sessions.manage') then
    raise exception 'Accès refusé : conduire une session d''assistance exige support.sessions.manage, et vous ne la portez pas (ou plus).'
      using errcode = '42501';
  end if;

  select * into v_session from public.support_sessions where id = p_session_id;

  if v_session.id is null or v_session.admin_user_id <> auth.uid() then
    -- Même message pour « n'existe pas » et « n'est pas la vôtre » : la
    -- différence renseignerait sur l'existence de sessions d'autrui.
    raise exception 'Aucune session d''assistance ouverte à votre nom sous cet identifiant.'
      using errcode = '42501';
  end if;

  if v_session.revoked_at is not null then
    raise exception 'Session d''assistance révoquée : plus aucun accès.' using errcode = '42501';
  end if;

  if v_session.expires_at <= now() then
    raise exception 'Session d''assistance expirée le % : plus aucun accès. Ouvrez-en une nouvelle, avec son motif.', v_session.expires_at
      using errcode = '42501';
  end if;

  if v_session.consent_required and v_session.consent_given_at is null then
    raise exception 'Le client n''a pas encore consenti à cette session : aucun accès tant qu''il ne l''a pas fait.'
      using errcode = '42501';
  end if;

  select * into v_res
  from public.support_access_level_resources r
  where r.level_key = v_session.access_level and r.resource = p_resource;

  if v_res.resource is null then
    raise exception 'Le niveau « % » n''ouvre pas « % ». Un niveau d''accès est une liste de ressources nommées, et celle-ci n''y figure pas.', v_session.access_level, coalesce(p_resource, '(vide)')
      using errcode = '42501';
  end if;

  -- 6. LA LIGNE APPARTIENT-ELLE AU CLIENT QUE LA SESSION NOMME ?
  --
  -- Sans ce contrôle, une session « entreprise A » ouvrait la ligne
  -- d'un client B dans une table autorisée, et le journal — celui que
  -- l'entreprise A peut relire — enregistrait l'accès comme légitime.
  --
  -- QUAND ON NE PEUT PAS VÉRIFIER, ON REFUSE. Table sans colonne de
  -- rattachement, table sans identifiant de ligne, session qui ne nomme
  -- ni entreprise ni compte : dans les trois cas la cible nommée est
  -- rejetée plutôt que journalisée sans preuve. Une trace qui affirme
  -- une appartenance non contrôlée est pire qu'une trace absente.
  if p_target_id is not null then
    if v_res.tenant_column is null or v_res.identity_column is null then
      raise exception 'La ressource « % » ne sait pas dire à quel client appartient une de ses lignes : on ne journalise pas un accès qu''on ne peut pas vérifier.', p_resource
        using errcode = '42501';
    end if;

    v_expected := case when v_res.tenant_column = 'organization_id'
                       then v_session.organization_id
                       else v_session.customer_user_id end;

    if v_expected is null then
      raise exception 'Cette session ne nomme pas de % : elle ne peut pas ouvrir une ligne désignée de « % ».',
        case when v_res.tenant_column = 'organization_id' then 'entreprise' else 'compte client' end,
        p_resource
        using errcode = '42501';
    end if;

    execute format('select %I from public.%I where %I = $1',
                   v_res.tenant_column, v_res.resource, v_res.identity_column)
      into v_owner using p_target_id;

    if v_owner is distinct from v_expected then
      raise exception 'Cette ligne de « % » n''appartient pas au client de cette session. Une session d''assistance n''ouvre que le dossier qu''elle nomme.', p_resource
        using errcode = '42501';
    end if;
  end if;

  insert into public.support_access_log
    (session_id, admin_user_id, resource, target_id, detail)
  values (p_session_id, auth.uid(), p_resource, p_target_id, p_detail)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.support_session_record_access(uuid, text, uuid, jsonb) is
  'LE SEUL CHEMIN d''accès sous session d''assistance. Vérifie que l''appelant est ENCORE habilité, puis propriété de la session, '
  'révocation, EXPIRATION (en SQL, à chaque accès), consentement, appartenance de la ressource au niveau, et APPARTENANCE DE LA LIGNE '
  'au client que la session nomme — puis trace. Lève sur tout refus ; ne rend jamais « rien » silencieusement.';

-- La bannière de la spec p.21 : « SUPPORT MODE · Read Only · Session
-- expires in 18 min ». C'est un AFFICHAGE, et cette fonction lui donne
-- ses chiffres. Elle n'est pas la sécurité — la sécurité est
-- au-dessus — et elle est écrite ici pour qu'on ne s'y trompe pas.
create or replace function public.support_session_mine()
returns table (
  id uuid,
  organization_id uuid,
  customer_user_id uuid,
  access_level text,
  opens_business_data boolean,
  reason text,
  started_at timestamptz,
  expires_at timestamptz,
  seconds_remaining integer,
  consent_required boolean,
  consent_given_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.organization_id, s.customer_user_id, s.access_level,
         l.opens_business_data, s.reason, s.started_at, s.expires_at,
         greatest(0, floor(extract(epoch from (s.expires_at - now()))))::integer,
         s.consent_required, s.consent_given_at
  from public.support_sessions s
  join public.support_access_levels l on l.key = s.access_level
  where s.admin_user_id = auth.uid()
    and s.revoked_at is null
    and s.expires_at > now()
  order by s.expires_at;
$$;

-- ============================================================
-- 9. LES DROITS
-- ============================================================
--
-- LA LEÇON DE 0057, RÉAPPLIQUÉE. Supabase accorde par défaut TOUS les
-- droits sur un objet créé dans `public` à `anon` et `authenticated`, et
-- une fonction y est par défaut exécutable par `public`. Sur une
-- fonction `security definer`, ce défaut est une porte ouverte : la
-- clause de garde est le seul filtre, et un objet dont on a oublié de
-- retirer les droits n'a plus de filtre du tout. En 0055, un visiteur
-- ANONYME avait ainsi inséré une ligne dans `quotes`.
--
-- On retire donc tout, à `public` d'abord — un droit accordé au
-- pseudo-rôle `public` est hérité par tout le monde et survivrait au
-- retrait des deux autres — puis on rend le strict nécessaire.

-- ------------------------------------------------------------
-- 9.a Les tables : `select` seulement, la RLS filtre derrière
-- ------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'platform_security_settings',
    'platform_admin_invitations',
    'platform_modules',
    'plan_modules',
    'discount_offers',
    'subscription_discounts',
    'subscription_commitment_acceptances',
    'organization_subscription_events',
    'organization_subscription_modules',
    'saas_account_credits',
    'saas_billing_issuer',
    'saas_eu_countries',
    'saas_vat_rates',
    'saas_customer_tax_profiles',
    'saas_invoices',
    'saas_invoice_lines',
    'saas_invoice_payments',
    'saas_credit_notes',
    'saas_credit_note_lines',
    'support_tickets',
    'support_ticket_messages',
    'support_access_levels',
    'support_access_level_resources',
    'support_sessions',
    'support_access_log'
  ]
  loop
    execute format('revoke all on public.%I from public', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    -- AUCUNE écriture depuis un jeton, sur AUCUNE de ces tables. Ni un
    -- prix, ni une facture, ni une session d'assistance, ni une
    -- promotion d'administrateur ne s'écrit depuis le navigateur : les
    -- fonctions `security definer` de ce fichier sont le seul chemin.
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 9.a bis LES QUATRE TABLES PRÉEXISTANTES QUI PORTENT MAINTENANT DE
--         L'ARGENT OU DU COMPORTEMENT
-- ------------------------------------------------------------
-- CE QUE LE TEST A RÉVÉLÉ, ET QUI N'ÉTAIT PAS DANS LE CADRAGE :
-- `organization_plans` conserve les GRANT par défaut de Supabase —
-- `authenticated` y a INSERT, UPDATE et DELETE. Jusqu'ici, seule la RLS
-- l'arrêtait, et elle l'arrêtait EN SILENCE : un `update` d'un compte
-- ordinaire ne lève pas, il modifie zéro ligne. C'est protégé, mais du
-- mauvais côté — le jour où quelqu'un ajoute une politique d'écriture un
-- peu large sur cette table, le droit est déjà là et attend.
--
-- Les quatre tables concernées portent désormais des décisions
-- coûteuses : la grille tarifaire, les abonnements, les drapeaux que lit
-- l'app iOS, et la configuration commerciale. Aucune ligne du produit ne
-- les écrit depuis un jeton — vérifié dans le dépôt — donc retirer le
-- droit ne retire rien à personne.
--
-- `select` est CONSERVÉ : `web-pro` lit la grille et l'abonnement,
-- l'app iOS lit les drapeaux. Fermer la lecture casserait les trois.
do $$
declare
  t text;
begin
  foreach t in array array[
    'organization_plans',
    'organization_subscriptions',
    'feature_flags',
    'commercial_config'
  ]
  loop
    execute format('revoke insert, update, delete, truncate on public.%I from public', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;

-- LE COMPTEUR N'EST PAS LISIBLE, MÊME PAS EN LECTURE. Ce n'est pas une
-- donnée de gestion : c'est un rouage, et le lire donnerait le prochain
-- numéro à qui le demande.
revoke all on public.saas_document_counters from public;
revoke all on public.saas_document_counters from anon;
revoke all on public.saas_document_counters from authenticated;

-- Les vues sont recréées par `create or replace`, et une vue recréée
-- hérite des droits PAR DÉFAUT du schéma — qui incluent l'écriture pour
-- `anon` et `authenticated`. C'est exactement l'oubli que 0064 avait dû
-- rattraper. On referme, et on ne laisse que la lecture aux comptes
-- connectés : `security_invoker` fait porter la RLS des tables
-- sous-jacentes.
do $$
declare v text;
begin
  foreach v in array array[
    'saas_invoice_totals', 'saas_invoice_balance', 'saas_invoice_state'
  ]
  loop
    execute format('revoke all on public.%I from public', v);
    execute format('revoke all on public.%I from anon', v);
    execute format('revoke all on public.%I from authenticated', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 9.b Les fonctions
-- ------------------------------------------------------------
-- Toutes révoquées de `public` et d'`anon`, rendues à `authenticated`
-- seul. Et la précision qui évite une fausse confiance, déjà écrite en
-- 0075 : `service_role` en conserve un `execute` hérité du défaut
-- Supabase. Le retirer serait cosmétique — un `service_role` SANS jeton
-- reçoit 42501 sur chacune de ces fonctions, parce que `auth.uid()` y
-- est nul et que le contrôle d'identité est À L'INTÉRIEUR. Posséder la
-- clé n'est pas être autorisé.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.auth_assurance_level()',
    'public.platform_admin_mfa_state()',
    'public.platform_admin_mfa_satisfied()',
    'public.platform_admin_require_mfa()',
    'public.admin_set_mfa_policy(boolean, timestamptz, text)',
    'public.admin_grant_platform_admin(uuid, text, text, text)',
    'public.admin_change_platform_admin_role(uuid, text, text)',
    'public.admin_revoke_platform_admin(uuid, text)',
    'public.admin_invite_platform_admin(text, text, text, text, integer)',
    'public.admin_revoke_platform_admin_invitation(text, text)',
    'public.claim_platform_admin_invitation()',
    'public.admin_list_platform_admins()',
    'public.plan_module_terms(text, text)',
    'public.discount_offer_terms(text)',
    'public.admin_set_plan_pricing(text, bigint, bigint, text, integer, bigint, integer, integer)',
    'public.admin_set_plan_module(text, text, text, bigint, bigint, text, bigint)',
    -- `record_subscription_event` N'EST PAS DANS CETTE LISTE, et c'est
    -- délibéré : voir la révocation explicite juste en dessous.
    'public.admin_create_subscription(uuid, text, text, text, text, integer, bigint, bigint)',
    'public.admin_set_subscription_plan(uuid, text, text, text, bigint, bigint)',
    'public.admin_extend_trial(uuid, integer, text)',
    'public.admin_set_billable_seats(uuid, integer, text)',
    'public.subscription_billable_extra_seats(uuid)',
    'public.admin_grant_credit(uuid, bigint, text)',
    'public.admin_set_subscription_module(uuid, text, boolean, text)',
    'public.admin_cancel_subscription_at_period_end(uuid, text, boolean)',
    'public.admin_reactivate_subscription(uuid, text)',
    'public.admin_apply_discount(uuid, text, text, date, text, text)',
    'public.saas_billing_issuer_missing_fields()',
    'public.admin_set_billing_issuer(jsonb, text)',
    'public.saas_vat_regime(uuid)',
    'public.admin_set_customer_tax_profile(uuid, boolean, boolean, text, text, text)',
    'public.saas_subscription_billing_lines(uuid, date, date)',
    'public.saas_issue_invoice(uuid, text)',
    'public.saas_record_invoice_payment(uuid, bigint, date, text, text, text, text)',
    'public.saas_cancel_invoice(uuid, text)',
    'public.saas_credit_invoice(uuid, text)',
    'public.saas_generate_invoices(text, date, date, text, boolean)',
    'public.admin_set_feature_flag(text, boolean, text)',
    'public.admin_set_commercial_config(text, jsonb, text)',
    'public.open_support_ticket(text, text, uuid, text, text, text, text, text)',
    'public.admin_reply_support_ticket(uuid, text, text, boolean, text, boolean)',
    'public.admin_start_support_session(text, text, uuid, uuid, integer, uuid)',
    'public.admin_revoke_support_session(uuid, text)',
    'public.grant_support_session_consent(uuid)',
    'public.support_session_record_access(uuid, text, uuid, jsonb)',
    'public.support_session_mine()'
  ]
  loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 9.b bis L'HISTORIQUE D'ABONNEMENT NE S'ÉCRIT PAS DEPUIS DEHORS
-- ------------------------------------------------------------
-- `record_subscription_event()` est une ÉCRITURE `security definer`, et
-- son seul contrôle est `is_platform_admin()` : pas de permission, pas
-- de second facteur. Accordée à `authenticated`, elle serait appelable
-- en `POST /rest/v1/rpc/record_subscription_event` par N'IMPORTE QUEL
-- rôle d'administrateur — l'analyste en lecture seule compris, celui
-- pour qui le garde-fou de la matrice existe précisément — et la ligne
-- forgée serait LUE PAR LE CLIENT (§ 5.d). Un « planChanged business →
-- solo » qui n'a jamais eu lieu apparaîtrait dans l'historique d'une
-- entreprise, et l'exigence de second facteur ne l'arrêterait pas.
--
-- Elle n'a AUCUN appelant externe : les neuf appelants sont les
-- fonctions de gestes du § 5, toutes `security definer`, qui
-- s'exécutent sous le propriétaire et n'ont donc pas besoin de ce
-- GRANT. On la révoque comme `saas_next_document_number()` l'est déjà :
-- un rouage n'est pas une porte.
revoke all on function public.record_subscription_event(uuid, text, text, text, text, text, jsonb, jsonb, text, uuid) from public;
revoke all on function public.record_subscription_event(uuid, text, text, text, text, text, jsonb, jsonb, text, uuid) from anon;
revoke all on function public.record_subscription_event(uuid, text, text, text, text, text, jsonb, jsonb, text, uuid) from authenticated;


-- ============================================================
-- 10. LE MRR, QUE CE FICHIER VIENT D'ALLUMER — ET DE FAUSSER
-- ============================================================
--
-- LE PROBLÈME, EN UNE PHRASE : poser les prix rallume un calcul qui
-- n'est plus juste.
--
-- 0075 rendait `mrr_cents` inconnu pour une raison précise, écrite à
-- l'endroit du calcul : « au moins un forfait actif n'a pas de prix ».
-- Le § 4 de ce fichier fait disparaître cette raison. Le calcul se
-- rallume donc TOUT SEUL — et il se rallume FAUX, parce que 0075
-- sommait `organization_plans.monthly_price_cents` en supposant trois
-- choses qui viennent de cesser d'être vraies :
--
--   • que tout le monde paie au MOIS. Le cycle annuel existe désormais,
--     et un abonné à 799 €/an serait compté 79,90 €/mois, soit 958,80 €
--     l'an : 20 % de trop.
--   • qu'AUCUNE REMISE n'existe. Le tarif fondateur impose 49,90 € sur
--     l'offre Pro ; ce client serait compté 79,90 €, soit 60 % de trop.
--   • qu'un abonnement se résume à son forfait. Un module en option à
--     20 € ne serait jamais compté, dans l'autre sens.
--
-- Laisser ce chiffre en l'état serait le contraire de la règle que tout
-- ce produit suit : un chiffre faux qui a l'air d'un chiffre est pire
-- qu'un « INCONNU » honnête, parce qu'il ne demande pas à être vérifié.
-- Et c'est précisément ce que 0075 avait prévu — son commentaire
-- annonçait que « cette ligne devra changer ce jour-là ».
--
-- CE FICHIER EST DONC LE SEUL DU LOT À RÉÉCRIRE UNE FONCTION D'UNE
-- MIGRATION ANTÉRIEURE, et c'est assumé : il a créé le défaut, il le
-- corrige dans la même transaction. La définition reprise ci-dessous
-- est celle qui TOURNE EN PRODUCTION, recopiée telle quelle ; seul le
-- bloc du MRR change, et il le dit.

-- ------------------------------------------------------------
-- 10.a Le revenu mensuel NORMALISÉ d'un abonnement
-- ------------------------------------------------------------
-- « Normalisé » veut dire : ramené au mois, quoi que paie le client et
-- quand qu'il le paie. C'est ce qui rend une somme d'abonnés
-- hétérogènes additionnable, et c'est aussi ce qui rend la
-- multiplication par douze de nouveau exacte.
--
-- CE QU'ELLE COMPTE, dans l'ordre :
--   1. l'offre — prix mensuel, ou prix annuel divisé par douze, ou prix
--      NÉGOCIÉ pour une offre sur devis ;
--   2. la remise EN COURS AUJOURD'HUI, et seulement celle-là : une
--      remise qui s'est terminée hier ne réduit plus rien, une remise
--      qui commence demain ne réduit rien encore ;
--   3. les modules SOUSCRITS, au prix de la MATRICE — donc zéro pour un
--      module compris dans l'offre ;
--   4. les sièges facturés en plus.
--
-- ELLE REND NULL DÈS QU'UNE PIÈCE MANQUE, et ne devine jamais. C'est ce
-- NULL qui remonte jusqu'au tableau de bord et y devient « INCONNU ».
--
-- POURQUOI PERSONNE NE PEUT L'APPELER. Elle est `security definer` —
-- elle doit franchir la RLS, un administrateur n'étant membre d'aucune
-- entreprise — mais elle ne porte AUCUN contrôle de permission, parce
-- que ses appelants en ont déjà un et que `admin_platform_kpis()` est
-- ouverte à tout rôle portant `platform.dashboard.read`, y compris
-- l'analyste. Un contrôle ici casserait le tableau de bord de la
-- moitié des rôles. La protection est donc ailleurs, et elle est totale :
-- l'`execute` est retiré à `public`, `anon` ET `authenticated` (§ 9.b).
-- Seules les fonctions `security definer` de ce fichier peuvent
-- l'appeler, parce qu'elles s'exécutent sous le propriétaire.
create or replace function public.subscription_normalized_mrr_cents(p_organization_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub record;
  v_plan record;
  v_annuel boolean;
  v_total bigint;
  v_base bigint;
  v_disc record;
  v_mod record;
  v_terms record;
  v_prix bigint;
begin
  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;
  if v_sub.organization_id is null then
    return null;
  end if;

  select * into v_plan from public.organization_plans where key = v_sub.plan;
  if v_plan.key is null then
    return null;
  end if;

  v_annuel := (v_sub.billing_cycle = 'yearly');

  -- 1. L'offre.
  if v_plan.is_quote_only then
    v_base := case when v_annuel then v_sub.negotiated_yearly_price_cents
                   else v_sub.negotiated_monthly_price_cents end;
  else
    v_base := case when v_annuel then v_plan.yearly_price_cents
                   else v_plan.monthly_price_cents end;
  end if;

  if v_base is null then
    return null;
  end if;

  -- La division par douze arrondit AU CENTIME, et l'arrondi est assumé :
  -- 799 € l'an font 66,58 € par mois, dont douze font 798,96 €. Quatre
  -- centimes d'écart sur un indicateur de pilotage ne se comparent pas
  -- au fait de compter un abonné annuel à son tarif mensuel. Ce chiffre
  -- ne sert JAMAIS à facturer : la facture, elle, prend le prix annuel
  -- entier (§ 6.i).
  if v_annuel then
    v_base := round(v_base / 12.0)::bigint;
  end if;

  v_total := v_base;

  -- 2. La remise en cours AUJOURD'HUI.
  select * into v_disc
  from public.subscription_discounts d
  where d.organization_id = p_organization_id
    and d.cancelled_at is null
    and daterange(d.starts_on, d.ends_on, '[)') @> current_date
  order by d.starts_on desc
  limit 1;

  if v_disc.id is not null then
    -- Le pendant de l'assertion défensive du § 6.i : une remise
    -- réservée à une autre offre rend le montant INCONNU. Les
    -- déclencheurs du § 4.c et du § 5.b rendent ce cas impossible ; on
    -- ne l'atteint que par une ligne antérieure au verrou, et un MRR
    -- calculé dessus mentirait de 90 € par mois et par client.
    if v_disc.applies_to_plan is not null
       and v_disc.applies_to_plan is distinct from v_sub.plan then
      return null;
    end if;

    if v_disc.kind = 'fixedMonthlyPrice' then
      if v_annuel then
        -- Même refus qu'au § 6.i, et pour la même raison : une remise à
        -- prix mensuel imposé NE SE VEND QU'AU MOIS depuis le § 4.c.
        -- Le cas n'est plus indécidable, il est impossible — on n'y
        -- arrive que par une donnée antérieure au verrou, et on rend
        -- inconnu plutôt que d'inventer un équivalent annuel.
        return null;
      end if;
      -- `least` ET NON UNE AFFECTATION SÈCHE. Un « prix imposé »
      -- SUPÉRIEUR au tarif de l'offre ne fait pas payer plus cher : la
      -- ligne de facture pose `greatest(base - valeur, 0)`, soit un net
      -- de `min(base, valeur)` (§ 6.i), et `lib/billing/abonnement.ts`
      -- l'écrit pareil. Sans `least`, le MRR compterait plus que ce que
      -- la facture réclamerait — deux calculs du même euro qui
      -- divergent, et c'est l'indicateur de pilotage qui ment.
      v_total := least(v_total, v_disc.value_cents);
    elsif v_disc.kind = 'percentOff' then
      v_total := v_total - round(v_total * v_disc.percent / 100.0)::bigint;
    elsif v_disc.kind = 'amountOff' then
      v_total := greatest(v_total - v_disc.value_cents, 0);
    end if;
  end if;

  -- 3. Les modules souscrits, AU PRIX DE LA MATRICE.
  for v_mod in
    select sm.module_key, m.pricing_model
    from public.organization_subscription_modules sm
    join public.platform_modules m on m.key = sm.module_key
    where sm.organization_id = p_organization_id and sm.cancelled_at is null
  loop
    select * into v_terms from public.plan_module_terms(v_sub.plan, v_mod.module_key);

    if v_terms.availability = 'included' then
      continue;  -- compris dans l'offre : zéro, et c'est tout l'intérêt.
    end if;
    if v_terms.availability <> 'optional' then
      return null;  -- case non décidée ou indisponible : montant inconnu.
    end if;
    if v_mod.pricing_model = 'metered' then
      return null;  -- au compteur, sans relevé de consommation.
    end if;

    v_prix := case when v_annuel then v_terms.yearly_price_cents
                   else v_terms.monthly_price_cents end;
    if v_prix is null then
      return null;
    end if;
    v_total := v_total + case when v_annuel then round(v_prix / 12.0)::bigint else v_prix end;
  end loop;

  -- 4. Les sièges facturés en plus.
  if coalesce(v_sub.billable_extra_seats, 0) > 0 then
    if v_annuel or v_plan.extra_seat_monthly_price_cents is null then
      -- Le prix du siège est fixé au MOIS ; son équivalent annuel n'a
      -- pas été décidé, et l'inventer serait facturer faux.
      return null;
    end if;
    v_total := v_total + v_sub.billable_extra_seats * v_plan.extra_seat_monthly_price_cents;
  end if;

  return v_total;
end;
$$;

comment on function public.subscription_normalized_mrr_cents(uuid) is
  'Le revenu mensuel NORMALISÉ d''un abonnement : cycle ramené au mois, remise en cours déduite, '
  'modules au prix de la MATRICE (donc zéro s''ils sont compris dans l''offre), sièges en plus. '
  'Rend NULL dès qu''une pièce manque — jamais un montant approché. Usage interne : l''execute est retiré à authenticated.';

-- ------------------------------------------------------------
-- 10.b `admin_platform_kpis()`, avec son seul bloc corrigé
-- ------------------------------------------------------------
-- La définition ci-dessous est celle qui tourne en production, relue par
-- `pg_get_functiondef()` et recopiée telle quelle. SEUL LE BLOC DU MRR
-- CHANGE, ainsi que le motif d'inconnu qui l'accompagne ; tout le reste
-- — les utilisateurs, le parc mobile et ses réserves, les essais, les
-- requêtes IA, les six autres motifs — est intact, mot pour mot. C'est
-- la même règle que 0080 a suivie en remplaçant le garde-fou de la
-- matrice : on recopie ce qu'on ne change pas, pour que le lecteur voie
-- d'un coup d'œil ce qui bouge.
CREATE OR REPLACE FUNCTION public.admin_platform_kpis()
 RETURNS TABLE(total_users bigint, new_users_this_month bigint, mobile_users bigint, mobile_users_declared bigint, mobile_users_inferred bigint, mobile_collection_started_at timestamp with time zone, mobile_users_note text, pro_organizations bigint, pro_users bigint, open_sessions bigint, tracked_subscriptions bigint, mrr_cents bigint, arr_cents bigint, pro_trials bigint, mobile_trials bigint, churn_30d_percent numeric, pro_ai_requests_this_month bigint, mobile_ai_requests_this_month bigint, ai_cost_cents bigint, unknown_reasons jsonb, computed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
set search_path = public, pg_temp
AS $function$
declare
  -- Le mois « en cours » est celui de PARIS : à minuit le 1er, un
  -- compteur en UTC afficherait encore le mois précédent pendant deux
  -- heures (0066 a tranché ce point pour tout le projet).
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris';

  -- Les périodes des compteurs IA sont écrites en UTC par leurs
  -- producteurs : on relit avec la MÊME étiquette que l'écrivain.
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

  v_mob_total bigint;
  v_mob_declared bigint;
  v_mob_inferred bigint;
  v_mob_started timestamptz;
  v_mob_note text;
  v_mob_since text;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé : réservé aux administrateurs de la plateforme Oasis Care.'
      using errcode = '42501';
  end if;
  if not public.platform_admin_can('platform.dashboard.read') then
    raise exception 'Accès refusé : permission platform.dashboard.read manquante.'
      using errcode = '42501';
  end if;

  -- ---- Ce qui se calculait déjà ---------------------------------

  select count(*) into v_total_users from auth.users where deleted_at is null;

  select count(*) into v_new_users
  from auth.users
  where deleted_at is null and created_at >= v_month_start;

  select count(*) into v_orgs
  from public.business_organizations where archived_at is null;

  select count(distinct om.user_id) into v_pro_users
  from public.organization_members om
  join auth.users u on u.id = om.user_id and u.deleted_at is null
  join public.business_organizations o
    on o.id = om.organization_id and o.archived_at is null
  where om.archived_at is null;

  select count(distinct s.user_id) into v_sessions
  from auth.sessions s
  where coalesce(s.refreshed_at at time zone 'UTC', s.updated_at) >= now() - interval '30 minutes';

  select count(*) into v_subs
  from public.organization_subscriptions s
  join public.business_organizations o
    on o.id = s.organization_id and o.archived_at is null;

  select coalesce(sum(u.used), 0) into v_pro_ai
  from public.ai_pro_usage u where u.period = v_period;

  select coalesce(sum(c.count), 0) into v_mobile_ai
  from public.usage_counters c where c.period = v_period;

  -- ---- LES UTILISATEURS MOBILE ----------------------------------
  --
  -- Les comptes effacés en douceur sont exclus, comme dans
  -- `v_total_users` : ce chiffre est le numérateur d'une barre dont
  -- `v_total_users` est le dénominateur, et deux populations
  -- différentes donnent un pourcentage qui peut dépasser 100 %. La
  -- cascade ne suffit pas à garantir ça — Supabase pose `deleted_at`
  -- sans supprimer la ligne, donc le `on delete cascade` NE SE
  -- DÉCLENCHE PAS pour un effacement doux.
  select started_at into v_mob_started from public.mobile_presence_collection;

  select
    count(distinct i.user_id),
    count(distinct i.user_id) filter (where i.source = 'declared'),
    count(distinct i.user_id) filter (where i.source = 'inferred')
  into v_mob_total, v_mob_declared, v_mob_inferred
  from public.mobile_app_installations i
  join auth.users u on u.id = i.user_id and u.deleted_at is null;

  -- LE `coalesce` N'EST PAS DÉCORATIF. Si `mobile_presence_collection`
  -- est vide (un `truncate`, une restauration partielle, un
  -- environnement recréé sans la graine), `v_mob_since` serait NULL,
  -- donc `v_mob_note` — construit par concaténation — serait NULL, donc
  -- le `where v is not null` plus bas ferait DISPARAÎTRE l'entrée
  -- `mobile_users` de `unknown_reasons` : un chiffre inconnu SANS motif,
  -- c'est-à-dire « — » tout court, le point de départ même de ce
  -- chantier. L'invariant que ce projet défend — un nombre OU un motif,
  -- jamais aucun des deux — se tient, il ne se suppose pas.
  -- La préposition est DANS la variable, pas dans les phrases : sans
  -- cela, le repli produirait « démarrée le une date inconnue ».
  v_mob_since := coalesce(
    'le ' || to_char(v_mob_started at time zone 'Europe/Paris', 'DD/MM/YYYY'),
    'à une date inconnue — la ligne de démarrage de la collecte est absente de mobile_presence_collection'
  );

  if v_mob_total = 0 then
    -- LE CAS DU JOUR DU DÉPLOIEMENT. Le mécanisme existe mais personne
    -- ne s'en est encore servi : « 0 utilisateur Mobile » se lirait
    -- « personne n'utilise l'iPhone » alors que la vérité est « le parc
    -- n'a pas encore basculé ». On rend donc NULL et on DATE le motif —
    -- un inconnu sans date ne se distingue pas d'un inconnu définitif.
    v_mob_total := null;
    v_mob_note := 'Collecte démarrée ' || v_mob_since ||
      ' : aucune installation ne s''est encore annoncée, et aucune activité passée ne permet de déduire un usage mobile. Le chiffre est inconnu, pas nul.';
  else
    -- LE CHIFFRE EXISTE, ET IL RESTE UNE BORNE INFÉRIEURE. Il le
    -- restera tant qu'un compte pourra exister sans avoir rouvert
    -- l'application depuis la mise en service : ce n'est pas une
    -- précaution provisoire, c'est la nature de la mesure.
    v_mob_note := 'Borne inférieure. ' || v_mob_declared::text ||
      ' compte(s) déclaré(s) par l''application depuis ' || v_mob_since || ', ' ||
      v_mob_inferred::text ||
      ' déduit(s) d''une activité passée qui ne peut venir que de l''iPhone. Un compte qui n''a pas rouvert l''application depuis cette date reste invisible, et le mode invité n''est jamais compté. ' ||
      -- LE SENS INVERSE, QU'IL SERAIT MALHONNÊTE DE TAIRE. « Borne
      -- inférieure » laisserait croire que le chiffre ne peut qu'être
      -- trop bas. La déclaration est faite par le client, et la clé qui
      -- permet de l'appeler est publique par nature : le serveur ne
      -- distingue pas l'application d'un appel direct. Le plafond de dix
      -- installations par compte borne le NOMBRE DE LIGNES, pas le
      -- nombre de comptes — au pire un compte de plus par compte réel.
      'Une réserve dans l''autre sens : la déclaration est faite par l''application et n''est pas vérifiable côté serveur, donc un compte qui n''utilise pas l''iPhone pourrait s''y inscrire lui-même.';
  end if;

  -- ---- Le MRR, RECALCULÉ PAR 0081 ------------------------------
  --
  -- POURQUOI CE BLOC A CHANGÉ, ET POURQUOI 0081 SE PERMET DE RÉÉCRIRE
  -- UNE FONCTION DE 0075. Le commentaire d'origine annonçait lui-même sa
  -- date de péremption : « Multiplier par douze est donc exact
  -- AUJOURD'HUI, par construction — et deviendra faux le jour où un
  -- abonnement annuel remisé existera. Cette ligne devra changer ce
  -- jour-là. » 0081 EST CE JOUR-LÀ : elle pose le cycle, les remises
  -- datées et les modules facturables, et elle allume les prix qui
  -- faisaient rendre NULL à ce calcul.
  --
  -- CE QUE LA SOMME NAÏVE AURAIT DIT, SUR LA GRILLE QUE 0081 SÈME :
  --   • un abonné ANNUEL à 799 € compté à 79,90 €/mois, soit 958,80 €
  --     par an — 20 % de trop ;
  --   • un client FONDATEUR compté à 79,90 € au lieu de 49,90 € — 60 %
  --     de trop ;
  --   • un module en option à 20 € jamais compté du tout.
  -- Un tableau de bord de direction qui se trompe dans ce sens est pire
  -- qu'un tableau vide : il ne demande pas à être vérifié.
  --
  -- Le calcul part maintenant dans `subscription_normalized_mrr_cents()`,
  -- qui ramène TOUT AU MOIS et rend NULL dès qu'une pièce manque.
  select count(*) into v_subs_billable
  from public.organization_subscriptions s
  join public.business_organizations o
    on o.id = s.organization_id and o.archived_at is null
  where s.status in ('active', 'pastDue');

  select count(*) into v_unpriced
  from public.organization_subscriptions s
  join public.business_organizations o
    on o.id = s.organization_id and o.archived_at is null
  where s.status in ('active', 'pastDue')
    and public.subscription_normalized_mrr_cents(s.organization_id) is null;

  if v_subs_billable = 0 then
    -- Garde-fou 1 : aucun abonnement suivi. `sum()` sur zéro ligne rend
    -- déjà NULL, mais on l'écrit à la main pour que personne ne
    -- « répare » ce NULL avec un coalesce en croyant bien faire.
    v_mrr := null;
  elsif v_unpriced > 0 then
    -- Garde-fou 2 : au moins un abonnement dont on ne sait pas calculer
    -- le montant. Un `sum()` naïf ignorerait ces lignes et rendrait un
    -- MRR TROP BAS — le pire des cas, parce qu'il a l'air d'un chiffre.
    v_mrr := null;
  else
    select sum(public.subscription_normalized_mrr_cents(s.organization_id)) into v_mrr
    from public.organization_subscriptions s
    join public.business_organizations o
      on o.id = s.organization_id and o.archived_at is null
    where s.status in ('active', 'pastDue');
  end if;

  -- LA MULTIPLICATION PAR DOUZE REDEVIENT EXACTE, et pour une raison
  -- précise : le MRR ci-dessus est NORMALISÉ au mois. Un abonné annuel y
  -- compte déjà pour un douzième de ce qu'il paie ; le remultiplier par
  -- douze rend donc bien ce qu'il paie. C'était l'inverse avant 0081.
  --
  -- CE QUE CE CHIFFRE N'EST TOUJOURS PAS : une projection. Il annualise
  -- la situation d'aujourd'hui et ignore que les remises datées TOMBENT —
  -- un client fondateur passera de 49,90 € à 79,90 € au treizième mois.
  -- C'est un instantané annualisé, pas un prévisionnel, et l'écran ne
  -- doit pas le présenter autrement.
  v_arr := case when v_mrr is null then null else v_mrr * 12 end;


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
  -- Construits à partir des valeurs RÉELLEMENT nulles : le motif de
  -- `mobile_users` disparaît de lui-même à la première installation
  -- annoncée, sans qu'on ait à y revenir.
  select jsonb_object_agg(k, v) into v_reasons
  from (values
    ('mobile_users',
     case when v_mob_total is null then v_mob_note end::text),
    ('mrr_cents',
     case when v_mrr is null then
       case when v_subs_billable = 0
         then 'Aucun abonnement facturable sur une entreprise vivante : organization_subscriptions est vide et aucune ligne de code du dépôt ne l''écrit (startCheckout rend « unavailable »). 0 € serait un fait faux.'
         else v_unpriced::text || ' abonnement(s) actif(s) dont le montant mensuel ne se calcule pas : prix absent sur l''offre, offre sur devis sans prix négocié, case de matrice non décidée sur un module souscrit, remise mensuelle sur un abonnement annuel, ou module au compteur sans relevé de consommation. La somme serait silencieusement trop basse.'
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
    v_mob_total,
    v_mob_declared,
    v_mob_inferred,
    v_mob_started,
    v_mob_note,
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
$function$;


-- L'`execute` de l'aide au calcul est retiré à TOUT LE MONDE — y compris
-- à `authenticated`. Voir l'en-tête du § 10.a : elle franchit la RLS
-- sans porter de contrôle de permission, et sa seule protection est
-- qu'aucun jeton ne peut l'appeler. `admin_platform_kpis()`, elle, garde
-- les droits qu'elle avait : `create or replace` ne les touche pas.
revoke all on function public.subscription_normalized_mrr_cents(uuid) from public;
revoke all on function public.subscription_normalized_mrr_cents(uuid) from anon;
revoke all on function public.subscription_normalized_mrr_cents(uuid) from authenticated;
-- ============================================================
-- 11. CE QUI RESTE À DÉCIDER, ET QUI N'APPARTIENT PAS À CE FICHIER
-- ============================================================
--
-- Écrit ici plutôt que dans un compte rendu qui se perdra, parce que ce
-- sont des décisions que la base ATTEND et qu'elle refuse d'inventer.
-- Chacune se lit en SQL, et non dans un commentaire :
--
--   1. LES CASES NON DÉCIDÉES DE LA MATRICE. Pro Solo × BioLab,
--      Pro Solo × Pépinière, Enterprise × BioLab, Enterprise × Pépinière
--      — le dirigeant n'a rien dit. Elles valent « undecided », ce qui
--      BLOQUE la souscription et l'affiche comme une décision à prendre.
--        select plan_key, module_key from public.plan_modules
--         where availability = 'undecided';
--
--   2. LA CAPACITÉ D'ENTERPRISE. Les sièges compris sont désormais
--      tranchés pour les trois offres publiques — Pro Solo 1, Pro 5,
--      Pro Business 10 — et le siège supplémentaire vaut 9,90 € À
--      L'INTÉRIEUR de chaque offre. Seule Enterprise reste à NULL, et
--      c'est le bon état : sa capacité se négocie, comme son prix.
--        select key, name, included_seats from public.organization_plans
--         where is_active and included_seats is null;
--
--      DEUX CHOSES RESTENT OUVERTES, ET ELLES NE SONT PAS DES OUBLIS.
--      D'abord, `seat_policy` vaut `billedBeyondIncluded` partout : rien
--      en base n'empêche de facturer un trentième siège sur Pro
--      Business. « Au-delà, sur devis » est une bascule commerciale vers
--      Enterprise, pas un plafond, et aucun plafond chiffré n'a été
--      donné — `hardCap` attend celui-là. Ensuite, le nombre de sièges
--      facturés reste SAISI : `subscription_billable_extra_seats()` sait
--      le calculer, mais le brancher directement sur la facture ferait
--      varier un montant facturé au rythme des arrivées et des départs,
--      sans qu'aucun administrateur ne l'ait daté.
--        select o.name, public.subscription_billable_extra_seats(s.organization_id) as devraient,
--               s.billable_extra_seats as factures
--          from public.organization_subscriptions s
--          join public.business_organizations o on o.id = s.organization_id
--         where public.subscription_billable_extra_seats(s.organization_id)
--               is distinct from s.billable_extra_seats;
--
--   3. L'IDENTITÉ LÉGALE DE L'ÉMETTEUR. Personne dans ce chantier ne la
--      connaît. Aucune facture ne part tant qu'elle manque, et la base
--      dit champ par champ ce qui manque :
--        select public.saas_billing_issuer_missing_fields();
--
--   4. LE NIVEAU D'ACCÈS `businessReadOnly`. Déclaré, non accordable,
--      aucune table nommée. L'ouvrir demandera de LISTER les tables une
--      par une — et ce sera un geste délibéré, pas un oubli comblé.
--
--   5. LE BASCULEMENT DE L'EXIGENCE DE SECOND FACTEUR. Le mécanisme est
--      posé et il mord sur les ÉCRITURES seulement. L'ordre à respecter :
--      livrer l'écran d'enrôlement, enrôler réellement, vérifier qu'une
--      session `aal2` s'obtient, ET SEULEMENT ALORS appeler
--      `admin_set_mfa_policy(true, …)`. Cette fonction est délibérément
--      la seule du fichier à ne pas exiger le second facteur : c'est la
--      sortie de secours.
