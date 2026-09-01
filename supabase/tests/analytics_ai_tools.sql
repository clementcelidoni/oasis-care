-- Milestone 12 — §11T Analytics, §11U Oasis Pro AI, §AUDIT LOG.
--
-- CE QUE CE TEST PROTÈGE.
--
-- Un tableau de bord faux ne plante pas. Il affiche « marge 62 % » avec
-- la même assurance que « marge 34 % », et on prend des décisions
-- dessus pendant des mois. Les assertions ci-dessous fixent la
-- DÉFINITION de chaque indicateur sur un jeu de données dont on connaît
-- la réponse à la main.
--
-- Idem pour l'assistant : le modèle ne calcule rien, il commente des
-- chiffres que ces fonctions produisent. Si `suggestPurchaseNeeds` se
-- trompe de soustraction, l'IA le dira très bien, très poliment, et
-- l'utilisateur commandera le mauvais nombre d'oliviers.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- ============================================================
-- Géométrie : les mêmes chiffres qu'en TypeScript
-- ============================================================
-- `lib/twin/geometry.ts` mesure côté navigateur, `polygon_area_m2`
-- côté base. Deux formules pour une même surface, c'est une divergence
-- qui attend son heure — sauf si les deux sont épinglées ici.
insert into res
select 'Un carré de 6 m fait 36 m²', '36.00',
       to_char(public.polygon_area_m2('[
         {"xMeters":0,"yMeters":0},{"xMeters":6,"yMeters":0},
         {"xMeters":6,"yMeters":6},{"xMeters":0,"yMeters":6}]'::jsonb), 'FM990.00');

insert into res
select 'Le sens de tracé ne change pas la surface', '36.00',
       to_char(public.polygon_area_m2('[
         {"xMeters":0,"yMeters":6},{"xMeters":6,"yMeters":6},
         {"xMeters":6,"yMeters":0},{"xMeters":0,"yMeters":0}]'::jsonb), 'FM990.00');

insert into res
select 'Un triangle 3-4-5 fait 6 m²', '6.00',
       to_char(public.polygon_area_m2('[
         {"xMeters":0,"yMeters":0},{"xMeters":4,"yMeters":0},
         {"xMeters":0,"yMeters":3}]'::jsonb), 'FM990.00');

-- Deux points ne délimitent rien : zéro, et pas une erreur.
insert into res
select 'Deux points ne font pas une surface', '0',
       public.polygon_area_m2('[{"xMeters":0,"yMeters":0},{"xMeters":6,"yMeters":0}]'::jsonb)::text;

insert into res
select 'Une polyligne 3+4 mesure 7 m', '7.00',
       to_char(public.polyline_length_m('[
         {"xMeters":0,"yMeters":0},{"xMeters":3,"yMeters":0},
         {"xMeters":3,"yMeters":4}]'::jsonb), 'FM990.00');

insert into res
select 'Un tuyau à un seul point mesure zéro', '0',
       public.polyline_length_m('[{"xMeters":1,"yMeters":1}]'::jsonb)::text;

-- ============================================================
-- Le décor
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('ddddddd1-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','patron@test.invalid','',now(),now(),now(),'{}','{}');
-- Le concurrent : il ne doit RIEN voir, par aucun outil.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('ddddddd2-0000-4000-8000-0000000000d2','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','concurrent@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','ddddddd1-0000-4000-8000-0000000000d1')::text, true);
insert into ids select 'org', public.create_professional_organization('Analytique Test','landscaperAndNursery');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ddddddd2-0000-4000-8000-0000000000d2')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Le Concurrent','landscaper');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ddddddd1-0000-4000-8000-0000000000d1')::text, true);
set local role authenticated;

-- Le client.
insert into ids select 'client', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name, email)
select (select v from ids where k='client'), (select v from ids where k='org'),
       'customer', 'Madame Martin', 'martin@test.invalid';

-- ------------------------------------------------------------
-- Devis 1 : envoyé il y a 10 jours, ACCEPTÉ.
--   10 × 120,00 € vendus, 10 × 30,00 € achetés → 1 200 € HT, 300 € de coût
-- ------------------------------------------------------------
insert into ids select 'q1', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, sent_at, issued_on)
select (select v from ids where k='q1'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_quote_number((select v from ids where k='org')),
       'Jardin méditerranéen', 'accepted', now() - interval '10 days', current_date - 10;

insert into public.quote_lines
  (organization_id, quote_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, vat_rate, position, cost_kind)
select (select v from ids where k='org'), (select v from ids where k='q1'),
       'Olivier 200/250', 'u', 10, 3000, 12000, 20, 0, 'plant';

-- ------------------------------------------------------------
-- Devis 2 : envoyé dans la même période, PAS accepté.
--   → conversion attendue : 1 accepté sur 2 envoyés = 50 %
-- ------------------------------------------------------------
insert into public.quotes (organization_id, customer_id, number, title, status, sent_at, issued_on)
select (select v from ids where k='org'), (select v from ids where k='client'),
       public.next_quote_number((select v from ids where k='org')),
       'Terrasse bois', 'sent', now() - interval '9 days', current_date - 9;

-- ------------------------------------------------------------
-- Devis 3 : ACCEPTÉ mais envoyé HORS période, et jamais facturé.
--   → hors cohorte de conversion, mais DANS le carnet de commandes
-- ------------------------------------------------------------
insert into ids select 'q3', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, sent_at, issued_on)
select (select v from ids where k='q3'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_quote_number((select v from ids where k='org')),
       'Clôture', 'accepted', now() - interval '90 days', current_date - 90;

insert into public.quote_lines
  (organization_id, quote_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, vat_rate, position, cost_kind)
select (select v from ids where k='org'), (select v from ids where k='q3'),
       'Clôture bois', 'ml', 50, 500, 1000, 20, 0, 'material';

-- ------------------------------------------------------------
-- Chantier terminé dans la période, issu du devis 1.
--   prévu : 10 h de main-d'œuvre à 200 €, 5 oliviers
--   réel  : 400 € de coûts saisis + 8 h validées à 25 €/h = 200 €
--   → coût réel 600 €, vendu 1 200 € → marge 600 €, taux de marque 50 %
--   → efficacité main-d'œuvre 10 h prévues / 8 h réelles = 125 %
-- ------------------------------------------------------------
insert into ids select 'p1', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, quote_id, number, name,
                             status, actual_start_on, actual_end_on, planned_end_on)
