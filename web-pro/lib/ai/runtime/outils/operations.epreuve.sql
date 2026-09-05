-- Oasis Care — §11Y, L'ÉPREUVE DE `ai_operations_snapshot`.
--
-- ============================================================
-- OÙ CE FICHIER DOIT FINIR
-- ============================================================
--
-- Dans `supabase/tests/agents_ia.sql`, qui appartient à l'intégration.
-- Il est écrit AUTONOME — son propre `begin`, sa propre table `res`, son
-- propre `rollback` — pour deux raisons : il se rejoue seul pendant
-- l'écriture de l'agent, et il s'ajoute au fichier d'intégration comme
-- une seconde transaction sans rien renommer.
--
--   node runsql.js .sb_token operations.sql operations.epreuve.sql
--
-- SANS EFFET DE BORD : tout est annulé, y compris les trois comptes.
--
-- ============================================================
-- CE QUE CETTE ÉPREUVE DÉFEND, DANS L'ORDRE D'IMPORTANCE
-- ============================================================
--
--   1. « ZÉRO EN RETARD » NE PEUT PAS SORTIR D'UN PORTEFEUILLE SANS
--      DATES. C'est la raison d'être de la fonction. Deux entreprises
--      sont montées exprès : l'une a une date de fin sur un chantier
--      ouvert et pas sur l'autre — le compteur vaut 1 et le motif dit
--      lequel est hors calcul ; l'autre n'en a aucune — le compteur vaut
--      NULL, et surtout PAS zéro.
--
--   2. LE CLOISONNEMENT. L'entreprise B a un chantier ouvert, une
--      intervention et un pointage non validé. Si un seul filtre
--      d'organisation manquait, ils apparaîtraient dans les compteurs de
--      A. Et depuis la peau de A, la fonction appelée sur B est refusée
--      — l'identifiant de B est pourtant connu de l'appelant.
--
--   3. UN DROIT MANQUANT REFUSE, IL NE REND PAS UNE VUE PARTIELLE. Un
--      compte sans `projects.read` obtient une exception. Une vue
--      amputée serait une réponse fausse, pas une réponse incomplète.
--
--   4. UN POINTAGE OUBLIÉ HORS FENÊTRE RESTE VISIBLE. C'est le seul
--      tableau volontairement non borné par la période : un pointage
--      vieux de six mois est précisément celui qu'il faut voir.
--
--   5. LES NULL SONT DES NULL. Avancement d'un chantier sans phase,
--      écart d'une intervention sans fin réelle : NULL, jamais zéro.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table cfg(k text, d date) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on cfg to authenticated;

-- Calculé UNE FOIS, à Paris : un test qui recalcule « aujourd'hui » à
-- chaque ligne échoue une nuit sur deux entre minuit et deux heures.
insert into cfg values ('today', (now() at time zone 'Europe/Paris')::date);

-- ============================================================
-- Fixtures — deux entreprises, trois comptes
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('a0000082-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ops-a@test.invalid','',now(),now(),now(),'{}','{}'),
 ('b0000082-0000-4000-8000-0000000000b1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ops-b@test.invalid','',now(),now(),now(),'{}','{}'),
 ('c0000082-0000-4000-8000-0000000000c1','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ops-c@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000a1')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Chantiers A','landscaper');

select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000b1')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Chantiers B','landscaper');

-- LE COMPTE SANS `projects.read`. Il voit les clients, rien d'autre :
-- c'est le seul moyen d'éprouver le refus plutôt que la vue partielle.
insert into public.organization_members (organization_id, user_id, role, custom_permissions)
select v, 'c0000082-0000-4000-8000-0000000000c1', 'custom', array['clients.read']
from ids where k='orgA';

-- ---------- Le décor de A ----------
insert into ids select 'cliA', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='cliA'), (select v from ids where k='orgA'),
       'Villa Aubépine', 'individual', 'customer';

insert into ids select 'empA', gen_random_uuid();
insert into public.employees (id, organization_id, first_name, last_name, hourly_cost_cents)
select (select v from ids where k='empA'), (select v from ids where k='orgA'), 'Ana', 'Roux', 4000;

insert into ids select 'eqA', gen_random_uuid();
insert into public.teams (id, organization_id, name, color)
select (select v from ids where k='eqA'), (select v from ids where k='orgA'), 'ÉQUIPE A', '#123456';

