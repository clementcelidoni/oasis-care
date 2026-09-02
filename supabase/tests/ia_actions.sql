-- 0069 — LES ÉCRITURES DE L'ASSISTANT.
--
-- CE QUE CE TEST PROTÈGE.
--
-- Ouvrir quinze écritures à un modèle de langage n'est acceptable que
-- si chacune refuse deux choses, à tous les coups :
--
--   1. UN APPELANT D'UNE AUTRE ORGANISATION. Deux formes, et la seconde
--      est celle qui a déjà mordu ce projet
--      (`cross_tenant_grants.sql`) :
--        (a) il nomme l'organisation de la victime — le garde-fou
--            d'appartenance doit lever ;
--        (b) il nomme LA SIENNE, et lui accroche l'entité de la
--            victime. Là, la permission est parfaitement légitime :
--            c'est la vérification du PARENT qui doit refuser, et rien
--            d'autre. Une politique RLS qui ne relie pas les deux bouts
--            de sa ligne laisse passer exactement ce cas.
--
--   2. UN APPELANT SANS LA PERMISSION. Le même ouvrier, dans la BONNE
--      entreprise, avec un rôle qui ne donne que `projects.read` : les
--      quinze fonctions doivent lui dire non. Sans la vérification
--      explicite, la RLS refuserait en silence — zéro ligne insérée,
--      aucune erreur — et l'assistant annoncerait « c'est fait ».
--
-- Et un troisième axe, propre à ce fichier : LES REFUS DÉLIBÉRÉS.
-- Gagner une affaire, vendre du stock, ajuster un inventaire, ajouter
-- une ligne à un devis déjà envoyé. Ce ne sont pas des bogues qu'on
-- évite, ce sont des portes qu'on a choisi de ne pas percer, et rien
-- d'autre qu'un test ne le rappellera à celui qui ajoutera le
-- seizième outil.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- Deux aides, parce que quarante-cinq blocs `do $$ … exception …` se
-- relisent moins bien que quarante-cinq lignes. Elles sont en
-- `security invoker` par défaut : le rôle et le JWT de l'appelant
-- traversent, sans quoi le test ne testerait rien.
create function pg_temp.refuse(p_nom text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  insert into res values (p_nom, 'refusé', 'ACCEPTÉ');
exception when others then
  insert into res values (p_nom, 'refusé', 'refusé');
end $$;

create function pg_temp.accepte(p_nom text, p_sql text) returns void
language plpgsql as $$
begin
  execute p_sql;
  insert into res values (p_nom, 'accepté', 'accepté');
exception when others then
  insert into res values (p_nom, 'accepté', 'CASSÉ : ' || sqlerrm);
end $$;

-- ============================================================
-- Le décor : deux entreprises, trois personnes
-- ============================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  ('eeeeeee1-0000-4000-8000-0000000000e1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','patronne@test.invalid','',now(),now(),now(),'{}','{}'),
  -- L'ouvrier : membre de la BONNE entreprise, rôle `fieldWorker`,
  -- c'est-à-dire `projects.read` et rien d'autre. C'est lui qui met à
  -- l'épreuve les permissions, pas le cloisonnement.
  ('eeeeeee2-0000-4000-8000-0000000000e2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','ouvrier@test.invalid','',now(),now(),now(),'{}','{}'),
  -- Le confrère : un professionnel parfaitement légitime, ailleurs.
  ('eeeeeee3-0000-4000-8000-0000000000e3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','confrere@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','eeeeeee1-0000-4000-8000-0000000000e1')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Jardins du Sud','landscaperAndNursery');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','eeeeeee3-0000-4000-8000-0000000000e3')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Le Confrère','landscaperAndNursery');

reset role;
-- L'ouvrier rejoint l'entreprise A. Insertion hors rôle `authenticated`
-- pour ne pas dépendre de l'écran d'invitation, qui n'est pas le sujet.
insert into public.organization_members (organization_id, user_id, role)
select (select v from ids where k='orgA'), 'eeeeeee2-0000-4000-8000-0000000000e2', 'fieldWorker';