select (select v from ids where k='p1'), (select v from ids where k='org'),
       (select v from ids where k='client'), (select v from ids where k='q1'),
       public.next_project_number((select v from ids where k='org')),
       'Jardin Martin', 'completed', current_date - 8, current_date - 2, current_date - 3;

insert into public.project_resources
  (organization_id, project_id, kind, description, unit, planned_quantity, planned_unit_cost_cents)
select (select v from ids where k='org'), (select v from ids where k='p1'),
       'labor', 'Équipe plantation', 'h', 10, 2000;
insert into public.project_resources
  (organization_id, project_id, kind, description, unit, planned_quantity, planned_unit_cost_cents)
select (select v from ids where k='org'), (select v from ids where k='p1'),
       'plant', 'Olivier 200/250', 'u', 5, 3000;

insert into public.project_costs
  (organization_id, project_id, kind, description, quantity, unit_cost_cents, incurred_on)
select (select v from ids where k='org'), (select v from ids where k='p1'),
       'plant', 'Oliviers achetés', 10, 4000, current_date - 5;

insert into ids select 'emp', gen_random_uuid();
insert into public.employees (id, organization_id, first_name, last_name, hourly_cost_cents)
select (select v from ids where k='emp'), (select v from ids where k='org'), 'Luc', 'Terrain', 2500;

insert into public.time_entries
  (organization_id, employee_id, project_id, worked_on, hours, hourly_cost_cents, kind, validated)
