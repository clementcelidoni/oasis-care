-- Milestone 5 — chiffrage : totaux, TVA, marge, historique des prix.
--
-- C'est le module où une erreur se transforme en argent, et où un
-- mauvais chiffre ressemble trait pour trait à un bon. D'où des cas
-- choisis pour les pièges réels du métier plutôt que pour la
-- couverture : TVA mixte, remise qui ronge la marge, tarif modifié
-- après coup, et le droit de lire sans le droit d'écrire.
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
values ('dddddddd-0000-4000-8000-00000000000d','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','devis@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','dddddddd-0000-4000-8000-00000000000d')::text, true);
insert into ids select 'org', public.create_professional_organization('Devis Test','landscaper');

set local role authenticated;

-- ============================================================
-- Numérotation
-- ============================================================
insert into txt select 'num1', public.next_quote_number((select v from ids where k='org'));
insert into txt select 'num2', public.next_quote_number((select v from ids where k='org'));

insert into res
select 'Le premier numéro suit le format attendu',
       'DEV-' || extract(year from current_date)::int::text || '-0001',
       (select v from txt where k='num1');

insert into res
select 'Deux appels ne rendent jamais le même numéro', 'differents',
       case when (select v from txt where k='num1') <> (select v from txt where k='num2')
            then 'differents' else 'IDENTIQUES' end;

-- ============================================================
-- Un devis à TVA mixte
-- ============================================================
insert into ids select 'client', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name)
select (select v from ids where k='client'), (select v from ids where k='org'),
       'customer', 'Client Devis';

insert into ids select 'devis', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title)
select (select v from ids where k='devis'), (select v from ids where k='org'),
       (select v from ids where k='client'), (select v from txt where k='num1'),
       'Aménagement complet';

-- Ligne 1 : 10 m² à 50,00 € HT, TVA 20 %, achat 30,00 €.
insert into public.quote_lines
  (organization_id, quote_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, vat_rate)
select (select v from ids where k='org'), (select v from ids where k='devis'),
       'Terrasse bois', 'm2', 10, 3000, 5000, 20;

-- Ligne 2 : 4 h à 45,00 € HT, TVA 10 % (rénovation), achat 28,00 €.
insert into public.quote_lines
  (organization_id, quote_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, vat_rate)
select (select v from ids where k='org'), (select v from ids where k='devis'),
       'Main-d''œuvre', 'h', 4, 2800, 4500, 10;

insert into res
select 'Total HT', '68000', total_excluding_vat_cents::text
from public.quote_totals where quote_id = (select v from ids where k='devis');

-- 20 % de 500,00 = 100,00 ; 10 % de 180,00 = 18,00 ; soit 118,00 €.
-- Appliquer un taux unique au total donnerait 136,00 ou 68,00 : faux
-- dans les deux cas. C'est le piège que ce test existe pour attraper.
insert into res
select 'TVA calculée par taux, pas sur le total', '11800', total_vat_cents::text
from public.quote_totals where quote_id = (select v from ids where k='devis');

insert into res
select 'Total TTC', '79800', total_including_vat_cents::text
from public.quote_totals where quote_id = (select v from ids where k='devis');

-- Coût : 10 x 30 + 4 x 28 = 300 + 112 = 412,00 €. Marge = 680 - 412 = 268,00.
insert into res
select 'Marge en euros', '26800', margin_cents::text
from public.quote_totals where quote_id = (select v from ids where k='devis');

-- Taux de marque : 268 / 680 = 39,41 %. Et non 268/412 = 65,05 %,
-- qui serait le taux de marge — se tromper de dénominateur fausse
-- tous les chiffrages.
insert into res
select 'Marge en % du prix de vente (taux de marque)', '39.41', margin_percent::text
from public.quote_totals where quote_id = (select v from ids where k='devis');

-- ============================================================
-- La remise ronge la marge, elle ne baisse pas le coût
-- ============================================================
insert into ids select 'ligne3', gen_random_uuid();
insert into public.quote_lines
  (id, organization_id, quote_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, vat_rate, discount_percent)
select (select v from ids where k='ligne3'), (select v from ids where k='org'),
       (select v from ids where k='devis'), 'Paillage', 'm3', 2, 4000, 10000, 20, 25;

insert into res
select 'La remise de ligne réduit la vente', '15000',
       sale_total_cents::text
from public.quote_lines where id = (select v from ids where k='ligne3');

insert into res
select 'La remise ne touche PAS le coût', '8000',
       cost_total_cents::text
from public.quote_lines where id = (select v from ids where k='ligne3');

-- ============================================================
-- La remise globale s'applique après, au prorata de chaque taux
-- ============================================================
update public.quotes set global_discount_percent = 10
 where id = (select v from ids where k='devis');

-- HT avant remise globale : 680 + 150 = 830,00 €.
-- Tranche 20 % : 500 + 150 = 650 → 585,00 ; tranche 10 % : 180 → 162,00.
insert into res
select 'Total HT après remise globale de 10 %', '74700',
       total_excluding_vat_cents::text
from public.quote_totals where quote_id = (select v from ids where k='devis');

