-- Aucune vue en `security definer` ne doit accepter une écriture.
--
-- Ce test est né d'une faille réelle. Les vues `client_*` de la
-- migration 0055 sont en `security definer` — sans quoi un client, qui
-- n'est membre d'aucune organisation, ne pourrait rien lire. Mais une
-- telle vue n'a pas de RLS : elle s'exécute avec les droits de son
-- propriétaire, et sa clause `where` est le seul filtre.
--
-- Supabase accordant par défaut TOUS les droits sur les objets de
-- `public` à `anon` et `authenticated`, ces vues sont nées
-- modifiables. Un visiteur anonyme, sans jeton, a inséré une ligne dans
-- `quotes` en écrivant dans `client_quotes`.
--
-- Le contrôle est mécanique, et il vaut pour les vues à venir : on
-- interroge le catalogue plutôt qu'une liste écrite à la main, donc
-- une onzième vue oubliée sera signalée le jour où elle apparaîtra.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;

-- ============================================================
-- Le catalogue
-- ============================================================
insert into res
select
  'Aucune vue en security definer n''accepte une écriture',
  'AUCUNE',
  coalesce(string_agg(distinct vue || ' → ' || grantee, ', '), 'AUCUNE')
from (
  select c.relname as vue, g.grantee
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join information_schema.role_table_grants g
    on g.table_schema = 'public' and g.table_name = c.relname
  where n.nspname = 'public'
    and c.relkind = 'v'
    -- `security_invoker` absent vaut `false` : c'est le défaut de
    -- PostgreSQL, et c'est le cas dangereux.
    and coalesce((select option_value from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'false') <> 'true'
    and g.grantee in ('anon', 'authenticated', 'PUBLIC')
    and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
) ouvertes;

-- `anon` ne lit rien non plus. Le filtre de ces vues repose sur
-- `auth.uid()` : il ne rendrait aucune ligne à un anonyme, mais un
-- droit qu'on n'a pas est plus sûr qu'un filtre qui rend zéro.
-- Les VUES seulement. `client_invitations` et `client_portal_access`
-- sont de vraies tables, protégées par leur RLS comme le reste du
-- projet — leur laisser les droits par défaut est cohérent, et sans
-- effet : aucune politique ne répond à un anonyme.
insert into res
select
  'anon n''a même pas le droit de lire les vues client',
  'AUCUNE',
  coalesce(string_agg(distinct g.table_name, ', '), 'AUCUNE')
from information_schema.role_table_grants g
join pg_class c on c.relname = g.table_name and c.relkind = 'v'
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where g.table_schema = 'public'
  and g.table_name like 'client\_%'
  and g.grantee = 'anon';

-- ============================================================
-- La tentative, pour de vrai
-- ============================================================
-- Le catalogue peut mentir si un droit arrive par un chemin auquel on
-- n'a pas pensé. On essaie donc l'attaque elle-même.
create temp table ids(k text, v uuid) on commit drop;
grant all on res to anon, authenticated;
grant all on ids to anon, authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('ccccccc1-0000-4000-8000-0000000000c1','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','sonde@test.invalid','',now(),now(),now(),'{}','{}');

select set_config('request.jwt.claims',
  json_build_object('sub','ccccccc1-0000-4000-8000-0000000000c1')::text, true);
insert into ids select 'org', public.create_professional_organization('Sonde','landscaper');

insert into ids select 'client', gen_random_uuid();
set local role authenticated;
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name)
select (select v from ids where k='client'), (select v from ids where k='org'), 'customer', 'Cible';
reset role;

-- Un visiteur anonyme, sans aucun jeton.
select set_config('request.jwt.claims', null, true);
set local role anon;

do $$
begin
  insert into public.client_quotes
    (id, organization_id, customer_id, number, title, status, issued_on, global_discount_percent)
  values (gen_random_uuid(),
          (select v from ids where k='org'),
          (select v from ids where k='client'),
          'SONDE-001', 'Injecte par un anonyme', 'sent', current_date, 0);
  insert into res values ('Un anonyme écrit dans quotes par la vue', 'refusé', 'ACCEPTÉ');
exception when insufficient_privilege then
  insert into res values ('Un anonyme écrit dans quotes par la vue', 'refusé', 'refusé');
when others then
  insert into res values ('Un anonyme écrit dans quotes par la vue', 'refusé',
                          'refusé autrement : ' || sqlstate);
end $$;

reset role;
insert into res
select 'Rien n''est arrivé dans quotes', '0', count(*)::text
from public.quotes where number = 'SONDE-001';

-- Un client AUTHENTIFIÉ ne doit pas pouvoir se déclarer payé non plus.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','ccccccc1-0000-4000-8000-0000000000c1')::text, true);

do $$
begin
  update public.client_invoices set status = 'paid';
  insert into res values ('Un client ne modifie pas ses factures', 'refusé', 'ACCEPTÉ');
exception when insufficient_privilege then
  insert into res values ('Un client ne modifie pas ses factures', 'refusé', 'refusé');
when others then
  insert into res values ('Un client ne modifie pas ses factures', 'refusé',
                          'refusé autrement : ' || sqlstate);
end $$;

do $$
begin
  delete from public.client_projects;
  insert into res values ('Un client ne supprime pas ses chantiers', 'refusé', 'ACCEPTÉ');
exception when insufficient_privilege then
  insert into res values ('Un client ne supprime pas ses chantiers', 'refusé', 'refusé');
when others then
  insert into res values ('Un client ne supprime pas ses chantiers', 'refusé',
                          'refusé autrement : ' || sqlstate);
end $$;

-- Et la lecture, elle, marche toujours.
do $$
declare n int;
begin
  select count(*) into n from public.client_quotes;
  insert into res values ('La lecture reste possible', 'oui', 'oui');
exception when others then
  insert into res values ('La lecture reste possible', 'oui', 'CASSÉE : ' || sqlerrm);
end $$;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