select (select v from ids where k='org'), (select v from ids where k='emp'),
       (select v from ids where k='p1'), current_date - 5, 8, 2500, 'work', true;
-- Un pointage NON validé : il ne doit entrer dans aucun budget.
insert into public.time_entries
  (organization_id, employee_id, project_id, worked_on, hours, hourly_cost_cents, kind, validated)
select (select v from ids where k='org'), (select v from ids where k='emp'),
       (select v from ids where k='p1'), current_date - 4, 6, 2500, 'work', false;

-- ------------------------------------------------------------
-- Facture émise dans la période, échue et impayée.
-- ------------------------------------------------------------
-- On l'écrit en BROUILLON, puis on l'émet : une facture émise
-- n'accepte plus de ligne — c'est le verrou du Milestone 10, et il
-- vaut aussi pour les fixtures.
insert into ids select 'f1', gen_random_uuid();
-- L'échéance est posée AVANT l'émission : `issue_invoice` respecte
-- une échéance déjà fixée, mais rien ne peut plus la changer après.
insert into public.invoices (id, organization_id, customer_id, quote_id, status, due_on)
select (select v from ids where k='f1'), (select v from ids where k='org'),
       (select v from ids where k='client'), (select v from ids where k='q1'),
       'draft', current_date - 1;

insert into public.invoice_lines
  (organization_id, invoice_id, position, description, unit, quantity, unit_price_cents, vat_rate)
select (select v from ids where k='org'), (select v from ids where k='f1'),
       0, 'Jardin méditerranéen', 'forfait', 1, 120000, 20;

-- Émise aujourd'hui, déjà échue. On ne l'antidate pas : une facture
-- émise ne se modifie plus, et le test n'a aucune raison d'être le seul
-- endroit du projet qui contourne cette règle.
select public.issue_invoice((select v from ids where k='f1'), 30);

-- ============================================================
-- §11T — les KPI du paysagiste
-- ============================================================
create temp table kpi on commit drop as
select * from public.pro_analytics_landscaper(
  (select v from ids where k='org'), current_date - 30, current_date);
grant all on kpi to authenticated;

insert into res select 'Chiffre d''affaires : le HT des factures émises', '120000',
       (select revenue_cents::text from kpi);

insert into res select 'Devis envoyés dans la période', '2',
       (select quotes_sent::text from kpi);

insert into res select 'Conversion mesurée sur la cohorte envoyée', '50.0',
       (select quote_conversion_percent::text from kpi);

-- Le devis 3 est accepté et non facturé : 50 × 10,00 € = 500,00 €.
-- Le devis 1, lui, est accepté MAIS facturé — il n'est plus en carnet.
insert into res select 'Carnet de commandes : l''accepté non facturé', '50000',
       (select backlog_cents::text from kpi);

insert into res select 'Marge chantier : vendu 1200 € − coûts 600 €', '60000',
       (select project_margin_cents::text from kpi);

insert into res select 'Taux de marque, sur le prix de vente', '50.0',
       (select project_margin_percent::text from kpi);

-- Si le pointage non validé était compté, le coût monterait à 750 €
-- et la marge tomberait à 450 €. C'est la règle du Milestone 7.
insert into res select 'Un pointage non validé n''entre dans aucun budget', 'oui',
       (select case when project_margin_cents = 60000 then 'oui' else 'NON' end from kpi);

insert into res select 'Efficacité main-d''œuvre : 10 h prévues / 8 h pointées', '125.0',
       (select labor_efficiency_percent::text from kpi);

insert into res select 'Panier moyen des chantiers démarrés', '120000',
       (select average_project_value_cents::text from kpi);

insert into res select 'Une facture échue et impayée', '1',
       (select overdue_invoices_count::text from kpi);

insert into res select 'Le montant impayé est le TTC restant dû', '144000',
       (select overdue_invoices_cents::text from kpi);

