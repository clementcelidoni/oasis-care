-- Milestone 11 — portail client.
--
-- « Les données internes de marge / coûts / notes privées ne doivent
-- JAMAIS être transférées au client. »
--
-- C'est le test le plus important de la phase, et il est écrit à
-- l'envers des autres : la plupart des assertions vérifient une
-- ABSENCE. Un portail qui montre trop ne se signale par aucune erreur —
-- il fonctionne parfaitement, et fuite.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- Le professionnel.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('bbbbbbb1-0000-4000-8000-0000000000b1','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','pro@test.invalid','',now(),now(),now(),'{}','{}');
-- Le client invité.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('bbbbbbb2-0000-4000-8000-0000000000b2','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','client@test.invalid','',now(),now(),now(),'{}','{}');
-- Un AUTRE client de la même entreprise : le voisin ne doit rien voir.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('bbbbbbb3-0000-4000-8000-0000000000b3','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','voisin@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','bbbbbbb1-0000-4000-8000-0000000000b1')::text, true);
insert into ids select 'org', public.create_professional_organization('Portail Test','landscaper');
insert into ids select 'ws', workspace_id from public.business_organizations
  where id = (select v from ids where k='org');

set local role authenticated;

insert into ids select 'client', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name, notes)
select (select v from ids where k='client'), (select v from ids where k='org'),
       'customer', 'Madame Martin', 'Paye toujours en retard';

insert into ids select 'voisin', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name)
select (select v from ids where k='voisin'), (select v from ids where k='org'),
       'customer', 'Monsieur Dupont';

-- Un devis ENVOYÉ, avec un coût d'achat et des notes internes.
insert into ids select 'devis', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status, internal_notes)
select (select v from ids where k='devis'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_quote_number((select v from ids where k='org')),
       'Jardin méditerranéen', 'sent', 'Marge faible, ne pas négocier';

insert into public.quote_lines
  (organization_id, quote_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, vat_rate, position)
select (select v from ids where k='org'), (select v from ids where k='devis'),
       'Olivier', 'u', 10, 3000, 12000, 20, 0;

-- Un devis encore en BROUILLON : le client ne doit pas le découvrir.
insert into ids select 'brouillon', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status)
select (select v from ids where k='brouillon'), (select v from ids where k='org'),
       (select v from ids where k='client'),
       public.next_quote_number((select v from ids where k='org')),
       'Idée pour plus tard', 'draft';

-- Un devis pour le VOISIN.
insert into ids select 'devisVoisin', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status)
select (select v from ids where k='devisVoisin'), (select v from ids where k='org'),
       (select v from ids where k='voisin'),
       public.next_quote_number((select v from ids where k='org')),
       'Terrasse du voisin', 'sent';

-- Un chantier avec ses coûts.
insert into ids select 'chantier', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, quote_id, number, name, notes)
select (select v from ids where k='chantier'), (select v from ids where k='org'),
       (select v from ids where k='client'), (select v from ids where k='devis'),
       public.next_project_number((select v from ids where k='org')),
       'Jardin Martin', 'Client difficile sur les délais';

insert into public.project_phases (organization_id, project_id, title, position, progress_percent)
select (select v from ids where k='org'), (select v from ids where k='chantier'), 'Plantation', 0, 40;

insert into public.project_costs
  (organization_id, project_id, kind, description, quantity, unit_cost_cents)
select (select v from ids where k='org'), (select v from ids where k='chantier'),
       'plant', 'Oliviers achetés', 10, 3000;

-- Le jardin dessiné par le professionnel, dans SON espace.
insert into ids select 'jardin', gen_random_uuid();
insert into public.gardens (id, workspace_id, name)
select (select v from ids where k='jardin'), (select v from ids where k='ws'), 'Jardin Martin';

insert into public.garden_map_objects
  (id, workspace_id, garden_id, object_type, position_x_meters, position_y_meters,
   width_meters, height_meters)
select gen_random_uuid(), (select v from ids where k='ws'),
       (select v from ids where k='jardin'), 'tree', 5, 5, 4, 4;

-- ============================================================
-- L'invitation
-- ============================================================
insert into ids select 'jeton', gen_random_uuid();
create temp table tok(v text) on commit drop;
grant all on tok to authenticated;
insert into tok select public.invite_client((select v from ids where k='client'), 'client@test.invalid');

insert into res
select 'L''invitation porte un jeton long et aléatoire', '64',
       length((select v from tok))::text;

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','bbbbbbb2-0000-4000-8000-0000000000b2')::text, true);
set local role authenticated;