-- ============================================================
-- LE CHEMIN LÉGITIME — la patronne, dans son entreprise
-- ============================================================
-- Il passe en premier : une fonction qui refuse tout le monde
-- passerait tous les tests de refus.
select set_config('request.jwt.claims',
  json_build_object('sub','eeeeeee1-0000-4000-8000-0000000000e1')::text, true);
set local role authenticated;

-- 1. Un prospect.
insert into ids
select 'client', (public.ai_create_customer(
  (select v from ids where k='orgA'), 'Madame Rossi', 'individual', 'lead',
  'rossi@test.invalid', '0490000000', '3 chemin des Oliviers', '84000', 'Avignon',
  'Salon du végétal', 'Terrain en restanques') ->> 'clientId')::uuid;

insert into res select 'La patronne crée un prospect', 'Madame Rossi',
       (select display_name from public.crm_customers where id = (select v from ids where k='client'));

-- 2. Une opportunité.
insert into ids
select 'opp', (public.ai_create_opportunity(
  (select v from ids where k='orgA'), (select v from ids where k='client'),
  'Aménagement complet', 4500000, 40, current_date + 30, null) ->> 'opportuniteId')::uuid;

insert into res select 'Et une opportunité, en qualification', 'qualification',
       (select stage from public.crm_opportunities where id = (select v from ids where k='opp'));

-- 3. Faire avancer l'opportunité.
select pg_temp.accepte('Elle la fait passer en négociation',
  format('select public.ai_set_opportunity_stage(%L, %L, ''negotiation'')',
         (select v from ids where k='orgA'), (select v from ids where k='opp')));

-- 4. Une note d'activité.
select pg_temp.accepte('Elle consigne un appel',
  format('select public.ai_log_activity(%L, ''call'', ''Rappel du 12'', ''Rappeler jeudi matin.'', %L)',
         (select v from ids where k='orgA'), (select v from ids where k='client')));

-- 5. Un brouillon de devis (fonction de 0058, appelée par le même
--    chemin : elle fait partie du registre qu'on ouvre).
insert into ids
select 'devis', (public.ai_create_quote_draft(
  (select v from ids where k='orgA'), (select v from ids where k='client'),
  'Restanques',
  '[{"description":"Olivier 200/250","unit":"u","quantity":10,
     "unit_cost_cents":3000,"unit_sale_price_cents":12000,"vat_rate":20,"cost_kind":"plant"}]'::jsonb
) ->> 'devisId')::uuid;

-- 6. Des lignes en plus, sur le brouillon.
insert into res select 'Elle ajoute deux lignes au brouillon', '2',
       (public.ai_add_quote_draft_lines(
         (select v from ids where k='orgA'), (select v from ids where k='devis'),
         '[{"description":"Paillage minéral","unit":"m2","quantity":40,
            "unit_sale_price_cents":1800,"vat_rate":10},
           {"description":"Remise commerciale","unit":"u","quantity":1,
            "unit_sale_price_cents":0,"vat_rate":0}]'::jsonb) ->> 'lignesAjoutees');

-- LA TVA À 0 % ET LA VENTE À 0 € SURVIVENT. C'est le défaut historique
-- du projet — `parse(x) || 20` écrasait un zéro légitime — et il se
-- reproduit à l'identique en SQL avec un `||` mal placé.
insert into res select 'Une TVA à 0 % reste à 0 %', '0.00',
       (select to_char(vat_rate, 'FM990.00') from public.quote_lines
        where quote_id = (select v from ids where k='devis') and description = 'Remise commerciale');
insert into res select 'Et un prix de vente à 0 € reste à 0', '0',
       (select unit_sale_price_cents::text from public.quote_lines
        where quote_id = (select v from ids where k='devis') and description = 'Remise commerciale');
insert into res select 'Les lignes s''ajoutent APRÈS, sans renuméroter', '0,1,2',
       (select string_agg(position::text, ',' order by position) from public.quote_lines
        where quote_id = (select v from ids where k='devis'));

-- 7. Un article au catalogue.
select pg_temp.accepte('Elle crée un article',
  format('select public.ai_create_catalog_item(%L, ''Paillage ardoise'', ''material'', ''m2'')',
         (select v from ids where k='orgA')));