-- ------------------------------------------------------------
-- Ce qui n'est pas calculable rend NULL, pas zéro
-- ------------------------------------------------------------
-- Une période sans aucun devis envoyé n'a pas un taux de conversion de
-- 0 % : elle n'en a pas. Afficher « 0 % » ferait croire à un mois
-- catastrophique là où il ne s'est rien passé.
insert into res
select 'Sans devis envoyé, la conversion est inconnue — pas 0 %', 'NULL',
       coalesce((select quote_conversion_percent::text
                 from public.pro_analytics_landscaper(
                   (select v from ids where k='org'),
                   current_date - 3650, current_date - 3600)), 'NULL');

-- ------------------------------------------------------------
-- Un chantier que personne n'a estimé
-- ------------------------------------------------------------
-- L'efficacité main-d'œuvre n'y est pas de 0 % : elle est INCONNUE.
-- Zéro se lirait « équipe catastrophique » là où la vérité est qu'il
-- n'y a rien à comparer. Cas trouvé en exécutant la fonction sur des
-- données réelles, où beaucoup de chantiers n'ont aucune ressource
-- prévue — le jeu de test, lui, en prévoyait toujours.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ddddddd1-0000-4000-8000-0000000000d1')::text, true);
insert into ids select 'orgVide', public.create_professional_organization('Sans Estimation','landscaper');
set local role authenticated;

insert into ids select 'clientVide', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name)
select (select v from ids where k='clientVide'), (select v from ids where k='orgVide'),
       'customer', 'Client pressé';

insert into ids select 'empVide', gen_random_uuid();
insert into public.employees (id, organization_id, first_name, last_name, hourly_cost_cents)
select (select v from ids where k='empVide'), (select v from ids where k='orgVide'),
       'Sam', 'Terrain', 2500;

insert into ids select 'p3', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name,
                             status, actual_start_on, actual_end_on)
select (select v from ids where k='p3'), (select v from ids where k='orgVide'),
       (select v from ids where k='clientVide'),
       public.next_project_number((select v from ids where k='orgVide')),
       'Chantier jamais estimé', 'completed', current_date - 6, current_date - 2;

-- Des heures réelles, aucune heure prévue.
insert into public.time_entries
  (organization_id, employee_id, project_id, worked_on, hours, hourly_cost_cents, kind, validated)
select (select v from ids where k='orgVide'), (select v from ids where k='empVide'),
       (select v from ids where k='p3'), current_date - 4, 5, 2500, 'work', true;

insert into res
select 'Sans heures prévues, l''efficacité est inconnue — pas 0 %', 'NULL',
       coalesce((select labor_efficiency_percent::text
                 from public.pro_analytics_landscaper(
                   (select v from ids where k='orgVide'), current_date - 30, current_date)), 'NULL');

-- Les heures réelles, elles, restent comptées : c'est bien l'absence de
-- COMPARAISON qu'on signale, pas l'absence de travail.
insert into res
select 'Mais les heures pointées sont bien là', '5.00',
       (select labor_actual_hours::text
        from public.pro_analytics_landscaper(
          (select v from ids where k='orgVide'), current_date - 30, current_date));

-- ============================================================
-- §11T — les KPI de la pépinière
-- ============================================================
insert into ids select 'stageProd', gen_random_uuid();
insert into ids select 'stageVente', gen_random_uuid();
insert into public.nursery_stages (id, organization_id, code, label, position, is_saleable)
select (select v from ids where k='stageProd'), (select v from ids where k='org'),
       'prod', 'En production', 0, false;
insert into public.nursery_stages (id, organization_id, code, label, position, is_saleable)
select (select v from ids where k='stageVente'), (select v from ids where k='org'),
       'vente', 'Vendable', 1, true;

insert into ids select 'emplacement', gen_random_uuid();
insert into public.nursery_locations (id, organization_id, code, name, kind, capacity)
select (select v from ids where k='emplacement'), (select v from ids where k='org'),
       'A1', 'Parcelle A1', 'outdoorBlock', 200;

