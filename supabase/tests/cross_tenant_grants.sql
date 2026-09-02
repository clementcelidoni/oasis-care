-- LES DEUX PORTES QUE LE MILESTONE 11 A LAISSÉES OUVERTES.
--
-- Trouvées en revue avant fusion. Le motif est le même dans les deux
-- cas, et il est instructif :
--
--     using (public.has_permission(organization_id, 'clients.write'))
--
-- `organization_id` est ici la COLONNE DE LA LIGNE QU'ON ÉCRIT. La
-- politique demande donc « as-tu le droit d'écrire dans l'organisation
-- que tu viens de désigner ? » — et la réponse est oui, puisque
-- l'attaquant y met la sienne. Rien ne vérifie que l'AUTRE bout de la
-- ligne — la fiche client, le jardin — lui appartient aussi.
--
-- Une politique de ce genre a l'air juste : elle nomme une permission,
-- elle nomme une organisation. Il faut relire deux fois pour voir
-- qu'elle ne relie pas les deux extrémités de la ligne.
--
-- SANS EFFET DE BORD : transaction terminée par ROLLBACK.

begin;

create temp table res(nom text, attendu text, obtenu text) on commit drop;
create temp table ids(k text, v uuid) on commit drop;
grant all on res to authenticated;
grant all on ids to authenticated;

-- La victime.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('fffffff1-0000-4000-8000-0000000000f1','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','victime@test.invalid','',now(),now(),now(),'{}','{}');
-- L'attaquant : un professionnel parfaitement légitime, mais d'une
-- AUTRE organisation. Ce n'est pas un pirate, c'est un confrère.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values ('fffffff2-0000-4000-8000-0000000000f2','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','attaquant@test.invalid','',now(),now(),now(),'{}','{}');

-- ============================================================
-- La victime : une entreprise, un client, un devis, un jardin privé
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub','fffffff1-0000-4000-8000-0000000000f1')::text, true);
insert into ids select 'orgV', public.create_professional_organization('Victime SARL','landscaper');
insert into ids select 'wsV', workspace_id from public.business_organizations
  where id = (select v from ids where k='orgV');
set local role authenticated;

insert into ids select 'clientV', gen_random_uuid();
insert into public.crm_customers (id, organization_id, lifecycle_stage, display_name, notes)
select (select v from ids where k='clientV'), (select v from ids where k='orgV'),
       'customer', 'Client de la victime', 'Notes internes confidentielles';

insert into ids select 'devisV', gen_random_uuid();
insert into public.quotes (id, organization_id, customer_id, number, title, status)
select (select v from ids where k='devisV'), (select v from ids where k='orgV'),
       (select v from ids where k='clientV'),
       public.next_quote_number((select v from ids where k='orgV')),
       'Devis confidentiel', 'sent';

-- Le jardin PRIVÉ de la victime — celui que son iPhone synchronise.
insert into ids select 'jardinV', gen_random_uuid();
insert into public.gardens (id, workspace_id, name)
select (select v from ids where k='jardinV'), (select v from ids where k='wsV'), 'Jardin privé';

insert into public.garden_map_objects
  (id, workspace_id, garden_id, object_type, label,
   position_x_meters, position_y_meters, width_meters, height_meters)
select gen_random_uuid(), (select v from ids where k='wsV'),
       (select v from ids where k='jardinV'), 'tree', 'Arbre privé', 1, 1, 2, 2;

-- ============================================================
-- L'attaquant : sa propre entreprise, ses propres droits
-- ============================================================
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','fffffff2-0000-4000-8000-0000000000f2')::text, true);
insert into ids select 'orgA', public.create_professional_organization('Attaquant SARL','landscaper');
set local role authenticated;

-- Contrôle : sans rien faire, il ne voit rien. C'est l'état attendu.
insert into res select 'Au départ, il ne voit pas le devis de la victime', '0', count(*)::text
from public.quotes where id = (select v from ids where k='devisV');

insert into res select 'Ni son jardin', '0', count(*)::text
from public.gardens where id = (select v from ids where k='jardinV');

