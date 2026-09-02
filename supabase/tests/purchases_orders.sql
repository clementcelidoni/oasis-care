-- Milestone 9 — achats, réceptions, commandes clients, livraisons.
--
-- Ce que ces tests surveillent :
--   1. l'état d'une commande se déduit des réceptions, jamais de la
--      main de quelqu'un qui oublierait de le changer ;
--   2. un lot n'est créé QUE si on le demande — §"après validation" ;
--   3. livrer consomme la réservation au lieu de s'y ajouter, sinon un
--      stock déjà parti resterait bloqué ;
--   4. « attendu » ne compte que les commandes réellement envoyées.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
create temp table txt(k text, v text) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;
grant all on txt to authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('99999991-0000-4000-8000-000000000091','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','achats@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','99999991-0000-4000-8000-000000000091')::text, true);
insert into ids select 'org', public.create_professional_organization('Achats Test','landscaperAndNursery');

set local role authenticated;

insert into ids select 'fournisseur', gen_random_uuid();
insert into public.suppliers (id, organization_id, name)
select (select v from ids where k='fournisseur'), (select v from ids where k='org'), 'Pépinières du Sud';

insert into ids select 'serre', gen_random_uuid();
insert into public.nursery_locations (id, organization_id, code, name, kind)
select (select v from ids where k='serre'), (select v from ids where k='org'), 'S1', 'Serre 1', 'greenhouse';

-- ============================================================
-- Une commande fournisseur de 100 oliviers
-- ============================================================
insert into ids select 'commande', gen_random_uuid();
insert into public.purchase_orders (id, organization_id, supplier_id, number, status)
select (select v from ids where k='commande'), (select v from ids where k='org'),
       (select v from ids where k='fournisseur'),
       public.next_document_number((select v from ids where k='org'), 'purchase', 'CF'),
       'draft';

insert into ids select 'ligne', gen_random_uuid();
insert into public.purchase_order_lines
  (id, organization_id, purchase_order_id, description, unit, quantity,
   unit_cost_cents, is_plant, species_name, container_size)
select (select v from ids where k='ligne'), (select v from ids where k='org'),
       (select v from ids where k='commande'), 'Olivier C10', 'u', 100,
       4500, true, 'Olea europaea', 'C10';

insert into res
select 'Le numéro suit le format attendu', 'CF-' || extract(year from current_date)::int::text || '-0001',
       number from public.purchase_orders where id = (select v from ids where k='commande');

-- Un BROUILLON ne doit rien annoncer au stock prévisionnel.
insert into res
select 'Un brouillon ne gonfle pas l''attendu', '0',
       coalesce((select expected::text from public.nursery_stock
                 where species_name = 'Olea europaea'), '0');

update public.purchase_orders set status = 'sent', sent_at = now()
 where id = (select v from ids where k='commande');

insert into res
select 'Une fois envoyée, 100 sont attendus', '100',
       expected::text from public.nursery_stock where species_name = 'Olea europaea';

insert into res
select 'Mais rien n''est encore physiquement là', '0',
       physical::text from public.nursery_stock where species_name = 'Olea europaea';

-- ============================================================
-- Réception partielle, SANS créer de lot
-- ============================================================
insert into ids select 'reception1', gen_random_uuid();
insert into public.goods_receipts (id, organization_id, purchase_order_id, delivery_note_reference)
select (select v from ids where k='reception1'), (select v from ids where k='org'),
       (select v from ids where k='commande'), 'BL-4471';

insert into res
select 'Réceptionner sans le demander ne crée aucun lot', 'aucun',
       coalesce(public.receive_purchase_line(
         (select v from ids where k='reception1'), (select v from ids where k='ligne'), 40
       )::text, 'aucun');

insert into res
select 'La commande passe en partiellement reçue', 'partiallyReceived',
       status from public.purchase_orders where id = (select v from ids where k='commande');

insert into res
select 'Il reste 60 à recevoir', '60', remaining::int::text
from public.purchase_order_progress where line_id = (select v from ids where k='ligne');

insert into res
select 'L''attendu retombe à 60', '60',
       expected::text from public.nursery_stock where species_name = 'Olea europaea';

-- ============================================================
-- Réception du reste, EN créant le lot — §« après validation »
-- ============================================================
insert into ids select 'reception2', gen_random_uuid();
insert into public.goods_receipts (id, organization_id, purchase_order_id, delivery_note_reference)
select (select v from ids where k='reception2'), (select v from ids where k='org'),
       (select v from ids where k='commande'), 'BL-4488';

insert into ids select 'lot', public.receive_purchase_line(
  (select v from ids where k='reception2'), (select v from ids where k='ligne'), 60,
  true, 'OLE-2026-001', (select v from ids where k='serre'));

insert into res
select 'Demandé, le lot est créé', 'OLE-2026-001',
       coalesce((select lot_code from public.nursery_lots
                 where id = (select v from ids where k='lot')), 'AUCUN');

insert into res
select 'Il porte la quantité reçue', '60',
       current_quantity::text from public.nursery_lots where id = (select v from ids where k='lot');

insert into res
select 'Sa quantité est entrée par un mouvement', 'receive',
       coalesce((select kind from public.nursery_stock_movements
                 where lot_id = (select v from ids where k='lot') limit 1), 'AUCUN');