-- Un article de catalogue tarifé : c'est lui qui donne sa valeur au lot.
insert into ids select 'sp', gen_random_uuid();
-- Les fiches d'espèce sont partagées entre tous les comptes et
-- n'appartiennent à personne : seule la clé de service les écrit
-- (Phase 3). On sort donc du rôle applicatif le temps de l'insertion.
reset role;
insert into public.species_profiles (id, scientific_name, normalized_name, profile_json)
select (select v from ids where k='sp'), 'Olea europaea', 'olea europaea', '{}'::jsonb;
set local role authenticated;

insert into ids select 'article', gen_random_uuid();
insert into public.catalog_items (id, organization_id, item_type, name, unit, species_profile_id)
select (select v from ids where k='article'), (select v from ids where k='org'),
       'plant', 'Olivier 200/250', 'u', (select v from ids where k='sp');

insert into ids select 'grille', gen_random_uuid();
insert into public.price_books (id, organization_id, name, is_default)
select (select v from ids where k='grille'), (select v from ids where k='org'), 'Tarif public', true;

insert into public.price_book_items
  (organization_id, price_book_id, catalog_item_id, purchase_price_cents, sale_price_cents, vat_rate, valid_from)
select (select v from ids where k='org'), (select v from ids where k='grille'),
       (select v from ids where k='article'), 800, 2000, 20, current_date - 30;

-- L1 : vendable, 100 en stock dont 20 réservés, 120 au départ.
insert into ids select 'lot1', gen_random_uuid();
insert into public.nursery_lots
  (id, organization_id, lot_code, species_profile_id, species_name, stage_id, location_id,
   initial_quantity, current_quantity, reserved_quantity, status)
select (select v from ids where k='lot1'), (select v from ids where k='org'), 'LOT-1',
       (select v from ids where k='sp'), 'Olea europaea',
       (select v from ids where k='stageVente'), (select v from ids where k='emplacement'),
       120, 100, 20, 'available';

-- L2 : en production, 50.
insert into ids select 'lot2', gen_random_uuid();
insert into public.nursery_lots
  (id, organization_id, lot_code, species_profile_id, species_name, stage_id, location_id,
   initial_quantity, current_quantity, reserved_quantity, status)
select (select v from ids where k='lot2'), (select v from ids where k='org'), 'LOT-2',
       (select v from ids where k='sp'), 'Olea europaea',
       (select v from ids where k='stageProd'), (select v from ids where k='emplacement'),
       50, 50, 0, 'inProduction';

-- L3 : SANS espèce rattachée — donc sans tarif. Il compte dans le
-- stock physique mais pas dans la valeur, et l'écran doit le dire.
insert into ids select 'lot3', gen_random_uuid();
insert into public.nursery_lots
  (id, organization_id, lot_code, species_name, stage_id, location_id,
   initial_quantity, current_quantity, reserved_quantity, status)
select (select v from ids where k='lot3'), (select v from ids where k='org'), 'LOT-3',
       'Espèce sans tarif',
       (select v from ids where k='stageProd'), (select v from ids where k='emplacement'),
       10, 10, 0, 'inProduction';

-- Mouvements sur L1, dans la période : 10 perdus, 30 vendus.
insert into public.nursery_stock_movements (organization_id, lot_id, kind, quantity, reason, occurred_at)
select (select v from ids where k='org'), (select v from ids where k='lot1'), 'loss', 10,
       'Gel tardif', now() - interval '5 days';
insert into public.nursery_stock_movements (organization_id, lot_id, kind, quantity, occurred_at)
select (select v from ids where k='org'), (select v from ids where k='lot1'), 'sell', 30,
       now() - interval '3 days';

create temp table pep on commit drop as
select * from public.pro_analytics_nursery(
  (select v from ids where k='org'), current_date - 30, current_date);
grant all on pep to authenticated;