-- PJ1 : OUVERT, EN RETARD, DEUX PHASES À 50 ET 100 %.
insert into ids select 'PJ1', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status, planned_end_on)
select (select v from ids where k='PJ1'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'CH-OPS-1', 'Terrasse', 'inProgress', (select d from cfg where k='today') - 3;
insert into public.project_phases (organization_id, project_id, title, position, status, progress_percent, planned_end_on)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), 'Terrassement', 1, 'inProgress', 50,
       (select d from cfg where k='today') - 3;
insert into public.project_phases (organization_id, project_id, title, position, status, progress_percent)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), 'Plantation', 2, 'done', 100;

-- PJ2 : OUVERT, SANS DATE DE FIN, SANS PHASE. Il est ce qui rend le
-- retard partiellement mesurable, et son avancement doit valoir NULL.
insert into ids select 'PJ2', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status)
select (select v from ids where k='PJ2'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'CH-OPS-2', 'Clôture', 'planned';

-- PJ3 : TERMINÉ. Il ne doit pas entrer dans le parc ouvert, mais il
-- compte dans la couverture des dates de fin.
insert into ids select 'PJ3', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status, actual_end_on)
select (select v from ids where k='PJ3'), (select v from ids where k='orgA'), (select v from ids where k='cliA'),
       'CH-OPS-3', 'Haie', 'completed', (select d from cfg where k='today') - 20;

-- Les interventions : une avec les quatre horodatages (écart calculable),
-- une sans fin réelle (écart NULL), une hors fenêtre.
insert into public.field_interventions
  (organization_id, project_id, customer_id, team_id, kind, title, status,
   scheduled_start, scheduled_end, actual_start, actual_end)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), (select v from ids where k='cliA'),
       (select v from ids where k='eqA'), 'work', 'Terrassement J1', 'done',
       ((((select d from cfg where k='today') - 2)::timestamp + time '08:00') at time zone 'Europe/Paris'),
       ((((select d from cfg where k='today') - 2)::timestamp + time '16:00') at time zone 'Europe/Paris'),
       ((((select d from cfg where k='today') - 2)::timestamp + time '08:00') at time zone 'Europe/Paris'),
       ((((select d from cfg where k='today') - 2)::timestamp + time '18:00') at time zone 'Europe/Paris');

insert into public.field_interventions
  (organization_id, project_id, customer_id, team_id, kind, title, status,
   scheduled_start, scheduled_end)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), (select v from ids where k='cliA'),
       (select v from ids where k='eqA'), 'work', 'Terrassement J2', 'scheduled',
       ((((select d from cfg where k='today') + 1)::timestamp + time '08:00') at time zone 'Europe/Paris'),
       ((((select d from cfg where k='today') + 1)::timestamp + time '16:00') at time zone 'Europe/Paris');

insert into public.field_interventions
  (organization_id, project_id, customer_id, team_id, kind, title, status,
   scheduled_start, scheduled_end)
select (select v from ids where k='orgA'), (select v from ids where k='PJ1'), (select v from ids where k='cliA'),
       (select v from ids where k='eqA'), 'work', 'Vieille visite', 'done',
       ((((select d from cfg where k='today') - 200)::timestamp + time '08:00') at time zone 'Europe/Paris'),
       ((((select d from cfg where k='today') - 200)::timestamp + time '10:00') at time zone 'Europe/Paris');

-- LE POINTAGE OUBLIÉ, VIEUX DE DEUX CENTS JOURS. Hors de toute fenêtre
-- raisonnable, et c'est exactement celui qu'il faut voir.
insert into public.time_entries (organization_id, employee_id, project_id, worked_on, hours,
                                 hourly_cost_cents, kind, validated)
select (select v from ids where k='orgA'), (select v from ids where k='empA'), (select v from ids where k='PJ1'),
       (select d from cfg where k='today') - 200, 5, 4000, 'work', false;
insert into public.time_entries (organization_id, employee_id, project_id, worked_on, hours,
                                 hourly_cost_cents, kind, validated)
select (select v from ids where k='orgA'), (select v from ids where k='empA'), (select v from ids where k='PJ1'),
       (select d from cfg where k='today') - 2, 8, 4000, 'work', true;

-- ---------- Le décor de B : rien de tout cela ne doit fuir chez A ----------
insert into ids select 'cliB', gen_random_uuid();
insert into public.crm_customers (id, organization_id, display_name, kind, lifecycle_stage)
select (select v from ids where k='cliB'), (select v from ids where k='orgB'), 'Parc B', 'company', 'customer';

