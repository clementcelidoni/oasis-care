-- LA TVA SE CALCULE PAR TAUX, PAS PAR LIGNE.
--
-- Le devis le faisait déjà. La facture, l'avoir et les deux commandes
-- ne le faisaient pas : elles arrondissaient chaque ligne avant
-- d'additionner les arrondis.
--
-- Ce qui rend la chose grave n'est pas la somme — quelques centimes —
-- mais l'INCOHÉRENCE : la facture imprimée affiche la ventilation par
-- taux, puis un total calculé autrement, juste en dessous. Le document
-- ne fait pas son propre total. Et c'est ce total-là qui part chez
-- l'expert-comptable.
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
values ('aaaaaaa9-0000-4000-8000-0000000000a9','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','tva@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaaa9-0000-4000-8000-0000000000a9')::text, true);
insert into ids select 'org', public.create_professional_organization('TVA Test','landscaper');
set local role authenticated;

insert into ids select 'client', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name)
select (select v from ids where k='client'), (select v from ids where k='org'), 'customer', 'Client TVA';

-- ============================================================
-- Le cas qui diverge : beaucoup de petites lignes
-- ============================================================
-- Quarante lignes à 1,67 € à 20 %.
--   par ligne : round(167 × 0,20) = 33 centimes, × 40 = 13,20 €
--   par taux   : round(6 680 × 0,20)             = 13,36 €
-- Seize centimes d'écart, et c'est le second qui est juste.
insert into ids select 'facture', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, status, issued_on)
select (select v from ids where k='facture'), (select v from ids where k='org'),
       (select v from ids where k='client'), 'draft', current_date;

insert into public.invoice_lines
  (organization_id, invoice_id, position, description, unit, quantity, unit_price_cents, vat_rate)
select (select v from ids where k='org'), (select v from ids where k='facture'),
       g, 'Ligne ' || g, 'u', 1, 167, 20
from generate_series(1, 40) g;

insert into res
select 'Le total HT ne dépend pas de la méthode', '6680',
       (select total_excluding_vat_cents::text from public.invoice_totals
        where invoice_id = (select v from ids where k='facture'));

insert into res
select 'La TVA est calculée par taux', '1336',
       (select total_vat_cents::text from public.invoice_totals
        where invoice_id = (select v from ids where k='facture'));

insert into res
select 'Le TTC suit', '8016',
       (select total_including_vat_cents::text from public.invoice_totals
        where invoice_id = (select v from ids where k='facture'));

-- LE CONTRÔLE QUI COMPTE : la ventilation imprimée doit faire le total
-- imprimé. C'est exactement ce qui n'était pas vrai.
insert into res
select 'La ventilation par taux fait bien le total de la facture', 'true',
       (
         (select sum(round(base * rate / 100.0))::bigint from (
            select vat_rate as rate, sum(total_cents) as base
            from public.invoice_lines
            where invoice_id = (select v from ids where k='facture')
            group by vat_rate
          ) x)
         = (select total_vat_cents from public.invoice_totals
            where invoice_id = (select v from ids where k='facture'))
       )::text;

-- ============================================================
-- Plusieurs taux sur la même facture
-- ============================================================
insert into ids select 'mixte', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, status, issued_on)
select (select v from ids where k='mixte'), (select v from ids where k='org'),
       (select v from ids where k='client'), 'draft', current_date;

-- 10 000 à 20 % et 10 000 à 5,5 %. Un taux moyen donnerait 2 550 ;
-- la ventilation juste donne 2 000 + 550.
insert into public.invoice_lines
  (organization_id, invoice_id, position, description, unit, quantity, unit_price_cents, vat_rate)
values
  ((select v from ids where k='org'), (select v from ids where k='mixte'), 0, 'Prestation', 'u', 1, 10000, 20),
  ((select v from ids where k='org'), (select v from ids where k='mixte'), 1, 'Végétaux', 'u', 1, 10000, 5.5);