-- 100 × 20,00 € + 50 × 20,00 € = 3 000,00 €. Le lot 3 n'a pas de tarif.
insert into res select 'Valeur du stock, au tarif en cours', '300000',
       (select stock_value_cents::text from pep);

insert into res select 'Deux lots valorisés, un sans tarif', '2/1',
       (select valued_lots::text || '/' || unpriced_lots::text from pep);

insert into res select 'Disponible = vendable moins réservé', '80',
       (select available_stock::text from pep);

insert into res select 'Valeur de ce qui est encore en production', '100000',
       (select production_value_cents::text from pep);

-- 10 perdus sur 10 + 30 vendus + 160 encore debout = 5 %.
insert into res select 'Taux de perte sur la période', '5.0',
       (select loss_rate_percent::text from pep);

-- 30 vendus rapportés aux 160 en stock.
insert into res select 'Rotation du stock', '18.8',
       (select turnover_percent::text from pep);

-- L1 a bougé ; L2 et L3 dorment depuis toujours.
insert into res select 'Deux lots dormants, 60 sujets', '2/60',
       (select dormant_lots::text || '/' || dormant_quantity::text from pep);

-- 160 sujets sur une parcelle de 200 places.
insert into res select 'Occupation de la parcelle', '80.0',
       (select space_utilization_percent::text from pep);

-- Seul L1 a atteint un stade vendable : 100 restants sur 120 entrés.
insert into res select 'Rendement de production', '83.3',
       (select production_yield_percent::text from pep);

-- ============================================================
-- §11U — le registre d'outils
-- ============================================================
insert into res
select 'getClientContext rend le nom du client', 'Madame Martin',
       public.ai_get_client_context((select v from ids where k='client')) #>> '{client,nom}';

insert into res
select 'Et ses trois devis', '3',
       jsonb_array_length(public.ai_get_client_context((select v from ids where k='client')) -> 'devis')::text;

insert into res
select 'Et sa facture impayée', '144000',
       public.ai_get_client_context((select v from ids where k='client')) #>> '{facturesImpayees,0,resteADevoir}';

insert into res
select 'getProjectContext connaît le budget vendu', '120000',
       public.ai_get_project_context((select v from ids where k='p1')) #>> '{budget,venduHT}';

