-- Oasis Care — §PLANNING → NOTES DE JOURNÉE (migration 0078).
--
-- CE QUE CE TEST DÉFEND, dans l'ordre d'importance :
--
--   1. LE CLOISONNEMENT. B ne voit pas les consignes de A, ne les
--      corrige pas, ne les efface pas — et, le cas moins évident, ne
--      peut pas ACCROCHER sa propre note à une équipe de A en
--      déclarant sa propre organisation. C'est la faille que 0062 a dû
--      réparer sur trois tables : la politique demandait « as-tu le
--      droit d'écrire chez toi ? », la réponse était oui, et personne
--      ne regardait l'autre bout de la ligne.
--
--   2. LE FUSEAU. Une note appartient à une DATE, et cette date se
--      compte à Paris. Le défaut est celui de 0066 : Supabase tourne en
--      UTC, et entre minuit et deux heures du matin la journée
--      parisienne a commencé mais pas celle du serveur. Une consigne
--      saisie mardi à 00 h 30 rangée au lundi n'est pas lue mardi
--      matin, c'est-à-dire jamais.
--
--   3. LES DROITS. Qui écrit une consigne, qui corrige celle d'un
--      autre. L'ouvrier lit et ne pose rien ; le responsable corrige,
--      mais ne signe pas à la place du collègue.
--
--   4. LE BORNAGE. Une note est une note : ni vide, ni un document.
--
-- SANS EFFET DE BORD : tout est dans une transaction terminée par
-- ROLLBACK. Rien ne subsiste, y compris les quatre comptes de test.
--
-- Pour le rejouer, coller ce fichier dans l'éditeur SQL Supabase, ou
-- l'envoyer à l'API Management (/v1/projects/<ref>/database/query).

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- Le repère de temps du test est celui de la table : la date de PARIS.
-- Prendre `current_date` ici ferait échouer le test deux heures par
-- nuit en été, sans que rien ne soit cassé — le pire des tests.
create temp table repere(today date) on commit drop;
insert into repere select (now() at time zone 'Europe/Paris')::date;
grant all on repere to authenticated;

-- ============================================================
-- Fixtures — deux entreprises, quatre comptes
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000078-0000-4000-8000-000000000078','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','notes-patron-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000078-0000-4000-8000-000000000078','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','notes-patron-b@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000078-0000-4000-8000-000000000078','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','notes-ouvrier-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('d0000078-0000-4000-8000-000000000078','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','notes-chef-a@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000078-0000-4000-8000-000000000078')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Paysages A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','b0000078-0000-4000-8000-000000000078')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Paysages B','landscaper');

-- Un ouvrier de A : `projects.read` et rien d'autre (0043:129).
-- Un chef de A : `projects.read` + `projects.manage` (0043:114), et
-- surtout PAS l'auteur des notes — c'est lui qui devra corriger celle
-- d'un collègue.
insert into public.organization_members (organization_id, user_id, role)
select v, 'c0000078-0000-4000-8000-000000000078', 'fieldWorker' from ids where k='orgA';
insert into public.organization_members (organization_id, user_id, role)
select v, 'd0000078-0000-4000-8000-000000000078', 'manager' from ids where k='orgA';

insert into ids select 'equipeA', gen_random_uuid();
insert into public.teams (id, organization_id, name)
select (select v from ids where k='equipeA'), (select v from ids where k='orgA'), 'Équipe A';

insert into ids select 'equipeB', gen_random_uuid();
insert into public.teams (id, organization_id, name)
select (select v from ids where k='equipeB'), (select v from ids where k='orgB'), 'Équipe B';

-- ============================================================
-- 2. Le fuseau, avant même d'écrire une ligne
-- ============================================================
-- La forme de la colonne est un test à part entière : le jour où
-- quelqu'un la repassera en `timestamptz` « pour pouvoir noter
-- l'heure », tout le reste continuera de passer et la dérive
-- reviendra en silence.
insert into res
select 'La journée d''une note est une DATE, pas un horodatage','date',
       (select data_type from information_schema.columns
         where table_schema='public' and table_name='planning_day_notes' and column_name='day');

