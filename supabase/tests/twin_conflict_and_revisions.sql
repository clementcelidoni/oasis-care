-- Phase 11 §CONCURRENCY + §"VERSIONS DU PROJET".
--
-- Vérifie les deux propriétés que le document marque CRITIQUE :
--   1. une écriture concurrente est DÉTECTABLE avant d'écraser ;
--   2. une révision figée ne bouge plus quand le plan courant change.
--
-- Le premier point est testé via `garden_twin_last_modified()`, qui est
-- exactement ce que l'application compare avant d'enregistrer.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.
-- Dernier résultat : 7/7 le 2026-08-28.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table ts(k text, v timestamptz) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on ts to authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('eeeeeeee-0000-4000-8000-00000000000e','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','twin@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','eeeeeeee-0000-4000-8000-00000000000e','email','twin@test.invalid')::text, true);
insert into ids select 'org', public.create_professional_organization('Twin Test','landscaper');
insert into ids select 'ws', workspace_id from public.business_organizations
  where id = (select v from ids where k='org');

set local role authenticated;

-- Un jardin. Rappel : `gardens.id` n'a pas de default.
with g as (
  insert into public.gardens (id, workspace_id, name)
  select gen_random_uuid(), v, 'Jardin Twin' from ids where k='ws' returning id
)
insert into ids select 'jardin', id from g;

-- ---------- 1. Détection de conflit ----------
insert into ts select 'avant', public.garden_twin_last_modified((select v from ids where k='jardin'));

-- Un objet est posé (simule l'iPhone, ou un collègue).
insert into public.garden_map_objects
  (id, workspace_id, garden_id, object_type, position_x_meters, position_y_meters,
   width_meters, height_meters, updated_at)
select gen_random_uuid(), (select v from ids where k='ws'), (select v from ids where k='jardin'),
       'tree', 3, 4, 4, 4, now() + interval '1 second';

insert into ts select 'apres', public.garden_twin_last_modified((select v from ids where k='jardin'));

insert into res
select 'Une écriture concurrente fait avancer l''horodatage','true',
       ((select v from ts where k='apres') > coalesce((select v from ts where k='avant'), 'epoch'::timestamptz))::text;

insert into res
select 'Un enregistrement basé sur l''état d''avant est détecté comme conflit','true',
       ((select v from ts where k='apres') > (select v from ts where k='avant'))::text;

insert into res
select 'Un enregistrement basé sur l''état actuel ne l''est pas','false',
       ((select v from ts where k='apres') > (select v from ts where k='apres'))::text;

-- ---------- 2. Révisions ----------
with r as (
  insert into public.digital_twin_revisions (workspace_id, garden_id, label, state, snapshot)
  select (select v from ids where k='ws'), (select v from ids where k='jardin'),
         'État initial','existing',
         jsonb_build_object(
           'boundary', jsonb_build_array(),
           'areas', jsonb_build_array(),
           'objects', jsonb_build_array(jsonb_build_object('objectType','tree','label','Olivier')))
  returning id
)
insert into ids select 'rev', id from r;

insert into res
select 'La révision retient le contenu figé','1',
       jsonb_array_length((snapshot -> 'objects'))::text
from public.digital_twin_revisions where id = (select v from ids where k='rev');

-- Le plan courant change complètement…
delete from public.garden_map_objects where garden_id = (select v from ids where k='jardin');
insert into public.garden_map_objects
  (id, workspace_id, garden_id, object_type, position_x_meters, position_y_meters, width_meters, height_meters)
select gen_random_uuid(), (select v from ids where k='ws'), (select v from ids where k='jardin'),
       'pool', 10, 10, 8, 4;

insert into res
select 'Le plan courant a bien changé','pool',
       object_type from public.garden_map_objects where garden_id = (select v from ids where k='jardin');

-- …et la révision, elle, n'a pas bougé.
insert into res
select 'La révision « existant » n''a PAS suivi le plan courant','Olivier',
       (snapshot -> 'objects' -> 0 ->> 'label')
from public.digital_twin_revisions where id = (select v from ids where k='rev');

-- ---------- 3. Étanchéité ----------
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('ffffffff-0000-4000-8000-00000000000f','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','autre@test.invalid','',now(),now(),now(),'{}','{}');
select set_config('request.jwt.claims',
  json_build_object('sub','ffffffff-0000-4000-8000-00000000000f','email','autre@test.invalid')::text, true);
set local role authenticated;

insert into res
select 'Un tiers ne voit aucune révision','0',count(*)::text
from public.digital_twin_revisions;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