-- ============================================================
-- ATTAQUE 1 — se rattacher à la fiche client d'un autre
-- ============================================================
-- Il insère une ligne de `client_portal_access` : SON organisation,
-- LE CLIENT DE LA VICTIME, LUI-MÊME comme utilisateur. La politique
-- vérifie qu'il a `clients.write` sur l'organisation nommée — la
-- sienne — et le laisse passer.
do $$
begin
  insert into public.client_portal_access (organization_id, customer_id, user_id)
  values ((select v from ids where k='orgA'),
          (select v from ids where k='clientV'),
          'fffffff2-0000-4000-8000-0000000000f2');
  insert into res values ('Il se rattache à la fiche client d''une autre entreprise', 'refusé', 'ACCEPTÉ');
exception when others then
  insert into res values ('Il se rattache à la fiche client d''une autre entreprise', 'refusé', 'refusé');
end $$;

-- Et voilà ce que ça lui ouvre : les vues du portail sont en
-- `security definer` et ne filtrent que sur `my_customer_ids()`.
insert into res
select 'Le devis confidentiel devient lisible par le portail', '0', count(*)::text
from public.client_quotes where id = (select v from ids where k='devisV');

-- ============================================================
-- ATTAQUE 2 — s'accorder l'accès au jardin privé d'un autre
-- ============================================================
-- Même motif : la politique de `garden_access` demande une permission
-- sur l'organisation portée par la ligne, jamais que le JARDIN
-- appartienne à cette organisation.
do $$
begin
  insert into public.garden_access (garden_id, user_id, role, organization_id)
  values ((select v from ids where k='jardinV'),
          'fffffff2-0000-4000-8000-0000000000f2',
          'professional',
          (select v from ids where k='orgA'));
  insert into res values ('Il s''accorde l''accès au jardin privé d''un autre', 'refusé', 'ACCEPTÉ');
exception when others then
  insert into res values ('Il s''accorde l''accès au jardin privé d''un autre', 'refusé', 'refusé');
end $$;

insert into res
select 'Le jardin privé devient lisible', '0', count(*)::text
from public.gardens where id = (select v from ids where k='jardinV');

insert into res
select 'Et le plan qui va avec', '0', count(*)::text
from public.garden_map_objects where garden_id = (select v from ids where k='jardinV');

-- ============================================================
-- ATTAQUE 3 — un professionnel révoqué se ré-autorise
-- ============================================================
-- §"Le propriétaire peut retirer l'accès du professionnel" : si le
-- révoqué peut remettre `revoked_at` à NULL lui-même, la promesse ne
-- vaut rien.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','fffffff1-0000-4000-8000-0000000000f1')::text, true);
set local role authenticated;

-- La victime révoque tout accès de l'attaquant à son jardin.
update public.garden_access set revoked_at = now()
where garden_id = (select v from ids where k='jardinV')
  and user_id = 'fffffff2-0000-4000-8000-0000000000f2';

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','fffffff2-0000-4000-8000-0000000000f2')::text, true);
set local role authenticated;

do $$
begin
  update public.garden_access set revoked_at = null
  where garden_id = (select v from ids where k='jardinV')
    and user_id = 'fffffff2-0000-4000-8000-0000000000f2';
  if found then
    insert into res values ('Un révoqué se ré-autorise tout seul', 'non', 'OUI');
  else
    insert into res values ('Un révoqué se ré-autorise tout seul', 'non', 'non');
  end if;
exception when others then
  insert into res values ('Un révoqué se ré-autorise tout seul', 'non', 'non');
end $$;

-- ============================================================
-- CE QUI DOIT CONTINUER DE MARCHER
-- ============================================================
-- Une correction qui fermerait aussi le chemin légitime ne serait pas
-- une correction. La victime invite SON client, sur SA fiche.
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub','fffffff1-0000-4000-8000-0000000000f1')::text, true);
set local role authenticated;

do $$
declare jeton text;
begin
  jeton := public.invite_client((select v from ids where k='clientV'), 'client@test.invalid');
  insert into res values ('Le chemin légitime marche toujours — invitation', 'oui',
                          case when length(jeton) = 64 then 'oui' else 'non' end);
exception when others then
  insert into res values ('Le chemin légitime marche toujours — invitation', 'oui',
                          'CASSÉ : ' || sqlerrm);
end $$;

reset role;

select nom, attendu, obtenu,
       case when attendu = obtenu then 'OK' else 'ÉCHEC' end as verdict
from res;

rollback;