insert into res
select 'Il garde le lien vers le bordereau du fournisseur', 'BL-4488',
       coalesce((select supplier_lot_reference from public.nursery_lots
                 where id = (select v from ids where k='lot')), 'PERDU');

insert into res
select 'La commande est soldée', 'received',
       status from public.purchase_orders where id = (select v from ids where k='commande');

insert into res
select 'Et l''attendu retombe à zéro', '0',
       expected::text from public.nursery_stock where species_name = 'Olea europaea';

insert into res
select 'Le physique vaut ce qui a été mis en lot', '60',
       physical::text from public.nursery_stock where species_name = 'Olea europaea';

-- Une ligne de fourniture ne peut pas devenir un lot de pépinière.
insert into ids select 'lignePot', gen_random_uuid();
insert into public.purchase_order_lines
  (id, organization_id, purchase_order_id, description, unit, quantity, unit_cost_cents, is_plant)
select (select v from ids where k='lignePot'), (select v from ids where k='org'),
       (select v from ids where k='commande'), 'Pots C10', 'u', 200, 120, false;

do $$
declare ok boolean := false;
begin
  begin
    perform public.receive_purchase_line(
      (select v from ids where k='reception2'), (select v from ids where k='lignePot'), 200,
      true, 'POT-001', null);
  exception when others then ok := true;
  end;
  insert into res select 'Des pots ne deviennent pas un lot de végétaux', 'refuse',
    case when ok then 'refuse' else 'ACCEPTÉ' end;
end $$;

-- ============================================================
-- Commande client : réserver puis livrer
-- ============================================================
update public.nursery_lots set status = 'available' where id = (select v from ids where k='lot');

insert into ids select 'client', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name)
select (select v from ids where k='client'), (select v from ids where k='org'), 'customer', 'Client Vente';

insert into ids select 'vente', gen_random_uuid();
insert into public.sales_orders (id, organization_id, customer_id, number, status)
select (select v from ids where k='vente'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_document_number((select v from ids where k='org'), 'sales', 'CC'),
       'confirmed';

insert into ids select 'ligneVente', gen_random_uuid();
insert into public.sales_order_lines
  (id, organization_id, sales_order_id, lot_id, description, unit, quantity, unit_sale_price_cents)
select (select v from ids where k='ligneVente'), (select v from ids where k='org'),
       (select v from ids where k='vente'), (select v from ids where k='lot'),
       'Olivier C10', 'u', 25, 12000;

-- On réserve les 25 promis.
select public.record_nursery_movement(
  (select v from ids where k='lot'), 'reserve', 25, null, 'Commande client');

insert into res
select 'Réservé, le physique reste à 60', '60',
       physical::text from public.nursery_stock where species_name = 'Olea europaea';

insert into res
select 'Et le disponible tombe à 35', '35',
       available::text from public.nursery_stock where species_name = 'Olea europaea';

-- LA LIVRAISON.
insert into ids select 'livraison', gen_random_uuid();
insert into public.deliveries (id, organization_id, sales_order_id, number)
select (select v from ids where k='livraison'), (select v from ids where k='org'),
       (select v from ids where k='vente'),
       public.next_document_number((select v from ids where k='org'), 'delivery', 'BL');

select public.deliver_sales_order_line(
  (select v from ids where k='livraison'), (select v from ids where k='ligneVente'), 25);

insert into res
select 'Livrer fait enfin sortir le physique', '35',
       physical::text from public.nursery_stock where species_name = 'Olea europaea';

-- LE TEST QUI COMPTE : la livraison consomme la réservation. Si elle
-- s'y ajoutait, 25 unités resteraient bloquées sur un stock déjà parti.
insert into res
select 'La livraison consomme la réservation, elle ne la laisse pas', '0',
       reserved::text from public.nursery_stock where species_name = 'Olea europaea';

insert into res
select 'Le disponible redevient le physique entier', '35',
       available::text from public.nursery_stock where species_name = 'Olea europaea';

insert into res
select 'La commande passe en livrée', 'delivered',
       status from public.sales_orders where id = (select v from ids where k='vente');

-- On ne livre pas plus que commandé.
do $$
declare ok boolean := false;
begin
  begin
    perform public.deliver_sales_order_line(
      (select v from ids where k='livraison'), (select v from ids where k='ligneVente'), 10);
  exception when others then ok := true;
  end;
  insert into res select 'On ne livre pas au-delà de la commande', 'refuse',
    case when ok then 'refuse' else 'ACCEPTÉ' end;
end $$;

-- ============================================================
-- Isolement
-- ============================================================
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('99999992-0000-4000-8000-000000000092','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','rival6@test.invalid','',now(),now(),now(),'{}','{}');
select set_config('request.jwt.claims',
  json_build_object('sub','99999992-0000-4000-8000-000000000092')::text, true);
select public.create_professional_organization('Rival achats','nursery');
set local role authenticated;

insert into res select 'Un concurrent ne voit aucune commande', '0', count(*)::text
from public.purchase_orders;
insert into res select 'Ni aucune livraison', '0', count(*)::text from public.deliveries;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