insert into ids select 'empB', gen_random_uuid();
insert into public.employees (id, organization_id, first_name, last_name, hourly_cost_cents)
select (select v from ids where k='empB'), (select v from ids where k='orgB'), 'Bo', 'Bee', 4000;

-- Ouvert, SANS date de fin : c'est le cas « retard non mesurable ».
insert into ids select 'PJB', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status)
select (select v from ids where k='PJB'), (select v from ids where k='orgB'), (select v from ids where k='cliB'),
       'CH-B-1', 'Bassin', 'inProgress';

insert into public.field_interventions
  (organization_id, project_id, customer_id, kind, title, status, scheduled_start, scheduled_end)
select (select v from ids where k='orgB'), (select v from ids where k='PJB'), (select v from ids where k='cliB'),
       'work', 'Intervention B', 'scheduled',
       ((((select d from cfg where k='today'))::timestamp + time '08:00') at time zone 'Europe/Paris'),
       ((((select d from cfg where k='today'))::timestamp + time '12:00') at time zone 'Europe/Paris');

insert into public.time_entries (organization_id, employee_id, project_id, worked_on, hours,
                                 hourly_cost_cents, kind, validated)
select (select v from ids where k='orgB'), (select v from ids where k='empB'), (select v from ids where k='PJB'),
       (select d from cfg where k='today') - 1, 20, 4000, 'work', false;

-- ============================================================
-- 1. Vue de A — le retard PARTIELLEMENT mesurable
-- ============================================================

select set_config('request.jwt.claims',
  json_build_object('sub','a0000082-0000-4000-8000-0000000000a1')::text, true);
set local role authenticated;

create temp table snapA(j jsonb) on commit drop;
insert into snapA select public.ai_operations_snapshot((select v from ids where k='orgA'));

insert into res
select '1a : deux chantiers ouverts chez A, et pas trois', '2',
       (select j ->> 'chantiersOuverts' from snapA);

insert into res
select '1b : un seul est en retard, l''autre n''a pas de date', '1',
       (select j -> 'retard' ->> 'enRetard' from snapA);

insert into res
select '1c : le motif nomme le chantier hors calcul', 'true',
       (select (j -> 'retard' ->> 'motif') like '%hors du calcul%' from snapA)::text;

insert into res
select '1d : la couverture compte TOUT le portefeuille, pas seulement l''ouvert', '3',
       (select j -> 'retard' -> 'couverture' ->> 'chantiers' from snapA);

insert into res
select '1e : deux phases, une seule datée', '1',
       (select j -> 'retard' -> 'couverture' ->> 'phasesAvecDateDeFin' from snapA);

-- ============================================================
-- 2. Les NULL sont des NULL
-- ============================================================

insert into res
select '2a : l''avancement moyen de CH-OPS-1 est la moyenne de ses phases', '75',
       (select e ->> 'avancementMoyenPct' from snapA, jsonb_array_elements(j -> 'chantiers') e
        where e ->> 'numero' = 'CH-OPS-1');

insert into res
select '2b : un chantier SANS PHASE n''est pas à 0 % : il est à NULL', '(null)',
       (select coalesce(e ->> 'avancementMoyenPct', '(null)')
        from snapA, jsonb_array_elements(j -> 'chantiers') e
        where e ->> 'numero' = 'CH-OPS-2');

insert into res
select '2c : l''écart de fin est calculé par le SQL, pas par le modèle', '2.00',
       (select e ->> 'ecartFinHeures' from snapA, jsonb_array_elements(j -> 'interventions') e
        where e ->> 'titre' = 'Terrassement J1');

insert into res
select '2d : sans fin réelle, l''écart est NULL et non zéro', '(null)',
       (select coalesce(e ->> 'ecartFinHeures', '(null)')
        from snapA, jsonb_array_elements(j -> 'interventions') e
        where e ->> 'titre' = 'Terrassement J2');

insert into res
select '2e : et la durée réellement travaillée est déclarée inconnue', 'false',
       (select e ->> 'dureeReelleConnue' from snapA, jsonb_array_elements(j -> 'interventions') e
        where e ->> 'titre' = 'Terrassement J2');

-- ============================================================
-- 3. La fenêtre borne les interventions, PAS les pointages
-- ============================================================

