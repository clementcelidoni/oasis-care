-- Milestone 8 — stock vivant de pépinière.
--
-- Un seul invariant gouverne ces tests, et c'est la phrase du
-- document : « Ne pas confondre stock physique et disponible à vendre. »
-- Le confondre, c'est soit vendre deux fois la même plante, soit
-- refuser une commande qu'on pouvait honorer.
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
values ('88888881-0000-4000-8000-000000000081','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','pepiniere@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','88888881-0000-4000-8000-000000000081')::text, true);
insert into ids select 'org', public.create_professional_organization('Pépinière Test','nursery');

set local role authenticated;

insert into ids select 'serre', gen_random_uuid();
insert into public.nursery_locations (id, organization_id, code, name, kind, capacity)
select (select v from ids where k='serre'), (select v from ids where k='org'),
       'S2', 'Serre 2', 'greenhouse', 500;

insert into ids select 'quarantaine', gen_random_uuid();
insert into public.nursery_locations (id, organization_id, code, name, kind)
select (select v from ids where k='quarantaine'), (select v from ids where k='org'),
       'Q1', 'Quarantaine', 'quarantine';

-- 200 Trachycarpus disponibles.
insert into ids select 'lot', gen_random_uuid();
insert into public.nursery_lots
  (id, organization_id, lot_code, species_name, container_size,
   initial_quantity, current_quantity, status, location_id)
select (select v from ids where k='lot'), (select v from ids where k='org'),
       'TRA-2026-001', 'Trachycarpus fortunei', 'C10',
       200, 200, 'available', (select v from ids where k='serre');

-- ============================================================
-- LE TEST CENTRAL — réserver ne touche pas le physique
-- ============================================================
select public.record_nursery_movement(
  (select v from ids where k='lot'), 'reserve', 100, null, 'Commande client');

insert into res
select 'Réserver 100 laisse le physique à 200', '200', physical::text
from public.nursery_stock where species_name = 'Trachycarpus fortunei';

insert into res
select 'Mais le disponible tombe à 100', '100', available::text
from public.nursery_stock where species_name = 'Trachycarpus fortunei';

insert into res
select 'Et le réservé vaut 100', '100', reserved::text
from public.nursery_stock where species_name = 'Trachycarpus fortunei';

-- On ne peut pas réserver deux fois le même stock.
do $$
declare ok boolean := false;
begin
  begin
    perform public.record_nursery_movement(
      (select v from ids where k='lot'), 'reserve', 150, null, 'Deuxième client');
  exception when others then ok := true;
  end;
  insert into res select 'On ne réserve pas au-delà du disponible', 'refuse',
    case when ok then 'refuse' else 'ACCEPTÉ — survente' end;
end $$;

-- Réserver le reste, exactement, doit passer.
select public.record_nursery_movement(
  (select v from ids where k='lot'), 'reserve', 100, null, 'Le reste');

insert into res
select 'Réserver jusqu''au dernier est permis', '0', available::text
from public.nursery_stock where species_name = 'Trachycarpus fortunei';

-- ============================================================
-- La sortie réelle
-- ============================================================
select public.record_nursery_movement(
  (select v from ids where k='lot'), 'sell', 100, null, 'Livraison');

insert into res
select 'Vendre 100 fait enfin baisser le physique', '100', physical::text
from public.nursery_stock where species_name = 'Trachycarpus fortunei';

insert into res
select 'La vente consomme la réservation, elle ne s''y ajoute pas', '100',
       reserved::text
from public.nursery_stock where species_name = 'Trachycarpus fortunei';

-- ============================================================
-- On ne vend pas ce qu'on n'a pas
-- ============================================================
do $$
declare ok boolean := false;
begin
  begin
    perform public.record_nursery_movement(
      (select v from ids where k='lot'), 'sell', 500, null, 'Commande impossible');
  exception when others then ok := true;
  end;
  insert into res select 'On ne vend pas plus que le stock', 'refuse',
    case when ok then 'refuse' else 'ACCEPTÉ — stock négatif' end;
end $$;

-- ============================================================
-- Chaque geste laisse une trace
-- ============================================================
-- Trois gestes ont réussi — deux réservations et une vente — et un a
-- été refusé. Le refusé ne doit avoir laissé AUCUNE ligne : le
-- mouvement et son effet sont écrits dans la même opération, donc
-- l'exception annule les deux. Un journal qui garderait la trace d'un
-- geste sans effet serait pire qu'un journal incomplet.
insert into res
select 'Un mouvement refusé ne laisse aucune trace', '3', count(*)::text
from public.nursery_stock_movements where lot_id = (select v from ids where k='lot');