-- Avant d'accepter, il doit savoir de qui vient l'invitation.
insert into res
select 'L''invité voit qui l''invite, sans plus', 'Portail Test|false',
       coalesce((select company_name from public.client_invitation_preview((select v from tok))), 'RIEN')
       || '|' || (select accepted::text from public.client_invitation_preview((select v from tok)));

-- Et un jeton inventé ne renvoie rien plutôt qu'une erreur bavarde.
insert into res
select 'Un jeton inventé ne dit rien', '0', count(*)::text
from public.client_invitation_preview('00000000000000000000000000000000');

insert into res
select 'Le client accepte son invitation', 'oui',
       case when public.accept_client_invitation((select v from tok))
                 = (select v from ids where k='client')
            then 'oui' else 'non' end;

-- ============================================================
-- CE QUE LE CLIENT VOIT
-- ============================================================
insert into res
select 'Il voit son devis envoyé', 'Jardin méditerranéen',
       coalesce((select title from public.client_quotes), 'RIEN');

insert into res
select 'Avec le prix de vente', '12000',
       coalesce((select unit_sale_price_cents::text from public.client_quote_lines), 'RIEN');

insert into res
select 'Il voit son chantier', 'Jardin Martin',
       coalesce((select name from public.client_projects), 'RIEN');

insert into res
select 'Et son avancement', '40',
       coalesce((select progress_percent::text from public.client_project_phases), 'RIEN');

-- ============================================================
-- CE QU'IL NE DOIT PAS VOIR — le cœur du test
-- ============================================================
insert into res
select 'Le PRIX D''ACHAT n''existe pas dans sa vue', 'absente',
       coalesce((select 'PRÉSENTE' from information_schema.columns
                 where table_schema='public' and table_name='client_quote_lines'
                   and column_name='unit_cost_cents' limit 1), 'absente');

insert into res
select 'Ni le total de coût', 'absente',
       coalesce((select 'PRÉSENTE' from information_schema.columns
                 where table_schema='public' and table_name='client_quote_lines'
                   and column_name='cost_total_cents' limit 1), 'absente');

insert into res
select 'Ni les notes internes du devis', 'absente',
       coalesce((select 'PRÉSENTE' from information_schema.columns
                 where table_schema='public' and table_name='client_quotes'
                   and column_name='internal_notes' limit 1), 'absente');

insert into res
select 'Ni les notes internes de la facture', 'absente',
       coalesce((select 'PRÉSENTE' from information_schema.columns
                 where table_schema='public' and table_name='client_invoices'
                   and column_name='internal_notes' limit 1), 'absente');

insert into res
select 'Ni les notes du chantier', 'absente',
       coalesce((select 'PRÉSENTE' from information_schema.columns
                 where table_schema='public' and table_name='client_projects'
                   and column_name='notes' limit 1), 'absente');

-- Les tables elles-mêmes restent fermées : le client n'est membre
-- d'aucune organisation, aucune politique ne le laisse entrer.
insert into res select 'La table des devis lui est fermée', '0', count(*)::text from public.quotes;
insert into res select 'Celle des chantiers aussi', '0', count(*)::text from public.projects;
insert into res select 'Les coûts de chantier lui sont fermés', '0', count(*)::text from public.project_costs;
insert into res select 'Les ressources prévues aussi', '0', count(*)::text from public.project_resources;
insert into res select 'Et les pointages', '0', count(*)::text from public.time_entries;
insert into res select 'Et les fiches clients', '0', count(*)::text from public.crm_customers;

-- Le brouillon n'est pas un document remis.
insert into res
select 'Un devis en brouillon reste invisible', '0', count(*)::text
from public.client_quotes where title = 'Idée pour plus tard';

-- Le voisin non plus.
insert into res
select 'Le devis du voisin reste invisible', '0', count(*)::text
from public.client_quotes where title = 'Terrasse du voisin';

insert into res
select 'Il ne voit QUE son devis', '1', count(*)::text from public.client_quotes;

-- Le jardin n'est pas encore livré.
insert into res
select 'Le jardin non livré reste invisible', '0', count(*)::text from public.gardens;

-- ============================================================
-- La livraison du jardin
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','bbbbbbb1-0000-4000-8000-0000000000b1')::text, true);
set local role authenticated;

