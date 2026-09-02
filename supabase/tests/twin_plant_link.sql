-- Phase 11 §11C : rattacher un objet du plan à une vraie plante.
--
-- Vérifie les trois choses qui peuvent silencieusement casser l'app iOS :
--   1. le lien est bien écrit dans linked_entity_id / linked_entity_kind ;
--   2. un upsert web qui OMET ces colonnes ne les efface pas — c'est ce
--      qui serait arrivé aux liens posés depuis l'iPhone ;
--   3. linked_entity_kind ne prend que des valeurs que Swift sait
--      décoder (GardenObjectLinkKind : plant | sensor).
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
values ('ffffffff-0000-4000-8000-00000000000f','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','twin@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','ffffffff-0000-4000-8000-00000000000f')::text, true);
insert into ids select 'org', public.create_professional_organization('Twin Test','landscaper');
insert into ids select 'ws', workspace_id from public.business_organizations
  where id = (select v from ids where k='org');

set local role authenticated;

-- Un jardin et une plante réelle, comme l'iPhone les crée (id fourni).
insert into ids select 'jardin', gen_random_uuid();
insert into public.gardens (id, workspace_id, name)
select v, (select v from ids where k='ws'), 'Jardin lié' from ids where k='jardin';

insert into ids select 'plante', gen_random_uuid();
-- `type` est NOT NULL sans défaut : l'app iOS le renseigne toujours.
insert into public.plants (id, workspace_id, garden_id, custom_name, common_name, type)
select (select v from ids where k='plante'), (select v from ids where k='ws'),
       (select v from ids where k='jardin'), 'Olivier du fond', 'Olivier', 'tree';

-- Un objet du plan, rattaché à cette plante.
insert into ids select 'objet', gen_random_uuid();
insert into public.garden_map_objects
  (id, workspace_id, garden_id, object_type, position_x_meters, position_y_meters,
   width_meters, height_meters, linked_entity_id, linked_entity_kind)
select (select v from ids where k='objet'), (select v from ids where k='ws'),
       (select v from ids where k='jardin'), 'tree', 3, 4, 4, 4,
       (select v from ids where k='plante'), 'plant';

insert into res
select 'Le lien est écrit', 'plant', coalesce(linked_entity_kind, 'NULL')
from public.garden_map_objects where id = (select v from ids where k='objet');

insert into res
select 'Le lien pointe vers la bonne plante', 'Olivier du fond',
       coalesce((select p.custom_name from public.plants p
                 join public.garden_map_objects o on o.linked_entity_id = p.id
                 where o.id = (select v from ids where k='objet')), 'INTROUVABLE');

-- Le point critique : un upsert web qui omet les colonnes de lien.
insert into public.garden_map_objects
  (id, workspace_id, garden_id, object_type, position_x_meters, position_y_meters,
   width_meters, height_meters)
select (select v from ids where k='objet'), (select v from ids where k='ws'),
       (select v from ids where k='jardin'), 'tree', 9, 9, 4, 4
on conflict (id) do update set
  position_x_meters = excluded.position_x_meters,
  position_y_meters = excluded.position_y_meters;

insert into res
select 'Déplacer l''objet ne casse pas le lien', 'plant',
       coalesce(linked_entity_kind, '>>> EFFACÉ <<<')
from public.garden_map_objects where id = (select v from ids where k='objet');

insert into res
select 'Le déplacement a bien eu lieu', '9', position_x_meters::int::text
from public.garden_map_objects where id = (select v from ids where k='objet');

-- Une plante d'une autre organisation ne doit pas être proposée.
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('99999999-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','rival@test.invalid','',now(),now(),now(),'{}','{}');
select set_config('request.jwt.claims',
  json_build_object('sub','99999999-0000-4000-8000-000000000009')::text, true);
insert into ids select 'orgRivale', public.create_professional_organization('Rival','landscaper');
set local role authenticated;

insert into res
select 'Un concurrent ne voit aucune de ces plantes', '0', count(*)::text
from public.plants;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