insert into res
select 'Le journal garde le type de chaque geste', 'reserve,reserve,sell',
       string_agg(kind, ',' order by occurred_at)
from public.nursery_stock_movements
where lot_id = (select v from ids where k='lot') and kind in ('reserve','sell');

-- ============================================================
-- Quarantaine : le stock sort du disponible sans disparaître
-- ============================================================
select public.record_nursery_movement(
  (select v from ids where k='lot'), 'quarantine', 0,
  (select v from ids where k='quarantaine'), 'Suspicion de charançon');

insert into res
select 'La quarantaine retire du disponible', '0', available::text
from public.nursery_stock where species_name = 'Trachycarpus fortunei';

insert into res
select 'Sans faire disparaître les plantes', '100', physical::text
from public.nursery_stock where species_name = 'Trachycarpus fortunei';

insert into res
select 'Qui apparaissent bien en quarantaine', '100', quarantine::text
from public.nursery_stock where species_name = 'Trachycarpus fortunei';

insert into res
select 'Et le lot a changé d''emplacement', 'Quarantaine',
       coalesce((select loc.name from public.nursery_locations loc
                 join public.nursery_lots l on l.location_id = loc.id
                 where l.id = (select v from ids where k='lot')), 'AUCUN');

select public.record_nursery_movement(
  (select v from ids where k='lot'), 'release', 0, (select v from ids where k='serre'), 'Rien trouvé');

-- ============================================================
-- Scinder un lot garde la filiation
-- ============================================================
-- Il reste 100 dont 100 réservés : on libère avant de scinder.
select public.record_nursery_movement(
  (select v from ids where k='lot'), 'unreserve', 100, null, 'Commande annulée');

insert into ids select 'enfant', public.split_nursery_lot(
  (select v from ids where k='lot'), 40, 'TRA-2026-001-B', (select v from ids where k='serre'));

insert into res
select 'Le lot parent a été allégé', '60', current_quantity::text
from public.nursery_lots where id = (select v from ids where k='lot');

insert into res
select 'Le lot détaché porte la quantité', '40', current_quantity::text
from public.nursery_lots where id = (select v from ids where k='enfant');

insert into res
select 'Le total physique est inchangé par la scission', '100', physical::text
from public.nursery_stock where species_name = 'Trachycarpus fortunei';

insert into res
select 'La filiation remonte au parent', 'TRA-2026-001',
       coalesce((select p.lot_code from public.nursery_lots p
                 join public.nursery_lots c on c.parent_lot_id = p.id
                 where c.id = (select v from ids where k='enfant')), 'PERDUE');

-- ============================================================
-- Occupation de l'emplacement
-- ============================================================
insert into res
select 'L''occupation de la serre est comptée sur les lots', '100',
       occupied::text
from public.nursery_location_occupation where location_id = (select v from ids where k='serre');

insert into res
select 'Et exprimée en pourcentage de sa capacité', '20',
       occupation_percent::int::text
from public.nursery_location_occupation where location_id = (select v from ids where k='serre');

-- ============================================================
-- Le jeton QR n'expose rien
-- ============================================================
insert into res
select 'Chaque lot reçoit un jeton aléatoire', '32',
       length(public_token)::text
from public.nursery_lots where id = (select v from ids where k='lot');

insert into res
select 'Deux lots n''ont jamais le même', 'differents',
       case when (select public_token from public.nursery_lots where id = (select v from ids where k='lot'))
              <> (select public_token from public.nursery_lots where id = (select v from ids where k='enfant'))
            then 'differents' else 'IDENTIQUES' end;

-- ============================================================
-- Isolement
-- ============================================================
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('88888882-0000-4000-8000-000000000082','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','rival5@test.invalid','',now(),now(),now(),'{}','{}');
select set_config('request.jwt.claims',
  json_build_object('sub','88888882-0000-4000-8000-000000000082')::text, true);
select public.create_professional_organization('Rival pépinière','nursery');
set local role authenticated;

insert into res select 'Un concurrent ne voit aucun lot', '0', count(*)::text from public.nursery_lots;
insert into res select 'Ni aucun mouvement', '0', count(*)::text from public.nursery_stock_movements;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