-- 8. Un chantier.
insert into ids
select 'chantier', (public.ai_create_project(
  (select v from ids where k='orgA'), (select v from ids where k='client'),
  'Restanques — réalisation', null, (select v from ids where k='devis'),
  current_date + 15, current_date + 45, null) ->> 'chantierId')::uuid;

insert into res select 'Le chantier naît « planned », jamais démarré', 'planned',
       (select status from public.projects where id = (select v from ids where k='chantier'));

-- 9. Une phase, 10. une tâche, 11. un avancement.
insert into ids
select 'phase', (public.ai_add_project_phase(
  (select v from ids where k='orgA'), (select v from ids where k='chantier'),
  'Terrassement', null, null) ->> 'phaseId')::uuid;

select pg_temp.accepte('Elle ajoute une tâche sur la phase',
  format('select public.ai_add_project_task(%L, %L, ''Louer la mini-pelle'', %L, 8, null)',
         (select v from ids where k='orgA'), (select v from ids where k='chantier'),
         (select v from ids where k='phase')));

select pg_temp.accepte('Elle note un avancement de 30 %',
  format('select public.ai_set_phase_progress(%L, %L, 30, ''inProgress'')',
         (select v from ids where k='orgA'), (select v from ids where k='phase')));

-- 12. Une intervention au planning.
select pg_temp.accepte('Elle pose une intervention',
  format('select public.ai_schedule_intervention(%L, ''Visite technique'', now() + interval ''2 days'', null, ''visit'', %L, %L)',
         (select v from ids where k='orgA'), (select v from ids where k='chantier'),
         (select v from ids where k='client')));

-- 13. Un lot de pépinière. Le décor minimal : un stade, un emplacement.
insert into ids select 'stade', gen_random_uuid();
insert into public.nursery_stages (id, organization_id, code, label, position, is_saleable)
select (select v from ids where k='stade'), (select v from ids where k='orgA'), 'C3', 'Conteneur 3 L', 3, true;

insert into ids select 'emplacement', gen_random_uuid();
insert into public.nursery_locations (id, organization_id, code, name, kind, capacity)
select (select v from ids where k='emplacement'), (select v from ids where k='orgA'),
       'S1', 'Serre 1', 'greenhouse', 500;

insert into ids
select 'lot', (public.ai_create_nursery_lot(
  (select v from ids where k='orgA'), 'Lavandula angustifolia', 200, null, null, 'C3',
  (select v from ids where k='stade'), (select v from ids where k='emplacement'), null, null
) ->> 'lotId')::uuid;

-- La quantité entre par un MOUVEMENT, comme sur l'écran : le lot part
-- de zéro et une réception l'amène à 200. Sans cela, le journal du lot
-- commencerait par un solde surgi de nulle part.
insert into res select 'Le lot est reçu, pas rempli à la main', '200',
       (select current_quantity::text from public.nursery_lots where id = (select v from ids where k='lot'));
insert into res select 'Et la réception figure au journal du lot', 'receive',
       (select kind from public.nursery_stock_movements
        where lot_id = (select v from ids where k='lot') order by occurred_at limit 1);

-- 14. Un mouvement de stock.
select pg_temp.accepte('Elle réserve 20 plants',
  format('select public.ai_record_stock_movement(%L, %L, ''reserve'', 20, null, ''Devis Rossi'')',
         (select v from ids where k='orgA'), (select v from ids where k='lot')));

insert into res select 'Une réservation ne touche pas au physique', '200/20',
       (select current_quantity || '/' || reserved_quantity
        from public.nursery_lots where id = (select v from ids where k='lot'));

-- 15. Une commande fournisseur brouillon.
insert into ids select 'fournisseur', gen_random_uuid();
insert into public.suppliers (id, organization_id, name)
select (select v from ids where k='fournisseur'), (select v from ids where k='orgA'), 'Pépinières du Ventoux';

insert into ids
select 'commande', (public.ai_create_purchase_order_draft(
  (select v from ids where k='orgA'), (select v from ids where k='fournisseur'),
  '[{"description":"Olivier 200/250","unit":"u","quantity":10,"unit_cost_cents":3000,"is_plant":true,
     "species_name":"Olea europaea"}]'::jsonb,
  current_date + 20, null, null) ->> 'commandeId')::uuid;

