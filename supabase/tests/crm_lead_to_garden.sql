-- Phase 11 §"TEST MILESTONE 2" : Lead → Customer → CustomerSite → Garden.
--
-- Déroule le parcours commercial complet en tant qu'utilisateur réel
-- (role authenticated + claims JWT), donc sous RLS, et vérifie au
-- passage la propriété qui compte vraiment : la conversion d'un
-- prospect en client ne recopie AUCUNE donnée.
--
-- Vérifie aussi qu'un membre sans la permission clients.write ne peut
-- rien écrire, et qu'une organisation concurrente ne voit rien.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.
-- Dernier résultat : 12/12 le 2026-08-27.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- ---------- Fixtures ----------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
 ('aaaaaaaa-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','patron@crm-test.invalid','',now(),now(),now(),'{}','{}'),
 ('cccccccc-0000-4000-8000-00000000000c','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','ouvrier@crm-test.invalid','',now(),now(),now(),'{}','{}'),
 ('dddddddd-0000-4000-8000-00000000000d','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','concurrent@crm-test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaaaa-0000-4000-8000-00000000000a','email','patron@crm-test.invalid')::text, true);
insert into ids select 'org', public.create_professional_organization('Paysages Test','landscaper');
insert into ids select 'ws', workspace_id from public.business_organizations
  where id = (select v from ids where k='org');

-- Un ouvrier : membre de la même organisation, mais sans clients.write.
insert into public.organization_members (organization_id, user_id, role)
select v, 'cccccccc-0000-4000-8000-00000000000c', 'fieldWorker' from ids where k='org';

-- Une organisation concurrente, pour le contrôle d'étanchéité.
select set_config('request.jwt.claims',
  json_build_object('sub','dddddddd-0000-4000-8000-00000000000d','email','concurrent@crm-test.invalid')::text, true);
insert into ids select 'orgRivale', public.create_professional_organization('Concurrent','landscaper');

-- ---------- Parcours commercial, en tant que patron ----------
select set_config('request.jwt.claims',
  json_build_object('sub','aaaaaaaa-0000-4000-8000-00000000000a','email','patron@crm-test.invalid')::text, true);
set local role authenticated;

-- 1. Un prospect arrive.
with nouveau as (
  insert into public.crm_customers
    (organization_id, display_name, kind, email, phone, billing_city, source)
  select v,'Famille Martin','individual','martin@exemple.invalid','0600000000','Antibes','salon'
  from ids where k='org'
  returning id
)
insert into ids select 'client', id from nouveau;

insert into res
select 'Le prospect est créé au stade lead','lead',lifecycle_stage
from public.crm_customers where id = (select v from ids where k='client');

-- 2. Un contact et une activité de visite.
insert into public.crm_contacts (organization_id, customer_id, last_name, first_name, email, is_primary)
select (select v from ids where k='org'), (select v from ids where k='client'),
       'Martin','Sophie','sophie@exemple.invalid', true;

insert into public.crm_activities (organization_id, customer_id, activity_type, subject, body)
select (select v from ids where k='org'), (select v from ids where k='client'),
       'visit','Visite du terrain','Terrain en pente, exposition sud.';

-- 3. Une opportunité.
with opp as (
  insert into public.crm_opportunities
    (organization_id, customer_id, title, stage, estimated_value_cents, probability_percent)
  select (select v from ids where k='org'), (select v from ids where k='client'),
         'Création jardin méditerranéen','visit', 1850000, 60
  returning id
)
insert into ids select 'opp', id from opp;

-- 4. Conversion en client. Le point clé : rien n'est recopié.
select public.convert_lead_to_customer((select v from ids where k='client'));

insert into res
select 'Le prospect converti devient client','customer',lifecycle_stage
from public.crm_customers where id = (select v from ids where k='client');

insert into res
select 'La conversion ne duplique aucune fiche','1',count(*)::text
from public.crm_customers where organization_id = (select v from ids where k='org');

insert into res
select 'L''e-mail saisi au stade prospect est conservé','martin@exemple.invalid',coalesce(email,'PERDU')
from public.crm_customers where id = (select v from ids where k='client');

insert into res
select 'L''historique du prospect suit le client','1',count(*)::text
from public.crm_activities where customer_id = (select v from ids where k='client');

-- 5. Le site du client, puis son jardin.
-- `gardens.id` n'a PAS de default : la table est alimentée par l'app
-- iOS, qui génère ses UUID côté client et fait un upsert dessus. Toute
-- création de jardin depuis le web doit donc fournir l'id elle aussi.
with jardin as (
  insert into public.gardens (id, workspace_id, name)
  select gen_random_uuid(), v,'Jardin Martin' from ids where k='ws'
  returning id
)
insert into ids select 'jardin', id from jardin;

with site as (
  insert into public.crm_customer_sites
    (organization_id, customer_id, name, site_type, city, postal_code, garden_id)
  select (select v from ids where k='org'), (select v from ids where k='client'),
         'Résidence principale','residence','Antibes','06600',
         (select v from ids where k='jardin')
  returning id
)
insert into ids select 'site', id from site;

insert into res
select 'Le site est bien relié à un vrai jardin','true',
       (garden_id is not null)::text
from public.crm_customer_sites where id = (select v from ids where k='site');

insert into res
select 'Le jardin lié est celui de gardens (table partagée avec iOS)','Jardin Martin',
       coalesce((select g.name from public.gardens g
                 join public.crm_customer_sites s on s.garden_id = g.id
                 where s.id = (select v from ids where k='site')), 'INTROUVABLE');

-- 6. Recherche et filtres.
insert into res
select 'La recherche par ville trouve le client','1',count(*)::text
from public.crm_customers
where organization_id = (select v from ids where k='org')
  and to_tsvector('simple', coalesce(display_name,'') || ' ' || coalesce(legal_name,'') || ' ' ||
      coalesce(email,'') || ' ' || coalesce(billing_city,'')) @@ plainto_tsquery('simple','Antibes');

insert into res
select 'Le filtre « prospects » n''affiche plus ce client','0',count(*)::text
from public.crm_customers
where organization_id = (select v from ids where k='org') and lifecycle_stage = 'lead';

-- ---------- Contrôle de permission : l'ouvrier ----------
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','cccccccc-0000-4000-8000-00000000000c','email','ouvrier@crm-test.invalid')::text, true);
set local role authenticated;

insert into res
select 'Un ouvrier (sans clients.read) ne voit aucun client','0',count(*)::text
from public.crm_customers;

do $$
declare refuse boolean := false;
begin
  begin
    insert into public.crm_customers (organization_id, display_name)
    select v,'Client pirate' from ids where k='org';
  exception when others then
    refuse := true;
  end;
  insert into res values ('Un ouvrier ne peut pas créer de client','true',refuse::text);
end $$;

-- ---------- Contrôle d'étanchéité : le concurrent ----------
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','dddddddd-0000-4000-8000-00000000000d','email','concurrent@crm-test.invalid')::text, true);
set local role authenticated;

insert into res
select 'Une organisation concurrente ne voit aucun client','0',count(*)::text
from public.crm_customers;

insert into res
select 'Une organisation concurrente ne voit aucune opportunité','0',count(*)::text
from public.crm_opportunities;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