-- TVA : 20 % de 585 = 117,00 ; 10 % de 162 = 16,20 ; soit 133,20 €.
insert into res
select 'La ventilation de TVA survit à la remise globale', '13320',
       total_vat_cents::text
from public.quote_totals where quote_id = (select v from ids where k='devis');

-- ============================================================
-- §HISTORIQUE — un prix change, l'ancien reste
-- ============================================================
insert into ids select 'grille', gen_random_uuid();
insert into public.price_books (id, organization_id, name, is_default)
select (select v from ids where k='grille'), (select v from ids where k='org'), 'Tarif 2026', true;

insert into ids select 'article', gen_random_uuid();
insert into public.catalog_items (id, organization_id, item_type, name, unit)
select (select v from ids where k='article'), (select v from ids where k='org'),
       'material', 'Paillage minéral', 'm3';

select public.set_price_book_price(
  (select v from ids where k='grille'), (select v from ids where k='article'), 4000, 9000, 20);

-- Rectification le MÊME JOUR : c'est une correction de saisie, pas un
-- changement de tarif. Elle doit écrire sur place plutôt que d'ouvrir
-- une période qui se terminerait avant de commencer.
select public.set_price_book_price(
  (select v from ids where k='grille'), (select v from ids where k='article'), 4000, 9500, 20);

insert into res
select 'Corriger un prix le jour même ne crée pas de doublon', '1', count(*)::text
from public.price_book_items
where price_book_id = (select v from ids where k='grille')
  and catalog_item_id = (select v from ids where k='article');

insert into res
select 'La correction a bien été prise en compte', '9500', sale_price_cents::text
from public.price_book_items
where price_book_id = (select v from ids where k='grille')
  and catalog_item_id = (select v from ids where k='article');

-- Vrai changement de tarif : on antidate la ligne en cours pour simuler
-- un prix posé le mois dernier, puis on le change.
update public.price_book_items set valid_from = current_date - 30
 where price_book_id = (select v from ids where k='grille')
   and catalog_item_id = (select v from ids where k='article');

select public.set_price_book_price(
  (select v from ids where k='grille'), (select v from ids where k='article'), 4200, 10500, 20);

insert into res
select 'Le nouveau tarif n''écrase pas l''ancien', '2', count(*)::text
from public.price_book_items
where price_book_id = (select v from ids where k='grille')
  and catalog_item_id = (select v from ids where k='article');

insert into res
select 'Un seul tarif reste en cours', '10500', sale_price_cents::text
from public.price_book_items
where price_book_id = (select v from ids where k='grille')
  and catalog_item_id = (select v from ids where k='article')
  and valid_until is null;

insert into res
select 'L''ancien tarif est clos la veille', '1', count(*)::text
from public.price_book_items
where price_book_id = (select v from ids where k='grille')
  and catalog_item_id = (select v from ids where k='article')
  and valid_until = current_date - 1;

-- ============================================================
-- Une ligne de devis ne suit pas le tarif
-- ============================================================
-- Le cœur de §HISTORIQUE : le devis rédigé plus haut doit rester
-- inchangé, quoi qu'il arrive à la grille tarifaire.
insert into res
select 'Le devis déjà rédigé ne bouge pas quand le tarif change', '74700',
       total_excluding_vat_cents::text
from public.quote_totals where quote_id = (select v from ids where k='devis');

-- ============================================================
-- Permissions : lire sans pouvoir écrire
-- ============================================================
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('cccccccc-0000-4000-8000-00000000000c','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','lecteur@test.invalid','',now(),now(),now(),'{}','{}');

insert into public.organization_members (organization_id, user_id, role)
select (select v from ids where k='org'), 'cccccccc-0000-4000-8000-00000000000c',
       'readOnly';

select set_config('request.jwt.claims',
  json_build_object('sub','cccccccc-0000-4000-8000-00000000000c')::text, true);
set local role authenticated;

insert into res
select 'Un rôle lecture seule voit le devis', '1', count(*)::text
from public.quotes where id = (select v from ids where k='devis');

do $$
declare ok boolean := false;
begin
  begin
    insert into public.quote_lines (organization_id, quote_id, description, quantity)
    select organization_id, id, 'Ligne interdite', 1 from public.quotes limit 1;
  exception when others then
    ok := true;
  end;
  insert into res select 'Un rôle lecture seule ne peut PAS ajouter de ligne', 'refuse',
    case when ok then 'refuse' else 'ACCEPTE — faille' end;
end $$;

-- ============================================================
-- Isolement entre entreprises
-- ============================================================
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('bbbbbbbb-0000-4000-8000-00000000000b','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','concurrent@test.invalid','',now(),now(),now(),'{}','{}');
select set_config('request.jwt.claims',
  json_build_object('sub','bbbbbbbb-0000-4000-8000-00000000000b')::text, true);
select public.create_professional_organization('Concurrent','landscaper');
set local role authenticated;

insert into res select 'Un concurrent ne voit aucun devis', '0', count(*)::text from public.quotes;
insert into res select 'Un concurrent ne voit aucun prix', '0', count(*)::text from public.price_book_items;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
