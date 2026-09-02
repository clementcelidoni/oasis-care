-- §20 à §31 — RECHERCHE GLOBALE.
--
-- Deux moitiés, et la seconde compte plus que la première.
--
-- La première vérifie que la recherche TROUVE : accents, casse, fautes
-- de frappe, numéros incomplets, téléphones avec des espaces.
--
-- La seconde vérifie qu'elle NE TROUVE PAS — §31 : « Organisation A ne
-- voit JAMAIS Organisation B. Même en recherchant un ID exact. » Une
-- recherche qui traverse vingt tables d'un coup est l'endroit du
-- produit où une politique oubliée fuiterait le plus discrètement :
-- l'utilisateur tape un nom, voit un résultat de plus, et n'a aucune
-- raison de trouver ça anormal.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- Le patron de l'organisation A.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('eeeeeee1-0000-4000-8000-0000000000e1','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','a@test.invalid','',now(),now(),now(),'{}','{}');
-- Le patron de l'organisation B — le voisin.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('eeeeeee2-0000-4000-8000-0000000000e2','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','b@test.invalid','',now(),now(),now(),'{}','{}');
-- Un compte membre de rien.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('eeeeeee3-0000-4000-8000-0000000000e3','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','rien@test.invalid','',now(),now(),now(),'{}','{}');

-- ============================================================
-- L'organisation A et ses données
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','eeeeeee1-0000-4000-8000-0000000000e1')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Paysages A','landscaperAndNursery');
insert into ids select 'wsA', workspace_id from public.business_organizations
  where id = (select v from ids where k='orgA');
set local role authenticated;

insert into ids select 'clientA', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name, billing_city, phone)
select (select v from ids where k='clientA'), (select v from ids where k='orgA'),
       'customer', 'Villa Martin', 'Nice', '06.12.34.56.78';

insert into public.crm_contacts (organization_id, customer_id, first_name, last_name, phone, email)
select (select v from ids where k='orgA'), (select v from ids where k='clientA'),
       'Paul', 'Martin', '06 98 76 54 32', 'paul@martin.invalid';

-- Un devis dont le TITRE porte des accents, et dont une LIGNE parle
-- d'un olivier — §21 « lignes ; articles ; végétaux ».
insert into ids select 'devisA', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status)
select (select v from ids where k='devisA'), (select v from ids where k='orgA'),
       (select v from ids where k='clientA'),
       'DEV-2026-0042', 'Jardin méditerranéen', 'sent';

insert into public.quote_lines
  (organization_id, quote_id, description, unit, quantity,
   unit_cost_cents, unit_sale_price_cents, vat_rate, position)
select (select v from ids where k='orgA'), (select v from ids where k='devisA'),
       'Olivier centenaire', 'u', 1, 80000, 150000, 20, 0;

insert into ids select 'projetA', gen_random_uuid();
insert into public.projects (id, organization_id, customer_id, number, name)
select (select v from ids where k='projetA'), (select v from ids where k='orgA'),
       (select v from ids where k='clientA'), 'CHA-2026-0007', 'Création jardin Villa Martin';

-- Le jardin, sa zone et son olivier.
insert into ids select 'jardinA', gen_random_uuid();
insert into public.gardens (id, workspace_id, name)
select (select v from ids where k='jardinA'), (select v from ids where k='wsA'), 'Jardin Villa Martin';

insert into public.garden_map_objects
  (id, workspace_id, garden_id, object_type, label,
   position_x_meters, position_y_meters, width_meters, height_meters)
select gen_random_uuid(), (select v from ids where k='wsA'),
       (select v from ids where k='jardinA'), 'tree', 'Olivier principal', 5, 5, 4, 4;

insert into public.nursery_lots
  (organization_id, lot_code, species_name, container_size,
   initial_quantity, current_quantity, status)
select (select v from ids where k='orgA'), 'LOT-2026-0248', 'Trachycarpus fortunei', 'C10', 40, 40, 'available';

-- ============================================================
-- L'organisation B — le voisin, avec des noms VOISINS
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','eeeeeee2-0000-4000-8000-0000000000e2')::text, true);
insert into ids select 'orgB', public.create_professional_organization('Paysages B','landscaper');
insert into ids select 'wsB', workspace_id from public.business_organizations
  where id = (select v from ids where k='orgB');
set local role authenticated;

insert into ids select 'clientB', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name, billing_city)
select (select v from ids where k='clientB'), (select v from ids where k='orgB'),
       'customer', 'Villa Martin du voisin', 'Nice';

insert into ids select 'devisB', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status)
select (select v from ids where k='devisB'), (select v from ids where k='orgB'),
       (select v from ids where k='clientB'),
       'DEV-2026-0042', 'Jardin méditerranéen du voisin', 'sent';

insert into ids select 'jardinB', gen_random_uuid();
insert into public.gardens (id, workspace_id, name)
select (select v from ids where k='jardinB'), (select v from ids where k='wsB'), 'Jardin Villa Martin du voisin';

-- ============================================================
-- CE QUE A TROUVE
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','eeeeeee1-0000-4000-8000-0000000000e1')::text, true);
set local role authenticated;

insert into res
select 'Le client se trouve par son nom', 'Villa Martin',
       coalesce((select title from public.global_search((select v from ids where k='orgA'), 'villa martin')
                 where entity_type = 'client' limit 1), 'RIEN');

-- §24 FUZZY — « accents ». L'utilisateur ne tape pas les accents.
insert into res
select 'Sans accent, on trouve quand même', 'Jardin méditerranéen',
       coalesce((select title from public.global_search((select v from ids where k='orgA'), 'mediterraneen')
                 where entity_type = 'quote' limit 1), 'RIEN');

