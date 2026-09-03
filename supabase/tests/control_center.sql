-- Oasis Care — OASIS CONTROL CENTER, jalon 1 (migration 0075).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LA SÉPARATION FORTE (spec p.32 et p.36). Un utilisateur Oasis
--      Care ordinaire n'obtient RIEN de ces fonctions, et un OWNER
--      d'entreprise Pro non plus. La spec nomme ce second cas
--      explicitement, parce que c'est le piège : dans ce produit,
--      « owner » et « admin » sont déjà des rôles CLIENTS, et le
--      raccourci « owner = administrateur » est celui qu'on prend sans
--      s'en apercevoir.
--
--      Et elles LÈVENT — elles ne rendent pas une liste vide. Une liste
--      vide se confond avec « aucune donnée » : l'écran afficherait
--      « 0 utilisateur » à quelqu'un qui n'a simplement pas le droit de
--      regarder, ce qui est à la fois faux et rassurant.
--
--   2. LE MOINDRE PRIVILÈGE (spec p.30), pris au mot : le support ne
--      modifie pas les abonnements, la facturation n'ouvre pas les
--      données client, le produit ne touche pas aux paiements, un
--      analyste en lecture seule n'écrit rien — pas même une ligne de
--      journal. Ces quatre règles sont testées deux fois : sur ce que
--      la matrice DIT, et sur ce que la base REFUSE d'y écrire.
--
--   3. LES CHIFFRES INCALCULABLES. Un KPI qu'on ne sait pas calculer
--      rend NULL et jamais zéro. Le test le vérifie dans les deux
--      sens : le MRR est inconnu tant qu'aucun abonnement n'est suivi,
--      il devient un vrai nombre dès qu'on en pose un — et il
--      REDEVIENT inconnu si un seul forfait actif n'a pas de prix, au
--      lieu de rendre une somme silencieusement trop basse.
--
--   4. LE FRANCHISSEMENT DE LA RLS N'OUVRE RIEN D'AUTRE. Les fonctions
--      sont `security definer` : leur clause de garde et leurs GRANT
--      sont les seules barrières (c'est exactement là que 0057 s'est
--      fait avoir). On vérifie donc aussi les droits eux-mêmes, et que
--      la RLS ordinaire n'a pas bougé d'un pouce pour les clients.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste, ni les comptes, ni les organisations, ni
-- les administrateurs de plateforme, ni le prix de forfait posé le
-- temps d'un calcul.
--
-- Pour le rejouer, coller ce fichier dans l'éditeur SQL Supabase, ou
-- l'envoyer à l'API Management (/v1/projects/<ref>/database/query).

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- ============================================================
-- Fixtures — neuf comptes : deux clients, un client sans rien,
-- et six administrateurs de plateforme
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, last_sign_in_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('cc000001-0000-4000-8000-000000000075','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cc-normal@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc000002-0000-4000-8000-000000000075','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cc-owner@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc000003-0000-4000-8000-000000000075','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cc-owner2@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc000010-0000-4000-8000-000000000075','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cc-super@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc000011-0000-4000-8000-000000000075','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cc-support@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc000012-0000-4000-8000-000000000075','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cc-billing@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc000013-0000-4000-8000-000000000075','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cc-product@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc000014-0000-4000-8000-000000000075','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cc-analyst@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 ('cc000015-0000-4000-8000-000000000075','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','cc-revoked@test.invalid','',now(),now(),now(),now(),'{}','{}');

-- Deux entreprises Pro, deux propriétaires différents. La seconde n'est
-- là que pour une question : est-ce que l'administrateur voit
-- réellement À TRAVERS les organisations, et est-ce que le
-- propriétaire de l'une continue de ne pas voir l'autre.
select set_config('request.jwt.claims',
  json_build_object('sub','cc000002-0000-4000-8000-000000000075')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Paysages Contrôle A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','cc000003-0000-4000-8000-000000000075')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Paysages Contrôle B','landscaper');

update public.business_organizations
   set siret = '123 456 789 00012', city = 'Nantes', legal_name = 'SARL Contrôle A'
 where id = (select v from ids where k='orgA');

-- Un client CRM chez A : l'écran d'administration doit savoir qu'il y
-- en a UN, et rien de plus à son sujet.
insert into public.crm_customers (organization_id, display_name, lifecycle_stage)
select v, 'Madame Dupont', 'customer' from ids where k='orgA';

-- Un accès OFFERT (source='complimentary') sur le compte ordinaire :
-- c'est le piège relevé par l'audit — 25 lignes de ce type existent en
-- production et ne sont pas 25 abonnés payants.
insert into ids
select 'wsNormal', id from public.workspaces
where owner_id = 'cc000001-0000-4000-8000-000000000075' and is_personal;

insert into public.subscription_entitlements (user_id, workspace_id, plan, entitlement, source, status)
select 'cc000001-0000-4000-8000-000000000075', v, 'biolab', 'plantManagement', 'complimentary', 'subscribed'
from ids where k='wsNormal';

-- Les administrateurs de plateforme. Posés ici, en `postgres` : c'est
-- le seul chemin qui existe, et c'est le sujet du test « personne ne
-- s'auto-promeut ».
insert into public.platform_admins (user_id, role, note) values
 ('cc000010-0000-4000-8000-000000000075','super_admin','Test'),
 ('cc000011-0000-4000-8000-000000000075','support','Test'),
 ('cc000012-0000-4000-8000-000000000075','billing_admin','Test'),
 ('cc000013-0000-4000-8000-000000000075','product_admin','Test'),
 ('cc000014-0000-4000-8000-000000000075','read_only_analyst','Test');

insert into public.platform_admins (user_id, role, is_active, revoked_at, note)
values ('cc000015-0000-4000-8000-000000000075','support', false, now(),
        'Révoqué : ne doit plus rien pouvoir.');

-- Les valeurs attendues sont relevées MAINTENANT, en `postgres`, et pas
-- plus tard dans la peau d'un administrateur : sous le rôle
-- `authenticated`, `auth.users` est inaccessible et la RLS masque les
-- entreprises. Une comparaison faite là-bas comparerait la fonction à
-- elle-même — un test qui passe quoi qu'il arrive.
create temp table att(k text, v text) on commit drop;
grant all on att to authenticated;
insert into att values
 ('total_users',
  (select count(*)::text from auth.users where deleted_at is null)),
 ('pro_orgs',
  (select count(*)::text from public.business_organizations where archived_at is null)),
 ('pro_users',
  (select count(distinct user_id)::text from public.organization_members where archived_at is null)),
 ('signups_today',
  (select count(*)::text from auth.users where deleted_at is null
     and created_at >= date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')),
 ('new_orgs_today',
  (select count(*)::text from public.business_organizations
    where created_at >= date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris')),
 -- Créer une entreprise laisse déjà une trace dans le journal MÉTIER
 -- (`organization.created`) : la « dernière action auditée » de A n'est
 -- donc pas nulle, et c'est cette date-là qu'on attend.
 ('last_audit_orgA',
  (select max(occurred_at)::text from public.audit_events
    where organization_id = (select v from ids where k='orgA')));

-- ============================================================
-- 1. LA SÉPARATION FORTE — l'utilisateur ORDINAIRE
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','cc000001-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res select 'Un utilisateur ordinaire n''est pas administrateur de plateforme','false',
  public.is_platform_admin()::text;

do $$
declare
  f text;
  refuse boolean;
begin
  foreach f in array array[
    'select * from public.admin_platform_kpis()',
    'select * from public.admin_live_activity()',
    'select * from public.admin_list_users()',
    'select * from public.admin_list_organizations()',
    'select * from public.admin_global_search(''Paysages'')',
    'select * from public.admin_me()'
  ]
  loop
    refuse := false;
    begin
      execute f;
    exception when others then refuse := true;
    end;
    -- LÈVE, et ne rend pas une liste vide : c'est la formulation du
    -- test, pas un détail de style.
    insert into res values ('Utilisateur ordinaire — « ' || f || ' » lève', 'true', refuse::text);
  end loop;
end $$;

insert into res select 'Un utilisateur ordinaire ne voit aucune ligne de platform_admins','0',
  (select count(*)::text from public.platform_admins);

-- La RLS ordinaire n'a pas bougé : 0075 n'a rien ouvert au passage.
insert into res select 'La RLS des clients est intacte : il ne voit aucune entreprise','0',
  (select count(*)::text from public.business_organizations);

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.platform_admins (user_id, role)
    values ('cc000001-0000-4000-8000-000000000075','super_admin');
  exception when others then refuse := true;
  end;
  insert into res values ('Personne ne s''auto-promeut administrateur','true',refuse::text);
end $$;

-- ============================================================
-- 2. LA SÉPARATION FORTE — l'OWNER d'entreprise Pro (spec p.36)
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc000002-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

-- Il est bien propriétaire, et tout-puissant CHEZ LUI : c'est ce qui
-- rend le refus significatif.
insert into res select 'Le propriétaire a tous les droits dans SON entreprise','true',
  public.has_permission((select v from ids where k='orgA'), 'organization.manageUsers')::text;

insert into res select 'Un owner d''entreprise Pro n''est PAS administrateur Oasis Care','false',
  public.is_platform_admin()::text;

do $$
declare
  f text;
  refuse boolean;
begin
  foreach f in array array[
    'select * from public.admin_platform_kpis()',
    'select * from public.admin_list_users()',
    'select * from public.admin_list_organizations()',
    'select * from public.admin_global_search(''Paysages'')'
  ]
  loop
    refuse := false;
    begin
      execute f;
    exception when others then refuse := true;
    end;
    insert into res values ('Owner Pro — « ' || f || ' » lève', 'true', refuse::text);
  end loop;
end $$;

insert into res select 'Un owner ne voit toujours qu''une entreprise : la sienne','1',
  (select count(*)::text from public.business_organizations);

do $$
declare refuse boolean := false;
begin
  begin
    perform public.record_admin_event('test.forge','user',null,null,null,null,'Tentative');
  exception when others then refuse := true;
  end;
  insert into res values ('Un owner ne peut pas écrire dans le journal admin','true',refuse::text);
end $$;

-- ============================================================
-- 3. L'ADMINISTRATEUR RÉVOQUÉ
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc000015-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res select 'Un administrateur révoqué n''est plus administrateur','false',
  public.is_platform_admin()::text;

insert into res select 'Un administrateur révoqué n''a plus aucune permission','false',
  public.platform_admin_can('platform.dashboard.read')::text;

do $$
declare refuse boolean := false;
begin
  begin
    perform * from public.admin_platform_kpis();
  exception when others then refuse := true;
  end;
  insert into res values ('Un administrateur révoqué n''ouvre plus le tableau de bord','true',refuse::text);
end $$;

-- ============================================================
-- 4. LE MOINDRE PRIVILÈGE (spec p.30)
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc000011-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res select 'Le support voit le tableau de bord','true',
  public.platform_admin_can('platform.dashboard.read')::text;
insert into res select 'Le support LIT les abonnements','true',
  public.platform_admin_can('billing.subscriptions.read')::text;
insert into res select 'SUPPORT NE MODIFIE PAS LES ABONNEMENTS','false',
  public.platform_admin_can('billing.subscriptions.write')::text;
insert into res select 'Le support peut ouvrir les données d''un client pour l''aider','true',
  public.platform_admin_can('customer.data.read')::text;
insert into res select 'Le support ne lit pas le journal des administrateurs','false',
  public.platform_admin_can('platform.audit.read')::text;

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc000012-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res select 'BILLING N''OUVRE PAS LES DONNÉES CLIENT','false',
  public.platform_admin_can('customer.data.read')::text;
insert into res select 'Billing modifie bien les abonnements','true',
  public.platform_admin_can('billing.subscriptions.write')::text;

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc000013-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res select 'PRODUCT NE TOUCHE PAS AUX PAIEMENTS','false',
  public.platform_admin_can('billing.payments.write')::text;
insert into res select 'Product ne modifie pas les abonnements non plus','false',
  public.platform_admin_can('billing.subscriptions.write')::text;
insert into res select 'Product lit quand même les usages','true',
  public.platform_admin_can('platform.organizations.read')::text;

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc000014-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

-- La règle générale, plutôt qu'une permission en particulier : aucune
-- permission marquée `is_write` ne doit être accordée à ce rôle, y
-- compris celles qui n'existent pas encore.
insert into res select 'UN ANALYSTE EN LECTURE SEULE N''A AUCUNE PERMISSION D''ÉCRITURE','0',
  (select count(*)::text
     from public.platform_admin_role_permissions rp
     join public.platform_admin_permissions p on p.key = rp.permission
    where rp.role = 'read_only_analyst' and p.is_write);

insert into res select 'Un analyste lit bien le tableau de bord','true',
  public.platform_admin_can('platform.dashboard.read')::text;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.record_admin_event('test.analyst','user',null,null,null,null,'Motif');
  exception when others then refuse := true;
  end;
  -- La seule écriture que ce jalon rende possible. Si elle passait,
  -- « n'écrit rien » serait déjà faux.
  insert into res values ('UN ANALYSTE N''ÉCRIT RIEN, PAS MÊME DANS LE JOURNAL','true',refuse::text);
end $$;

-- ------------------------------------------------------------
-- 4.b Ce que la base REFUSE d'écrire dans la matrice
-- ------------------------------------------------------------
-- Une absence se comble par distraction ; un refus se supprime exprès.
reset role;

do $$
declare
  c record;
  refuse boolean;
begin
  for c in
    select * from (values
      ('support','billing.subscriptions.write','On ne peut pas donner au support le droit de modifier un abonnement'),
      ('billing_admin','customer.data.read','On ne peut pas ouvrir les données client à la facturation'),
      ('product_admin','billing.payments.write','On ne peut pas donner les paiements au produit'),
      ('read_only_analyst','platform.admins.manage','On ne peut pas donner une écriture à un analyste'),
      ('support','permission.inventee','Une permission hors catalogue est refusée')
    ) t(r, p, nom)
  loop
    refuse := false;
    begin
      insert into public.platform_admin_role_permissions (role, permission) values (c.r, c.p);
    exception when others then refuse := true;
    end;
    insert into res values (c.nom, 'true', refuse::text);
  end loop;
end $$;

-- Une révocation qui laisserait le compte actif serait une porte
-- ouverte avec l'écriteau « fermé ».
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.platform_admins (user_id, role, is_active, revoked_at)
    values ('cc000001-0000-4000-8000-000000000075','support', true, now());
  exception when others then refuse := true;
  end;
  insert into res values ('Un admin révoqué ne peut pas rester « actif »','true',refuse::text);
end $$;

-- ============================================================
-- 5. LES DEUX PRÉDICATS SONT DIFFICILES À ASSOUPLIR
-- ============================================================
-- Le test le plus inhabituel de ce fichier : il relit le CODE SOURCE
-- des deux fonctions. C'est la seule façon de défendre une propriété
-- qui n'est pas observable à l'exécution — « il n'existe aucun chemin
-- depuis l'appartenance à une organisation » — et c'est précisément la
-- propriété que la spec p.32 exige.
insert into res select 'is_platform_admin() ne prend AUCUN paramètre','0',
  (select pronargs::text from pg_proc where oid = 'public.is_platform_admin()'::regprocedure);

insert into res select 'platform_admin_can() ne prend que la permission','1',
  (select pronargs::text from pg_proc where oid = 'public.platform_admin_can(text)'::regprocedure);

insert into res select 'is_platform_admin() ne parle jamais d''organisation','false',
  (select pg_get_functiondef(oid) ilike '%organization%' from pg_proc
    where oid = 'public.is_platform_admin()'::regprocedure)::text;

insert into res select 'is_platform_admin() n''appelle pas has_permission','false',
  (select pg_get_functiondef(oid) ilike '%has_permission%' from pg_proc
    where oid = 'public.is_platform_admin()'::regprocedure)::text;

insert into res select 'platform_admin_can() ne parle jamais d''organisation','false',
  (select pg_get_functiondef(oid) ilike '%organization%' from pg_proc
    where oid = 'public.platform_admin_can(text)'::regprocedure)::text;

insert into res select 'Les deux prédicats épinglent leur search_path','2',
  (select count(*)::text from pg_proc
    where oid in ('public.is_platform_admin()'::regprocedure,
                  'public.platform_admin_can(text)'::regprocedure)
      and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%');

-- Les droits eux-mêmes : c'est là que 0057 s'est fait avoir.
insert into res select 'anon n''exécute pas les KPI','false',
  has_function_privilege('anon','public.admin_platform_kpis()','execute')::text;
insert into res select 'anon ne lit pas la table des administrateurs','false',
  has_table_privilege('anon','public.platform_admins','select')::text;
insert into res select 'authenticated n''écrit pas dans la table des administrateurs','false',
  has_table_privilege('authenticated','public.platform_admins','insert')::text;
insert into res select 'authenticated n''écrit pas dans le journal admin','false',
  has_table_privilege('authenticated','public.admin_audit_events','insert')::text;
insert into res select 'Aucune vue security definer n''a été créée pour l''administration','0',
  (select count(*)::text from pg_views
    where schemaname='public' and viewname like 'admin!_%' escape '!');

-- ============================================================
-- 6. LES KPI — un chiffre inconnu rend NULL, jamais zéro
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc000010-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res
select 'Le total des utilisateurs est celui de la base, pas une estimation',
       (select v from att where k='total_users'),
       (select total_users::text from public.admin_platform_kpis());

insert into res
select 'Les entreprises Pro se comptent hors archivées',
       (select v from att where k='pro_orgs'),
       (select pro_organizations::text from public.admin_platform_kpis());

insert into res
select 'Les utilisateurs Pro se comptent SANS doublon',
       (select v from att where k='pro_users'),
       (select pro_users::text from public.admin_platform_kpis());

insert into res
select 'MRR INCONNU tant qu''aucun abonnement n''est suivi (et surtout pas 0 €)','NULL',
       coalesce((select mrr_cents::text from public.admin_platform_kpis()), 'NULL');

insert into res
select 'ARR inconnu lui aussi','NULL',
       coalesce((select arr_cents::text from public.admin_platform_kpis()), 'NULL');

insert into res
select 'Essais Pro inconnus tant que la table n''est alimentée par personne','NULL',
       coalesce((select pro_trials::text from public.admin_platform_kpis()), 'NULL');

insert into res
select 'Utilisateurs « Oasis Care Mobile » : inconnus, rien ne l''enregistre','NULL',
       coalesce((select mobile_users::text from public.admin_platform_kpis()), 'NULL');

insert into res
select 'Churn inconnu','NULL',
       coalesce((select churn_30d_percent::text from public.admin_platform_kpis()), 'NULL');

insert into res
select 'Coût de l''IA inconnu : aucune table n''enregistre de tokens','NULL',
       coalesce((select ai_cost_cents::text from public.admin_platform_kpis()), 'NULL');

-- Un NULL muet ne vaut pas grand-chose : l'écran doit pouvoir dire
-- POURQUOI il ne sait pas.
insert into res
select 'Chaque inconnu est accompagné de son motif','true',
       (select (unknown_reasons ? 'mrr_cents' and unknown_reasons ? 'ai_cost_cents'
                and unknown_reasons ? 'mobile_users')::text
          from public.admin_platform_kpis());

-- ------------------------------------------------------------
-- 6.b Le MRR n'est pas un NULL codé en dur : il calcule vraiment
-- ------------------------------------------------------------
reset role;
update public.organization_plans set monthly_price_cents = 4900 where key = 'solo';
insert into public.organization_subscriptions (organization_id, plan, status)
select v, 'solo', 'active' from ids where k='orgA';

select set_config('request.jwt.claims',
  json_build_object('sub','cc000010-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res
select 'Un abonnement au prix connu donne un vrai MRR','4900',
       (select mrr_cents::text from public.admin_platform_kpis());

insert into res
select 'L''ARR en découle','58800',
       (select arr_cents::text from public.admin_platform_kpis());

-- ET CELUI-LÀ EST UN VRAI ZÉRO : la table est alimentée, donc
-- « aucun essai » est une information, pas une ignorance.
insert into res
select 'Une fois la table alimentée, « 0 essai » devient une vérité','0',
       (select pro_trials::text from public.admin_platform_kpis());

insert into res
select 'Le motif du MRR a disparu de lui-même','false',
       (select (unknown_reasons ? 'mrr_cents')::text from public.admin_platform_kpis());

-- Un second abonnement sur un forfait SANS PRIX. Un `sum()` naïf
-- l'ignorerait et rendrait encore 4 900 — un chiffre faux qui a l'air
-- d'un chiffre. C'est le mode de défaillance le plus dangereux de tout
-- ce fichier.
reset role;
insert into public.organization_subscriptions (organization_id, plan, status)
select v, 'team', 'active' from ids where k='orgB';

select set_config('request.jwt.claims',
  json_build_object('sub','cc000010-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res
select 'Un seul forfait sans prix rend le MRR INCONNU (et non trop bas)','NULL',
       coalesce((select mrr_cents::text from public.admin_platform_kpis()), 'NULL');

insert into res
select 'Et le motif dit qu''il s''agit d''un prix manquant','true',
       (select (unknown_reasons->>'mrr_cents' ilike '%prix%')::text
          from public.admin_platform_kpis());

reset role;
delete from public.organization_subscriptions
 where organization_id = (select v from ids where k='orgB');
update public.organization_subscriptions set status = 'trialing'
 where organization_id = (select v from ids where k='orgA');

select set_config('request.jwt.claims',
  json_build_object('sub','cc000010-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res
select 'Un essai en cours se compte','1',
       (select pro_trials::text from public.admin_platform_kpis());

insert into res
select 'Sans abonnement facturable, le MRR redevient inconnu','NULL',
       coalesce((select mrr_cents::text from public.admin_platform_kpis()), 'NULL');

-- ============================================================
-- 7. L'ACTIVITÉ DU JOUR
-- ============================================================
insert into res
select 'Les inscriptions du jour sont comptées sur la vraie table',
       (select v from att where k='signups_today'),
       (select signups::text from public.admin_live_activity());

insert into res
select 'Les nouvelles entreprises du jour aussi',
       (select v from att where k='new_orgs_today'),
       (select new_organizations::text from public.admin_live_activity());

insert into res
select 'Conversions Pro : inconnues, personne n''écrit organization_subscriptions','NULL',
       coalesce((select pro_conversions::text from public.admin_live_activity()), 'NULL');

insert into res
select 'Erreurs importantes : inconnues, aucune table d''erreurs n''existe','NULL',
       coalesce((select important_errors::text from public.admin_live_activity()), 'NULL');

insert into res
select 'Consommation IA du jour : inconnue, les compteurs sont mensuels','NULL',
       coalesce((select ai_requests::text from public.admin_live_activity()), 'NULL');

insert into res
select 'Conversions Premium : inconnues tant que subscription_events est vide','NULL',
       coalesce((select premium_conversions::text from public.admin_live_activity()), 'NULL');

-- Dès qu'une ligne existe, le compteur se met à répondre tout seul :
-- l'inconnu n'était pas une renonciation, c'était un constat.
reset role;
insert into public.subscription_events
  (workspace_id, user_id, event_type, product_id, original_transaction_id, transaction_id, environment, occurred_at)
select v, 'cc000001-0000-4000-8000-000000000075', 'SUBSCRIBED', 'com.test.premium',
       'cc-orig-1', 'cc-tx-1', 'Sandbox', now()
from ids where k='wsNormal';

select set_config('request.jwt.claims',
  json_build_object('sub','cc000010-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res
select 'Une première conversion enregistrée est comptée','1',
       (select premium_conversions::text from public.admin_live_activity());

-- ============================================================
-- 8. LES LISTES — des nombres et des métadonnées, pas du contenu
-- ============================================================
insert into res
select 'La recherche par e-mail trouve exactement un compte','1',
       (select count(*)::text from public.admin_list_users('cc-owner@test.invalid'));

insert into res
select 'Le total de pagination accompagne la page','1',
       (select total_count::text from public.admin_list_users('cc-owner@test.invalid'));

insert into res
select 'Le propriétaire est rattaché à son entreprise','1',
       (select organization_count::text from public.admin_list_users('cc-owner@test.invalid'));

insert into res
select 'Et l''entreprise est nommée','Paysages Contrôle A',
       (select organizations[1] from public.admin_list_users('cc-owner@test.invalid'));

insert into res
select 'Un compte sans entreprise n''en a aucune','0',
       (select organization_count::text from public.admin_list_users('cc-normal@test.invalid'));

-- Le piège de l'audit, rendu visible : 25 droits « offerts » ne sont
-- pas 25 abonnés.
insert into res
select 'Un accès OFFERT est signalé comme tel','true',
       (select complimentary::text from public.admin_list_users('cc-normal@test.invalid'));

insert into res
select 'Le produit utilisé reste INCONNU pour un compte sans entreprise','NULL',
       coalesce((select product from public.admin_list_users('cc-normal@test.invalid')), 'NULL');

do $$
declare
  c record;
  refuse boolean;
begin
  for c in
    select * from (values
      ('mobile','Le filtre « Mobile » lève : rien n''enregistre le produit d''origine'),
      ('trial','Le filtre « Trial » lève : un essai Apple est indiscernable'),
      ('cancelled','Le filtre « Cancelled » lève : il n''y a pas d''historique'),
      ('nimportequoi','Un filtre inconnu lève plutôt que de tout rendre')
    ) t(f, nom)
  loop
    refuse := false;
    begin
      perform * from public.admin_list_users(null, c.f);
    exception when others then refuse := true;
    end;
    insert into res values (c.nom, 'true', refuse::text);
  end loop;
end $$;

insert into res
select 'Le filtre « pro » ne rend que des comptes rattachés à une entreprise','0',
       (select count(*)::text from public.admin_list_users(null, 'pro') where organization_count = 0);

-- ------------------------------------------------------------
-- 8.b Les entreprises
-- ------------------------------------------------------------
insert into res
select 'L''administrateur voit les DEUX entreprises de test','2',
       (select count(*)::text from public.admin_list_organizations('Paysages Contrôle'));

insert into res
select 'Une entreprise annonce son nombre de membres','1',
       (select member_count::text from public.admin_list_organizations('Paysages Contrôle A'));

insert into res
select 'Elle annonce son nombre de clients CRM','1',
       (select crm_customer_count::text from public.admin_list_organizations('Paysages Contrôle A'));

insert into res
select 'Elle n''a aucun devis, et le dit','0',
       (select quote_count::text from public.admin_list_organizations('Paysages Contrôle A'));

insert into res
select 'La « dernière activité » est bien la dernière action journalisée',
       (select v from att where k='last_audit_orgA'),
       (select last_audited_action_at::text
          from public.admin_list_organizations('Paysages Contrôle A'));

-- Et quand le journal ne dit rien, l'écran ne doit pas inventer une
-- date : une entreprise dont aucune action n'a été auditée est une
-- entreprise dont on ignore la dernière activité — pas une entreprise
-- active à l'instant.
reset role;
delete from public.audit_events
 where organization_id = (select v from ids where k='orgB');
select set_config('request.jwt.claims',
  json_build_object('sub','cc000010-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res
select 'Sans action auditée, la dernière activité est INCONNUE (et non « maintenant »)','NULL',
       coalesce((select last_audited_action_at::text
                   from public.admin_list_organizations('Paysages Contrôle B')), 'NULL');

-- R5, vérifiée sur la SIGNATURE : la fonction ne peut pas rendre du
-- contenu métier, puisqu'aucune de ses colonnes de sortie n'en porte.
-- Ce qu'elle rend d'une entreprise se compte en `_count`, en dates et
-- en identité légale.
insert into res
select 'Aucune colonne de contenu métier dans la liste des entreprises','0',
       (select count(*)::text
          from information_schema.parameters
         where specific_schema = 'public'
           and specific_name like 'admin\_list\_organizations%'
           and parameter_mode = 'TABLE'
           and parameter_name in ('quotes','customers','plants','photos','notes','documents','lines'));

insert into res
select 'Le filtre « archivées » ne rend pas une entreprise vivante','0',
       (select count(*)::text from public.admin_list_organizations(null, 'archivees')
         where organization_id = (select v from ids where k='orgA'));

-- ============================================================
-- 9. LA RECHERCHE ADMINISTRATIVE GLOBALE
-- ============================================================
insert into res
select 'On retrouve une entreprise par son SIRET, séparateurs compris','organization',
       (select result_type from public.admin_global_search('78900012'));

insert into res
select 'Et la correspondance est nommée','siret',
       (select matched_on from public.admin_global_search('78900012'));

insert into res
select 'On retrouve un compte par son e-mail','user',
       (select result_type from public.admin_global_search('cc-owner2@test.invalid'));

insert into res
select 'On retrouve une entreprise par son identifiant exact','identifiant',
       (select matched_on from public.admin_global_search((select v from ids where k='orgB')::text));

insert into res
select 'Une seule lettre ne déclenche aucune recherche','0',
       (select count(*)::text from public.admin_global_search('a'));

-- LE POINT QUE global_search (0061) NE PEUT PAS TENIR : la recherche
-- administrative traverse les organisations, celle du produit non.
insert into res
select 'La recherche admin traverse les organisations','2',
       (select count(*)::text from public.admin_global_search('Paysages Contrôle')
         where result_type = 'organization');

-- ============================================================
-- 10. LE JOURNAL D'AUDIT ADMINISTRATIF
-- ============================================================
insert into ids
select 'evt', public.record_admin_event(
  'subscription.planChanged', 'organization',
  (select v from ids where k='orgA'), 'Paysages Contrôle A',
  '{"plan":"solo"}'::jsonb, '{"plan":"team"}'::jsonb,
  'Geste de test, pour vérifier que le journal fonctionne.',
  '203.0.113.7'::inet, 'test-suite', '{"session":"test"}'::jsonb);

insert into res
select 'Une action administrative se journalise','true',
       ((select v from ids where k='evt') is not null)::text;

insert into res
select 'Le journal retient QUI a agi, et sous quel rôle','super_admin',
       (select admin_role from public.admin_audit_events where id = (select v from ids where k='evt'));

insert into res
select 'Il retient l''ancienne et la nouvelle valeur','solo → team',
       (select (old_value->>'plan') || ' → ' || (new_value->>'plan')
          from public.admin_audit_events where id = (select v from ids where k='evt'));

do $$
declare refuse boolean := false;
begin
  begin
    perform public.record_admin_event('subscription.planChanged','organization',null,null,null,null,'   ');
  exception when others then refuse := true;
  end;
  -- Un motif vide n'est pas un motif. C'est la seule colonne contrainte
  -- de la table, et c'est celle qu'on voudra lire dans six mois.
  insert into res values ('Une action sans MOTIF est refusée','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    update public.admin_audit_events set reason = 'réécrit'
     where id = (select v from ids where k='evt');
  exception when others then refuse := true;
  end;
  insert into res values ('Le journal ne se réécrit pas','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    delete from public.admin_audit_events where id = (select v from ids where k='evt');
  exception when others then refuse := true;
  end;
  insert into res values ('Le journal ne s''efface pas','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.admin_audit_events (admin_user_id, admin_role, action, target_type, reason)
    values (auth.uid(), 'super_admin', 'faux', 'user', 'ligne fabriquée à la main');
  exception when others then refuse := true;
  end;
  insert into res values ('On n''écrit pas dans le journal sans passer par la fonction','true',refuse::text);
end $$;

-- Le support ne lit pas ce journal : savoir quel collègue a touché quel
-- dossier n'est pas son travail.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc000011-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res
select 'Le support ne lit pas le journal des administrateurs','0',
       (select count(*)::text from public.admin_audit_events);

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cc000010-0000-4000-8000-000000000075')::text, true);
set local role authenticated;

insert into res
select 'Le super-administrateur, lui, le lit','1',
       (select count(*)::text from public.admin_audit_events
         where id = (select v from ids where k='evt'));

insert into res
select 'admin_me() dit qui l''on est','super_admin',
       (select m.role from public.admin_me() m);

reset role;

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
