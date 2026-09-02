-- LA FACTURE DOIT RETOMBER SUR LE DEVIS ACCEPTÉ.
--
-- Et trois autres chiffres que la revue a trouvés faux : le chiffre
-- d'affaires qui ignorait les avoirs, la marge qui comptait un chantier
-- sans devis comme « vendu 0 € », et une inspection défavorable que
-- l'assistant ne voyait jamais.
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
values ('bbbbbbb8-0000-4000-8000-0000000000b8','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','conforme@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','bbbbbbb8-0000-4000-8000-0000000000b8')::text, true);
insert into ids select 'org', public.create_professional_organization('Conforme SARL','landscaperAndNursery');
set local role authenticated;

insert into ids select 'client', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name)
select (select v from ids where k='client'), (select v from ids where k='org'), 'customer', 'Client';

-- ============================================================
-- 1. LE CAS PATHOLOGIQUE : un article à un centime, par milliers
-- ============================================================
-- Un godet à 0,01 € commandé par mille, remise 33 %.
--   attendu : round(1 000 × 0,67) = 670 centimes
--   ancien  : round(1 × 0,67) = 1 centime unitaire × 1 000 = 1 000
-- La remise disparaissait entièrement.
insert into ids select 'devis', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           global_discount_percent)
select (select v from ids where k='devis'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_quote_number((select v from ids where k='org')),
       'Godets', 'accepted', 33;

insert into public.quote_lines
  (organization_id, quote_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, vat_rate, position)
select (select v from ids where k='org'), (select v from ids where k='devis'),
       'Godet 9 cm', 'u', 1000, 1, 1, 20, 0;

insert into ids select 'facture', public.create_invoice_from_quote((select v from ids where k='devis'));

insert into res
select 'Le devis vaut 670 centimes HT', '670',
       (select total_excluding_vat_cents::text from public.quote_totals
        where quote_id = (select v from ids where k='devis'));

insert into res
select 'La facture retombe exactement dessus', '670',
       (select total_excluding_vat_cents::text from public.invoice_totals
        where invoice_id = (select v from ids where k='facture'));

-- Et le PRIX UNITAIRE recopié est celui que le client a accepté, pas un
-- prix remisé fabriqué pour l'occasion.
insert into res
select 'Le prix unitaire de la facture est celui du devis', '1',
       (select unit_price_cents::text from public.invoice_lines
        where invoice_id = (select v from ids where k='facture') limit 1);

insert into res
select 'La remise a voyagé avec la facture', '33.00',
       (select global_discount_percent::text from public.invoices
        where id = (select v from ids where k='facture'));

-- ============================================================
-- 2. Un devis ordinaire, à plusieurs taux
-- ============================================================
insert into ids select 'devis2', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status,
                           global_discount_percent)
select (select v from ids where k='devis2'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_quote_number((select v from ids where k='org')),
       'Jardin complet', 'accepted', 10;

insert into public.quote_lines
  (organization_id, quote_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, vat_rate, position)
values
  ((select v from ids where k='org'), (select v from ids where k='devis2'),
   'Main-d''œuvre', 'h', 3, 2000, 3330, 20, 0),
  ((select v from ids where k='org'), (select v from ids where k='devis2'),
   'Végétaux', 'u', 7, 800, 1470, 5.5, 1);

insert into ids select 'facture2', public.create_invoice_from_quote((select v from ids where k='devis2'));

insert into res
select 'Devis et facture rendent le même HT', 'true',
       ((select total_excluding_vat_cents from public.quote_totals
         where quote_id = (select v from ids where k='devis2'))
        = (select total_excluding_vat_cents from public.invoice_totals
           where invoice_id = (select v from ids where k='facture2')))::text;

insert into res
select 'La même TVA', 'true',
       ((select total_vat_cents from public.quote_totals
         where quote_id = (select v from ids where k='devis2'))
        = (select total_vat_cents from public.invoice_totals
           where invoice_id = (select v from ids where k='facture2')))::text;

insert into res
select 'Et le même TTC', 'true',
       ((select total_including_vat_cents from public.quote_totals
         where quote_id = (select v from ids where k='devis2'))
        = (select total_including_vat_cents from public.invoice_totals
           where invoice_id = (select v from ids where k='facture2')))::text;

-- Une facture sans remise n'est pas affectée par le correctif.
insert into ids select 'facture3', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, status, issued_on)
select (select v from ids where k='facture3'), (select v from ids where k='org'),
       (select v from ids where k='client'), 'draft', current_date;
insert into public.invoice_lines
  (organization_id, invoice_id, position, description, unit, quantity, unit_price_cents, vat_rate)
select (select v from ids where k='org'), (select v from ids where k='facture3'),
       0, 'Prestation', 'u', 1, 10000, 20;

insert into res
select 'Sans remise, rien ne change', '10000|2000',
       (select total_excluding_vat_cents::text || '|' || total_vat_cents::text
        from public.invoice_totals where invoice_id = (select v from ids where k='facture3'));

-- ============================================================
-- 3. Le chiffre d'affaires et les avoirs
-- ============================================================
-- Les lignes AVANT l'émission : le déclencheur `protect_issued_invoice_lines`
-- (Milestone 10) interdit de toucher aux lignes d'une facture émise, et
-- il a raison — c'est ce qui rend une facture opposable.
insert into ids select 'factureCA', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, number, status, issued_on)
select (select v from ids where k='factureCA'), (select v from ids where k='org'),
       (select v from ids where k='client'), 'FAC-TEST-900', 'draft', current_date;
