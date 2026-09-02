-- Milestone 6 — « Transformer en projet », et le suivi prévu/réel.
--
-- Le piège central de ce module tient en une phrase : le PRÉVU d'un
-- chantier est ce qu'on avait prévu de DÉPENSER, pas ce qu'on a
-- facturé. Prendre le prix de vente ferait paraître tout chantier
-- bénéficiaire tant qu'on dépense moins qu'on n'a vendu — vrai par
-- construction, et sans aucune valeur. Le premier test porte là-dessus.
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
values ('aaaaaaa1-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','chantier@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaaa1-0000-4000-8000-00000000000a')::text, true);
insert into ids select 'org', public.create_professional_organization('Chantier Test','landscaper');

set local role authenticated;

-- Un devis accepté, deux postes, trois lignes.
insert into ids select 'client', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name)
select (select v from ids where k='client'), (select v from ids where k='org'),
       'customer', 'Client Chantier';

insert into ids select 'devis', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status)
select (select v from ids where k='devis'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_quote_number((select v from ids where k='org')),
       'Jardin méditerranéen', 'accepted';

insert into ids select 'poste1', gen_random_uuid();
insert into public.quote_sections (id, organization_id, quote_id, title, position)
select (select v from ids where k='poste1'), (select v from ids where k='org'),
       (select v from ids where k='devis'), 'Préparation', 0;

insert into ids select 'poste2', gen_random_uuid();
insert into public.quote_sections (id, organization_id, quote_id, title, position)
select (select v from ids where k='poste2'), (select v from ids where k='org'),
       (select v from ids where k='devis'), 'Plantation', 1;

-- Ligne A : 10 u à 30,00 € d'achat, vendues 80,00 €. L'écart entre les
-- deux est exactement ce que ce test surveille.
insert into public.quote_lines
  (organization_id, quote_id, section_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, position, cost_kind)
select (select v from ids where k='org'), (select v from ids where k='devis'),
       (select v from ids where k='poste2'), 'Olivier', 'u', 10, 3000, 8000, 0, 'plant';

-- Ligne B : 40 m² à 5,00 € d'achat, vendus 15,00 €.
insert into public.quote_lines
  (organization_id, quote_id, section_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, position, cost_kind)
select (select v from ids where k='org'), (select v from ids where k='devis'),
       (select v from ids where k='poste1'), 'Géotextile', 'm2', 40, 500, 1500, 1, 'material';

-- Ligne C : sans poste, pour vérifier qu'elle ne se perd pas.
insert into public.quote_lines
  (organization_id, quote_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, position)
select (select v from ids where k='org'), (select v from ids where k='devis'),
       'Évacuation gravats', 'forfait', 1, 25000, 40000, 2;

-- ============================================================
-- La conversion
-- ============================================================
insert into ids select 'projet', public.create_project_from_quote((select v from ids where k='devis'));

insert into res
select 'Le chantier porte un numéro', 'CH-' || extract(year from current_date)::int::text || '-0001',
       number from public.projects where id = (select v from ids where k='projet');

insert into res
select 'Il reprend le nom du devis', 'Jardin méditerranéen',
       name from public.projects where id = (select v from ids where k='projet');

insert into res
select 'Il reste rattaché à son devis', 'oui',
       case when quote_id = (select v from ids where k='devis') then 'oui' else 'non' end
from public.projects where id = (select v from ids where k='projet');

insert into res
select 'Une phase par poste du devis', '2', count(*)::text
from public.project_phases where project_id = (select v from ids where k='projet');

insert into res
select 'Les phases gardent l''ordre du devis', 'Préparation',
       title from public.project_phases
where project_id = (select v from ids where k='projet') and position = 0;

insert into res
select 'Une ressource par ligne, y compris celle sans poste', '3', count(*)::text
from public.project_resources where project_id = (select v from ids where k='projet');

-- LE TEST CENTRAL.
-- Prévu au coût : 10 x 30 + 40 x 5 + 250 = 300 + 200 + 250 = 750,00 €.
-- Au prix de vente ce serait 10 x 80 + 40 x 15 + 400 = 1 800,00 €.
insert into res
select 'Le prévu est le COÛT, pas le prix de vente', '75000',
       sum(planned_total_cents)::text
from public.project_resources where project_id = (select v from ids where k='projet');

insert into res
select 'La ligne sans poste n''est rattachée à aucune phase', '1', count(*)::text
from public.project_resources
where project_id = (select v from ids where k='projet') and phase_id is null;

insert into res
select 'Une ligne de poste est rattachée à sa phase', 'Plantation',
       coalesce((select ph.title from public.project_phases ph
                 join public.project_resources r on r.phase_id = ph.id
                 where r.description = 'Olivier'
                   and r.project_id = (select v from ids where k='projet')), 'AUCUNE');

-- Deuxième clic : on ne fabrique pas un jumeau.
insert into res
select 'Convertir deux fois rend le même chantier', 'identique',
       case when public.create_project_from_quote((select v from ids where k='devis'))
                 = (select v from ids where k='projet')
            then 'identique' else 'DOUBLON' end;

insert into res
select 'Et il n''y a toujours qu''un chantier', '1', count(*)::text
from public.projects where quote_id = (select v from ids where k='devis');

-- ============================================================
-- §JOB COSTING — prévu contre réel
-- ============================================================
-- On dépense 380,00 € en végétaux là où 300,00 étaient prévus.
insert into public.project_costs
  (organization_id, project_id, kind, description, unit, quantity, unit_cost_cents)
select (select v from ids where k='org'), (select v from ids where k='projet'),
       'plant', 'Oliviers livrés', 'u', 10, 3800;

insert into res
select 'Le dépassement sur les végétaux est visible', '8000',
       variance_cents::text
from public.project_cost_summary
where project_id = (select v from ids where k='projet') and kind = 'plant';

-- Une dépense qu'aucun devis n'avait prévue : la location d'une
-- minipelle. C'est précisément celle qu'on cherche.
insert into public.project_costs
  (organization_id, project_id, kind, description, unit, quantity, unit_cost_cents)
select (select v from ids where k='org'), (select v from ids where k='projet'),
       'equipment', 'Location minipelle', 'j', 2, 18000;

insert into res
select 'Une dépense non prévue apparaît quand même', '36000',
       variance_cents::text
from public.project_cost_summary
where project_id = (select v from ids where k='projet') and kind = 'equipment';

insert into res
select 'Son prévu vaut bien zéro, et non nul', '0',
       coalesce(planned_cents::text, 'NULL')
from public.project_cost_summary
where project_id = (select v from ids where k='projet') and kind = 'equipment';

-- Un poste prévu et jamais dépensé doit rester visible : c'est un
-- oubli possible, pas une ligne à faire disparaître.
-- La ligne « Évacuation gravats » n'a reçu aucune nature : elle doit
-- retomber sur « Divers », et non sur une catégorie devinée d'après son
-- libellé. Un poste prévu et jamais dépensé reste visible — c'est un
-- oubli possible, pas une ligne à faire disparaître.
insert into res
select 'Une ligne sans nature retombe sur Divers, sans deviner', '-25000',
       variance_cents::text
from public.project_cost_summary
where project_id = (select v from ids where k='projet') and kind = 'other';

-- ============================================================
-- L'avancement ne se déduit pas de la dépense
-- ============================================================
insert into res
select 'L''avancement démarre à zéro malgré les dépenses', '0',
       max(progress_percent)::text
from public.project_phases where project_id = (select v from ids where k='projet');

-- ============================================================
-- Isolement
-- ============================================================
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('aaaaaaa2-0000-4000-8000-00000000000b','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','rival3@test.invalid','',now(),now(),now(),'{}','{}');
select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaaa2-0000-4000-8000-00000000000b')::text, true);
select public.create_professional_organization('Rival chantier','landscaper');
set local role authenticated;

insert into res select 'Un concurrent ne voit aucun chantier', '0', count(*)::text
from public.projects;
insert into res select 'Ni aucun coût', '0', count(*)::text from public.project_costs;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