insert into res
select 'Il sépare heures validées et non validées', '8.00/6.00',
       (public.ai_get_project_context((select v from ids where k='p1')) #>> '{budget,heuresValidees}')
       || '/' ||
       (public.ai_get_project_context((select v from ids where k='p1')) #>> '{budget,heuresNonValidees}');

-- « Quels chantiers ont dépassé leur budget ? » — prévu 350 € (200 de
-- main-d'œuvre + 150 de végétaux), réel 600 € → 250 € de dépassement.
insert into res
select 'analyzeProjectMargin chiffre le dépassement', '25000',
       public.ai_analyze_project_margin((select v from ids where k='org')) #>> '{0,depassement_cents}';

insert into res
select 'summarizeProject rend des faits, pas un tableau', 'oui',
       case when (public.ai_summarize_project((select v from ids where k='p1')) -> 'faits') ?
            format('Chantier %s « Jardin Martin », statut completed.',
                   (select number from public.projects where id = (select v from ids where k='p1')))
            then 'oui' else 'NON' end;

insert into res
select 'findStock trouve l''espèce', '150',
       (public.ai_find_stock((select v from ids where k='org'), 'Olea') #>> '{0,physique}');

insert into res
select 'forecastAvailability voit ce qui est en production', '2',
       jsonb_array_length(
         public.ai_forecast_availability((select v from ids where k='org'), null) -> 'enProduction')::text;

-- « Quels végétaux dois-je commander pour les projets signés ? »
-- Le chantier P1 est TERMINÉ : il ne consomme plus rien. Un besoin
-- calculé sur les chantiers terminés ferait commander deux fois.
insert into res
select 'Un chantier terminé ne crée aucun besoin d''achat', '0',
       jsonb_array_length(public.ai_suggest_purchase_needs((select v from ids where k='org')))::text;

-- Un chantier signé mais pas démarré, lui, en crée un.
insert into ids select 'p2', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name, status)
select (select v from ids where k='p2'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_project_number((select v from ids where k='org')),
       'Chantier à venir', 'planned';
insert into public.project_resources
  (organization_id, project_id, kind, description, unit, planned_quantity, planned_unit_cost_cents)
select (select v from ids where k='org'), (select v from ids where k='p2'),
       'plant', 'Olea europaea', 'u', 200, 3000;

-- Besoin 200, disponible 80, attendu 0 → il en manque 120.
insert into res
select 'suggestPurchaseNeeds soustrait le stock disponible', '120',
       public.ai_suggest_purchase_needs((select v from ids where k='org')) #>> '{0,a_commander}';

-- « Que dois-je faire aujourd'hui ? »
insert into res
select 'Oasis Daily voit la facture en retard', '1',
       jsonb_array_length(
         public.ai_get_daily_priorities((select v from ids where k='org')) -> 'facturesEnRetard')::text;

insert into res
select 'Et le devis à relancer', '1',
       jsonb_array_length(
         public.ai_get_daily_priorities((select v from ids where k='org')) -> 'devisARelancer')::text;

insert into res
select 'Et les six heures qui attendent validation', '6.00',
       public.ai_get_daily_priorities((select v from ids where k='org')) #>> '{pointagesAValider,heures}';

insert into res
select 'analyzeNurseryLosses remonte le motif', 'Gel tardif',
       public.ai_analyze_nursery_losses((select v from ids where k='org'),
         current_date - 30, current_date) #>> '{parEspece,0,motifs,0}';

-- ============================================================
-- §SÉCURITÉ IA — ce que l'assistant a le droit de faire
-- ============================================================
insert into res
select 'createQuoteDraft crée un BROUILLON, jamais un devis envoyé', 'draft',
       public.ai_create_quote_draft(
         (select v from ids where k='org'), (select v from ids where k='client'),
         'Proposé par Oasis',
         '[{"description":"Olivier 200/250","unit":"u","quantity":3,"unit_sale_price_cents":12000,"unit_cost_cents":3000,"vat_rate":20,"cost_kind":"plant"}]'::jsonb
       ) ->> 'statut';

insert into res
select 'Le brouillon porte bien ses lignes', '1',
       (select count(*)::text from public.quote_lines l
        join public.quotes q on q.id = l.quote_id
        where q.status = 'draft' and q.title = 'Proposé par Oasis');

-- §AUDIT LOG — « source ». Un brouillon apparu tout seul doit
-- s'expliquer.
insert into res
select 'Le brouillon laisse une trace signée « ai »', 'quoteDraftCreated/ai',
       (select action || '/' || source from public.audit_events
        where organization_id = (select v from ids where k='org')
          and action = 'quoteDraftCreated' limit 1);

insert into res
select 'Et la trace nomme son auteur', 'oui',
       (select case when actor_user_id = 'ddddddd1-0000-4000-8000-0000000000d1'
                    then 'oui' else 'NON' end
        from public.audit_events where action = 'quoteDraftCreated' limit 1);

-- Le client d'une AUTRE organisation est refusé, avec un message clair
-- plutôt qu'une violation de contrainte.
do $$
begin
  perform public.ai_create_quote_draft(
    (select v from ids where k='org'), gen_random_uuid(), 'Client inventé', '[]'::jsonb);
  insert into res values ('Un client inconnu est refusé', 'refusé', 'ACCEPTÉ');
exception when others then
  insert into res values ('Un client inconnu est refusé', 'refusé', 'refusé');
end $$;

-- LE JOURNAL NE SE RÉÉCRIT PAS.
do $$
begin
  update public.audit_events set action = 'rienDuTout'
   where organization_id = (select v from ids where k='org');
  if found then
    insert into res values ('Le journal d''audit ne se modifie pas', 'refusé', 'MODIFIÉ');
  else
    insert into res values ('Le journal d''audit ne se modifie pas', 'refusé', 'refusé');
  end if;
exception when others then
  insert into res values ('Le journal d''audit ne se modifie pas', 'refusé', 'refusé');
end $$;

do $$
begin
  delete from public.audit_events where organization_id = (select v from ids where k='org');
  if found then
    insert into res values ('Le journal d''audit ne s''efface pas', 'refusé', 'EFFACÉ');
  else
    insert into res values ('Le journal d''audit ne s''efface pas', 'refusé', 'refusé');
  end if;
exception when others then
  insert into res values ('Le journal d''audit ne s''efface pas', 'refusé', 'refusé');
end $$;

-- Le plafond.
insert into res
select 'Le quota se consomme', '1/true',
       (select used::text || '/' || allowed::text
        from public.consume_pro_ai_quota((select v from ids where k='org'), 3));

insert into res
select 'Et il finit par refuser', 'false',
       (select allowed::text from (
          select (public.consume_pro_ai_quota((select v from ids where k='org'), 3)).*
          from generate_series(1, 3)
        ) t offset 2 limit 1);

-- ============================================================
-- LE CONCURRENT NE VOIT RIEN
-- ============================================================
-- L'assistant s'exécute avec les droits de celui qui parle. C'est
-- l'assertion qui compte le plus de ce fichier : un outil qui
-- contournerait la RLS servirait les chiffres d'une entreprise à une
-- autre, sans la moindre erreur à l'écran.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','ddddddd2-0000-4000-8000-0000000000d2')::text, true);
set local role authenticated;

insert into res
select 'Le concurrent ne lit pas le contexte client', 'rien',
       coalesce(public.ai_get_client_context((select v from ids where k='client')) #>> '{client,nom}', 'rien');

insert into res
select 'Ni le contexte chantier', 'rien',
       coalesce(public.ai_get_project_context((select v from ids where k='p1')) #>> '{chantier,nom}', 'rien');

insert into res
select 'Ni le résumé du chantier', 'Chantier introuvable ou inaccessible.',
       public.ai_summarize_project((select v from ids where k='p1')) ->> 'erreur';

insert into res
select 'Ni les marges', '0',
       jsonb_array_length(public.ai_analyze_project_margin((select v from ids where k='org')))::text;

insert into res
select 'Ni le stock', '0',
       jsonb_array_length(public.ai_find_stock((select v from ids where k='org'), null))::text;

insert into res
select 'Ni les priorités du jour', '0',
       jsonb_array_length(
         public.ai_get_daily_priorities((select v from ids where k='org')) -> 'facturesEnRetard')::text;

insert into res
select 'Ni les pertes de la pépinière', '0',
       jsonb_array_length(
         public.ai_analyze_nursery_losses((select v from ids where k='org'),
           current_date - 30, current_date) -> 'parEspece')::text;

insert into res
select 'Ni le journal d''audit', '0',
       (select count(*)::text from public.audit_events
        where organization_id = (select v from ids where k='org'));

-- Les KPI d'une organisation dont on n'est pas membre : la fonction
-- s'exécute, la RLS vide les tables, et tout retombe à zéro plutôt que
-- de rendre les chiffres du voisin.
insert into res
select 'Ni le chiffre d''affaires', '0',
       (select revenue_cents::text from public.pro_analytics_landscaper(
          (select v from ids where k='org'), current_date - 30, current_date));

-- Et il ne peut pas non plus écrire un brouillon chez le voisin.
do $$
begin
  perform public.ai_create_quote_draft(
    (select v from ids where k='org'), (select v from ids where k='client'),
    'Devis hostile', '[]'::jsonb);
  insert into res values ('Ni créer un brouillon chez le voisin', 'refusé', 'ACCEPTÉ');
exception when others then
  insert into res values ('Ni créer un brouillon chez le voisin', 'refusé', 'refusé');
end $$;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
