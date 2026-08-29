-- Milestone 4 — les réseaux du Digital Twin, écrits comme l'éditeur web
-- les écrit.
--
-- Vérifie ce que le navigateur ne peut pas prouver tout seul :
--   1. les colonnes existent et acceptent ce que le web envoie ;
--   2. `points` garde la forme que Swift décode — [{xMeters,yMeters}] ;
--   3. le garde-fou d'espace de travail couvre les deux tables ;
--   4. modifier UNIQUEMENT un tuyau fait bouger l'horodatage de conflit
--      — c'était le bug silencieux réparé par la migration 0047 ;
--   5. une autre organisation ne voit rien.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.

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
        'authenticated','authenticated','reseaux@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','eeeeeeee-0000-4000-8000-00000000000e')::text, true);
insert into ids select 'org', public.create_professional_organization('Réseaux Test','landscaper');
insert into ids select 'ws', workspace_id from public.business_organizations
  where id = (select v from ids where k='org');

set local role authenticated;

insert into ids select 'jardin', gen_random_uuid();
insert into public.gardens (id, workspace_id, name)
select v, (select v from ids where k='ws'), 'Jardin réseaux' from ids where k='jardin';

-- Une vanne, pour servir de nœud au tuyau.
insert into ids select 'vanne', gen_random_uuid();
insert into public.garden_map_objects
  (id, workspace_id, garden_id, object_type, position_x_meters, position_y_meters,
   width_meters, height_meters)
select (select v from ids where k='vanne'), (select v from ids where k='ws'),
       (select v from ids where k='jardin'), 'valve', 0, 0, 0.3, 0.3;

-- Un arroseur avec sa portée, exactement comme le panneau l'écrit.
insert into ids select 'arroseur', gen_random_uuid();
insert into public.garden_map_objects
  (id, workspace_id, garden_id, object_type, position_x_meters, position_y_meters,
   width_meters, height_meters,
   sprinkler_radius_meters, sprinkler_start_angle_degrees,
   sprinkler_end_angle_degrees, sprinkler_flow_rate_liters_per_hour)
select (select v from ids where k='arroseur'), (select v from ids where k='ws'),
       (select v from ids where k='jardin'), 'sprinkler', 10, 5, 0.3, 0.3,
       4, 0, 180, 750;

insert into res
select 'L''arroseur garde sa portée et son secteur', '4 / 0-180 / 750',
       sprinkler_radius_meters::int || ' / ' ||
       sprinkler_start_angle_degrees::int || '-' || sprinkler_end_angle_degrees::int ||
       ' / ' || sprinkler_flow_rate_liters_per_hour::int
from public.garden_map_objects where id = (select v from ids where k='arroseur');

-- Un tuyau en L de 3 + 4 m, dans la forme que Swift encode.
insert into ids select 'tuyau', gen_random_uuid();
insert into public.irrigation_pipes
  (id, workspace_id, garden_id, points, diameter_mm, material, line_type,
   start_node_object_id)
select (select v from ids where k='tuyau'), (select v from ids where k='ws'),
       (select v from ids where k='jardin'),
       '[{"xMeters":0,"yMeters":0},{"xMeters":3,"yMeters":0},{"xMeters":3,"yMeters":4}]'::jsonb,
       25, 'pe', 'mainSupply', (select v from ids where k='vanne');

insert into res
select 'Le tuyau conserve la forme lisible par Swift', 'xMeters=3',
       'xMeters=' || (points -> 1 ->> 'xMeters')
from public.irrigation_pipes where id = (select v from ids where k='tuyau');

insert into res
select 'Diamètre, matériau et nature enregistrés', '25/pe/mainSupply',
       diameter_mm::int || '/' || material || '/' || line_type
from public.irrigation_pipes where id = (select v from ids where k='tuyau');

insert into res
select 'Le tuyau est bien relié à la vanne', 'oui',
       case when start_node_object_id = (select v from ids where k='vanne')
            then 'oui' else 'non' end
from public.irrigation_pipes where id = (select v from ids where k='tuyau');

-- Un câble, avec un espace de travail VOLONTAIREMENT faux : le
-- garde-fou de la migration 0046 doit le corriger ici aussi.
insert into ids select 'cable', gen_random_uuid();
insert into ids select 'wsFaux', gen_random_uuid();
insert into public.garden_cables
  (id, workspace_id, garden_id, points, cable_type, section_mm2)
select (select v from ids where k='cable'),
       (select v from ids where k='ws'),   -- corrigé plus bas par un update fautif
       (select v from ids where k='jardin'),
       '[{"xMeters":0,"yMeters":0},{"xMeters":6,"yMeters":0}]'::jsonb,
       'lowVoltage', 2.5;

update public.garden_cables
   set workspace_id = '00000000-0000-4000-8000-000000000001'
 where id = (select v from ids where k='cable');

insert into res
select 'Le garde-fou corrige l''espace d''un câble', 'oui',
       case when c.workspace_id = g.workspace_id then 'oui' else 'NON — fuite possible' end
from public.garden_cables c join public.gardens g on g.id = c.garden_id
where c.id = (select v from ids where k='cable');

-- LE POINT CRITIQUE : ne modifier QUE le réseau doit faire bouger
-- l'horodatage que l'éditeur consulte pour détecter un conflit.
insert into ts select 'avant', public.garden_twin_last_modified((select v from ids where k='jardin'));

update public.irrigation_pipes
   set points = '[{"xMeters":0,"yMeters":0},{"xMeters":9,"yMeters":0}]'::jsonb,
       updated_at = now() + interval '1 minute'
 where id = (select v from ids where k='tuyau');

insert into ts select 'apres', public.garden_twin_last_modified((select v from ids where k='jardin'));

insert into res
select 'Modifier un tuyau seul déclenche la détection de conflit', 'oui',
       case when (select v from ts where k='apres') > (select v from ts where k='avant')
            then 'oui' else 'NON — écrasement silencieux' end;

-- Isolement.
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('88888888-0000-4000-8000-000000000008','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','rival2@test.invalid','',now(),now(),now(),'{}','{}');
select set_config('request.jwt.claims',
  json_build_object('sub','88888888-0000-4000-8000-000000000008')::text, true);
select public.create_professional_organization('Rival réseaux','landscaper');
set local role authenticated;

insert into res select 'Un concurrent ne voit aucun tuyau', '0', count(*)::text
from public.irrigation_pipes;
insert into res select 'Un concurrent ne voit aucun câble', '0', count(*)::text
from public.garden_cables;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