insert into res select 'La commande fournisseur reste un brouillon', 'draft',
       (select status from public.purchase_orders where id = (select v from ids where k='commande'));
insert into res select 'Et elle n''est pas envoyée', 'jamais',
       (select case when sent_at is null then 'jamais' else 'ENVOYÉE' end
        from public.purchase_orders where id = (select v from ids where k='commande'));

-- La recherche : le chaînon qui permet à l'assistant de nommer un
-- client autrement que par un UUID sorti de nulle part.
insert into res select 'La recherche trouve la cliente', 'oui',
       case when jsonb_array_length(
              public.ai_search_entities((select v from ids where k='orgA'), 'Rossi')) > 0
            then 'oui' else 'non' end;

-- ============================================================
-- CHAQUE ÉCRITURE LAISSE UNE TRACE, ET ELLE DIT « IA »
-- ============================================================
insert into res select 'Les quinze écritures sont au journal', '15',
       (select count(*)::text from public.audit_events
        where organization_id = (select v from ids where k='orgA')
          and action in ('aiCustomerCreated','aiOpportunityCreated','aiOpportunityStageChanged',
                         'aiActivityLogged','quoteDraftCreated','aiQuoteLinesAdded',
                         'aiCatalogItemCreated','aiProjectCreated','aiProjectPhaseCreated',
                         'aiProjectTaskCreated','aiPhaseProgressUpdated','aiInterventionScheduled',
                         'aiNurseryLotCreated','aiStockMovementRecorded','aiPurchaseOrderDraftCreated'));

-- « source » est ce qui rend une écriture de l'assistant reconnaissable
-- dans le journal des opérations. Une seule ligne écrite en 'web' et la
-- promesse tombe : on ne saurait plus laquelle vient de lui.
-- `organization.created` est exclue : c'est la création de l'entreprise
-- elle-même par `create_professional_organization`, et elle est bien un
-- geste manuel.
insert into res select 'Aucune ne se fait passer pour un geste manuel', '0',
       (select count(*)::text from public.audit_events
        where organization_id = (select v from ids where k='orgA')
          and action <> 'organization.created' and source <> 'ai');

-- L'auteur reste la personne, pas l'assistant : c'est elle qui a
-- cliqué, et c'est son nom qu'on cherchera dans six mois.
insert into res select 'Et l''auteur reste humain', '0',
       (select count(*)::text from public.audit_events
        where organization_id = (select v from ids where k='orgA')
          and actor_user_id is distinct from 'eeeeeee1-0000-4000-8000-0000000000e1'::uuid);

-- ============================================================
-- LES REFUS DÉLIBÉRÉS — les portes qu'on a choisi de ne pas percer
-- ============================================================
select pg_temp.refuse('Gagner une affaire n''est pas une saisie',
  format('select public.ai_set_opportunity_stage(%L, %L, ''won'')',
         (select v from ids where k='orgA'), (select v from ids where k='opp')));

select pg_temp.refuse('Ni la perdre',
  format('select public.ai_set_opportunity_stage(%L, %L, ''lost'')',
         (select v from ids where k='orgA'), (select v from ids where k='opp')));

select pg_temp.refuse('Créer une affaire déjà perdue',
  format('select public.ai_create_customer(%L, ''Client fantôme'', ''individual'', ''lost'')',
         (select v from ids where k='orgA')));

-- Un devis ENVOYÉ est une offre ferme : y glisser une ligne changerait
-- un prix que le client a déjà sous les yeux.
insert into ids select 'devisEnvoye', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, sent_at)
select (select v from ids where k='devisEnvoye'), (select v from ids where k='orgA'),
       (select v from ids where k='client'),
       public.next_quote_number((select v from ids where k='orgA')),
       'Offre remise', 'sent', now() - interval '2 days';

