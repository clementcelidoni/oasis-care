-- Oasis Care — PRÉSENCE APPLICATIVE (migration 0077).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. « 0 UTILISATEUR MOBILE » N'EXISTE PAS. Tant qu'aucune
--      installation ne s'est annoncée et qu'aucune activité passée ne
--      permet de déduire quoi que ce soit, le KPI rend NULL avec un
--      motif DATÉ — jamais zéro. C'est la faute que ce projet a déjà
--      corrigée deux fois (0059, 0065) et le test la surveille dans les
--      deux sens : inconnu quand il n'y a rien, un vrai nombre dès
--      qu'il y a quelque chose.
--
--   2. PERSONNE NE DÉCLARE LA PRÉSENCE DE QUELQU'UN D'AUTRE. La
--      fonction d'annonce ne prend aucun identifiant d'utilisateur, et
--      la table n'est écrivable par aucun jeton. Les deux sont
--      vérifiés : un utilisateur qui reprend l'identifiant
--      d'installation d'un autre crée une ligne À SON NOM, et une
--      écriture directe est refusée.
--
--   3. UNE INSTALLATION, UNE LIGNE. Deux lancements ne font pas deux
--      lignes — sinon la table deviendrait un journal de connexions,
--      c'est-à-dire exactement ce qu'elle ne doit pas être.
--
--   4. UN COMPTE SUPPRIMÉ N'Y LAISSE RIEN. Une ligne de télémétrie qui
--      survivrait à une suppression de compte serait un manquement
--      RGPD.
--
--   5. LA CLOISON DU CONTROL CENTER TIENT. Un utilisateur ordinaire et
--      un OWNER d'entreprise Pro ne lisent rien des autres, et les
--      nouvelles fonctions d'administration LÈVENT pour eux — elles ne
--      rendent pas une liste vide, qui se confondrait avec « aucune
--      donnée ».
--
--   6. DÉCLARÉ ET DÉDUIT NE SE MÉLANGENT PAS. Le compteur les sépare, et
--      une DÉCLARATION périme la DÉDUCTION : on mesure, on ne suppose
--      plus, et personne n'est compté deux fois.
--
--   7. AUCUNE FONCTION D'ADMINISTRATION NE REND `install_id`. Vérifié
--      sur les TYPES DE RETOUR, pas sur une intention.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Le §0 vide la table de présence pour pouvoir éprouver
-- l'état « aucune donnée collectée » — la suppression est annulée avec
-- le reste.
--
-- Pour le rejouer, coller ce fichier dans l'éditeur SQL Supabase, ou
-- l'envoyer à l'API Management (/v1/projects/<ref>/database/query).

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v text) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- ============================================================
-- Fixtures — six comptes
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at, last_sign_in_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 -- Celui qui utilise l'iPhone, sur deux installations.
 ('ab000001-0000-4000-8000-000000000077','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','mp-mobile@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 -- Un autre utilisateur ordinaire : c'est lui qui essaiera de déclarer
 -- la présence du premier.
 ('ab000002-0000-4000-8000-000000000077','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','mp-autre@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 -- Un OWNER d'entreprise Pro : le piège nommé par la spec p.36.
 ('ab000003-0000-4000-8000-000000000077','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','mp-owner@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 -- Un compte jetable, qui sera supprimé pour de bon.
 ('ab000004-0000-4000-8000-000000000077','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','mp-jetable@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 -- Un compte dont on ne sait RIEN : ni Pro, ni mobile. Sa fiche doit
 -- rendre des inconnus, pas des zéros.
 ('ab000005-0000-4000-8000-000000000077','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','mp-inconnu@test.invalid','',now(),now(),now(),now(),'{}','{}'),
 -- L'administrateur de plateforme, seul à voir les chiffres.
 ('ab000010-0000-4000-8000-000000000077','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','mp-admin@test.invalid','',now(),now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','ab000003-0000-4000-8000-000000000077')::text, true);
insert into ids
select 'orgA', public.create_professional_organization('Paysages Présence','landscaper')::text;

insert into public.platform_admins (user_id, role, note) values
 ('ab000010-0000-4000-8000-000000000077','super_admin','Test présence applicative');

-- ============================================================
-- 0. AUCUNE DONNÉE COLLECTÉE — le cas qui compte
-- ============================================================
--
-- On vide la table (dans la transaction annulée) pour reproduire le
-- JOUR DU DÉPLOIEMENT : le mécanisme existe, personne ne s'en est
-- encore servi. C'est là que « 0 » serait un mensonge.
delete from public.mobile_app_installations;

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ab000010-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

insert into res
select 'Aucune donnée : mobile_users est INCONNU', 'true',
       (select (k.mobile_users is null)::text from public.admin_platform_kpis() k);

-- `coalesce` volontaire : la question posée est « ce chiffre vaut-il
-- zéro ? » et la réponse attendue est un NON franc. Sans lui, la
-- comparaison rendrait elle-même NULL et l'assertion ne dirait rien.
insert into res
select 'Aucune donnée : surtout pas « 0 utilisateur mobile »', 'false',
       (select coalesce(k.mobile_users = 0, false)::text from public.admin_platform_kpis() k);

insert into res
select 'L''inconnu est MOTIVÉ, et le motif est daté', 'true',
       (select (k.unknown_reasons ? 'mobile_users'
                and k.unknown_reasons ->> 'mobile_users' like 'Collecte démarrée le %')::text
          from public.admin_platform_kpis() k);

insert into res
select 'La date de démarrage de la collecte est rendue', 'true',
       (select (k.mobile_collection_started_at is not null)::text
          from public.admin_platform_kpis() k);

-- Les deux compteurs de fiabilité, eux, valent bien ZÉRO : « aucune
-- installation ne s'est annoncée » est une phrase VRAIE et vérifiable,
-- contrairement à « aucun utilisateur mobile n'existe ».
insert into res
select 'Zéro DÉCLARATION est un fait, et se dit', '0',
       (select k.mobile_users_declared::text from public.admin_platform_kpis() k);

-- ------------------------------------------------------------
-- 0.b UN INCONNU SANS MOTIF N'EXISTE PAS NON PLUS
-- ------------------------------------------------------------
--
-- L'invariant que ce projet défend est « un nombre OU un motif, jamais
-- aucun des deux ». Le §0 l'éprouve avec la ligne de démarrage en
-- place ; il faut aussi l'éprouver SANS elle. Un `truncate`, une
-- restauration partielle ou un environnement recréé sans la graine
-- suffisent, et le motif — construit par concaténation — deviendrait
-- NULL, donc disparaîtrait de `unknown_reasons` : « — » tout court,
-- c'est-à-dire le point de départ de tout ce chantier.
reset role;
delete from public.mobile_presence_collection;

select set_config('request.jwt.claims',
  json_build_object('sub','ab000010-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

insert into res
select 'Sans ligne de démarrage : le chiffre reste inconnu…', 'true',
       (select (k.mobile_users is null)::text from public.admin_platform_kpis() k);

insert into res
select '…et il reste MOTIVÉ, un inconnu muet serait le défaut d''origine', 'true',
       (select (k.unknown_reasons ->> 'mobile_users' is not null)::text
          from public.admin_platform_kpis() k);

-- On la remet : la suite du fichier éprouve le fonctionnement normal.
reset role;
insert into public.mobile_presence_collection (singleton) values (true)
on conflict (singleton) do nothing;

-- ============================================================
-- 1. LA DÉCLARATION — une installation, une ligne
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ab000001-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

select public.declare_mobile_presence(
  '11111111-2222-4333-8444-555555555555', 'ios', '1.4.0', '31', 26);

insert into res
select 'Une déclaration crée UNE ligne', '1',
       (select count(*)::text from public.mobile_app_installations);

insert into ids
select 'vu1', (select max(last_seen_at)::text from public.mobile_app_installations);

-- Deux lancements de suite : c'est le cas normal (scenePhase .active se
-- déclenche à chaque retour au premier plan).
select public.declare_mobile_presence(
  '11111111-2222-4333-8444-555555555555', 'ios', '1.4.0', '31', 26);
select public.declare_mobile_presence(
  '11111111-2222-4333-8444-555555555555', 'ios', '1.4.0', '31', 26);

insert into res
select 'Trois lancements de la même installation ne font pas trois lignes', '1',
       (select count(*)::text from public.mobile_app_installations);

-- Et ils n'ont même pas RÉÉCRIT la ligne : sans ce garde-fou, un client
-- bavard produirait des dizaines d'écritures par jour et par appareil,
-- pour une information qui n'a pas changé.
insert into res
select 'Un relancement dans l''heure n''écrit rien du tout', 'true',
       ((select max(last_seen_at)::text from public.mobile_app_installations)
        = (select v from ids where k = 'vu1'))::text;

-- Un changement de version, lui, est pris TOUT DE SUITE : le jour d'une
-- sortie, la distribution ne doit pas retarder d'une heure.
select public.declare_mobile_presence(
  '11111111-2222-4333-8444-555555555555', 'ios', '1.5.0', '32', 26);

insert into res
select 'Un changement de version est pris immédiatement', '1.5.0 / 32',
       (select app_version || ' / ' || app_build from public.mobile_app_installations);

insert into res
select 'Et il ne crée toujours pas de deuxième ligne', '1',
       (select count(*)::text from public.mobile_app_installations);

-- Un second téléphone : deux installations, un seul utilisateur.
select public.declare_mobile_presence(
  '99999999-2222-4333-8444-555555555555', 'ios', '1.5.0', '32', 25);

insert into res
select 'Une seconde installation fait une seconde ligne', '2',
       (select count(*)::text from public.mobile_app_installations);

-- ------------------------------------------------------------
-- 1.b Ce que la fonction REFUSE d'écrire
-- ------------------------------------------------------------
do $$
declare
  cas text;
  refuse boolean;
begin
  foreach cas in array array[
    -- Un nom d'appareil est un nom de personne : il ne doit pas entrer,
    -- pas même pour être effacé ensuite.
    'select public.declare_mobile_presence(''iPhone de Clément'', ''ios'', ''1.5.0'', ''32'', 26)',
    'select public.declare_mobile_presence(''court'', ''ios'', ''1.5.0'', ''32'', 26)',
    -- Aucun client Android n'existe : l''accepter laisserait croire
    -- qu''on le mesure.
    'select public.declare_mobile_presence(''22222222-2222-4333-8444-555555555555'', ''android'', ''1.5.0'', ''32'', 26)',
    -- La version majeure d''OS, pas la version complète.
    'select public.declare_mobile_presence(''22222222-2222-4333-8444-555555555555'', ''ios'', ''1.5.0'', ''32'', null)',
    'select public.declare_mobile_presence(''22222222-2222-4333-8444-555555555555'', ''ios'', '''', ''32'', 26)',
    -- LES QUATRE CAS QUI PASSAIENT. Refuser l'espace ne gardait rien :
    -- une espace se remplace par un tiret et une adresse électronique
    -- n'en contient aucune. Les deux dernières lignes sont les plus
    -- graves — `app_version` et `app_build` sont rendus TELS QUELS à
    -- l'administrateur, sur la fiche et dans la distribution des
    -- versions : ce qu'on n'y refuse pas s'affiche.
    'select public.declare_mobile_presence(''iPhone-de-Clement-Celidoni'', ''ios'', ''1.5.0'', ''32'', 26)',
    'select public.declare_mobile_presence(''clement.celidoni@gmail.com'', ''ios'', ''1.5.0'', ''32'', 26)',
    'select public.declare_mobile_presence(''22222222-2222-4333-8444-555555555555'', ''ios'', ''iPhone de Clement'', ''32'', 26)',
    'select public.declare_mobile_presence(''22222222-2222-4333-8444-555555555555'', ''ios'', ''1.5.0'', ''clement@gmail.com'', 26)'
  ]
  loop
    refuse := false;
    begin
      execute cas;
    exception when others then refuse := true;
    end;
    insert into res values ('Refusé — « ' || left(cas, 78) || '… »', 'true', refuse::text);
  end loop;
end $$;

insert into res
select 'Aucun de ces refus n''a laissé de ligne derrière lui', '2',
       (select count(*)::text from public.mobile_app_installations);

-- ------------------------------------------------------------
-- 1.c LE NOMBRE D'INSTALLATIONS EST PLAFONNÉ
-- ------------------------------------------------------------
--
-- L'index unique empêche le DOUBLON, jamais la MULTIPLICATION : avant
-- correction, un seul compte fabriquait 301 lignes en une transaction,
-- toutes comptées dans « nombre d'appareils » et toutes versées au
-- DÉNOMINATEUR des pourcentages de l'écran des versions. Le plafond est
-- de dix, et au-delà c'est la plus ancienne qui est recyclée — pas
-- l'appel qui échoue, sinon un utilisateur légitime à trois téléphones
-- cesserait d'être vu au onzième identifiant perdu.
do $$
begin
  for i in 1..30 loop
    perform public.declare_mobile_presence(
      lpad(to_hex(i), 8, '0') || '-2222-4333-8444-555555555555',
      'ios', '1.5.0', '32', 26);
  end loop;
end $$;

insert into res
select 'Trente déclarations d''un même compte ne font pas trente lignes', '10',
       (select count(*)::text from public.mobile_app_installations
         where user_id = 'ab000001-0000-4000-8000-000000000077');

-- Et l'appel n'a JAMAIS levé : le client l'ignore de toute façon, une
-- exception n'aurait servi qu'à remplir les traces.
insert into res
select 'Le plafond est silencieux : rien n''a levé au trentième appel', 'true',
       (select (count(*) > 0)::text from public.mobile_app_installations
         where user_id = 'ab000001-0000-4000-8000-000000000077');

-- On remet le compte dans l'état attendu par la suite du fichier :
-- ses deux installations du §1, avec leurs valeurs de la fin du §1.
reset role;
delete from public.mobile_app_installations
 where user_id = 'ab000001-0000-4000-8000-000000000077';

select set_config('request.jwt.claims',
  json_build_object('sub','ab000001-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

select public.declare_mobile_presence(
  '11111111-2222-4333-8444-555555555555', 'ios', '1.5.0', '32', 26);
select public.declare_mobile_presence(
  '99999999-2222-4333-8444-555555555555', 'ios', '1.5.0', '32', 25);

insert into res
select 'Le compte est revenu à ses deux installations', '2',
       (select count(*)::text from public.mobile_app_installations);

-- La contrainte de table double la fonction, et elle doit tenir toute
-- seule : `service_role` écrit directement (une reprise, un script de
-- support, une restauration) et n'appelle pas la fonction. Sans elle,
-- la règle ne serait pas une règle de la DONNÉE.
reset role;
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.mobile_app_installations
      (user_id, source, install_id, platform, app_version, app_build, os_major)
    values ('ab000005-0000-4000-8000-000000000077', 'declared',
            '77777777-7777-4777-8777-777777777777', 'ios',
            'iPhone de Clément', '32', 26);
  exception when others then refuse := true;
  end;
  insert into res values (
    'Même en écriture directe, une « version » qui est un nom est refusée',
    'true', refuse::text);
end $$;

-- ============================================================
-- 2. PERSONNE NE DÉCLARE LA PRÉSENCE D'UN AUTRE
-- ============================================================
--
-- D'abord la forme, qui est ce qui rend la règle difficile à
-- assouplir par accident : la fonction NE PREND PAS d'identifiant
-- d'utilisateur. `declare_mobile_presence(p_user_id, …)` aurait été
-- plus « souple », et n'importe qui aurait pu gonfler le KPI.
insert into res
select 'La fonction d''annonce ne prend aucun identifiant d''utilisateur', 'true',
       (select (pg_get_function_arguments(p.oid) not ilike '%uuid%')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'declare_mobile_presence');

insert into res
select 'Elle s''identifie par le JETON, pas par un paramètre', 'true',
       (select (pg_get_functiondef(p.oid) like '%auth.uid()%')::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'declare_mobile_presence');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ab000002-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

-- Le fond, maintenant : le deuxième utilisateur reprend mot pour mot
-- l'identifiant d'installation du premier.
select public.declare_mobile_presence(
  '11111111-2222-4333-8444-555555555555', 'ios', '0.9.0', '12', 18);

reset role;

insert into res
select 'Reprendre l''identifiant d''un autre crée une ligne À SON PROPRE NOM', '1',
       (select count(*)::text from public.mobile_app_installations
         where user_id = 'ab000002-0000-4000-8000-000000000077');

insert into res
select 'La victime garde ses deux lignes, intactes', '2',
       (select count(*)::text from public.mobile_app_installations
         where user_id = 'ab000001-0000-4000-8000-000000000077');

insert into res
select 'Et sa version n''a pas été écrasée par celle de l''autre', '0',
       (select count(*)::text from public.mobile_app_installations
         where user_id = 'ab000001-0000-4000-8000-000000000077'
           and app_version = '0.9.0');

-- L'écriture directe, maintenant : la RLS dit à qui appartient une
-- ligne, elle ne dit rien de ce qu'elle contient. C'est le retrait des
-- droits qui empêche d'y mettre n'importe quoi.
select set_config('request.jwt.claims',
  json_build_object('sub','ab000002-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

do $$
declare
  cas text;
  refuse boolean;
begin
  foreach cas in array array[
    'insert into public.mobile_app_installations (user_id, source, platform) values (''ab000001-0000-4000-8000-000000000077'', ''inferred'', ''ios'')',
    'insert into public.mobile_app_installations (user_id, source, platform) values (auth.uid(), ''inferred'', ''ios'')',
    'update public.mobile_app_installations set last_seen_at = now()',
    'delete from public.mobile_app_installations'
  ]
  loop
    refuse := false;
    begin
      execute cas;
    exception when others then refuse := true;
    end;
    insert into res values ('Écriture directe refusée — « ' || left(cas, 60) || '… »', 'true', refuse::text);
  end loop;
end $$;

-- Sans jeton, pas de présence : `auth.uid()` est nul et la fonction
-- lève. Une annonce anonyme n'appartiendrait à personne.
reset role;
select set_config('request.jwt.claims', '{}', true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.declare_mobile_presence(
      '33333333-2222-4333-8444-555555555555', 'ios', '1.5.0', '32', 26);
  exception when others then refuse := true;
  end;
  insert into res values ('Sans jeton, aucune présence ne se déclare','true',refuse::text);
end $$;

-- ============================================================
-- 3. PERSONNE NE LIT LES LIGNES DES AUTRES
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ab000001-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

insert into res
select 'Un utilisateur ne voit QUE ses propres installations', '2',
       (select count(*)::text from public.mobile_app_installations);

do $$
declare
  f text;
  refuse boolean;
begin
  foreach f in array array[
    'select * from public.admin_platform_kpis()',
    'select * from public.admin_list_users()',
    'select * from public.admin_mobile_version_distribution()',
    'select * from public.admin_mobile_os_distribution()'
  ]
  loop
    refuse := false;
    begin
      execute f;
    exception when others then refuse := true;
    end;
    -- Elles LÈVENT : une liste vide se confondrait avec « aucune
    -- donnée », et l'écran afficherait « 0 utilisateur mobile » à
    -- quelqu'un qui n'a simplement pas le droit de regarder.
    insert into res values ('Utilisateur ordinaire — « ' || f || ' » lève', 'true', refuse::text);
  end loop;
end $$;

-- L'OWNER d'entreprise Pro : le piège que la spec p.36 nomme.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ab000003-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

insert into res
select 'Le propriétaire a bien tous les droits DANS son entreprise', 'true',
       public.has_permission((select v::uuid from ids where k = 'orgA'), 'organization.manageUsers')::text;

insert into res
select 'Un owner Pro ne voit aucune installation, pas même une', '0',
       (select count(*)::text from public.mobile_app_installations);

do $$
declare
  f text;
  refuse boolean;
begin
  foreach f in array array[
    'select * from public.admin_platform_kpis()',
    'select * from public.admin_mobile_version_distribution()',
    'select * from public.admin_mobile_os_distribution()'
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

-- ============================================================
-- 4. LE COMPTEUR DISTINGUE « DÉCLARÉ » DE « DÉDUIT »
-- ============================================================
--
-- On pose à la main une ligne DÉDUITE pour l'owner Pro — c'est ce que
-- ferait la reprise du §3 de la migration pour un compte qui a laissé
-- des `care_events` dans son espace personnel avant que la collecte
-- n'existe.
reset role;
insert into public.mobile_app_installations (user_id, source, platform, last_seen_at)
values ('ab000003-0000-4000-8000-000000000077', 'inferred', 'ios', now() - interval '40 days');

select set_config('request.jwt.claims',
  json_build_object('sub','ab000010-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

insert into res
select 'Trois comptes mobiles au total', '3',
       (select k.mobile_users::text from public.admin_platform_kpis() k);

insert into res
select 'Dont deux DÉCLARÉS par l''application', '2',
       (select k.mobile_users_declared::text from public.admin_platform_kpis() k);

insert into res
select 'Et un DÉDUIT de l''activité passée', '1',
       (select k.mobile_users_inferred::text from public.admin_platform_kpis() k);

-- Le chiffre existe : il n'est plus « inconnu ». Mais il ne devient pas
-- exact pour autant, et l'écran doit le dire.
insert into res
select 'Le chiffre n''est plus inconnu…', 'false',
       (select (k.unknown_reasons ? 'mobile_users')::text from public.admin_platform_kpis() k);

insert into res
select '…mais il s''annonce comme une BORNE INFÉRIEURE', 'true',
       (select (k.mobile_users_note like 'Borne inférieure.%')::text
          from public.admin_platform_kpis() k);

insert into res
select 'Et la note rappelle le mode invité, jamais compté', 'true',
       (select (k.mobile_users_note like '%invité%')::text
          from public.admin_platform_kpis() k);

-- Et l'autre sens, qu'il serait malhonnête de taire : la déclaration
-- est faite par le client et n'est pas vérifiable côté serveur, donc le
-- chiffre peut aussi être trop HAUT. « Borne inférieure » tout court ne
-- prévient que d'un sens.
insert into res
select 'La note prévient AUSSI que la déclaration n''est pas vérifiable', 'true',
       (select (k.mobile_users_note like '%pas vérifiable côté serveur%')::text
          from public.admin_platform_kpis() k);

-- ------------------------------------------------------------
-- 4.b LA FICHE D'UN COMPTE DÉDUIT — le seul état que la
--     production connaîtra le jour du déploiement
-- ------------------------------------------------------------
--
-- C'est le trou qu'aucune des 71 assertions d'origine ne couvrait : la
-- fiche n'était éprouvée que sur un compte DÉCLARÉ. Or sur une ligne
-- déduite, `last_seen_at` vaut la date de la dernière trace — un
-- arrosage, un appel IA — et elle s'affichait sur la fiche sous le
-- libellé « Dernière annonce de l'application », c'est-à-dire une
-- mesure qui n'a jamais eu lieu. Vérifié sur la production : la valeur
-- était égale au dernier `care_events.created_at` à la microseconde
-- près.
--
-- CE QUE LA FICHE DOIT DIRE D'UN COMPTE DÉDUIT : la provenance, la
-- plateforme, et RIEN D'AUTRE. La plateforme est renseignée à dessein —
-- les tables sur lesquelles repose la déduction ne sont écrites que par
-- l'application iPhone, c'est un fait vrai qu'on ne masque pas. La
-- version, le nombre d'installations et la date d'annonce, eux, sont
-- des choses qu'une déduction ne sait pas.
insert into res
select 'Compte déduit : la provenance est dite', 'inferred',
       (select u.mobile_presence_source from public.admin_list_users('mp-owner@test.invalid') u);

insert into res
select 'Compte déduit : AUCUNE date d''annonce (ce serait un geste métier)', 'true',
       (select (u.mobile_last_seen_at is null)::text
          from public.admin_list_users('mp-owner@test.invalid') u);

insert into res
select 'Compte déduit : aucune version', 'true',
       (select (u.mobile_app_version is null)::text
          from public.admin_list_users('mp-owner@test.invalid') u);

insert into res
select 'Compte déduit : aucun nombre d''installations, surtout pas 0', 'true',
       (select (u.mobile_install_count is null)::text
          from public.admin_list_users('mp-owner@test.invalid') u);

-- La plateforme, elle, EST connue, et c'est délibéré : la déduction ne
-- repose que sur des tables qu'aucun autre client n'écrit.
insert into res
select 'Compte déduit : la plateforme reste connue, elle est déduite aussi', 'ios',
       (select u.mobile_platform from public.admin_list_users('mp-owner@test.invalid') u);

-- ============================================================
-- 5. UNE DÉCLARATION PÉRIME UNE DÉDUCTION
-- ============================================================
--
-- Sinon le même compte serait compté deux fois — une fois supposé, une
-- fois mesuré — et le total dépasserait le nombre de comptes.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ab000003-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

select public.declare_mobile_presence(
  '44444444-2222-4333-8444-555555555555', 'ios', '1.5.0', '32', 26);

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ab000010-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

insert into res
select 'Le total ne bouge pas : on mesure ce qu''on supposait', '3',
       (select k.mobile_users::text from public.admin_platform_kpis() k);

insert into res
select 'Le compte a basculé du côté DÉCLARÉ', '3',
       (select k.mobile_users_declared::text from public.admin_platform_kpis() k);

insert into res
select 'Et plus aucune déduction ne le concerne', '0',
       (select k.mobile_users_inferred::text from public.admin_platform_kpis() k);

-- ============================================================
-- 6. UN COMPTE SUPPRIMÉ N'Y LAISSE RIEN
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ab000004-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

select public.declare_mobile_presence(
  '55555555-2222-4333-8444-555555555555', 'ios', '1.5.0', '32', 26);

reset role;

insert into res
select 'Le compte jetable a bien déclaré une installation', '1',
       (select count(*)::text from public.mobile_app_installations
         where user_id = 'ab000004-0000-4000-8000-000000000077');

-- C'est la dernière étape de `delete-account/index.ts` : la
-- destruction de l'utilisateur auth lui-même. La cascade doit emporter
-- la télémétrie — y compris quand la suppression est faite hors de
-- l'Edge Function (tableau de bord Supabase, SQL direct).
delete from public.workspaces where owner_id = 'ab000004-0000-4000-8000-000000000077';
delete from auth.users where id = 'ab000004-0000-4000-8000-000000000077';

insert into res
select 'Un compte supprimé ne laisse AUCUNE ligne de télémétrie', '0',
       (select count(*)::text from public.mobile_app_installations
         where user_id = 'ab000004-0000-4000-8000-000000000077');

-- ------------------------------------------------------------
-- 6.b L'EFFACEMENT DOUX — le seul trou de la cascade
-- ------------------------------------------------------------
--
-- `on delete cascade` ne se déclenche que sur une suppression RÉELLE.
-- Supabase sait aussi effacer en douceur : `deleteUser(id, true)` laisse
-- la ligne `auth.users` en place et pose `deleted_at`. Le compte
-- disparaît alors de tous les écrans pendant que sa télémétrie reste en
-- base — invisible, donc jamais purgée. Mesuré avant correction : la
-- ligne survivait. Ce n'est pas le chemin du produit
-- (`delete-account/index.ts` supprime en dur), et c'est justement
-- pourquoi personne ne s'en serait aperçu.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ab000005-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

select public.declare_mobile_presence(
  '66666666-2222-4333-8444-555555555555', 'ios', '1.5.0', '32', 26);

reset role;

insert into res
select 'Un compte à effacer en douceur a bien une ligne', '1',
       (select count(*)::text from public.mobile_app_installations
         where user_id = 'ab000005-0000-4000-8000-000000000077');

update auth.users set deleted_at = now()
 where id = 'ab000005-0000-4000-8000-000000000077';

insert into res
select 'Un effacement DOUX emporte la télémétrie lui aussi', '0',
       (select count(*)::text from public.mobile_app_installations
         where user_id = 'ab000005-0000-4000-8000-000000000077');

-- On le remet debout : le §7 éprouve sa fiche « aucune trace ».
update auth.users set deleted_at = null
 where id = 'ab000005-0000-4000-8000-000000000077';

select set_config('request.jwt.claims',
  json_build_object('sub','ab000010-0000-4000-8000-000000000077')::text, true);
set local role authenticated;

insert into res
select 'Et le compteur redescend avec lui', '3',
       (select k.mobile_users::text from public.admin_platform_kpis() k);

-- ============================================================
-- 7. LA FICHE UTILISATEUR (spec p.8)
-- ============================================================
insert into res
select 'Produit utilisé : « mobile » pour un compte sans entreprise', 'mobile',
       (select u.product from public.admin_list_users('mp-mobile@test.invalid') u);

insert into res
select 'Nombre d''installations DÉCLARÉES', '2',
       (select u.mobile_install_count::text from public.admin_list_users('mp-mobile@test.invalid') u);

insert into res
select 'Version : celle de l''installation vue le plus récemment', '1.5.0',
       (select u.mobile_app_version from public.admin_list_users('mp-mobile@test.invalid') u);

insert into res
select 'Plateforme', 'ios',
       (select u.mobile_platform from public.admin_list_users('mp-mobile@test.invalid') u);

insert into res
select 'Origine de la présence', 'declared',
       (select u.mobile_presence_source from public.admin_list_users('mp-mobile@test.invalid') u);

insert into res
select 'Dernière présence connue', 'true',
       (select (u.mobile_last_seen_at is not null)::text
          from public.admin_list_users('mp-mobile@test.invalid') u);

-- « Ou les deux » (spec p.8) : la phrase que 0075 ne savait pas dire.
insert into res
select 'Produit utilisé : « les deux » pour l''owner Pro qui a l''iPhone', 'both',
       (select u.product from public.admin_list_users('mp-owner@test.invalid') u);

-- LE CAS QUI COMPTE AUTANT QUE LE RESTE : un compte dont on ne sait
-- rien. Ses colonnes mobiles sont INCONNUES, pas nulles. « 0
-- installation » affirmerait qu'on a regardé et qu'il n'y en a pas.
insert into res
select 'Un compte sans trace : produit INCONNU', 'true',
       (select (u.product is null)::text from public.admin_list_users('mp-inconnu@test.invalid') u);

insert into res
select 'Un compte sans trace : « 0 installation » ne s''affiche pas', 'true',
       (select (u.mobile_install_count is null)::text
          from public.admin_list_users('mp-inconnu@test.invalid') u);

insert into res
select 'Un compte sans trace : aucune plateforme inventée', 'true',
       (select (u.mobile_platform is null)::text
          from public.admin_list_users('mp-inconnu@test.invalid') u);

-- Le filtre « Mobile », que 0075 refusait faute de donnée derrière.
insert into res
select 'Le filtre « mobile » rend les trois comptes mobiles', '3',
       (select count(*)::text from public.admin_list_users(null, 'mobile'));

insert into res
select 'Le filtre « mobile_deduit » n''en rend plus aucun', '0',
       (select count(*)::text from public.admin_list_users(null, 'mobile_deduit'));

do $$
declare refuse boolean := false;
begin
  begin
    perform * from public.admin_list_users(null, 'android');
  exception when others then refuse := true;
  end;
  -- Aucun client Android n'existe : une liste vide se lirait « aucun
  -- utilisateur Android », c'est-à-dire un fait.
  insert into res values ('Le filtre « android » LÈVE, il ne rend pas une liste vide','true',refuse::text);
end $$;

-- ============================================================
-- 8. LA DISTRIBUTION DES VERSIONS
-- ============================================================
insert into res
select 'La 1.5.0 / 32 est portée par trois installations', '3',
       (select d.installations::text from public.admin_mobile_version_distribution() d
         where d.app_version = '1.5.0' and d.app_build = '32');

-- Trois installations, mais DEUX utilisateurs : le premier compte en a
-- deux à lui seul. C'est toute la raison d'être des deux colonnes — une
-- distribution qui ne compterait que les installations surestimerait le
-- nombre de personnes concernées par une sortie.
insert into res
select 'Portées par DEUX utilisateurs seulement', '2',
       (select d.users::text from public.admin_mobile_version_distribution() d
         where d.app_version = '1.5.0' and d.app_build = '32');

insert into res
select 'Le total des déclarations est rendu sur chaque ligne', '4',
       (select max(d.declared_installations_total)::text
          from public.admin_mobile_version_distribution() d);

insert into res
select 'La distribution ignore les lignes DÉDUITES (elles n''ont pas de version)', '0',
       (select coalesce(count(*) filter (where d.app_version is null), 0)::text
          from public.admin_mobile_version_distribution() d);

insert into res
select 'La distribution des OS sépare les trois majeures déclarées', '3',
       (select count(*)::text from public.admin_mobile_os_distribution());

-- Tri croissant : la question posée à cet écran est « qu'est-ce qui
-- traîne en bas, et puis-je relever la cible de déploiement sans couper
-- quelqu'un ». La réponse se lit en première ligne.
insert into res
select 'Et l''OS le plus ancien se lit en première ligne', '18',
       (select d.os_major::text from public.admin_mobile_os_distribution() d limit 1);

-- ============================================================
-- 9. L'IDENTIFIANT D'INSTALLATION NE SORT JAMAIS
-- ============================================================
--
-- Vérifié sur les TYPES DE RETOUR des fonctions d'administration, pas
-- sur une intention : l'écran voit des nombres et des versions.
reset role;

insert into res
select 'Aucune fonction d''administration ne rend install_id', '0',
       (select count(*)::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname like 'admin\_%'
           and pg_get_function_result(p.oid) ilike '%install_id%');

-- Et la table elle-même n'est ouverte à personne en écriture.
insert into res
select 'authenticated n''a que le SELECT sur la table de présence', 'SELECT',
       (select string_agg(distinct privilege_type, ',' order by privilege_type)
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'mobile_app_installations'
           and grantee = 'authenticated');

insert into res
select 'anon n''a rien du tout', 'true',
       (select (count(*) = 0)::text
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = 'mobile_app_installations'
           and grantee = 'anon');

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