insert into res
select 'Le professionnel livre le jardin', 'oui',
       case when public.deliver_garden_to_client(
              (select v from ids where k='jardin'), (select v from ids where k='client'))
            = 'bbbbbbb2-0000-4000-8000-0000000000b2' then 'oui' else 'non' end;

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','bbbbbbb2-0000-4000-8000-0000000000b2')::text, true);
set local role authenticated;

insert into res
select 'Le client voit maintenant son jardin', 'Jardin Martin',
       coalesce((select name from public.gardens where id = (select v from ids where k='jardin')), 'RIEN');

insert into res
select 'Et le plan qui va avec', '1', count(*)::text
from public.garden_map_objects where garden_id = (select v from ids where k='jardin');

insert into res
select 'Le jardin est passé dans SON espace de travail', 'oui',
       case when (select workspace_id from public.gardens where id = (select v from ids where k='jardin'))
                 = (select id from public.workspaces where owner_id = 'bbbbbbb2-0000-4000-8000-0000000000b2')
            then 'oui' else 'NON — la révocation ne mordrait pas' end;

-- Les photos du chantier : le chemin est
-- {organisation}/{chantier}/{fichier}, et c'est le chantier qui decide.
insert into res
select 'Il peut lire les photos de SON chantier', 'true',
       public.portal_can_read_project_photo(
         (select v from ids where k='org')::text || '/' ||
         (select v from ids where k='chantier')::text || '/photo.jpg')::text;

insert into res
select 'Pas celles du chantier d''un autre', 'false',
       public.portal_can_read_project_photo(
         (select v from ids where k='org')::text || '/' ||
         gen_random_uuid()::text || '/photo.jpg')::text;

insert into res
select 'Un chemin malforme refuse au lieu d''echouer', 'false',
       public.portal_can_read_project_photo('photo.jpg')::text;

-- Livrer le jardin ne livre RIEN d'autre.
insert into res select 'Livrer le jardin n''ouvre pas les coûts', '0', count(*)::text
from public.project_costs;

-- Le portail doit pouvoir nommer l'entreprise, sinon il n'affiche
-- qu'un identifiant.
insert into res
select 'Il sait chez qui il est client', 'Portail Test|1',
       coalesce((select name from public.client_portal_companies), 'RIEN')
       -- Une seule entreprise : celle qui l'a invité. Pas celle du
       -- voisin, dont la fixture existe elle aussi.
       || '|' || (select count(*)::text from public.client_portal_companies);

-- ============================================================
-- Retirer l'accès du professionnel
-- ============================================================
-- Avant de retirer, il faut VOIR. Sans cette ligne, l'écran du
-- propriétaire n'aurait personne à lui proposer de révoquer.
insert into res
select 'Le propriétaire voit l''accès du professionnel', '1', count(*)::text
from public.garden_access
where garden_id = (select v from ids where k='jardin')
  and user_id = 'bbbbbbb1-0000-4000-8000-0000000000b1'
  and revoked_at is null;

insert into res
select 'Le propriétaire retire l''accès du professionnel', 'ok',
       coalesce((select 'ok' from (
         select public.revoke_garden_access(
           (select v from ids where k='jardin'), 'bbbbbbb1-0000-4000-8000-0000000000b1')
       ) t), 'ok');

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','bbbbbbb1-0000-4000-8000-0000000000b1')::text, true);
set local role authenticated;

insert into res
select 'Le professionnel ne voit plus le jardin', '0', count(*)::text
from public.gardens where id = (select v from ids where k='jardin');

-- §"LE PROFESSIONNEL CONSERVE" — devis, chantier, factures restent à lui.
insert into res
select 'Mais il garde son devis', '1', count(*)::text
from public.quotes where id = (select v from ids where k='devis');

insert into res
select 'Son chantier', '1', count(*)::text
from public.projects where id = (select v from ids where k='chantier');

insert into res
select 'Et ses coûts', '1', count(*)::text
from public.project_costs where project_id = (select v from ids where k='chantier');

-- ============================================================
-- Un compte sans invitation ne voit rien
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','bbbbbbb3-0000-4000-8000-0000000000b3')::text, true);
set local role authenticated;

insert into res select 'Un compte non invité ne voit aucun devis', '0', count(*)::text
from public.client_quotes;
insert into res select 'Aucune facture', '0', count(*)::text from public.client_invoices;
insert into res select 'Aucun chantier', '0', count(*)::text from public.client_projects;
insert into res select 'Aucun jardin', '0', count(*)::text from public.gardens;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