select pg_temp.refuse('Ajouter une ligne à un devis déjà envoyé',
  format('select public.ai_add_quote_draft_lines(%L, %L, ''[{"description":"Ligne glissée","quantity":1,"unit_sale_price_cents":100000}]''::jsonb)',
         (select v from ids where k='orgA'), (select v from ids where k='devisEnvoye')));

insert into res select 'Le devis envoyé n''a gagné aucune ligne', '0',
       (select count(*)::text from public.quote_lines where quote_id = (select v from ids where k='devisEnvoye'));

select pg_temp.refuse('Vendre du stock',
  format('select public.ai_record_stock_movement(%L, %L, ''sell'', 10)',
         (select v from ids where k='orgA'), (select v from ids where k='lot')));

select pg_temp.refuse('Ajuster un inventaire qu''on n''a pas compté',
  format('select public.ai_record_stock_movement(%L, %L, ''adjustment'', 0)',
         (select v from ids where k='orgA'), (select v from ids where k='lot')));

select pg_temp.refuse('Éclater un lot sans son mouvement jumeau',
  format('select public.ai_record_stock_movement(%L, %L, ''split'', 50)',
         (select v from ids where k='orgA'), (select v from ids where k='lot')));

insert into res select 'Le lot n''a pas bougé', '200',
       (select current_quantity::text from public.nursery_lots where id = (select v from ids where k='lot'));

-- Une phase d'un chantier, une tâche d'un AUTRE : pas une fuite, un
-- planning faux — et personne ne le verrait.
insert into ids
select 'chantier2', (public.ai_create_project(
  (select v from ids where k='orgA'), (select v from ids where k='client'),
  'Autre chantier', null, null, null, null, null) ->> 'chantierId')::uuid;

select pg_temp.refuse('Accrocher une tâche à la phase d''un autre chantier',
  format('select public.ai_add_project_task(%L, %L, ''Tâche égarée'', %L)',
         (select v from ids where k='orgA'), (select v from ids where k='chantier2'),
         (select v from ids where k='phase')));

-- ============================================================
-- L'OUVRIER — la bonne entreprise, pas les droits
-- ============================================================
-- Rôle `fieldWorker` : `projects.read`, et rien d'autre. Les quinze
-- fonctions doivent dire non, chacune sur SA permission.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','eeeeeee2-0000-4000-8000-0000000000e2')::text, true);
set local role authenticated;

-- Contrôle : il est bien membre, et il lit bien les chantiers. Sans ce
-- contrôle, un test qui passerait pourrait ne prouver qu'une session
-- cassée.
insert into res select 'L''ouvrier est bien dans l''entreprise', 'oui',
       case when public.is_organization_member((select v from ids where k='orgA')) then 'oui' else 'non' end;
insert into res select 'Et il voit bien les chantiers', 'oui',
       case when exists (select 1 from public.projects where id = (select v from ids where k='chantier'))
            then 'oui' else 'non' end;