insert into public.invoice_lines
  (organization_id, invoice_id, position, description, unit, quantity, unit_price_cents, vat_rate)
select (select v from ids where k='org'), (select v from ids where k='factureCA'),
       0, 'Chantier', 'u', 1, 1000000, 20;
update public.invoices set status = 'issued', issued_at = now()
 where id = (select v from ids where k='factureCA');

insert into res
select 'Le CA compte la facture émise', '1000000',
       (select revenue_cents::text from public.pro_analytics_landscaper(
          (select v from ids where k='org'), current_date - 1, current_date + 1));

-- L'avoir, émis, doit se déduire.
insert into ids select 'avoirCA', gen_random_uuid();
insert into public.credit_notes (id, organization_id, invoice_id, customer_id, number,
                                 issued_on, issued_at)
select (select v from ids where k='avoirCA'), (select v from ids where k='org'),
       (select v from ids where k='factureCA'), (select v from ids where k='client'),
       'AV-TEST-900', current_date, now();
insert into public.credit_note_lines
  (organization_id, credit_note_id, position, description, unit, quantity, unit_price_cents, vat_rate)
select (select v from ids where k='org'), (select v from ids where k='avoirCA'),
       0, 'Annulation', 'u', 1, 400000, 20;

insert into res
select 'L''avoir se déduit du chiffre d''affaires', '600000',
       (select revenue_cents::text from public.pro_analytics_landscaper(
          (select v from ids where k='org'), current_date - 1, current_date + 1));

-- ============================================================
-- 4. La marge d'un chantier sans devis
-- ============================================================
-- Un chantier terminé, avec des coûts, RATTACHÉ À UN DEVIS.
insert into ids select 'devisM', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status)
select (select v from ids where k='devisM'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_quote_number((select v from ids where k='org')), 'Chantier vendu', 'accepted';
insert into public.quote_lines
  (organization_id, quote_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, vat_rate, position)
select (select v from ids where k='org'), (select v from ids where k='devisM'),
       'Travaux', 'forfait', 1, 6000, 10000, 20, 0;

insert into ids select 'chantierVendu', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, quote_id, number, name,
                             status, actual_end_on)
select (select v from ids where k='chantierVendu'), (select v from ids where k='org'),
       (select v from ids where k='client'), (select v from ids where k='devisM'),
       public.next_project_number((select v from ids where k='org')),
       'Chantier vendu', 'completed', current_date;
insert into public.project_costs
  (organization_id, project_id, kind, description, quantity, unit_cost_cents)
select (select v from ids where k='org'), (select v from ids where k='chantierVendu'),
       'plant', 'Végétaux', 1, 6000;

insert into res
select 'La marge du chantier vendu est un taux de marque de 40 %', '40.0',
       (select project_margin_percent::text from public.pro_analytics_landscaper(
          (select v from ids where k='org'), current_date - 1, current_date + 1));

-- Le même chantier terminé, avec des coûts, SANS DEVIS. C'est lui qui
-- tirait la marge à −56 % sur des données réelles.
insert into ids select 'chantierSansDevis', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name,
                             status, actual_end_on)
select (select v from ids where k='chantierSansDevis'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_project_number((select v from ids where k='org')),
       'Chantier jamais chiffré', 'completed', current_date;
insert into public.project_costs
  (organization_id, project_id, kind, description, quantity, unit_cost_cents)
select (select v from ids where k='org'), (select v from ids where k='chantierSansDevis'),
       'plant', 'Végétaux', 1, 50000;

insert into res
select 'Un chantier sans devis ne fausse plus la marge', '40.0',
       (select project_margin_percent::text from public.pro_analytics_landscaper(
          (select v from ids where k='org'), current_date - 1, current_date + 1));

insert into res
select 'Mais il est compté à part, pour qu''on puisse le dire', '1',
       (select projects_without_quote::text from public.pro_analytics_landscaper(
          (select v from ids where k='org'), current_date - 1, current_date + 1));

insert into res
select 'Et il n''entre pas dans le nombre de chantiers mesurés', '1',
       (select projects_measured::text from public.pro_analytics_landscaper(
          (select v from ids where k='org'), current_date - 1, current_date + 1));

-- ============================================================
-- 5. L'inspection « problem », que l'assistant ne voyait pas
-- ============================================================
insert into ids select 'lot', gen_random_uuid();
insert into public.nursery_lots
  (id, organization_id, lot_code, species_name, container_size,
   initial_quantity, current_quantity, status)
select (select v from ids where k='lot'), (select v from ids where k='org'),
       'LOT-INSP-001', 'Pittosporum tobira', 'C5', 100, 100, 'available';

insert into public.nursery_inspections
  (organization_id, lot_id, inspected_on, result, findings)
select (select v from ids where k='org'), (select v from ids where k='lot'),
       current_date, 'problem', 'Cochenilles sur le feuillage';

insert into res
select 'Une inspection « problem » est enfin signalée', '1',
       jsonb_array_length(
         public.ai_analyze_nursery_losses(
           (select v from ids where k='org'), current_date - 1, current_date + 1
         ) -> 'inspectionsDefavorables')::text;

-- Et une inspection saine ne l'est pas.
insert into public.nursery_inspections
  (organization_id, lot_id, inspected_on, result, findings)
select (select v from ids where k='org'), (select v from ids where k='lot'),
       current_date, 'healthy', 'Rien à signaler';

insert into res
select 'Une inspection saine reste hors de la liste', '1',
       jsonb_array_length(
         public.ai_analyze_nursery_losses(
           (select v from ids where k='org'), current_date - 1, current_date + 1
         ) -> 'inspectionsDefavorables')::text;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