-- §24 — « casse ».
insert into res
select 'La casse est ignorée', 'Villa Martin',
       coalesce((select title from public.global_search((select v from ids where k='orgA'), 'VILLA MARTIN')
                 where entity_type = 'client' limit 1), 'RIEN');

-- §24 — « recherche partielle », exemple de la spec : « trachy » →
-- Trachycarpus fortunei.
insert into res
select 'Une recherche partielle trouve l''espèce', 'LOT-2026-0248',
       coalesce((select title from public.global_search((select v from ids where k='orgA'), 'trachy')
                 where entity_type = 'lot' limit 1), 'RIEN');

-- §24 — « fautes légères ». C'est la trigramme qui rattrape, pas le LIKE.
insert into res
select 'Une faute de frappe est rattrapée', 'LOT-2026-0248',
       coalesce((select title from public.global_search((select v from ids where k='orgA'), 'trachicarpus')
                 where entity_type = 'lot' limit 1), 'RIEN');

-- §24 IDENTIFIANTS — « DEV-0042 ». Le numéro réel porte l'année ; on ne
-- la tape pas.
insert into res
select 'Un numéro incomplet retrouve le devis', 'Jardin méditerranéen',
       coalesce((select title from public.global_search((select v from ids where k='orgA'), 'DEV-0042')
                 where entity_type = 'quote' limit 1), 'RIEN');

insert into res
select 'Les quatre chiffres suffisent', 'Jardin méditerranéen',
       coalesce((select title from public.global_search((select v from ids where k='orgA'), '0042')
                 where entity_type = 'quote' limit 1), 'RIEN');

-- §24 TÉLÉPHONE — « 06 12 34 56 78 → client/contact ». Enregistré avec
-- des points, tapé avec des espaces.
insert into res
select 'Un téléphone se retrouve malgré les séparateurs', 'Villa Martin',
       coalesce((select title from public.global_search((select v from ids where k='orgA'), '06 12 34 56 78')
                 where entity_type = 'client' limit 1), 'RIEN');

-- §21 — chercher dans les LIGNES du devis, et rendre le DEVIS.
insert into res
select 'Un article du devis retrouve le devis', 'Jardin méditerranéen',
       coalesce((select title from public.global_search((select v from ids where k='orgA'), 'olivier centenaire')
                 where entity_type = 'quote_line' limit 1), 'RIEN');

-- §21 DIGITAL TWIN — « Olivier Martin doit retrouver l'Olivier du
-- Digital Twin concerné », et le sous-titre doit dire DE QUEL jardin.
insert into res
select 'L''olivier du plan est trouvé, avec son jardin', 'Olivier principal|Jardin Villa Martin',
       coalesce((select title || '|' || subtitle
                 from public.global_search((select v from ids where k='orgA'), 'olivier')
                 where entity_type = 'garden_object' limit 1), 'RIEN');

-- §23 OUVERTURE DIRECTE — l'URL doit mener quelque part.
insert into res
select 'Le résultat porte l''adresse de sa fiche', 'oui',
       case when (select url from public.global_search((select v from ids where k='orgA'), 'villa martin')
                  where entity_type = 'client' limit 1)
                 = '/crm/clients/' || (select v from ids where k='clientA')
            then 'oui' else 'non' end;

-- §25 FILTRES — restreindre à une famille.
insert into res
select 'Le filtre par type ne rend que ce type', 'quote',
       coalesce((select string_agg(distinct entity_type, ',')
                 from public.global_search((select v from ids where k='orgA'), 'martin', array['quote'])), 'RIEN');

-- §22 GROUPES — plusieurs familles pour une même recherche.
insert into res
select 'Une recherche large touche plusieurs familles', 'oui',
       case when (select count(distinct entity_type)
                  from public.global_search((select v from ids where k='orgA'), 'martin')) >= 3
            then 'oui' else 'non' end;

-- ============================================================
-- §31 CE QUE A NE DOIT PAS TROUVER
-- ============================================================
insert into res
select 'Le client du voisin reste invisible', '0', count(*)::text
from public.global_search((select v from ids where k='orgA'), 'du voisin');

insert into res
select 'Le devis du voisin aussi', '0', count(*)::text
from public.global_search((select v from ids where k='orgA'), 'mediterraneen')
where title like '%voisin%';

insert into res
select 'Le jardin du voisin aussi', '0', count(*)::text
from public.global_search((select v from ids where k='orgA'), 'villa martin')
where entity_type = 'garden' and title like '%voisin%';

-- « Même en recherchant un ID exact. »
insert into res
select 'Chercher l''identifiant exact du voisin ne donne rien', '0', count(*)::text
from public.global_search((select v from ids where k='orgA'),
                          (select v from ids where k='devisB')::text);

-- Et passer l'identifiant de l'organisation du voisin ne l'ouvre pas
-- davantage : la fonction vérifie l'appartenance avant tout le reste.
insert into res
select 'Demander la recherche DANS l''organisation du voisin ne rend rien', '0', count(*)::text
from public.global_search((select v from ids where k='orgB'), 'villa martin');

-- ============================================================
-- Les garde-fous
-- ============================================================
insert into res
select 'Une lettre seule ne déclenche rien', '0', count(*)::text
from public.global_search((select v from ids where k='orgA'), 'a');

insert into res
select 'Une recherche vide ne déclenche rien', '0', count(*)::text
from public.global_search((select v from ids where k='orgA'), '   ');

-- Un compte membre de rien.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','eeeeeee3-0000-4000-8000-0000000000e3')::text, true);
set local role authenticated;

insert into res
select 'Un compte membre de rien ne trouve rien', '0', count(*)::text
from public.global_search((select v from ids where k='orgA'), 'villa martin');

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