select pg_temp.refuse('Sans clients.write : créer un client',
  format('select public.ai_create_customer(%L, ''Client de l''''ouvrier'')', (select v from ids where k='orgA')));
select pg_temp.refuse('Sans clients.write : créer une opportunité',
  format('select public.ai_create_opportunity(%L, %L, ''Opportunité'')',
         (select v from ids where k='orgA'), (select v from ids where k='client')));
select pg_temp.refuse('Sans clients.write : déplacer une opportunité',
  format('select public.ai_set_opportunity_stage(%L, %L, ''design'')',
         (select v from ids where k='orgA'), (select v from ids where k='opp')));
select pg_temp.refuse('Sans clients.write : consigner une activité',
  format('select public.ai_log_activity(%L, ''note'', ''Note'', null, %L)',
         (select v from ids where k='orgA'), (select v from ids where k='client')));
select pg_temp.refuse('Sans quotes.create : un brouillon de devis',
  format('select public.ai_create_quote_draft(%L, %L, ''Devis'', ''[]''::jsonb)',
         (select v from ids where k='orgA'), (select v from ids where k='client')));
select pg_temp.refuse('Sans quotes.edit : des lignes de devis',
  format('select public.ai_add_quote_draft_lines(%L, %L, ''[]''::jsonb)',
         (select v from ids where k='orgA'), (select v from ids where k='devis')));
select pg_temp.refuse('Sans quotes.edit : un article au catalogue',
  format('select public.ai_create_catalog_item(%L, ''Article'')', (select v from ids where k='orgA')));
select pg_temp.refuse('Sans projects.manage : un chantier',
  format('select public.ai_create_project(%L, %L, ''Chantier'')',
         (select v from ids where k='orgA'), (select v from ids where k='client')));
select pg_temp.refuse('Sans projects.manage : une phase',
  format('select public.ai_add_project_phase(%L, %L, ''Phase'')',
         (select v from ids where k='orgA'), (select v from ids where k='chantier')));
select pg_temp.refuse('Sans projects.manage : une tâche',
  format('select public.ai_add_project_task(%L, %L, ''Tâche'')',
         (select v from ids where k='orgA'), (select v from ids where k='chantier')));
select pg_temp.refuse('Sans projects.manage : un avancement',
  format('select public.ai_set_phase_progress(%L, %L, 100, ''done'')',
         (select v from ids where k='orgA'), (select v from ids where k='phase')));
select pg_temp.refuse('Sans projects.manage : une intervention',
  format('select public.ai_schedule_intervention(%L, ''Intervention'', now())',
         (select v from ids where k='orgA')));
select pg_temp.refuse('Sans nursery.stock.manage : un lot',
  format('select public.ai_create_nursery_lot(%L, ''Buxus'', 10)', (select v from ids where k='orgA')));
select pg_temp.refuse('Sans nursery.stock.manage : un mouvement',
  format('select public.ai_record_stock_movement(%L, %L, ''receive'', 10)',
         (select v from ids where k='orgA'), (select v from ids where k='lot')));
select pg_temp.refuse('Sans invoice.create : une commande fournisseur',
  format('select public.ai_create_purchase_order_draft(%L, %L, ''[]''::jsonb)',
         (select v from ids where k='orgA'), (select v from ids where k='fournisseur')));

insert into res select 'Rien de tout cela n''a laissé de trace', '0',
       (select count(*)::text from public.audit_events
        where organization_id = (select v from ids where k='orgA')
          and actor_user_id = 'eeeeeee2-0000-4000-8000-0000000000e2'::uuid);

-- ============================================================
-- LE CONFRÈRE — variante (a) : il nomme l'entreprise de la victime
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','eeeeeee3-0000-4000-8000-0000000000e3')::text, true);
set local role authenticated;

insert into res select 'Au départ, il ne voit pas la cliente', '0',
       (select count(*)::text from public.crm_customers where id = (select v from ids where k='client'));
insert into res select 'Ni le chantier', '0',
       (select count(*)::text from public.projects where id = (select v from ids where k='chantier'));
insert into res select 'Et la recherche ne lui rend rien', '0',
       jsonb_array_length(public.ai_search_entities((select v from ids where k='orgA'), 'Rossi'))::text;

select pg_temp.refuse('(a) Créer un client chez le voisin',
  format('select public.ai_create_customer(%L, ''Client volé'')', (select v from ids where k='orgA')));
select pg_temp.refuse('(a) Une opportunité chez le voisin',
  format('select public.ai_create_opportunity(%L, %L, ''Opportunité volée'')',
         (select v from ids where k='orgA'), (select v from ids where k='client')));
select pg_temp.refuse('(a) Déplacer l''opportunité du voisin',
  format('select public.ai_set_opportunity_stage(%L, %L, ''design'')',
         (select v from ids where k='orgA'), (select v from ids where k='opp')));
select pg_temp.refuse('(a) Écrire dans l''historique du voisin',
  format('select public.ai_log_activity(%L, ''note'', ''Note hostile'', null, %L)',
         (select v from ids where k='orgA'), (select v from ids where k='client')));
select pg_temp.refuse('(a) Un brouillon de devis chez le voisin',
  format('select public.ai_create_quote_draft(%L, %L, ''Devis hostile'', ''[]''::jsonb)',
         (select v from ids where k='orgA'), (select v from ids where k='client')));
select pg_temp.refuse('(a) Des lignes sur le devis du voisin',
  format('select public.ai_add_quote_draft_lines(%L, %L, ''[]''::jsonb)',
         (select v from ids where k='orgA'), (select v from ids where k='devis')));
select pg_temp.refuse('(a) Un article dans le catalogue du voisin',
  format('select public.ai_create_catalog_item(%L, ''Article volé'')', (select v from ids where k='orgA')));
select pg_temp.refuse('(a) Un chantier chez le voisin',
  format('select public.ai_create_project(%L, %L, ''Chantier volé'')',
         (select v from ids where k='orgA'), (select v from ids where k='client')));
select pg_temp.refuse('(a) Une phase sur le chantier du voisin',
  format('select public.ai_add_project_phase(%L, %L, ''Phase'')',
         (select v from ids where k='orgA'), (select v from ids where k='chantier')));
select pg_temp.refuse('(a) Une tâche sur le chantier du voisin',
  format('select public.ai_add_project_task(%L, %L, ''Tâche'')',
         (select v from ids where k='orgA'), (select v from ids where k='chantier')));
select pg_temp.refuse('(a) Un avancement sur la phase du voisin',
  format('select public.ai_set_phase_progress(%L, %L, 100, ''done'')',
         (select v from ids where k='orgA'), (select v from ids where k='phase')));
select pg_temp.refuse('(a) Une intervention dans le planning du voisin',
  format('select public.ai_schedule_intervention(%L, ''Intervention'', now())',
         (select v from ids where k='orgA')));
select pg_temp.refuse('(a) Un lot dans la pépinière du voisin',
  format('select public.ai_create_nursery_lot(%L, ''Buxus'', 10)', (select v from ids where k='orgA')));
select pg_temp.refuse('(a) Un mouvement sur le lot du voisin',
  format('select public.ai_record_stock_movement(%L, %L, ''loss'', 100)',
         (select v from ids where k='orgA'), (select v from ids where k='lot')));
select pg_temp.refuse('(a) Une commande chez le fournisseur du voisin',
  format('select public.ai_create_purchase_order_draft(%L, %L, ''[]''::jsonb)',
         (select v from ids where k='orgA'), (select v from ids where k='fournisseur')));

-- ============================================================
-- LE CONFRÈRE — variante (b) : SON entreprise, LES DONNÉES DU VOISIN
-- ============================================================
-- C'EST LE TEST QUI COMPTE. Ici la permission est irréprochable : il a
-- tous les droits sur son entreprise, et c'est elle qu'il nomme. Seule
-- la vérification du PARENT peut refuser. C'est exactement le motif qui
-- avait ouvert deux portes au Milestone 11 : une politique qui nomme
-- une permission et une organisation, sans jamais relier les deux bouts
-- de la ligne.
insert into ids select 'clientB', (public.ai_create_customer(
  (select v from ids where k='orgB'), 'Client du confrère') ->> 'clientId')::uuid;
insert into ids select 'chantierB', (public.ai_create_project(
  (select v from ids where k='orgB'), (select v from ids where k='clientB'),
  'Chantier du confrère') ->> 'chantierId')::uuid;

select pg_temp.refuse('(b) Une opportunité sur la cliente du voisin',
  format('select public.ai_create_opportunity(%L, %L, ''Détournement'')',
         (select v from ids where k='orgB'), (select v from ids where k='client')));
select pg_temp.refuse('(b) Déplacer l''opportunité du voisin, sous son propre pavillon',
  format('select public.ai_set_opportunity_stage(%L, %L, ''design'')',
         (select v from ids where k='orgB'), (select v from ids where k='opp')));
select pg_temp.refuse('(b) Une activité sur la fiche de la cliente du voisin',
  format('select public.ai_log_activity(%L, ''note'', ''Vu chez le concurrent'', null, %L)',
         (select v from ids where k='orgB'), (select v from ids where k='client')));
select pg_temp.refuse('(b) Un devis au nom de la cliente du voisin',
  format('select public.ai_create_quote_draft(%L, %L, ''Devis détourné'', ''[]''::jsonb)',
         (select v from ids where k='orgB'), (select v from ids where k='client')));
select pg_temp.refuse('(b) Des lignes sur le devis du voisin',
  format('select public.ai_add_quote_draft_lines(%L, %L, ''[{"description":"X","quantity":1,"unit_sale_price_cents":1}]''::jsonb)',
         (select v from ids where k='orgB'), (select v from ids where k='devis')));
select pg_temp.refuse('(b) Un chantier pour la cliente du voisin',
  format('select public.ai_create_project(%L, %L, ''Chantier détourné'')',
         (select v from ids where k='orgB'), (select v from ids where k='client')));
select pg_temp.refuse('(b) Une phase sur le chantier du voisin',
  format('select public.ai_add_project_phase(%L, %L, ''Phase détournée'')',
         (select v from ids where k='orgB'), (select v from ids where k='chantier')));
select pg_temp.refuse('(b) Une tâche sur le chantier du voisin',
  format('select public.ai_add_project_task(%L, %L, ''Tâche détournée'')',
         (select v from ids where k='orgB'), (select v from ids where k='chantier')));
select pg_temp.refuse('(b) Un avancement sur la phase du voisin',
  format('select public.ai_set_phase_progress(%L, %L, 100, ''done'')',
         (select v from ids where k='orgB'), (select v from ids where k='phase')));
select pg_temp.refuse('(b) Une intervention rattachée au chantier du voisin',
  format('select public.ai_schedule_intervention(%L, ''Visite'', now(), null, ''visit'', %L)',
         (select v from ids where k='orgB'), (select v from ids where k='chantier')));
select pg_temp.refuse('(b) Un lot posé dans la serre du voisin',
  format('select public.ai_create_nursery_lot(%L, ''Buxus'', 10, null, null, null, null, %L)',
         (select v from ids where k='orgB'), (select v from ids where k='emplacement')));
select pg_temp.refuse('(b) Un mouvement sur le lot du voisin',
  format('select public.ai_record_stock_movement(%L, %L, ''loss'', 100)',
         (select v from ids where k='orgB'), (select v from ids where k='lot')));
select pg_temp.refuse('(b) Une commande chez le fournisseur du voisin',
  format('select public.ai_create_purchase_order_draft(%L, %L, ''[]''::jsonb)',
         (select v from ids where k='orgB'), (select v from ids where k='fournisseur')));

-- Ce que le confrère a le droit d'écrire, il l'a bien écrit : la
-- création de son entreprise, son client, son chantier. Un correctif
-- qui fermerait aussi le chemin légitime n'en serait pas un.
insert into res select 'Son propre travail passe, lui', '3',
       (select count(*)::text from public.audit_events
        where organization_id = (select v from ids where k='orgB'));

-- ============================================================
-- LE DÉCOMPTE FINAL, VU DE HAUT
-- ============================================================
-- Hors rôle `authenticated`, donc sans RLS : c'est le seul point d'où
-- l'on peut affirmer que rien n'a bougé chez la victime. Depuis la
-- session du confrère, « je ne vois rien » et « il n'y a rien » se
-- ressemblent trop.
reset role;

insert into res select 'Aucune écriture n''a atterri chez le voisin', '0',
       (select count(*)::text from public.audit_events
        where organization_id = (select v from ids where k='orgA')
          and actor_user_id = 'eeeeeee3-0000-4000-8000-0000000000e3'::uuid);
insert into res select 'Le lot du voisin est intact', '200/20',
       (select current_quantity || '/' || reserved_quantity
        from public.nursery_lots where id = (select v from ids where k='lot'));
insert into res select 'Sa cliente n''a pas d''opportunité en trop', '1',
       (select count(*)::text from public.crm_opportunities
        where customer_id = (select v from ids where k='client'));
insert into res select 'Son chantier n''a pas de phase en trop', '1',
       (select count(*)::text from public.project_phases
        where project_id = (select v from ids where k='chantier'));
insert into res select 'Ni de tâche égarée', '1',
       (select count(*)::text from public.project_tasks
        where project_id = (select v from ids where k='chantier'));
insert into res select 'Et son fournisseur n''a reçu aucune commande du confrère', '1',
       (select count(*)::text from public.purchase_orders
        where supplier_id = (select v from ids where k='fournisseur'));

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