insert into res
select 'Deux taux sur la même facture se ventilent séparément', '2550',
       (select total_vat_cents::text from public.invoice_totals
        where invoice_id = (select v from ids where k='mixte'));

-- ============================================================
-- L'avoir, calculé de la même façon
-- ============================================================
insert into ids select 'avoir', gen_random_uuid();
insert into public.credit_notes (id, organization_id, invoice_id, customer_id, number, issued_on, issued_at)
select (select v from ids where k='avoir'), (select v from ids where k='org'),
       (select v from ids where k='mixte'), (select v from ids where k='client'),
       'AV-TEST-001', current_date, now();

insert into public.credit_note_lines
  (organization_id, credit_note_id, position, description, unit, quantity, unit_price_cents, vat_rate)
values
  ((select v from ids where k='org'), (select v from ids where k='avoir'), 0, 'Remboursement', 'u', 1, 10000, 20);

insert into res
select 'L''avoir déduit correspond à ce que l''avoir affiche', '12000',
       (select credited_cents::text from public.invoice_balance
        where invoice_id = (select v from ids where k='mixte'));

insert into res
select 'Le reste à payer en tient compte', '10550',
       (select outstanding_cents::text from public.invoice_balance
        where invoice_id = (select v from ids where k='mixte'));

-- ============================================================
-- Une facture sans ligne reste visible
-- ============================================================
-- Le `left join` de la vue : un brouillon vide doit rendre zéro, pas
-- disparaître — sinon l'écran de la facture ne trouve plus ses totaux.
insert into ids select 'vide', gen_random_uuid();
insert into public.invoices (id, organization_id, customer_id, status, issued_on)
select (select v from ids where k='vide'), (select v from ids where k='org'),
       (select v from ids where k='client'), 'draft', current_date;

insert into res
select 'Une facture sans ligne rend zéro, pas rien', '0|0',
       coalesce((select total_excluding_vat_cents::text || '|' || total_vat_cents::text
                 from public.invoice_totals where invoice_id = (select v from ids where k='vide')), 'ABSENTE');

-- ============================================================
-- Les commandes suivent la même règle
-- ============================================================
insert into ids select 'fournisseur', gen_random_uuid();
insert into public.suppliers (id, organization_id, name)
select (select v from ids where k='fournisseur'), (select v from ids where k='org'), 'Fournisseur TVA';

insert into ids select 'commande', gen_random_uuid();
insert into public.purchase_orders (id, organization_id, supplier_id, number, status)
select (select v from ids where k='commande'), (select v from ids where k='org'),
       (select v from ids where k='fournisseur'), 'PO-TEST-001', 'draft';

insert into public.purchase_order_lines
  (organization_id, purchase_order_id, position, description, unit, quantity, unit_cost_cents, vat_rate)
select (select v from ids where k='org'), (select v from ids where k='commande'),
       g, 'Ligne ' || g, 'u', 1, 167, 20
from generate_series(1, 40) g;

insert into res
select 'La commande fournisseur calcule aussi par taux', '1336',
       (select total_vat_cents::text from public.purchase_order_totals
        where purchase_order_id = (select v from ids where k='commande'));

-- ============================================================
-- Et le devis, qui était déjà juste, ne bouge pas
-- ============================================================
insert into ids select 'devis', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status)
select (select v from ids where k='devis'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_quote_number((select v from ids where k='org')), 'Devis TVA', 'draft';

insert into public.quote_lines
  (organization_id, quote_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, vat_rate, position)
select (select v from ids where k='org'), (select v from ids where k='devis'),
       'Ligne ' || g, 'u', 1, 100, 167, 20, g
from generate_series(1, 40) g;

insert into res
select 'Le devis rend le même montant que la facture équivalente', '1336',
       (select total_vat_cents::text from public.quote_totals
        where quote_id = (select v from ids where k='devis'));

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
