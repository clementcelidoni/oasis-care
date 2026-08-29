-- Milestone 7 — pointage des heures et coût réel de main-d'œuvre.
--
-- Ce que ces tests surveillent, dans l'ordre d'importance :
--   1. pointer deux fois le même soir ne double pas les heures ;
--   2. un pointage non validé ne compte pas dans le budget ;
--   3. le coût horaire est photographié, pas relu ;
--   4. trajets et pauses ne sont pas facturés au chantier ;
--   5. un concurrent ne voit aucun salaire.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('77777771-0000-4000-8000-000000000071','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','equipe@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','77777771-0000-4000-8000-000000000071')::text, true);
insert into ids select 'org', public.create_professional_organization('Terrain Test','landscaper');

set local role authenticated;

-- Un chantier, une équipe de deux, une intervention.
insert into ids select 'client', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name)
select (select v from ids where k='client'), (select v from ids where k='org'), 'customer', 'Client Terrain';

insert into ids select 'projet', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name)
select (select v from ids where k='projet'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_project_number((select v from ids where k='org')), 'Chantier terrain';

-- 25,00 €/h et 30,00 €/h de coût entreprise.
insert into ids select 'ouvrier1', gen_random_uuid();
insert into public.employees (id, organization_id, first_name, last_name, hourly_cost_cents)
select (select v from ids where k='ouvrier1'), (select v from ids where k='org'), 'Marc', 'Ouvrier', 2500;

insert into ids select 'ouvrier2', gen_random_uuid();
insert into public.employees (id, organization_id, first_name, last_name, hourly_cost_cents)
select (select v from ids where k='ouvrier2'), (select v from ids where k='org'), 'Sofia', 'Chef', 3000;

insert into ids select 'equipe', gen_random_uuid();
insert into public.teams (id, organization_id, name)
select (select v from ids where k='equipe'), (select v from ids where k='org'), 'Équipe A';

insert into public.team_members (team_id, employee_id, organization_id)
select (select v from ids where k='equipe'), (select v from ids where k='ouvrier1'), (select v from ids where k='org');
insert into public.team_members (team_id, employee_id, organization_id)
select (select v from ids where k='equipe'), (select v from ids where k='ouvrier2'), (select v from ids where k='org');

insert into ids select 'inter', gen_random_uuid();
insert into public.field_interventions
  (id, organization_id, project_id, team_id, title, scheduled_start, scheduled_end)
select (select v from ids where k='inter'), (select v from ids where k='org'),
       (select v from ids where k='projet'), (select v from ids where k='equipe'),
       'Plantation massif', now(), now() + interval '7 hours';

-- ============================================================
-- Pointage d'équipe
-- ============================================================
insert into res
select 'Pointer l''équipe crée une ligne par salarié', '2',
       public.log_team_time((select v from ids where k='inter'), 7)::text;

insert into res
select 'Chacun garde SON coût horaire', '2500/3000',
       (select hourly_cost_cents from public.time_entries
         where employee_id = (select v from ids where k='ouvrier1'))::text || '/' ||
       (select hourly_cost_cents from public.time_entries
         where employee_id = (select v from ids where k='ouvrier2'))::text;

-- LE TEST QUI COMPTE. Le chef d'équipe se reprend : 8 h, pas 7.
insert into res
select 'Repointer le même soir corrige au lieu de doubler', '2',
       public.log_team_time((select v from ids where k='inter'), 8)::text;

insert into res
select 'Et il n''y a toujours que deux lignes', '2', count(*)::text
from public.time_entries where intervention_id = (select v from ids where k='inter');

insert into res
select 'Les heures ont bien été corrigées', '8',
       max(hours)::int::text
from public.time_entries where intervention_id = (select v from ids where k='inter');

-- ============================================================
-- Un pointage non validé ne coûte rien
-- ============================================================
insert into res
select 'Non validé, le pointage ne touche pas le budget', '0',
       coalesce((select actual_cents::text from public.project_cost_summary
                 where project_id = (select v from ids where k='projet') and kind = 'labor'), '0');

insert into res
select 'Mais il est visible en attente', '16',
       pending_hours::int::text
from public.project_labor_from_time where project_id = (select v from ids where k='projet');

update public.time_entries set validated = true
 where intervention_id = (select v from ids where k='inter');

-- 8 h x 25,00 + 8 h x 30,00 = 200,00 + 240,00 = 440,00 €.
insert into res
select 'Validé, il entre dans le coût de main-d''œuvre', '44000',
       actual_cents::text
from public.project_cost_summary
where project_id = (select v from ids where k='projet') and kind = 'labor';

-- ============================================================
-- Trajets et pauses ne sont pas du chantier
-- ============================================================
insert into public.time_entries
  (organization_id, employee_id, intervention_id, project_id, hours, hourly_cost_cents, kind, validated)
select (select v from ids where k='org'), (select v from ids where k='ouvrier1'),
       (select v from ids where k='inter'), (select v from ids where k='projet'),
       2, 2500, 'travel', true;

insert into res
select 'Le trajet n''est pas imputé au chantier', '44000',
       actual_cents::text
from public.project_cost_summary
where project_id = (select v from ids where k='projet') and kind = 'labor';

-- ============================================================
-- Une augmentation ne renchérit pas le passé
-- ============================================================
update public.employees set hourly_cost_cents = 4000
 where id = (select v from ids where k='ouvrier1');

insert into res
select 'Augmenter quelqu''un ne change pas les chantiers passés', '44000',
       actual_cents::text
from public.project_cost_summary
where project_id = (select v from ids where k='projet') and kind = 'labor';

-- ============================================================
-- L'heure survit à la suppression de son intervention
-- ============================================================
delete from public.field_interventions where id = (select v from ids where k='inter');

insert into res
select 'Supprimer l''intervention ne perd pas les heures', '44000',
       actual_cents::text
from public.project_cost_summary
where project_id = (select v from ids where k='projet') and kind = 'labor';

-- ============================================================
-- Isolement
-- ============================================================
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('77777772-0000-4000-8000-000000000072','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','rival4@test.invalid','',now(),now(),now(),'{}','{}');
select set_config('request.jwt.claims',
  json_build_object('sub','77777772-0000-4000-8000-000000000072')::text, true);
select public.create_professional_organization('Rival terrain','landscaper');
set local role authenticated;

insert into res select 'Un concurrent ne voit aucun salarié', '0', count(*)::text from public.employees;
insert into res select 'Ni aucun pointage', '0', count(*)::text from public.time_entries;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