insert into res
select '3a : la vieille visite de J-200 est hors de la fenêtre par défaut', '2',
       (select j ->> 'interventionsNombre' from snapA);

insert into res
select '3b : mais le pointage non validé de J-200 reste visible', '1',
       (select j ->> 'pointagesEnAttenteChantiers' from snapA);

insert into res
select '3c : et ses heures aussi', '5.00',
       (select j ->> 'heuresEnAttenteTotal' from snapA);

insert into res
select '3d : une fenêtre élargie retrouve la vieille visite', '3',
       (select public.ai_operations_snapshot((select v from ids where k='orgA'),
              (select d from cfg where k='today') - 300, (select d from cfg where k='today') + 30) ->> 'interventionsNombre');

-- ============================================================
-- 4. Le cloisonnement
-- ============================================================

insert into res
select '4a : le pointage de 20 h de B n''entre pas dans le total de A', '5.00',
       (select j ->> 'heuresEnAttenteTotal' from snapA);

insert into res
select '4b : l''intervention de B n''entre pas dans le compte de A', '2',
       (select j ->> 'interventionsNombre' from snapA);

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_operations_snapshot((select v from ids where k='orgB'));
  exception when others then refuse := true;
  end;
  insert into res values
    ('4c : depuis A, la fonction appelée sur B est refusée', 'true', refuse::text);
end $$;

-- ============================================================
-- 5. Un droit manquant REFUSE
-- ============================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','c0000082-0000-4000-8000-0000000000c1')::text, true);
set local role authenticated;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_operations_snapshot((select v from ids where k='orgA'));
  exception when others then refuse := true;
  end;
  insert into res values
    ('5a : sans projects.read, refus net plutôt que vue partielle', 'true', refuse::text);
end $$;

-- ============================================================
-- 6. Vue de B — le retard NON MESURABLE, et c'est le cœur du sujet
-- ============================================================

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000b1')::text, true);
set local role authenticated;

create temp table snapB(j jsonb) on commit drop;
insert into snapB select public.ai_operations_snapshot((select v from ids where k='orgB'));

insert into res
select '6a : un chantier ouvert chez B', '1',
       (select j ->> 'chantiersOuverts' from snapB);

insert into res
select '6b : AUCUNE date de fin : le compteur de retard est NULL, PAS zéro', '(null)',
       (select coalesce(j -> 'retard' ->> 'enRetard', '(null)') from snapB);

insert into res
select '6c : et la fonction dit pourquoi, en français', 'true',
       (select (j -> 'retard' ->> 'motif') like '%pas mesurable%' from snapB)::text;

insert into res
select '6d : le refus « heures prévues » est porté par la donnée, pas par le prompt', 'true',
       (select (j -> 'nonMesurable' ->> 'tempsPrevu') is not null from snapB)::text;

-- Et il DISPARAÎT dès que la donnée existe : une phrase d'indisponibilité
-- qu'aucun remplissage ne fait taire finirait par mentir à son tour.
reset role;
insert into public.project_tasks (organization_id, project_id, title, position, status, planned_hours)
select (select v from ids where k='orgB'), (select v from ids where k='PJB'), 'Poser le liner', 1, 'todo', 6;

select set_config('request.jwt.claims',
  json_build_object('sub','b0000082-0000-4000-8000-0000000000b1')::text, true);
set local role authenticated;

insert into res
select '6e : une heure prévue enregistrée fait taire la phrase d''indisponibilité', '(null)',
       coalesce(public.ai_operations_snapshot((select v from ids where k='orgB'))
                -> 'nonMesurable' ->> 'tempsPrevu', '(null)');

-- ============================================================
-- 7. Les bornes
-- ============================================================

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_operations_snapshot((select v from ids where k='orgB'),
                                          current_date, current_date - 1);
  exception when others then refuse := true;
  end;
  insert into res values ('7a : une période inversée est refusée', 'true', refuse::text);
end $$;

do $$
declare refuse boolean := false;
begin
  begin
    perform public.ai_operations_snapshot((select v from ids where k='orgB'),
                                          current_date - 400, current_date);
  exception when others then refuse := true;
  end;
  insert into res values ('7b : une fenêtre de 400 jours est refusée', 'true', refuse::text);
end $$;

reset role;

select nom, attendu, obtenu,
       case when attendu is not distinct from obtenu then 'OK' else 'ÉCHEC' end as verdict
from res
order by nom;

rollback;