insert into res
select 'Sa valeur par défaut se compte à Paris, pas sur le serveur','true',
       (select (column_default like '%Europe/Paris%')::text
          from information_schema.columns
         where table_schema='public' and table_name='planning_day_notes' and column_name='day');

-- LE DÉCALAGE, MONTRÉ SUR UN INSTANT FIXE plutôt que sur `now()` :
-- 2026-06-15 22:30 UTC, c'est-à-dire mardi 16 juin à 00 h 30 à
-- Paris (heure d'été, UTC+2). Le serveur en est encore à lundi.
insert into res
select 'À 00 h 30 à Paris, le serveur (UTC) en est encore à la veille','2026-06-15',
       (('2026-06-15 22:30:00+00'::timestamptz at time zone 'UTC')::date)::text;

insert into res
select 'Le même instant, à Paris, c''est déjà mardi','2026-06-16',
       (('2026-06-15 22:30:00+00'::timestamptz at time zone 'Europe/Paris')::date)::text;

-- ============================================================
-- On devient réellement le patron de A
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','a0000078-0000-4000-8000-000000000078')::text, true);
set local role authenticated;

-- La consigne d'entreprise : aucune équipe désignée.
insert into ids select 'consigne', gen_random_uuid();
insert into public.planning_day_notes (id, organization_id, body)
select (select v from ids where k='consigne'), (select v from ids where k='orgA'),
       'Dépôt fermé à 16 h';

-- La consigne d'équipe.
insert into ids select 'formation', gen_random_uuid();
insert into public.planning_day_notes (id, organization_id, day, team_id, body)
select (select v from ids where k='formation'), (select v from ids where k='orgA'),
       (select today from repere) + 1, (select v from ids where k='equipeA'),
       'Équipe A en formation';

insert into res
select 'Une note sans date prend le jour de PARIS',
       (select today from repere)::text,
       (select day::text from public.planning_day_notes where id = (select v from ids where k='consigne'));

insert into res
select 'Une note est signée par celui qui l''écrit',
       'a0000078-0000-4000-8000-000000000078',
       (select created_by::text from public.planning_day_notes where id = (select v from ids where k='consigne'));

-- Une note jamais corrigée n'a pas deux dates : sinon l'écran
-- afficherait « corrigée à … » sur chaque note du matin.
insert into res
select 'Une note jamais corrigée n''affiche pas de correction','true',
       (select (updated_at = created_at)::text from public.planning_day_notes
         where id = (select v from ids where k='consigne'));

insert into res
select 'Une note sans équipe concerne toute l''entreprise','NULL',
       coalesce((select team_id::text from public.planning_day_notes
                  where id = (select v from ids where k='consigne')), 'NULL');

-- ---------- 2. Le fuseau, sur des lignes réelles ----------
-- Mardi 00 h 30 à Paris : la note appartient à MARDI. Rangée au lundi,
-- elle ne serait pas sur l'écran du chef d'équipe mardi matin.
insert into ids select 'mardi', gen_random_uuid();
insert into public.planning_day_notes (id, organization_id, day, body)
select (select v from ids where k='mardi'), (select v from ids where k='orgA'),
       ('2026-06-15 22:30:00+00'::timestamptz at time zone 'Europe/Paris')::date,
       'Livraison paillage 14 h';

-- Lundi 23 h 30 à Paris : la note reste au LUNDI. C'est le sens
-- inverse, et il compte autant — une `date` n'a pas de fuseau, donc
-- rien ne peut plus la faire glisser au mardi à l'affichage.
insert into ids select 'lundi', gen_random_uuid();
insert into public.planning_day_notes (id, organization_id, day, body)
select (select v from ids where k='lundi'), (select v from ids where k='orgA'),
       ('2026-06-15 21:30:00+00'::timestamptz at time zone 'Europe/Paris')::date,
       'Benne à évacuer';

insert into res
select 'La note saisie mardi à 00 h 30 est rangée à MARDI','2026-06-16',
       (select day::text from public.planning_day_notes where id = (select v from ids where k='mardi'));

insert into res
select 'La note du lundi soir reste au LUNDI','2026-06-15',
       (select day::text from public.planning_day_notes where id = (select v from ids where k='lundi'));

-- La requête que fera l'écran : les notes de ces sept jours.
insert into res
select 'La semaine du 15 juin porte bien les deux notes','2',
       (select count(*)::text from public.planning_day_notes
         where day between date '2026-06-15' and date '2026-06-21');

insert into res
select 'Aucune des deux ne fuit dans la semaine précédente','0',
       (select count(*)::text from public.planning_day_notes
         where day between date '2026-06-08' and date '2026-06-14');

-- ---------- 4. Le bornage ----------
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.planning_day_notes (organization_id, body)
    select v, '   ' from ids where k='orgA';
  exception when others then refuse := true;
  end;
  insert into res values ('Une note faite de trois espaces est refusée','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.planning_day_notes (organization_id, body)
    select v, repeat('a', 501) from ids where k='orgA';
  exception when others then refuse := true;
  end;
  insert into res values ('Cinq cent un caractères : ce n''est plus une note','true',refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.planning_day_notes (organization_id, body)
    select v, repeat('a', 500) from ids where k='orgA';
  exception when others then refuse := true;
  end;
  insert into res values ('Cinq cents caractères passent','false',refuse::text);
end $$;

-- ---------- 1. Le cloisonnement, vu de A ----------
-- A écrit chez A — la politique RLS est satisfaite — mais désigne
-- l'équipe de B. C'est au déclencheur de dire non.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.planning_day_notes (organization_id, team_id, body)
    select (select v from ids where k='orgA'), (select v from ids where k='equipeB'),
           'Consigne pour l''équipe du voisin';
  exception when others then refuse := true;
  end;
  insert into res values ('A ne peut pas viser une équipe de B','true',refuse::text);
end $$;

-- Et pas davantage en déplaçant une note existante vers cette équipe :
-- le déclencheur est posé sur l'insertion ET sur la mise à jour.
do $$
declare refuse boolean := false;
begin
  begin
    update public.planning_day_notes
       set team_id = (select v from ids where k='equipeB')
     where id = (select v from ids where k='consigne');
  exception when others then refuse := true;
  end;
  insert into res values ('A ne peut pas non plus y déplacer une note existante','true',refuse::text);
end $$;

-- ============================================================
-- 3. Les droits — l'ouvrier lit, et rien de plus
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','c0000078-0000-4000-8000-000000000078')::text, true);
set local role authenticated;

insert into res
select 'L''ouvrier lit la consigne d''entreprise','1',
       (select count(*)::text from public.planning_day_notes
         where id = (select v from ids where k='consigne'));

insert into res
select 'L''ouvrier lit aussi la consigne de son équipe','1',
       (select count(*)::text from public.planning_day_notes
         where id = (select v from ids where k='formation'));

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.planning_day_notes (organization_id, body)
    select v, 'Je décide que le dépôt ferme à 15 h' from ids where k='orgA';
  exception when others then refuse := true;
  end;
  insert into res values ('L''ouvrier ne peut pas poser de consigne','true',refuse::text);
end $$;

-- La RLS ne lève pas d'exception sur une mise à jour : elle ne montre
-- simplement aucune ligne à modifier. C'est le nombre de lignes
-- touchées qu'il faut regarder, pas l'absence d'erreur.
do $$
declare n int;
begin
  update public.planning_day_notes set body = 'Dépôt ouvert toute la nuit'
   where id = (select v from ids where k='consigne');
  get diagnostics n = row_count;
  insert into res values ('L''ouvrier ne corrige pas la consigne du patron','0',n::text);
end $$;

do $$
declare n int;
begin
  delete from public.planning_day_notes where id = (select v from ids where k='consigne');
  get diagnostics n = row_count;
  insert into res values ('L''ouvrier n''efface pas la consigne du patron','0',n::text);
end $$;

-- ============================================================
-- 3 bis. Le chef corrige la note d'un collègue, sans la signer
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','d0000078-0000-4000-8000-000000000078')::text, true);
set local role authenticated;

do $$
declare n int;
begin
  update public.planning_day_notes set body = 'Dépôt fermé à 15 h'
   where id = (select v from ids where k='consigne');
  get diagnostics n = row_count;
  insert into res values ('Un autre responsable corrige la note d''un collègue','1',n::text);
end $$;

insert into res
select 'La correction est bien enregistrée','Dépôt fermé à 15 h',
       (select body from public.planning_day_notes where id = (select v from ids where k='consigne'));

-- LA LIGNE QUI JUSTIFIE D'AFFICHER L'AUTEUR. Si corriger revenait à
-- signer, le nom affiché sous la consigne serait un mensonge, et il
-- vaudrait mieux ne pas l'afficher du tout.
insert into res
select 'Corriger n''est pas signer : l''auteur reste le patron',
       'a0000078-0000-4000-8000-000000000078',
       (select created_by::text from public.planning_day_notes where id = (select v from ids where k='consigne'));

insert into res
select 'La correction est horodatée','true',
       (select (updated_at > created_at)::text from public.planning_day_notes
         where id = (select v from ids where k='consigne'));

-- ============================================================
-- 1. Le cloisonnement, vu de B
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','b0000078-0000-4000-8000-000000000078')::text, true);
set local role authenticated;

insert into res
select 'B ne voit aucune note de A','0',
       (select count(*)::text from public.planning_day_notes);

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.planning_day_notes (organization_id, body)
    select v, 'Consigne posée chez le voisin' from ids where k='orgA';
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas poser de note chez A','true',refuse::text);
end $$;

-- LA TENTATIVE QUI COMPTE. B écrit chez B — la politique RLS est donc
-- satisfaite — mais désigne l'équipe de A. Sans le déclencheur, la
-- ligne passerait, et l'écran de B afficherait une équipe qui n'est
-- pas la sienne.
do $$
declare refuse boolean := false;
begin
  begin
    insert into public.planning_day_notes (organization_id, team_id, body)
    select (select v from ids where k='orgB'), (select v from ids where k='equipeA'),
           'Consigne accrochée à l''équipe de A';
  exception when others then refuse := true;
  end;
  insert into res values ('B ne peut pas accrocher sa note à une équipe de A','true',refuse::text);
end $$;

do $$
declare n int;
begin
  update public.planning_day_notes set body = 'Dépôt ouvert'
   where id = (select v from ids where k='consigne');
  get diagnostics n = row_count;
  insert into res values ('B ne corrige pas la note de A','0',n::text);
end $$;

do $$
declare n int;
begin
  delete from public.planning_day_notes where id = (select v from ids where k='consigne');
  get diagnostics n = row_count;
  insert into res values ('B n''efface pas la note de A','0',n::text);
end $$;

-- ============================================================
-- Vérifié UNE FOIS SORTI de la peau de B
-- ============================================================
-- Et c'est essentiel : posées pendant que la RLS de B masque la ligne,
-- ces deux questions auraient rendu la bonne réponse quoi qu'il
-- arrive — un test qui passe même quand tout est cassé.
reset role;

insert into res
select 'La note de A est toujours là','1',
       (select count(*)::text from public.planning_day_notes
         where id = (select v from ids where k='consigne'));

insert into res
select 'Et son texte n''a pas été réécrit par B','Dépôt fermé à 15 h',
       (select body from public.planning_day_notes where id = (select v from ids where k='consigne'));

insert into res
select 'Aucune note n''a été créée dans l''organisation de B','0',
       (select count(*)::text from public.planning_day_notes
         where organization_id = (select v from ids where k='orgB'));

-- ============================================================
-- Dissoudre une équipe n'efface pas la consigne
-- ============================================================
-- `on delete set null` : la note redevient une note d'entreprise, ce
-- qui se voit, plutôt que de disparaître, ce qui ne se voit pas.
delete from public.teams where id = (select v from ids where k='equipeA');

insert into res
select 'Dissoudre une équipe ne supprime pas sa consigne','1',
       (select count(*)::text from public.planning_day_notes
         where id = (select v from ids where k='formation'));

insert into res
select 'La consigne orpheline redevient une note d''entreprise','NULL',
       coalesce((select team_id::text from public.planning_day_notes
                  where id = (select v from ids where k='formation')), 'NULL');

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
